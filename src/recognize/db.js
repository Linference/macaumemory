// 澳門記憶 · 建築普查建檔：SQLite 資料層（sqlite-wasm）
//
// ─────────────────────────────────────────────────────────────────────────
// 為什麼用 @sqlite.org/sqlite-wasm（官方版），不是 sql.js
// ─────────────────────────────────────────────────────────────────────────
// 普查的核心需求是「用 R-Tree 找出半徑內的既有記錄」，所以第一件事是確認
// R-Tree 模組有沒有被編進 WASM。實測（Node，見 tools/recognize/check-survey-db.mjs）：
//   · sql.js 1.14.2 → `pragma compile_options` 只有 ENABLE_FTS3；
//     `CREATE VIRTUAL TABLE ... USING rtree` 直接失敗：no such module: rtree ❌
//   · @sqlite.org/sqlite-wasm 3.53.4 → compile_options 有 ENABLE_RTREE（還有 FTS5、
//     JSON、math functions），rtree 建表／查詢／匯出都正常 ✅
// 另外官方版內建 OPFS VFS（第二階段持久化只要換一個 adapter，見檔尾說明），
// sql.js 沒有；R-Tree 是硬需求，所以選官方版。
//
// ─────────────────────────────────────────────────────────────────────────
// WASM 在 Vite 裡怎麼載入（先前踩過坑：public/ 的 wasm 被 import → 整頁白屏）
// ─────────────────────────────────────────────────────────────────────────
// 那次的錯誤是 `Cannot import non-asset file .../public/ort/*.wasm which is inside /public`：
// Vite 不允許 import public/ 底下的檔案（public/ 的東西只能「執行期用 URL 取」）。
// 這次的做法完全避開 public/：
//   ① npm 套件本身就在 node_modules/，不在 public/。
//   ② 用 Vite 官方的資產寫法 `import url from "@sqlite.org/sqlite-wasm/sqlite3.wasm?url"`，
//      讓 Vite 自己決定 URL（dev：/node_modules/...；build：複製到 assets/ 並改寫成相對路徑）。
//      `?url` 是「當資產」而不是「當模組 import」，所以不會觸發 wasm→ESM 的解析。
//   ③ 把該 URL 交給 initSqlite({ locateFile })，**不讓套件自己用 import.meta.url 猜**——
//      打包後 import.meta.url 指向 assets/index-xxxx.js，相對路徑 sqlite3.wasm 會 404。
//   ④ vite.config.js 的 optimizeDeps.exclude 必須含這個套件（官方 README 指定），
//      否則預打包會把 JS 外殼搬進 .vite/deps，相對路徑一起壞掉。
// 驗證方式：tools/recognize/check-survey-db.mjs（Node，直接跑同一份 SQL）＋
//          tools/recognize/browser-check-survey.mjs（瀏覽器，真的走 Vite 的資產路徑）。

import { bboxForRadius, haversineM, round5 } from "./geo-math.js";

