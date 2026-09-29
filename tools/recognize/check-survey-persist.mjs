// 驗證普查資料層的「持久化」邏輯（src/recognize/db.js）——不需要瀏覽器，用假的 localStorage 就能跑。
//
// 為什麼要這一支（browser-check-survey.mjs 已經有 E2E 了）：
//   瀏覽器那一支驗的是「真的重新整理後資料還在」，很接近真實情境，但很慢，而且很難造出
//   「配額爆掉」「舊檔毀損」「鏡射格式老舊」這幾種失敗情境。這一支把同一份 db.js 載進 Node，
//   用一個 MemoryLocalStorage 取代 localStorage，直接驗：
//     · save → load 之後，資料列與 R-Tree 都完整還原（sqlite3_deserialize，不是只記一筆 meta）
//     · 舊版逐筆鏡射（MIRROR_KEY）的欄位對應與 code 去重（救援既有資料）
//     · 配額爆掉（QuotaExceededError）要有可讀訊息，而且不能靜默、要保持 dirty
//     · 毀損的舊檔要被擋下並隔離，不能靜默蓋掉、也不能讓整頁壞掉
//     · 節流：連續多次寫入只會合併成少數幾次序列化，但最終一定落地
//     · OPFS provider（用假的 File System Access 後端跑真的 opfsPersistence）：同步快照救援、
//       clear、以及「OPFS 不可用就退回 localStorage／記憶體」的自動選擇順序
//
// 用法：node tools/recognize/check-survey-persist.mjs
//   （不需要 dev server；開兩個模組實例來模擬「重新整理」——見下面 reload() 的說明）
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const DB_URL = pathToFileURL(resolve(import.meta.dirname, "../../src/recognize/db.js")).href;
const problems = [];
const log = (...a) => console.log(...a);
const ok = (cond, msg) => { log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) problems.push(msg); };

// ------------------------------------------------------------------ 假的 localStorage
const store = new Map();
let failKeys = new Set();          // 這些 key 的 setItem 會丟 QuotaExceededError
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => {
    if (failKeys.has(k)) { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; }
    store.set(k, String(v));
  },
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};

/**
 * 模擬「重新整理」：Node 的 ES module 只會求值一次，所以用 query string 造出一個**全新的模組實例**
 * （模組內的 state 全部歸零），但共用同一個 localStorage——這正好對應瀏覽器重新整理的情形。
 */
let reloadSeq = 0;
const reload = () => import(`${DB_URL}?reload=${++reloadSeq}`);
/** 開一個新的資料庫實例（可指定 provider；預設 localStorage） */
async function openFresh({ persistence = null, provider = "localStorage" } = {}) {
  const db = await reload();
  await db.openDb(persistence ? { persistence } : { persistence: db[`${provider}Persistence`] });
  return db;
}

// 澳門半島真座標
const A = { lat: 22.197458, lng: 113.540839 };
const REC = { type: "tong_lau", name: "甲", lat: A.lat, lng: A.lng, accuracyM: 8, sampleCount: 3, geoSource: "gps", capturedAt: "2026-01-02T03:04:05.000Z" };

// ------------------------------------------------------------------ ① 存檔 → 還原
log("① 寫入 → 匯出位元組 → 存進 localStorage → 重新載入後完整還原");
let db = await openFresh();
log(`  provider：${db.dbState().persistence}（${db.dbState().persistenceLabel}）`);
const row1 = db.insertBuilding(REC);
const row2 = db.insertBuilding({ type: "temple", name: "乙", geoSource: "none" });
ok(db.countBuildings() === 2, `寫入 2 筆（實得 ${db.countBuildings()}）`);
const saved = await db.flushPersistence({ force: true });
log(`  flush：${JSON.stringify(saved)}`);
ok(saved.ok && saved.bytes > 0, `flush 成功（${saved.bytes} bytes）`);
ok(store.has(db.DB_STORAGE_KEY), `localStorage 裡有 DB 位元組（key=${db.DB_STORAGE_KEY}）`);
ok(store.get(db.DB_STORAGE_KEY) === store.get(db.DB_SHADOW_KEY) || !store.has(db.DB_SHADOW_KEY), "主 provider 是 localStorage 時不需要另外寫同步快照");
ok(!!db.dbState().lastSavedAt, `記錄了最後儲存時間（${db.dbState().lastSavedAt}）`);

