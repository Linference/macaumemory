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
// 第二階段（OPFS）持久化的介面預留
//
// 這一階段只在記憶體裡（重新整理就沒了，靠匯出檔保存）。要把資料真的留在裝置上，
// 第二階段只要換一個 adapter 進來，其他程式碼完全不用動：
//
//   import { openDb } from "./db.js";
//   const opfs = {
//     name: "opfs",
//     async load() { ...讀回 Uint8Array 或 null... },
//     async save(bytes) { ...寫入 OPFS... },
//     async clear() { ... },
//   };
//   await openDb({ persistence: opfs });
//
// adapter 的契約（三個非同步方法，load 回傳 Uint8Array 或 null）就是下面這個物件。
// ---------------------------------------------------------------------------
export const memoryPersistence = {
  name: "memory",
  persistent: false,
  async load() { return null; },
  async save() { return false; },
  async clear() { return false; },
};

const state = {
  sqlite3: null,
  db: null,
  persistence: memoryPersistence,
  error: null,
  ready: false,
  initMs: null,
};

export const dbState = () => ({
  ready: state.ready,
  error: state.error,
  initMs: state.initMs,
  persistence: state.persistence.name,
  persistent: !!state.persistence.persistent,
  schemaVersion: state.ready ? schemaVersion() : null,
  engine: state.ready ? `SQLite ${state.sqlite3?.version?.libVersion ?? "?"}（sqlite-wasm，記憶體）` : null,
  rtree: state.ready ? countRtree() : 0,
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

/**
 * 開啟（或建立）資料庫。可重複呼叫；失敗會 throw 帶中文說明的 Error。
 * @param {{persistence?: object}} opts
 */
export async function openDb({ persistence = state.persistence } = {}) {
  if (state.ready) return state;
  const t0 = Date.now();
  try {
    const initSqlite = (await import("@sqlite.org/sqlite-wasm")).default;
    const url = await sqliteWasmUrl();
    const sqlite3 = await initSqlite(url ? { locateFile: () => url } : {});
    // 套件在少數情況下會用 config.log 印內部訊息；普查頁不需要那些雜訊，但錯誤要留著。
    try { sqlite3.config.log = () => {}; } catch { /* 舊版沒有這個欄位 */ }

    // open flags "c" = create；**不要**加 "t"（t 會讓 DB 建構子安裝 sqlite3_trace_v2，
    // 每一句 SQL 都印到 console——除錯用得到，正式流程只會洗版）
    const db = new sqlite3.oo1.DB(":memory:", "c");
    db.exec(SCHEMA_SQL);
    state.sqlite3 = sqlite3;
    state.db = db;
    state.persistence = persistence;
    state.initMs = Date.now() - t0;

    db.exec({
      sql: "INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)",
      bind: ["schema_version", String(SCHEMA_VERSION)],
    });
    db.exec({ sql: "INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)", bind: ["created_at", new Date().toISOString()] });

    // 持久化（第二階段）：adapter 有東西就載回來
    try {
      const bytes = await persistence.load();
      if (bytes?.length) {
        // 有舊資料時的正式做法是把 bytes 寫進 OPFS 再由 SQLite 開啟；
        // 這一階段只記錄狀態，不假裝載入成功。
        db.exec({ sql: "INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)", bind: ["persistence_note", `${persistence.name}：載入介面已預留，第二階段實作`] });
      }
    } catch (e) {
      console.warn("[survey] persistence.load 失敗", e?.message ?? e);
    }

    state.ready = true;
    state.error = null;
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
 * @returns {object} 完整資料列（含 id / code）
 */
export function insertBuilding(rec) {
  const db = requireDb();
  const year = Number(rec.year) || year_();
  const created = rec.createdAt ?? nowIso();
  let row = null;
  db.transaction(() => {                                  // 交易：編號配置＋主表＋R-Tree 要嘛全成、要嘛全不成
    let seq = maxSeq(year) + 1;
    let code = formatCode(year, seq);
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
    db.exec({ sql: "INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)", bind: [seqKey(year), String(seq)] });
    row = getBuilding(id);
  });
  return row;
}

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
  return countBuildings();
}

/** 更新狀態（pending / approved）——普查的複核流程，第二階段會用到 */
export function setStatus(id, status) {
  requireDb().exec({ sql: "UPDATE buildings SET status = ? WHERE id = ?", bind: [status, id] });
  return getBuilding(id);
}

/** 把座標換算成好讀字串（列表與匯出都用同一套） */
export const fmtLatLng = (lat, lng) =>
  lat == null || lng == null ? "—" : `${round5(lat).toFixed(5)}, ${round5(lng).toFixed(5)}`;