/** 這個檔案裡唯一的 SQL 來源：schema 變更時只要改這裡 ＋ 提高 SCHEMA_VERSION */
export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 普查建檔主表。欄位對齊需求單的建議 schema，另外補上「這筆座標可不可信」需要的欄位：
--   accuracy_m / sample_count / geo_source   ← 需求單要求
--   geo_best_accuracy_m / geo_spread_m / geo_stop_reason ← 多次取樣的過程資訊
--   detector_* / dedup_*                     ← 這筆紀錄是由什麼辨識結果、什麼查重結論產生的
CREATE TABLE IF NOT EXISTS buildings (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  code              TEXT    NOT NULL UNIQUE,     -- 編號 MM-YYYY-NNNN
  type              TEXT    NOT NULL,            -- YOLO 類別（12 類）
  name              TEXT,                        -- 可留空（留空時自動命名）
  note              TEXT,
  lat               REAL,
  lng               REAL,
  accuracy_m        REAL,                        -- 最終精度估計（公尺）
  sample_count      INTEGER,                     -- 取了幾次讀數
  geo_source        TEXT,                        -- gps / wifi / manual / none
  geo_best_accuracy_m REAL,                      -- 樣本中最好的單次精度
  geo_spread_m      REAL,                        -- 樣本離散（公尺）＝跳動程度
  geo_stop_reason   TEXT,                        -- 停止取樣的原因
  geo_note          TEXT,                        -- 座標的補充說明（例如「GPS 原讀數 ±42m，已手動修正」）
  captured_at       TEXT,                        -- 定位時間（ISO）
  status            TEXT    NOT NULL DEFAULT 'pending',  -- pending / approved
  photo_name        TEXT,
  detector_score    REAL,
  detector_cls      TEXT,
  detector_source   TEXT,                        -- yolo / fallback（整張圖）
  detector_box      TEXT,                        -- JSON：{x,y,w,h}
  dedup_sim         REAL,                        -- 存檔時的最高影像相似度
  dedup_compared    INTEGER,                     -- 比對了幾棟
  encoder           TEXT,
  created_at        TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_buildings_type       ON buildings(type);
CREATE INDEX IF NOT EXISTS idx_buildings_geo_source ON buildings(geo_source);
CREATE INDEX IF NOT EXISTS idx_buildings_created    ON buildings(created_at);

-- R-Tree 空間索引：id 對應 buildings.id，四欄是外接矩形。
-- SQLite 的 rtree 座標是 32 位元浮點（113.54 附近解析度約 1 公尺），
-- 所以它只當「粗篩」，精確距離用 buildings.lat/lng 算 haversine 再過濾。
CREATE VIRTUAL TABLE IF NOT EXISTS buildings_rtree USING rtree(id, minlat, maxlat, minlng, maxlng);
`;

// ---------------------------------------------------------------------------
// 持久化 provider：把整個 DB 匯出成位元組寫進裝置，下次開啟再還原
//
// ⚠️ 這一節是「重新整理後資料全部消失」的修正。介面在上一輪就預留好了
// （load / save / clear，見下面 memoryPersistence 的註解），缺的是實作，這裡補上。
//
// 三種 provider：
//   · opfsPersistence         —— OPFS（容量無上限）；**不需要 Worker**
//   · localStoragePersistence —— localStorage（約 5 MB）；最務實的後備
//   · memoryPersistence       —— 什麼都不存（Node 測試、或兩種儲存都不能用時）
// openDb() 會依可用性自動挑（OPFS → localStorage → memory），並把「用了哪一種」
// 回報給 UI（dbState().persistenceLabel），讓使用者一眼看得出資料到底有沒有存下來。
//
// ── 為什麼不用 sqlite-wasm 官方的 OpfsDb（sqlite3.oo1.OpfsDb）？ ──
//   ① OpfsDb 走的是 OPFS VFS，而 VFS 的 createSyncAccessHandle() **只能在 Worker 裡**呼叫，
//      等於要把 SQLite 初始化搬進 Worker：整個資料層（insertBuilding／findNearby…）會被
//      迫改成非同步訊息往返，UI 與測試的同步呼叫全部要重寫——這是一次高風險的大重構。
//   ② 這個專案在 Vite 的 WASM 資產路徑上已經踩過坑（見檔頭：放 public/ 會整頁白屏），
//      再動一次初始化流程的代價太高。
//   ③ 需求其實不需要「SQLite 直接長在 OPFS 上」：普查一次幾百到幾千筆，整庫匯出才幾百 KB，
//      每次存檔「匯出位元組 → 寫檔」完全夠用（存檔本來就有節流，見 SAVE_DEBOUNCE_MS）。
//   所以這裡用**非同步的 OPFS API**（getFileHandle / createWritable / getFile）在主執行緒
//   讀寫「DB 匯出的位元組」——不需要 sync access handle，因此不需要 Worker。
//
// ── 還原方式：sqlite3_deserialize（真的把資料還原，不是只記一筆 meta） ──
//   官方 WASM 有匯出 sqlite3_deserialize。用法：
//     const p = sqlite3.wasm.allocFromTypedArray(bytes);   // 用 sqlite3_malloc 配的記憶體
//     sqlite3.capi.sqlite3_deserialize(db.pointer, "main", p, n, n,
//       SQLITE_DESERIALIZE_FREEONCLOSE | SQLITE_DESERIALIZE_RESIZEABLE);
//   已用 Node 探針驗過：資料列、R-Tree 虛擬表都完整還原，而且可以再次匯出。
//
// ── 「最後一筆沒落地」的保險（sync snapshot） ──
//   高頻寫入有節流（350 ms）。如果使用者在節流窗內就按了重新整理，非同步的 OPFS 寫入
//   可能來不及完成。所以主 provider 是 OPFS 時，會**同步**再寫一份位元組快照到
//   localStorage（setItem 是同步 API，關頁時一定寫得完）；下次開啟時兩份比時間戳，取新的。
//   localStorage 當主 provider 時它本身就是同步寫入，不需要快照。
// ---------------------------------------------------------------------------

export const DB_STORAGE_KEY = "macau-memory.sqlite";            // localStorage provider 的主鍵
export const DB_SHADOW_KEY = "macau-memory.sqlite.shadow";      // OPFS 的同步快照（備援）
export const MIRROR_KEY = "macau-memory.pending-discoveries";   // 舊版逐筆鏡射（要遷移進 DB）
const OPFS_FILE = "macau-survey.sqlite3";
const OPFS_PROBE = ".macau-survey-probe";
const SNAPSHOT_VERSION = 1;

// 節流：連續寫入合併成一次；但最多延後 SAVE_MAX_DELAY_MS，避免「一直有寫入就永遠不存」
export const SAVE_DEBOUNCE_MS = 350;
const SAVE_MAX_DELAY_MS = 1500;
const SAVE_RETRIES = 3;

// ---------------------------------------------------------------- 小工具
const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** localStorage 只能存字串：Uint8Array ⇄ base64（分塊處理，避免大陣列一次展開爆 call stack） */
function bytesToBase64(bytes) {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 配額爆掉：各瀏覽器的 name／code 不一樣，一起認 */
const isQuotaError = (e) =>
  !!e && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22 || e.code === 1014);

const quotaHint = (bytes) =>
  `本機儲存空間不足（QuotaExceededError）：這份資料庫匯出後 ${kb(bytes?.length ?? bytes ?? 0)}，超過瀏覽器給這個網站的額度`
  + `（localStorage 通常約 5 MB）。建議：① 先按「匯出 .sqlite」把資料存成檔案；`
  + `② 再按「清空資料庫」或清除舊資料後重新開始；③ 或改用支援 OPFS 的瀏覽器（Chrome／Edge）就沒有這個上限。`;

/** 是不是一個像樣的 SQLite 檔（避免把半截寫入／垃圾位元組餵給 sqlite3_deserialize） */
function looksLikeSqlite(bytes) {
  if (!bytes || bytes.length < 512) return false;
  const magic = "SQLite format 3\0";
  for (let i = 0; i < magic.length; i++) if (bytes[i] !== magic.charCodeAt(i)) return false;
  const pageSize = (bytes[16] << 8) | bytes[17];
  const size = pageSize === 1 ? 65536 : pageSize;      // 1 代表 65536（SQLite 的編碼）
  if (size < 512 || (size & (size - 1)) !== 0) return false;
  return bytes.length % size === 0;
}

/** 快照物件（localStorage 用）：{v, provider, at, bytes:"base64"} */
function packSnapshot(bytes, provider) {
  return JSON.stringify({ v: SNAPSHOT_VERSION, provider, at: Date.now(), size: bytes.length, bytes: bytesToBase64(bytes) });
}
function unpackSnapshot(raw) {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    const bytes = base64ToBytes(o.bytes ?? "");
    if (!bytes.length) return null;
    return { bytes, at: Number(o.at) || 0, size: bytes.length };
  } catch { return null; }
}
const newerOf = (a, b) => (!a ? b : !b ? a : (b.at ?? 0) > (a.at ?? 0) ? b : a);

// ---------------------------------------------------------------- memory
/** 什麼都不做：Node 測試、或瀏覽器兩種儲存都不能用時的後備（重新整理即清空） */
export const memoryPersistence = {
  name: "memory",
  label: "記憶體（重整即清空）",
  persistent: false,
  async available() { return true; },
  async load() { return null; },
  async save() { return { ok: false, reason: "memory", bytes: 0 }; },
  async clear() { return false; },
};

// ---------------------------------------------------------------- localStorage
export const localStoragePersistence = {
  name: "localStorage",
  label: "本機儲存 localStorage（容量約 5 MB）",
  persistent: true,

  async available() {
    try {
      if (typeof localStorage === "undefined") return false;
      localStorage.setItem("macau-memory.probe", "1");
      const v = localStorage.getItem("macau-memory.probe");
      localStorage.removeItem("macau-memory.probe");
      return v === "1";
    } catch { return false; }        // 隱私模式／被封鎖的第三方儲存
  },

  async load() {
    const snap = unpackSnapshot(localStorage.getItem(DB_STORAGE_KEY));
    if (!snap) return null;
    return { bytes: snap.bytes, at: snap.at, source: "localStorage" };
  },

  /**
   * 同步寫入（setItem 本身是同步的；函式裡在 setItem 之前**不能有 await**，
   * 這樣 pagehide 時呼叫它才會真的寫完）。
   */
  save(bytes) {
    try {
      localStorage.setItem(DB_STORAGE_KEY, packSnapshot(bytes, "localStorage"));
      return { ok: true, bytes: bytes.length, at: Date.now() };
    } catch (e) {
      if (isQuotaError(e)) {
        const err = new Error(quotaHint(bytes));
        err.userMessage = err.message;
        err.quota = true;
        err.bytes = bytes.length;
        throw err;
      }
      const err = new Error(`寫入 localStorage 失敗：${e?.message ?? e}`);
      err.userMessage = err.message;
      throw err;
    }
  },

  async clear() {
    try { localStorage.removeItem(DB_STORAGE_KEY); } catch { /* 忽略 */ }
    return true;
  },

  /** 毀損的資料移開（不要直接蓋掉，萬一還有救） */
  async quarantine() {
    try {
      const raw = localStorage.getItem(DB_STORAGE_KEY);
      if (!raw) return null;
      const key = `${DB_STORAGE_KEY}.corrupt-${Date.now()}`;
      localStorage.setItem(key, raw);
      localStorage.removeItem(DB_STORAGE_KEY);
      return key;
    } catch { return null; }
  },
};

// ---------------------------------------------------------------- OPFS
/**
 * OPFS 持久化（**非同步 API，不用 Worker**）。
 * load 會同時看 OPFS 檔案與 localStorage 的同步快照，取時間戳較新的那一份。
 */
export const opfsPersistence = {
  name: "opfs",
  label: "OPFS（容量無上限）",
  persistent: true,

  /** 真的寫一次、讀一次再刪掉：只檢查 API 存在不夠（Firefox 有 OPFS 但沒有 createWritable） */
  async available() {
    try {
      if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) return false;
      const root = await navigator.storage.getDirectory();
      const h = await root.getFileHandle(OPFS_PROBE, { create: true });
      const w = await h.createWritable();          // Firefox 沒有這個方法 → 丟錯 → 回 false
      await w.write(new Uint8Array([0x4d, 0x4d]));
      await w.close();
      const f = await h.getFile();
      const ab = await f.arrayBuffer();
      await root.removeEntry(OPFS_PROBE).catch(() => {});
      return ab.byteLength === 2 && new Uint8Array(ab)[0] === 0x4d;
    } catch { return false; }
  },

  async handle({ create = false } = {}) {
    const root = await navigator.storage.getDirectory();
    return root.getFileHandle(OPFS_FILE, { create });
  },

  async load() {
    let fromFile = null;
    try {
      const h = await this.handle();               // 沒有 create：檔案不存在就丟錯
      const f = await h.getFile();
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (bytes.length) fromFile = { bytes, at: Number(f.lastModified) || 0, source: "OPFS" };
    } catch { fromFile = null; }
    const snap = unpackSnapshot(localStorage.getItem(DB_SHADOW_KEY));
    const fromShadow = snap ? { bytes: snap.bytes, at: snap.at, source: "localStorage 同步快照" } : null;
    return newerOf(fromFile, fromShadow);
  },

  async save(bytes) {
    const root = await navigator.storage.getDirectory();
    const h = await root.getFileHandle(OPFS_FILE, { create: true });
    const w = await h.createWritable();
    try { await w.write(bytes); } finally { await w.close(); }
    return { ok: true, bytes: bytes.length, at: Date.now() };
  },

  async clear() {
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(OPFS_FILE).catch(() => {});
    } catch { /* 忽略 */ }
    try { localStorage.removeItem(DB_SHADOW_KEY); } catch { /* 忽略 */ }
    return true;
  },

  async quarantine() {
    try {
      const root = await navigator.storage.getDirectory();
      const name = `${OPFS_FILE}.corrupt-${Date.now()}`;
      const old = await root.getFileHandle(OPFS_FILE);          // 不存在就丟錯 → 回 null
      const bytes = new Uint8Array(await (await old.getFile()).arrayBuffer());
      const fresh = await root.getFileHandle(name, { create: true });
      const w = await fresh.createWritable();
      try { await w.write(bytes); } finally { await w.close(); }
      await root.removeEntry(OPFS_FILE);
      return name;
    } catch { return null; }
  },
};

/** 主動申請「持久化儲存」：被瀏覽器接受就不會因為空間不足被自動清除（Chrome 不會跳詢問） */
async function requestPersistentStorage() {
  try {
    if (!navigator.storage?.persist) return null;
    const already = await navigator.storage.persisted?.();
    if (already) return true;
    return await navigator.storage.persist();
  } catch { return null; }
}

/**
 * 依可用性挑 provider：URL 的 ?persist= 可以強制指定（測試與除錯用）。
 * 順序：OPFS → localStorage → memory。
 */
export async function pickPersistence(prefer = null) {
  const forced = typeof location !== "undefined"
    ? new URLSearchParams(location.search).get("persist")
    : null;
  const want = prefer ?? forced;
  const byName = { opfs: opfsPersistence, localStorage: localStoragePersistence, memory: memoryPersistence };
  if (want && byName[want]) {
    const p = byName[want];
    const usable = want === "memory" ? true : await p.available();
    if (usable) return { provider: p, reason: `由 ?persist=${want} 指定` };
    return { provider: memoryPersistence, reason: `?persist=${want} 指定的儲存不可用（已退回記憶體）` };
  }
  if (await opfsPersistence.available()) return { provider: opfsPersistence, reason: "OPFS 可用（容量無上限），優先使用" };
  if (await localStoragePersistence.available()) return { provider: localStoragePersistence, reason: "OPFS 不可用（例如 Firefox 沒有 createWritable），改用 localStorage" };
  return { provider: memoryPersistence, reason: "這個瀏覽器兩種儲存都不能用（隱私模式？），只能留在記憶體" };
}

const state = {
  sqlite3: null,
  db: null,
  persistence: memoryPersistence,
  persistenceReason: null,
  storagePersisted: null,
  error: null,
  ready: false,
  initMs: null,
  // 持久化狀態
  restoring: false,
  restoredFrom: null,        // { rows, source, savedAt, bytes }
  restoreError: null,        // 舊檔毀損／schema 不符等（可讀中文）
  quarantined: null,         // 毀損檔被移到哪裡
  schemaMismatch: null,
  migration: null,           // 鏡射遷移結果（見 migrateMirrorRecords）
  mirrorPending: 0,          // 還沒遷進 DB 的鏡射筆數
  lastSavedAt: null,
  lastSavedBytes: null,
  lastSaveMs: null,
  lastSaveError: null,       // { message, quota, at }
  saveCount: 0,
  shadowError: null,
  dirty: false,
  dirtySince: null,
  saveTimer: null,
  saving: false,
  saveAgain: false,
};

/** 持久化狀態（UI 診斷區塊用；不查資料庫，可以隨便呼叫） */
export const persistenceStatus = () => ({
  name: state.persistence.name,
  label: state.persistence.label,
  persistent: !!state.persistence.persistent,
  reason: state.persistenceReason,
  storagePersisted: state.storagePersisted,
  lastSavedAt: state.lastSavedAt,
  lastSavedBytes: state.lastSavedBytes,
  lastSaveMs: state.lastSaveMs,
  lastSaveError: state.lastSaveError,
  saveCount: state.saveCount,
  shadowError: state.shadowError,
  dirty: state.dirty,
  restoredFrom: state.restoredFrom,
  restoreError: state.restoreError,
  quarantined: state.quarantined,
  schemaMismatch: state.schemaMismatch,
  migration: state.migration,
  mirrorPending: state.mirrorPending,
});

export const dbState = () => ({
  ready: state.ready,
  error: state.error,
  initMs: state.initMs,
  persistence: state.persistence.name,
  persistent: !!state.persistence.persistent,
  persistenceLabel: state.persistence.label,
  persistenceReason: state.persistenceReason,
  schemaVersion: state.ready ? schemaVersion() : null,
  engine: state.ready ? `SQLite ${state.sqlite3?.version?.libVersion ?? "?"}（sqlite-wasm）` : null,
  rtree: state.ready ? countRtree() : 0,
  rows: state.ready ? countBuildings() : null,
  restoredFrom: state.restoredFrom,
  restoreError: state.restoreError,
  migration: state.migration,
  lastSavedAt: state.lastSavedAt,
  lastSavedBytes: state.lastSavedBytes,
  lastSaveError: state.lastSaveError,
});
export const rawDb = () => state.db;

/** 測試／除錯用：把上一次的 SQL 記下來（普查頁的「技術細節」會顯示查重用的 SQL） */
export const lastQueries = { nearby: null, stats: null, insert: null };

let wasmUrlPromise = null;
/**
 * Vite 的 `?url` 資產匯入。
 * 用動態匯入 ＋ try/catch 是刻意的：Node 端（check-survey-db.mjs）跑同一份 db.js 時
 * 沒有 Vite 的 `?url` 轉換，這裡會失敗——此時回傳 null，讓套件自己用 import.meta.url
 * 找 wasm（Node 建置版本剛好可以這樣找）。
 */
function sqliteWasmUrl() {
  if (!wasmUrlPromise) {
    wasmUrlPromise = import("@sqlite.org/sqlite-wasm/sqlite3.wasm?url")
      .then((m) => m.default ?? null)
      .catch(() => null);
  }
  return wasmUrlPromise;
}

/** provider.load() 可以回 Uint8Array（舊契約）或 {bytes, at, source}；這裡統一 */
function normalizeLoad(res) {
  if (!res) return null;
  if (res instanceof Uint8Array) return res.length ? { bytes: res, at: 0, source: "provider" } : null;
  const bytes = res.bytes instanceof Uint8Array ? res.bytes : null;
  return bytes?.length ? { bytes, at: Number(res.at) || 0, source: res.source ?? "provider" } : null;
}

/** 把匯出的位元組還原成資料庫（sqlite3_deserialize；見檔尾持久化章節的說明） */
function deserializeIntoDb(bytes) {
  const { sqlite3, db } = state;
  const p = sqlite3.wasm.allocFromTypedArray(bytes);      // 用 sqlite3_malloc 配，才能交給 FREEONCLOSE
  const flags = sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE;
  const rc = sqlite3.capi.sqlite3_deserialize(db.pointer, "main", p, bytes.length, bytes.length, flags);
  if (rc !== 0) {
    // 失敗時不主動 dealloc：FREEONCLOSE 的記憶體所有權在 SQLite 手上，寧可漏一小塊也不要 double free
    throw new Error(`還原資料庫失敗（sqlite3_deserialize rc=${rc}）`);
  }
}

/**
 * 開啟（或建立）資料庫：初始化 sqlite-wasm → 挑持久化 provider → 還原舊資料 → 遷移舊鏡射。
 * 可重複呼叫；失敗會 throw 帶中文說明的 Error。
 * @param {{persistence?: object, prefer?: string, migrate?: boolean}} opts
 *        persistence 明確給就用它；否則依可用性自動挑（?persist= 可強制，見 pickPersistence）
 */
export async function openDb({ persistence = null, prefer = null, migrate = true } = {}) {
  if (state.ready) return state;
  const t0 = Date.now();
  try {
    const initSqlite = (await import("@sqlite.org/sqlite-wasm")).default;
    const url = await sqliteWasmUrl();
    const sqlite3 = await initSqlite(url ? { locateFile: () => url } : {});
    // 套件在少數情況下會用 config.log 印內部訊息；普查頁不需要那些雜訊，但錯誤要留著。
    try { sqlite3.config.log = () => {}; } catch { /* 舊版沒有這個欄位 */ }
    state.sqlite3 = sqlite3;

    // ① 挑 provider（明確指定 > ?persist= > OPFS > localStorage > memory）
    if (!persistence) {
      const picked = await pickPersistence(prefer);
      persistence = picked.provider;
      state.persistenceReason = picked.reason;
    } else {
      state.persistenceReason = "由呼叫端指定";
    }
    state.persistence = persistence;
    if (persistence.name === "opfs") state.storagePersisted = await requestPersistentStorage();

    // open flags "c" = create；**不要**加 "t"（t 會讓 DB 建構子安裝 sqlite3_trace_v2，
    // 每一句 SQL 都印到 console——除錯用得到，正式流程只會洗版）
    // 一律先開記憶體 DB，再把持久化的位元組 deserialize 進來（見檔頭持久化章節）。
    state.db = new sqlite3.oo1.DB(":memory:", "c");

    // ② 還原舊資料（這一段是「重新整理後資料還在」的關鍵）
    let loaded = null;
    if (persistence.persistent) {
      state.restoring = true;
      try {
        loaded = normalizeLoad(await persistence.load());
      } catch (e) {
        state.restoreError = `讀取舊資料失敗：${e?.message ?? e}`;
        console.warn("[survey] persistence.load 失敗", e);
      } finally {
        state.restoring = false;
      }
    }
    if (loaded) {
      if (looksLikeSqlite(loaded.bytes)) {
        try {
          deserializeIntoDb(loaded.bytes);
          // ⚠ 這裡**不能**用 countBuildings()／selectValue()：那兩個會經過 requireDb()，
          // 而 state.ready 這時候還是 false（還在 openDb 裡面），會丟「SQLite 還沒就緒」
          // 而被誤判成「舊資料毀損」——實測踩過，會讓還原整條路失效。
          state.restoredFrom = {
            rows: Number(state.db.selectValue("SELECT COUNT(*) FROM buildings")),
            source: loaded.source,
            savedAt: loaded.at ? new Date(loaded.at).toISOString() : null,
            bytes: loaded.bytes.length,
          };
          const v = Number((() => { try { return state.db.selectValue("SELECT value FROM meta WHERE key = 'schema_version'"); } catch { return 0; } })() ?? 0);
          if (v && v !== SCHEMA_VERSION) {
            state.schemaMismatch = `舊資料的 schema v${v} 與目前 v${SCHEMA_VERSION} 不同（已直接開啟；欄位若不一致請匯出備份）`;
          }
        } catch (e) {
          // 毀損的舊檔：隔離它、從空的資料庫開始，**絕對不要**讓它靜默地被空資料庫蓋掉
          state.restoreError = `舊資料無法還原（${e?.message ?? e}），已從空的資料庫開始`;
          state.quarantined = await persistence.quarantine?.().catch(() => null) ?? null;
          try { state.db.close(); } catch { /* 已經壞掉的連線，關不掉就算了 */ }
          state.db = new sqlite3.oo1.DB(":memory:", "c");
          console.warn("[survey] 舊資料還原失敗：", e);
        }
      } else {
        state.restoreError = `舊資料不是有效的 SQLite 檔（${loaded.bytes.length} bytes），已忽略`;
        state.quarantined = await persistence.quarantine?.().catch(() => null) ?? null;
        console.warn("[survey] 舊資料標頭不合法，已隔離");
      }
    }

    // ③ schema（IF NOT EXISTS：還原回來的庫已經有表，這裡是全新的庫才真的建）
    state.db.exec(SCHEMA_SQL);
    state.db.exec({
      sql: "INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)",
      bind: ["schema_version", String(SCHEMA_VERSION)],
    });
    state.db.exec({ sql: "INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)", bind: ["created_at", new Date().toISOString()] });

    state.ready = true;
    state.error = null;
    state.initMs = Date.now() - t0;

    // ④ 救援舊資料：把 localStorage 的逐筆鏡射遷進資料庫（依 code 去重，見 migrateMirrorRecords）
    if (migrate) {
      try {
        state.migration = migrateMirrorRecords();
        state.mirrorPending = pendingMirrorCount();
      } catch (e) {
        console.warn("[survey] 鏡射遷移失敗", e);
      }
    }

    // ⑤ 第一次存檔：讓裝置上真的有一份檔（也讓「最後儲存時間」有個起點）
    if (persistence.persistent) {
      state.dirty = true;
      state.dirtySince = Date.now();
      await flushPersistence();
    }
    return state;
  } catch (e) {
    state.ready = false;
    state.error = e?.message ?? String(e);
    throw new Error(`SQLite 初始化失敗：${state.error}`);
  }
}

function requireDb() {
  if (!state.ready || !state.db) throw new Error("SQLite 還沒就緒");
  return state.db;
}

export const schemaVersion = () => Number(selectValue("SELECT value FROM meta WHERE key = 'schema_version'", [], 0)) || SCHEMA_VERSION;

// ------------------------------------------------------------------ 小工具
function selectObjects(sql, bind = []) {
  const db = requireDb();
  // 空陣列不能傳進 bind：OO1 的 bind([]) 會對「沒有參數的語句」丟
  // "This statement has no bindable parameters"（實測踩過）
  return bind?.length ? db.selectObjects(sql, bind) : db.selectObjects(sql);
}
function selectValue(sql, bind = [], dflt = null) {
  const db = requireDb();
  const v = bind?.length ? db.selectValue(sql, bind) : db.selectValue(sql);
  return v === undefined ? dflt : v;
}
const nowIso = () => new Date().toISOString();
const year_ = () => new Date().getFullYear();

// ------------------------------------------------------------------ 編號
/** MM-YYYY-NNNN；序號固定 4 位，超過 9999 自動變寬（不截斷、不重號） */
export const formatCode = (year, seq) => `MM-${year}-${String(seq).padStart(4, "0")}`;

const seqKey = (year) => `code_seq:${year}`;

/** 目前各年度已配到的最大序號（含已刪除的紀錄：序號單調遞增、不重用） */
function maxSeq(year) {
  // 快路徑：meta 的計數器（每次配號都會寫回去）。沒有計數器時（第一次用、
  // 或匯入外部 .sqlite）才掃一次資料表——掃描交給 SQLite 用 substr 取序號，
  // 不要用 JS 逐列 parse（2 萬筆時每筆插入都掃全表會變成 O(n²)，實測會卡死）。
  const fromMeta = Number(selectValue("SELECT value FROM meta WHERE key = ?", [seqKey(year)], 0)) || 0;
  if (fromMeta > 0) return fromMeta;
  const maxRow = Number(
    selectValue("SELECT COALESCE(MAX(CAST(substr(code, 9) AS INTEGER)), 0) FROM buildings WHERE code LIKE ?", [`MM-${year}-%`], 0),
  ) || 0;
  return maxRow;
}

/**
 * 下一個編號（不會寫入任何東西；真正配號在 insertBuilding 的交易裡做）。
 * @param {number} year
 * @param {Iterable<string>} extraTaken 其他來源已用掉的編號（例如 localStorage 備份裡的），
 *        避免「重新整理後資料庫清空、備份還在」時又配到同一個編號。
 */
export function peekNextCode(year = year_(), extraTaken = []) {
  const taken = new Set(extraTaken);
  let seq = maxSeq(year) + 1;
  while (taken.has(formatCode(year, seq))) seq++;
  return formatCode(year, seq);
}

// ------------------------------------------------------------------ 新增
/**
 * 寫入一筆普查紀錄（同一個交易內同時更新 R-Tree）。
 *
 * rec.code 有給就用它（**遷移用**：要把 localStorage 鏡射裡的舊編號原封不動搬進來）；
 * 沒給就自動配號 MM-YYYY-NNNN。
 * @returns {object} 完整資料列（含 id / code）
 */
export function insertBuilding(rec) {
  const db = requireDb();
  let year = Number(rec.year) || year_();
  const created = rec.createdAt ?? nowIso();
  const explicit = typeof rec.code === "string" && /^MM-\d{4}-\d+$/.test(rec.code.trim()) ? rec.code.trim() : null;
  let row = null;
  db.transaction(() => {                                  // 交易：編號配置＋主表＋R-Tree 要嘛全成、要嘛全不成
    let seq = maxSeq(year) + 1;
    let code = explicit ?? formatCode(year, seq);
    if (explicit) {
      // 指定編號時，年度與序號都以編號本身為準（否則 meta 的計數器會落後，之後配號會撞號）
      const m = /^MM-(\d{4})-(\d+)$/.exec(explicit);
      year = Number(m[1]);
      seq = Number(m[2]);
    }
    let id = null;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        db.exec({
          sql: `INSERT INTO buildings
            (code, type, name, note, lat, lng, accuracy_m, sample_count, geo_source,
             geo_best_accuracy_m, geo_spread_m, geo_stop_reason, geo_note, captured_at, status, photo_name,
             detector_score, detector_cls, detector_source, detector_box, dedup_sim, dedup_compared,
             encoder, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          bind: [
            code, rec.type, rec.name ?? null, rec.note ?? null,
            rec.lat ?? null, rec.lng ?? null, rec.accuracyM ?? null, rec.sampleCount ?? null, rec.geoSource ?? "none",
            rec.geoBestAccuracyM ?? null, rec.geoSpreadM ?? null, rec.geoStopReason ?? null, rec.geoNote ?? null,
            rec.capturedAt ?? null, rec.status ?? "pending", rec.photoName ?? null,
            rec.detectorScore ?? null, rec.detectorCls ?? null, rec.detectorSource ?? null,
            rec.detectorBox ? JSON.stringify(rec.detectorBox) : null,
            rec.dedupSim ?? null, rec.dedupCompared ?? null, rec.encoder ?? null, created,
          ],
        });
        id = Number(selectValue("SELECT last_insert_rowid()", [], null));
        lastQueries.insert = "INSERT INTO buildings (...) VALUES (...) ; INSERT INTO buildings_rtree(id, minlat, maxlat, minlng, maxlng) VALUES (...)";
        break;
      } catch (e) {
        // 指定編號撞號時**不要**偷偷換號（那會讓遷移的編號對不上），直接讓呼叫端處理
        if (explicit) throw e;
        if (/UNIQUE/i.test(e?.message ?? "") && attempt < 99) { seq++; code = formatCode(year, seq); continue; }
        throw e;
      }
    }
    if (id == null) throw new Error("配號失敗：連續 100 次都撞到重複編號");
    if (rec.lat != null && rec.lng != null) {
      // 點狀資料 → 外接矩形退化為一個點；查詢時再從查詢端把框放大
      db.exec({
        sql: "INSERT INTO buildings_rtree(id, minlat, maxlat, minlng, maxlng) VALUES (?,?,?,?,?)",
        bind: [id, rec.lat, rec.lat, rec.lng, rec.lng],
      });
    }
    // 序號計數器只前進、不後退（遷移進來一筆 0007 之後，下一筆要是 0008）
    const prev = Number(selectValue("SELECT value FROM meta WHERE key = ?", [seqKey(year)], 0)) || 0;
    if (seq > prev) db.exec({ sql: "INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)", bind: [seqKey(year), String(seq)] });
    row = getBuilding(id);
  });
  markDirty();
  return row;
}