db = await reload();
await db.openDb({ persistence: db.localStoragePersistence });
const restored = db.dbState().restoredFrom;
log(`  還原：${JSON.stringify(restored)}`);
ok(db.countBuildings() === 2, `重新載入後仍有 2 筆（實得 ${db.countBuildings()}）`);
ok(restored?.rows === 2 && restored?.source === "localStorage", "還原來源與筆數都對得上");
const back = db.listBuildings(10).find((r) => r.code === row1.code);
ok(back?.name === "甲" && back?.type === "tong_lau" && back?.accuracy_m === 8 && back?.sample_count === 3 && back?.geo_source === "gps",
  `欄位完整還原（${back?.code} / ${back?.name} / ${back?.accuracy_m}m / ${back?.sample_count} 次）`);
ok(back?.created_at === row1.created_at && back?.captured_at === REC.capturedAt, `created_at 與 captured_at 一致（${back?.created_at}）`);
ok(db.findNearby({ lat: A.lat, lng: A.lng, radiusM: 50 }).rows.length === 1, "R-Tree 虛擬表也一起還原（半徑 50 公尺查到 1 筆）");
ok(db.peekNextCode(new Date().getFullYear()) === row2.code.replace(/(\d+)$/, (m) => String(Number(m) + 1).padStart(m.length, "0")),
  `配號接續，不會撞到已還原的編號（${db.peekNextCode(new Date().getFullYear())}）`);
ok(db.dbState().schemaVersion === 1 && db.rawDb().selectValue("PRAGMA integrity_check") === "ok", "還原後的資料庫通過 PRAGMA integrity_check");

// ------------------------------------------------------------------ ② 遷移舊鏡射
log("\n② 救援既有資料：localStorage 鏡射（舊格式）遷進資料庫，依 code 去重、保留原編號");
store.set("macau-memory.pending-discoveries", JSON.stringify([
  // ① 編號與資料庫重複 → 必須跳過
  { code: row1.code, createdAt: "2026-01-01T00:00:00.000Z", building: { name: "重複的甲", type: "tong_lau", location: { source: "gps", lat: A.lat, lng: A.lng } } },
  // ② 舊格式（cls / typeZh、accuracyM 為 null）→ 要保留編號與各欄位
  {
    code: "MM-2025-0042", createdAt: "2025-05-06T07:08:09.000Z", status: "approved",
    building: {
      name: "舊鏡射唐樓", cls: "tong_lau", typeZh: "騎樓與唐樓", note: "巷口第二棟",
      location: { source: "manual", lat: 22.19, lng: 113.54, accuracyM: null, sampleCount: 0, gpsNote: "GPS 原讀數 ±42m，已手動修正" },
    },
    photo: { name: "old.jpg" }, detection: { source: "yolo", cls: "tong_lau", score: 0.71, box: { x: 1, y: 2, w: 3, h: 4 } },
    dedup: { top1: { id: "x", zh: "y", sim: 0.31 }, compared: 38 }, encoder: { name: "dinov2-s14", dim: 384 },
  },
  // ③ 鏡射內部的重複編號 → 只取第一筆
  { code: "MM-2025-0042", building: { name: "鏡射內的重複", type: "temple", location: { source: "wifi", lat: 22.2, lng: 113.55 } } },
  // ④ 沒有類別 → 無法寫入（buildings.type NOT NULL），要算失敗而不是讓整批中斷
  { code: "MM-2025-0043", building: { name: "沒有類別" } },
]));
db = await openFresh();
const mig = db.dbState().migration;
log(`  遷移結果：${JSON.stringify(mig)}`);
ok(mig.inserted === 1 && mig.skipped === 2 && mig.failed === 1,
  `1 進 / 2 跳過（重複編號） / 1 失敗（缺類別）（實得 ${mig.inserted}/${mig.skipped}/${mig.failed}）`);