/** 這個編號在資料庫裡已经有了嗎（遷移去重用的就是這一句） */
export const codeExists = (code) => !!selectValue("SELECT 1 FROM buildings WHERE code = ?", [code], null);

export const getBuilding = (id) => selectObjects("SELECT * FROM buildings WHERE id = ?", [id])[0] ?? null;
export const countBuildings = () => Number(selectValue("SELECT COUNT(*) FROM buildings", [], 0));
export const countRtree = () => Number(selectValue("SELECT COUNT(*) FROM buildings_rtree", [], 0));
export const listBuildings = (limit = 200) => selectObjects("SELECT * FROM buildings ORDER BY id DESC LIMIT ?", [limit]);

/**
 * ⭐ 空間查重（普查的核心需求）：找出半徑 radiusM 內的既有記錄。
 *
 * SQL 兩段式：
 *   ① R-Tree 粗篩（用不到 trig，走虛擬表的巢狀節點）
 *        SELECT b.* FROM buildings_rtree r JOIN buildings b ON b.id = r.id
 *         WHERE r.minlat <= :maxLat AND r.maxlat >= :minLat
 *           AND r.minlng <= :maxLng AND r.maxlng >= :minLng
 *   ② 精確距離（haversine）在 JS 算，再用 radiusM 過濾、由近到遠排序
 *
 * @returns {{rows: Array, sql: string, bbox: object, radiusM: number, candidates: number}}
 */
export function findNearby({ lat, lng, radiusM = 50, excludeId = null, limit = 50 } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { rows: [], sql: null, bbox: null, radiusM, candidates: 0 };
  const box = bboxForRadius(lat, lng, radiusM);
  const sql = `SELECT b.* FROM buildings_rtree r JOIN buildings b ON b.id = r.id
  WHERE r.minlat <= ? AND r.maxlat >= ? AND r.minlng <= ? AND r.maxlng >= ?
    AND b.lat IS NOT NULL AND b.lng IS NOT NULL`;
  const bind = [box.maxLat, box.minLat, box.maxLng, box.minLng];
  const candidates = selectObjects(sql, bind);
  lastQueries.nearby = { sql, bind, candidates: candidates.length, radiusM };
  const rows = candidates
    .filter((r) => r.id !== excludeId)
    .map((r) => ({ ...r, distanceM: haversineM(lat, lng, r.lat, r.lng) }))
    .filter((r) => r.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, limit);
  return { rows, sql, bbox: box, radiusM, candidates: candidates.length };
}

/** 依類型統計（普查進度） */
export function statsByType() {
  const sql = `SELECT type,
      COUNT(*) AS n,
      SUM(CASE WHEN lat IS NOT NULL THEN 1 ELSE 0 END) AS located,
      SUM(CASE WHEN geo_source = 'manual' THEN 1 ELSE 0 END) AS manual,
      SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved,
      ROUND(AVG(accuracy_m), 1) AS avg_accuracy_m
    FROM buildings GROUP BY type ORDER BY n DESC, type`;
  lastQueries.stats = sql;
  return selectObjects(sql);
}