ok(mig.codes.join() === "MM-2025-0042", `遷進的就是舊那筆：${mig.codes.join()}`);
const old = db.listBuildings(20).find((r) => r.code === "MM-2025-0042");
ok(!!old, "舊鏡射進了資料庫，編號原封不動");
ok(old?.created_at === "2025-05-06T07:08:09.000Z" && old?.status === "approved" && old?.name === "舊鏡射唐樓" && old?.note === "巷口第二棟",
  "created_at / status / name / note 對應正確");
ok(old?.geo_source === "manual" && old?.geo_note === "GPS 原讀數 ±42m，已手動修正" && old?.accuracy_m === null && old?.sample_count === 0,
  `geo_source / geo_note / accuracy_m(NULL) / sample_count 對應正確（${old?.geo_source}）`);
ok(old?.photo_name === "old.jpg" && Math.abs(old?.detector_score - 0.71) < 1e-9 && old?.dedup_compared === 38 && old?.encoder === "dinov2-s14-384d",
  "photo / detection / dedup / encoder 對應正確");
ok(store.get("macau-memory.pending-discoveries").includes("MM-2025-0042"), "鏡射本身保留（第二層保險）");
ok(db.peekNextCode(2025, JSON.parse(store.get("macau-memory.pending-discoveries")).map((r) => r.code)) === "MM-2025-0044",
  `跨年度配號避開鏡射裡已用掉的編號（${db.peekNextCode(2025, JSON.parse(store.get("macau-memory.pending-discoveries")).map((r) => r.code))}）`);
db = await openFresh();
ok(db.dbState().migration.inserted === 0 && db.dbState().migration.skipped === 3,
  `再載入一次不會重複插入（幂等：inserted=${db.dbState().migration.inserted}）`);

// ------------------------------------------------------------------ ③ 配額失敗
log("\n③ 配額爆掉：要回報失敗、留下可讀訊息、保持 dirty（下次再試），不能靜默");
failKeys.add("macau-memory.sqlite");
db.insertBuilding({ type: "temple", name: "配額測試", lat: 22.2, lng: 113.5, geoSource: "gps" });
const failed = await db.flushPersistence({ force: true });
log(`  flush：${JSON.stringify(failed).slice(0, 120)}…`);
ok(failed.ok === false && failed.quota === true, "flush 回報失敗且標記為配額問題");
const msg = db.persistenceStatus().lastSaveError?.message ?? "";
ok(/QuotaExceededError/.test(msg), `錯誤訊息指出是配額問題：${msg.slice(0, 40)}…`);
ok(/匯出 \.sqlite/.test(msg) && /清空資料庫/.test(msg), "錯誤訊息附上可執行建議（先匯出 .sqlite、再清空舊資料）");
ok(db.persistenceStatus().dirty === true, "失敗後仍是 dirty（之後會再重試）");
failKeys.clear();
const retry = await db.flushPersistence({ force: true });
ok(retry.ok === true && !db.persistenceStatus().lastSaveError, `額度恢復後重試成功（${retry.bytes} bytes），錯誤訊息清空`);

// ------------------------------------------------------------------ ④ 毀損舊檔
log("\n④ 舊檔毀損：要擋下、隔離，不能靜默被空資料庫蓋掉，也不能讓整頁壞掉");
store.set("macau-memory.sqlite", JSON.stringify({ v: 1, provider: "localStorage", at: Date.now(), bytes: Buffer.from("this is not a sqlite file").toString("base64") }));
store.delete("macau-memory.pending-discoveries");        // 這一輪只看主檔，不讓鏡射救援進來
db = await openFresh();
const st4 = db.dbState();
log(`  restoreError=${st4.restoreError}`);
log(`  隔離：${db.persistenceStatus().quarantined}`);
ok(/不是有效的 SQLite/.test(st4.restoreError ?? ""), "毀損檔被擋下並提示（不是靜默）");
ok(!!db.persistenceStatus().quarantined, `毀損內容被另存（${db.persistenceStatus().quarantined}）`);
ok(db.countBuildings() === 0, "從空的資料庫開始，應用程式仍可用");
ok(db.insertBuilding({ type: "temple", name: "毀損後仍可寫入" }).code.endsWith("-0001"), "毀損後仍能正常建檔");