export function stats() {
  const total = countBuildings();
  const located = Number(selectValue("SELECT COUNT(*) FROM buildings WHERE lat IS NOT NULL", [], 0));
  const manual = Number(selectValue("SELECT COUNT(*) FROM buildings WHERE geo_source = 'manual'", [], 0));
  const poor = Number(selectValue("SELECT COUNT(*) FROM buildings WHERE accuracy_m > 30", [], 0));
  const pending = Number(selectValue("SELECT COUNT(*) FROM buildings WHERE status = 'pending'", [], 0));
  return { total, located, manual, poor, pending, rtree: countRtree(), approxBytes: dbBytes()?.length ?? 0 };
}

/** 整個 DB 的位元組（＝匯出 .sqlite 的內容） */
export function dbBytes() {
  if (!state.ready) return null;
  return state.sqlite3.capi.sqlite3_js_db_export(state.db);
}

// ------------------------------------------------------------------ 匯出
const toRecord = (r) => ({
  code: r.code,
  type: r.type,
  name: r.name,
  note: r.note,
  status: r.status,
  location: {
    lat: r.lat, lng: r.lng,
    accuracyM: r.accuracy_m,
    sampleCount: r.sample_count,
    source: r.geo_source,
    bestAccuracyM: r.geo_best_accuracy_m,
    spreadM: r.geo_spread_m,
    stopReason: r.geo_stop_reason,
    note: r.geo_note,
    capturedAt: r.captured_at,
  },
  detection: { source: r.detector_source, cls: r.detector_cls, score: r.detector_score, box: r.detector_box ? JSON.parse(r.detector_box) : null },
  dedup: { sim: r.dedup_sim, compared: r.dedup_compared },
  photo: { name: r.photo_name },
  encoder: r.encoder,
  createdAt: r.created_at,
});

/** 匯出 JSON（給人看、也方便併進網站的 attractions/photos 資料） */
export function exportJson() {
  const buildings = selectObjects("SELECT * FROM buildings ORDER BY code").map(toRecord);
  return {
    generated: nowIso(),
    schema: { table: "buildings", version: schemaVersion(), engine: `SQLite ${state.sqlite3?.version?.libVersion ?? "?"} (sqlite-wasm)` },
    source: "澳門記憶 · 建築普查建檔（src/recognize）",
    count: buildings.length,
    stats: { overall: stats(), byType: statsByType() },
    buildings,
  };
}

export const exportJsonText = () => JSON.stringify(exportJson(), null, 1);

/** 下載（瀏覽器才有的能力；Node 測試會拿到 false） */
export function downloadBlob(filename, blob) {
  if (typeof document === "undefined" || typeof URL?.createObjectURL !== "function") return false;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
  return true;
}

/** 檔名帶日期，匯出多次不會互相覆蓋 */
export function exportFilename(ext) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `macau-survey-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${ext}`;
}

export function downloadJson() {
  return downloadBlob(exportFilename("json"), new Blob([exportJsonText()], { type: "application/json" }));
}

export function downloadSqlite() {
  const bytes = dbBytes();
  if (!bytes) throw new Error("資料庫還沒就緒");
  return downloadBlob(exportFilename("sqlite"), new Blob([bytes], { type: "application/vnd.sqlite3" }));
}

/** 清空（示範、測試、重新開始都用得到） */
export function deleteAll() {
  const db = requireDb();
  db.transaction(() => {
    db.exec("DELETE FROM buildings");
    db.exec("DELETE FROM buildings_rtree");
    db.exec("DELETE FROM meta WHERE key LIKE 'code_seq:%'");
  });
  markDirty();
  return countBuildings();
}