// ------------------------------------------------------------------ ⑤ 節流
log("\n⑤ 節流：連續 5 次寫入只會合併成少數幾次序列化，但最後一定落地");
db = await openFresh();
await db.flushPersistence({ force: true });               // 先歸零
const before5 = db.persistenceStatus().saveCount;
for (let i = 1; i <= 5; i++) db.insertBuilding({ type: "tong_lau", name: `節流 ${i}`, lat: 22.19 + i / 1000, lng: 113.54 });
const mid = db.persistenceStatus();
log(`  連寫 5 筆後：dirty=${mid.dirty} · 尚未儲存的計數=${mid.saveCount - before5}`);
ok(mid.dirty === true, "節流窗內仍是 dirty（證明沒有每寫一筆就序列化整個 DB）");
await new Promise((r) => setTimeout(r, db.SAVE_DEBOUNCE_MS + 500));
const done = db.persistenceStatus();
log(`  節流窗過後：saveCount=${done.saveCount}（先前 ${before5}）· dirty=${done.dirty}`);
ok(done.dirty === false && done.saveCount === before5 + 1, "5 次寫入合併成 1 次存檔（節流有效）");
db = await reload();
await db.openDb({ persistence: db.localStoragePersistence });
ok(db.countBuildings() === 5, `重新載入後 5 筆都在（實得 ${db.countBuildings()}）`);

// ------------------------------------------------------------------ ⑥ OPFS provider
//
// OPFS 在 Node 不存在，但 opfsPersistence 只用三個非同步 API（getFileHandle / createWritable /
// getFile），所以可以用一個 30 行的假 File System Access 後端去跑**真正的** opfsPersistence，
// 把「OPFS 寫入來不及完成時，靠 localStorage 同步快照救回來」這條路徑也驗掉。
log("\n⑥ OPFS provider：真 opfsPersistence ＋ 假的 File System Access 後端");
function fakeOpfs() {
  const files = new Map();                       // 檔名 → { bytes, lastModified }
  const handleFor = (name, create) => {
    if (!files.has(name)) {
      if (!create) throw Object.assign(new Error(`NotFoundError: ${name}`), { name: "NotFoundError" });
      files.set(name, { bytes: new Uint8Array(0), lastModified: 0 });
    }
    return {
      async createWritable() {
        let buf = new Uint8Array(0);
        return {
          async write(data) { buf = data instanceof Uint8Array ? data.slice() : new Uint8Array(data); },
          async close() { files.set(name, { bytes: buf, lastModified: Date.now() }); },
        };
      },
      async getFile() {
        const e = files.get(name);
        return { lastModified: e.lastModified, arrayBuffer: async () => e.bytes.slice().buffer };
      },
    };
  };
  const root = {
    getFileHandle: async (n, opts = {}) => handleFor(n, !!opts.create),
    removeEntry: async (n) => { if (!files.delete(n)) throw Object.assign(new Error("NotFoundError"), { name: "NotFoundError" }); },
  };
  return { files, root };
}
const opfsBackend = fakeOpfs();
let opfsBroken = false;
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    storage: {
      getDirectory: async () => { if (opfsBroken) throw new Error("OPFS 不可用（模擬）"); return opfsBackend.root; },
      persisted: async () => true,
      persist: async () => true,
    },
  },
});