/** 更新狀態（pending / approved）——普查的複核流程，第二階段會用到 */
export function setStatus(id, status) {
  requireDb().exec({ sql: "UPDATE buildings SET status = ? WHERE id = ?", bind: [status, id] });
  markDirty();
  return getBuilding(id);
}

/** 把座標換算成好讀字串（列表與匯出都用同一套） */
export const fmtLatLng = (lat, lng) =>
  lat == null || lng == null ? "—" : `${round5(lat).toFixed(5)}, ${round5(lng).toFixed(5)}`;

// ===========================================================================
// 寫入排程：節流 → 匯出位元組 → 存進 provider（＋同步快照）
// ===========================================================================

/** 狀態變了就通知 UI（診斷區塊／資料庫面板會顯示「最後儲存時間」與錯誤） */
const listeners = new Set();
export function onStorageChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function emitChange() {
  for (const cb of [...listeners]) {
    try { cb(persistenceStatus()); } catch (e) { console.warn("[survey] storage listener 失敗", e); }
  }
}

/** 標記「有東西還沒存」；實際寫入由節流器決定（見 scheduleSave） */
function markDirty() {
  if (!state.ready || !state.persistence?.persistent) return;
  state.dirty = true;
  if (state.dirtySince == null) state.dirtySince = Date.now();
  scheduleSave();
}

function scheduleSave() {
  if (state.saveTimer) return;                    // 節流窗內：等這一個 timer 就好
  const elapsed = state.dirtySince != null ? Date.now() - state.dirtySince : 0;
  const wait = Math.max(0, Math.min(SAVE_DEBOUNCE_MS, SAVE_MAX_DELAY_MS - elapsed));
  state.saveTimer = setTimeout(() => {
    state.saveTimer = null;
    flushPersistence().catch(() => {});
  }, wait);
}

/** OPFS 當主 provider 時的同步快照：setItem 是同步的，關頁時也寫得完 */
function writeShadowSync(bytes) {
  if (state.persistence?.name === "localStorage") return;   // 主 provider 本身就是同步寫入
  try {
    localStorage.setItem(DB_SHADOW_KEY, packSnapshot(bytes, state.persistence?.name ?? "?"));
    if (state.shadowError) { state.shadowError = null; emitChange(); }
  } catch (e) {
    const msg = isQuotaError(e)
      ? `同步備援快照寫不進去（localStorage 配額已滿，約 5 MB）——主要資料仍存在 ${state.persistence?.name}，但關頁前的最後一筆可能來不及落地`
      : `同步備援快照失敗：${e?.message ?? e}`;
    if (state.shadowError !== msg) { state.shadowError = msg; emitChange(); }
  }
}

/** 存一次；provider 失敗時重試（配額爆掉不重試，重試也沒用、只會拖慢畫面） */
async function persistOnce(bytes) {
  let lastErr = null;
  for (let attempt = 1; attempt <= SAVE_RETRIES; attempt++) {
    try {
      const res = await state.persistence.save(bytes);
      return { ok: true, bytes: bytes.length, at: res?.at ?? Date.now() };
    } catch (e) {
      lastErr = e;
      if (e?.quota) break;                        // 配額問題重試無效
      if (attempt < SAVE_RETRIES) await new Promise((r) => setTimeout(r, 300 * attempt));
    }
  }
  const err = new Error(lastErr?.userMessage ?? lastErr?.message ?? String(lastErr));
  err.quota = !!lastErr?.quota;
  throw err;
}

/**
 * 立刻把目前的資料庫寫進 provider（節流器到點、頁面隱藏／關閉前、或測試呼叫）。
 * 交易中的寫入不會遺失：saving 期間又有變更時，這一輪結束會再跑一次。
 * @param {{force?: boolean, sync?: boolean}} opts
 *        sync=true 時先做一次同步快照（pagehide 用：非同步寫入可能來不及完成）
 */
export async function flushPersistence({ force = false, sync = false } = {}) {
  if (!state.ready || !state.persistence?.persistent) {
    return { ok: false, reason: "此 provider 不持久化", bytes: 0 };
  }
  const hadTimer = !!state.saveTimer;
  if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
  // 「還有東西沒落地」：有變更、有排程中的存檔、或上一次存檔還在飛
  const pending = state.dirty || state.saving || hadTimer;

  if (sync && pending) {
    // 同步保險：不管主 provider 寫不寫得完，先把位元組同步塞進 localStorage。
    // 這一行在 async 函式裡是**同步執行**的（前面沒有 await），所以 pagehide 一定寫得完。
    try { writeShadowSync(dbBytes()); } catch { /* 序列化失敗就算了，下面還會再試 */ }
  }
  // 沒有待落地的東西時什麼都不做（關頁時不必浪費一次序列化）
  if (!pending && !force) return { ok: true, skipped: true, bytes: 0 };
  if (state.saving) { state.saveAgain = true; return { ok: true, deferred: true }; }

  state.saving = true;
  let last = null;
  try {
    do {
      state.saveAgain = false;
      state.dirty = false;
      state.dirtySince = null;
      const t0 = Date.now();
      let bytes = null;
      try {
        bytes = dbBytes();
        const res = await persistOnce(bytes);
        state.lastSavedAt = new Date(res.at).toISOString();
        state.lastSavedBytes = bytes.length;
        state.lastSaveMs = Date.now() - t0;
        state.lastSaveError = null;
        state.saveCount++;
        state.saveAgain = state.dirty;            // 寫入期間又變更 → 再跑一輪
        last = { ok: true, bytes: bytes.length, ms: state.lastSaveMs, at: state.lastSavedAt };
        if (state.persistence.name === "opfs") writeShadowSync(bytes);   // 之後的關頁靠這份快照
      } catch (e) {
        state.dirty = true;                       // 沒存成功 → 保持 dirty，下次再試
        state.lastSaveError = { message: e?.userMessage ?? e?.message ?? String(e), quota: !!e?.quota, at: new Date().toISOString() };
        last = { ok: false, error: state.lastSaveError.message, quota: !!e?.quota, bytes: bytes?.length ?? 0 };
        console.warn("[survey] 存檔失敗", state.lastSaveError.message);
      }
      emitChange();
    } while (state.saveAgain);
  } finally {
    state.saving = false;
  }
  return last ?? { ok: true, bytes: 0, skipped: true };
}

/** 清掉裝置上的資料庫檔（連同步快照一起）；示範／測試／重新開始用 */
export async function clearPersistence() {
  if (!state.persistence?.persistent) return false;
  state.dirty = false;
  state.dirtySince = null;
  if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
  try { localStorage.removeItem(DB_SHADOW_KEY); } catch { /* 忽略 */ }
  const ok = await state.persistence.clear().catch((e) => { console.warn("[survey] clear 失敗", e); return false; });
  state.lastSavedAt = null;
  state.lastSavedBytes = null;
  state.lastSaveError = null;
  emitChange();
  return ok;
}

/** 測試／示範用：清空資料庫 + 清掉裝置上的檔（重新整理後真的是空的） */
export async function wipeAll() {
  deleteAll();
  await clearPersistence();
  state.migration = null;
  return countBuildings();
}

// ---------------------------------------------------------------------------
// 頁面關閉前強制落地
//   · visibilitychange → hidden：手機切走 App、切分頁都會到這裡
//   · pagehide：重新整理／關閉分頁（比 beforeunload 可靠，且不會擋下導覽）
// 這裡刻意用 sync:true：非同步的 OPFS 寫入可能在頁面被丟掉前還沒完成，
// 同步快照（localStorage.setItem）一定寫得完。沒有待落地的變更時它什麼都不做。
// ---------------------------------------------------------------------------
if (typeof document !== "undefined" && !globalThis.__macauSurveyFlushHooked) {
  globalThis.__macauSurveyFlushHooked = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushPersistence({ sync: true }).catch(() => {});
  });
  window.addEventListener("pagehide", () => { flushPersistence({ sync: true }).catch(() => {}); });
}

// ===========================================================================
// 救援既有資料：把 localStorage 的逐筆鏡射（MIRROR_KEY）遷進資料庫
//
// 背景：舊版因為資料庫只在記憶體，每一筆另外鏡射一份到 localStorage（ledger.js）。
// 使用者現在已經有幾筆卡在鏡射裡，但鏡射**不會還原進資料庫**——所以重整後會看到
// 「DB 0 筆、備份 4 筆」的矛盾狀態。這裡在 openDb() 之後自動把它們補進資料庫。
//
// 欄位對應（鏡射紀錄 → buildings 表）：
//   code                    ← rec.code（沒有才自動配號）
//   type                    ← building.type ?? building.cls ?? type ?? cls（舊紀錄是 cls）
//   name / note             ← building.name / building.note
//   created_at / status     ← createdAt / created_at / status
//   lat/lng/accuracy_m/…    ← building.location.{lat,lng,accuracyM,sampleCount,bestAccuracyM,
//                              spreadM,stopReason,capturedAt}
//   geo_source              ← location.source（舊紀錄沒有就記 "none"）
//   geo_note                ← location.gpsNote ?? location.unavailableReason（與存檔時同一套規則）
//   photo_name              ← photo.name
//   detector_*              ← detection.{source,cls,score,box}
//   dedup_sim/compared      ← dedup.top1.sim / dedup.compared
//   encoder                 ← encoder.name＋維度（或直接是字串）
// 去重：用 **code** 比對（資料庫已有同編號就跳過），鏡射內部的重複編號也只取第一筆。
// 鏡射本身**不刪**（第二層保險），遷移結果回報在 dbState().migration 給 UI 顯示。
// ---------------------------------------------------------------------------

/** 讀 localStorage 鏡射（壞掉就當沒有，不要讓它擋住開機） */
export function readMirrorRecords() {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(MIRROR_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.warn("[survey] 讀取本機備份失敗", e?.message ?? e);
    return [];
  }
}

const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : null);

/** 鏡射紀錄 → insertBuilding 的參數（欄位對應見上面註解） */
export function mirrorToBuilding(rec) {
  if (!rec || typeof rec !== "object") return null;
  const b = rec.building ?? {};
  const loc = b.location ?? rec.location ?? {};
  const det = rec.detection ?? {};
  const type = b.type ?? b.cls ?? rec.type ?? rec.cls ?? null;
  if (!type) return null;                       // buildings.type 是 NOT NULL，沒有類別就沒救
  const enc = rec.encoder;
  return {
    code: typeof rec.code === "string" && /^MM-\d{4}-\d+$/.test(rec.code.trim()) ? rec.code.trim() : null,
    type: String(type),
    name: b.name ?? rec.name ?? null,
    note: b.note ?? rec.note ?? null,
    lat: num(loc.lat), lng: num(loc.lng),
    accuracyM: num(loc.accuracyM), sampleCount: num(loc.sampleCount) ?? 0,
    geoSource: loc.source ?? rec.source ?? "none",
    geoBestAccuracyM: num(loc.bestAccuracyM), geoSpreadM: num(loc.spreadM),
    geoStopReason: loc.stopReason ?? null,
    geoNote: loc.gpsNote ?? loc.unavailableReason ?? null,
    capturedAt: loc.capturedAt ?? null,
    status: rec.status ?? "pending",
    photoName: rec.photo?.name ?? null,
    detectorScore: num(det.score), detectorCls: det.cls ?? b.cls ?? null,
    detectorSource: det.source ?? null, detectorBox: det.box ?? null,
    dedupSim: num(rec.dedup?.top1?.sim), dedupCompared: num(rec.dedup?.compared),
    encoder: typeof enc === "string" ? enc : (enc?.name ? `${enc.name}${enc.dim ? `-${enc.dim}d` : ""}` : null),
    createdAt: rec.createdAt ?? rec.created_at ?? undefined,   // undefined → insertBuilding 用現在時間
  };
}

/**
 * 把鏡射清單遷進資料庫（依 code 去重、保留原編號）。
 * 鏡射本身不刪；沒有 code 的紀錄會把配到的編號寫回鏡射，之後就不會再被當成「待還原」。
 * @returns {{read:number, inserted:number, skipped:number, failed:number, codes:string[], errors:string[]}}
 */
export function migrateMirrorRecords(records = readMirrorRecords()) {
  const out = { read: records.length, inserted: 0, skipped: 0, failed: 0, codes: [], errors: [] };
  if (!Array.isArray(records) || !records.length) return out;
  const seen = new Set();
  let patched = false;
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const row = mirrorToBuilding(rec);
    if (!row) { out.failed++; out.errors.push("缺少類別（type/cls），無法寫入 buildings.type"); continue; }
    try {
      if (row.code && (seen.has(row.code) || codeExists(row.code))) { out.skipped++; continue; }
      const inserted = insertBuilding(row);
      seen.add(inserted.code);
      out.inserted++;
      out.codes.push(inserted.code);
      if (rec && typeof rec === "object" && !rec.code) { rec.code = inserted.code; patched = true; }
    } catch (e) {
      out.failed++;
      out.errors.push(`${row.code ?? "(自動配號)"}：${e?.message ?? e}`);
    }
  }
  if (patched) writeMirrorRecords(records);      // 補上編號（不是刪除，備份仍然是完整的）
  if (out.inserted) console.info(`[survey] 已從本機備份還原 ${out.inserted} 筆進資料庫：${out.codes.join(", ")}`);
  return out;
}

/** 把鏡射清單寫回去（只用在遷移後補編號；失敗不影響資料庫） */
export function writeMirrorRecords(records) {
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(records));
    return true;
  } catch (e) {
    console.warn("[survey] 回寫本機備份失敗（不影響資料庫）", e?.message ?? e);
    return false;
  }
}

/**
 * 鏡射清單裡還沒進資料庫的筆數（面板顯示「N 筆待還原」用）。
 * 只算「有編號」的紀錄：沒有編號的無法用 code 比對，而它們在遷移時會拿到編號並回寫。
 */
export function pendingMirrorCount() {
  if (!state.ready) return 0;
  return readMirrorRecords().filter((r) => {
    const row = mirrorToBuilding(r);
    return !!(row && row.code && !codeExists(row.code));
  }).length;
}