const opfsDb = await reload();
ok(await opfsDb.opfsPersistence.available(), "opfsPersistence.available() 的寫入→讀回探針通過");
const picked = await opfsDb.pickPersistence();
ok(picked.provider.name === "opfs", `自動選擇優先挑 OPFS（實得 ${picked.provider.name}／${picked.reason}）`);
await opfsDb.openDb({ persistence: opfsDb.opfsPersistence });
opfsDb.insertBuilding({ type: "temple", name: "OPFS 甲", lat: A.lat, lng: A.lng, geoSource: "gps" });
const opfsSaved = await opfsDb.flushPersistence({ force: true });
log(`  flush：${JSON.stringify(opfsSaved)}`);
ok(opfsSaved.ok && opfsBackend.files.get("macau-survey.sqlite3")?.bytes.length === opfsSaved.bytes,
  `OPFS 檔案裡真的是那份位元組（${opfsBackend.files.get("macau-survey.sqlite3")?.bytes.length} bytes）`);
ok(store.has("macau-memory.sqlite.shadow"), "同時留下 localStorage 同步快照（關頁前最後一筆的保險）");

// 模擬「OPFS 的寫入還沒完成、頁面就被關掉」：把 OPFS 檔案退回成空的舊檔
opfsBackend.files.set("macau-survey.sqlite3", { bytes: new Uint8Array(0), lastModified: Date.now() - 60000 });
const shadowBack = await reload();
await shadowBack.openDb({ persistence: shadowBack.opfsPersistence });
log(`  還原來源：${JSON.stringify(shadowBack.dbState().restoredFrom)}`);
ok(shadowBack.countBuildings() === 1 && shadowBack.dbState().restoredFrom?.source === "localStorage 同步快照",
  "OPFS 檔案較舊時，改用較新的同步快照還原（最後一筆不會掉）");
const resynced = await shadowBack.flushPersistence({ force: true });
ok(resynced.ok && opfsBackend.files.get("macau-survey.sqlite3").bytes.length === resynced.bytes,
  "還原後立刻補寫回 OPFS（兩份重新對齊）");

await shadowBack.clearPersistence();
ok(!opfsBackend.files.has("macau-survey.sqlite3") && !store.has("macau-memory.sqlite.shadow"),
  "clearPersistence() 把 OPFS 檔案與同步快照都清掉");

// ------------------------------------------------------------------ ⑦ 自動選擇的順序
log("\n⑦ 自動選擇：OPFS → localStorage → memory，以及 ?persist= 強制指定");
opfsBroken = true;                                    // 讓 OPFS 探針失敗（模擬 Firefox：沒有 createWritable）
const pick2 = await (await reload()).pickPersistence();
ok(pick2.provider.name === "localStorage", `OPFS 不可用時退回 localStorage（實得 ${pick2.provider.name}）`);
Object.defineProperty(globalThis, "location", { configurable: true, value: { search: "?persist=memory" } });
const pick3 = await (await reload()).pickPersistence();
ok(pick3.provider.name === "memory", `?persist=memory 可以強制指定（實得 ${pick3.provider.name}）`);
Object.defineProperty(globalThis, "location", { configurable: true, value: { search: "?persist=opfs" } });
const pick4 = await (await reload()).pickPersistence();
ok(pick4.provider.name === "memory" && /不可用/.test(pick4.reason),
  `?persist=opfs 但 OPFS 不可用時，安全退回記憶體並說明原因（${pick4.reason}）`);
opfsBroken = true;                                   // 這一輪連 OPFS 也不可用
Object.defineProperty(globalThis, "location", { configurable: true, value: { search: "" } });
delete globalThis.localStorage;                      // 而且沒有 localStorage → 只剩記憶體
const pick5 = await (await reload()).pickPersistence();
ok(pick5.provider.name === "memory" && /隱私模式/.test(pick5.reason),
  `兩種儲存都沒有時退回記憶體，並說明原因（${pick5.provider.name}／${pick5.reason}）`);

log("\n=== 摘要 ===");
log(problems.length ? `發現 ${problems.length} 個問題：\n  ${problems.join("\n  ")}` : "持久化 / 遷移 / 配額 / 毀損 / 節流 全部通過");
if (problems.length) process.exitCode = 1;
