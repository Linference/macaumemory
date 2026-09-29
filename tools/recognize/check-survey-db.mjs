// 驗證普查資料層（src/recognize/db.js）在 Node 直接跑也正確：schema、編號、R-Tree 空間查重、匯出。
//
// 為什麼需要這支：瀏覽器那一支（browser-check-survey.mjs）驗的是 UI 流程，
// 但「R-Tree 查重的 SQL 與距離計算」在 UI 上只看得到結論。這裡直接把同一份 db.js
// 載進 Node，把 SQL、候選數、精確距離全部印出來，並用斷言檢查。
//
// 用法：node tools/recognize/check-survey-db.mjs
//   （不需要 dev server；db.js 在 Node 會走 @sqlite.org/sqlite-wasm 的 node 建置）
import {
  openDb, insertBuilding, findNearby, peekNextCode, countBuildings, countRtree,
  statsByType, stats, exportJson, dbBytes, deleteAll, lastQueries, dbState, listBuildings,
} from "../../src/recognize/db.js";
import { haversineM } from "../../src/recognize/geo-math.js";

const problems = [];
const log = (...a) => console.log(...a);
const ok = (cond, msg) => { log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) problems.push(msg); };

// 澳門半島真座標當測試資料
const A = { lat: 22.197458, lng: 113.540839, label: "大三巴牌坊" };            // 基準點
const B = { lat: 22.197708, lng: 113.540839, label: "大三巴北側 28 公尺" };     // 同緯度往北 ≈ 27.8 m
const C = { lat: 22.201900, lng: 113.545000, label: "約 620 公尺外" };          // 遠處
const D = { lat: null, lng: null, label: "沒有座標（只做文字記錄）" };

const mk = (p, i, extra = {}) => ({
  type: i % 2 ? "tong_lau" : "temple",
  name: p.label,
  note: `第 ${i} 筆測試資料`,
  lat: p.lat, lng: p.lng,
  accuracyM: 8 + i, sampleCount: 10 + i, geoSource: i === 3 ? "manual" : "wifi",
  geoBestAccuracyM: 7, geoSpreadM: 3.5, geoStopReason: "max-samples",
  capturedAt: new Date("2026-09-27T10:00:00Z").toISOString(),
  status: "pending", photoName: `test-${i}.jpg`,
  detectorScore: 0.7 + i / 100, detectorCls: i % 2 ? "tong_lau" : "temple", detectorSource: "yolo",
  detectorBox: { x: 10, y: 20, w: 300, h: 200 }, dedupSim: 0.31, dedupCompared: 38, encoder: "dinov2-s14-336",
  ...extra,
});

log("→ 開啟資料庫（Node 直接載 sqlite-wasm）…");
const t0 = Date.now();
await openDb();
log(`  就緒：${JSON.stringify(dbState())} · ${Date.now() - t0} ms`);

log("\n→ 建 4 筆：2 筆相距 28 公尺、1 筆 620 公尺外、1 筆沒有座標");
deleteAll();
const rows = [A, B, C, D].map((p, i) => insertBuilding(mk(p, i + 1)));
for (const r of rows) log(`  ${r.code}  ${r.type.padEnd(10)} ${String(r.name).padEnd(22)} ${r.lat ?? "—"}, ${r.lng ?? "—"}  acc=${r.accuracy_m}m src=${r.geo_source}`);

log("\n→ 編號規則");
ok(/^MM-\d{4}-0001$/.test(rows[0].code), `第一筆編號格式 MM-YYYY-0001（實得 ${rows[0].code}）`);
const codes = rows.map((r) => r.code);
ok(new Set(codes).size === codes.length, `4 筆編號互不相同：${codes.join(" ")}`);
const seqs = codes.map((c) => Number(c.split("-")[2]));
ok(seqs.every((s, i) => i === 0 || s === seqs[i - 1] + 1), `序號連續遞增：${seqs.join(",")}`);
ok(peekNextCode() === `MM-${new Date().getFullYear()}-0005`, `peekNextCode 應為 0005（實得 ${peekNextCode()}）`);
// 刪掉一筆之後序號不得重用（不然會撞號）
deleteAll();
const again = insertBuilding(mk(A, 9));
ok(again.code === `MM-${new Date().getFullYear()}-0001`, `清空後重新配號從 0001 開始（實得 ${again.code}）`);
deleteAll();
const [W1, W2] = [0, 1].map((i) => insertBuilding(mk([A, B, C, D][i], i + 1)));
insertBuilding(mk(C, 3));
insertBuilding(mk(D, 4));

log("\n→ R-Tree 空間查重：以 A 為中心、半徑 50 公尺");
const near = findNearby({ lat: A.lat, lng: A.lng, radiusM: 50 });
log(`  SQL：\n${near.sql?.split("\n").map((l) => "    " + l).join("\n")}`);
log(`  綁定值（查詢框）：${JSON.stringify(near.bbox)}`);
log(`  R-Tree 粗篩候選：${near.candidates} 筆 → 精確距離過濾後：${near.rows.length} 筆`);
for (const r of near.rows) log(`    · ${r.code} ${r.name} — ${r.distanceM.toFixed(2)} 公尺（acc ${r.accuracy_m} m）`);
ok(near.candidates === 2, `R-Tree 粗篩應為 2 筆（620 公尺外那筆被框排除，這正是 R-Tree 的作用）——實得 ${near.candidates}`);
ok(near.rows.length === 2, `50 公尺內應為 2 筆（A 自己＋28 公尺外的 B）——實得 ${near.rows.length}`);
ok(near.rows[1] && Math.abs(near.rows[1].distanceM - 27.8) < 1.5, `B 的距離應 ≈ 27.8 公尺——實得 ${near.rows[1]?.distanceM.toFixed(2)}`);
ok(near.rows.every((r) => r.distanceM <= 50), "沒有任何超過半徑的紀錄");

log("\n→ 半徑 10 公尺（只該剩下 A 自己）");
const tight = findNearby({ lat: A.lat, lng: A.lng, radiusM: 10 });
log(`  候選 ${tight.candidates} → 命中 ${tight.rows.length}（${tight.rows.map((r) => r.code).join(",") || "無"}）`);
ok(tight.rows.length === 1, `10 公尺內應只有 1 筆——實得 ${tight.rows.length}`);

log("\n→ 半徑 1000 公尺（該含遠處那筆）+ excludeId");
const wide = findNearby({ lat: A.lat, lng: A.lng, radiusM: 1000, excludeId: W1.id });
log(`  候選 ${wide.candidates} → 命中 ${wide.rows.length}：${wide.rows.map((r) => `${r.code}@${r.distanceM.toFixed(0)}m`).join(" ")}`);
ok(wide.rows.length === 2 && wide.rows[0].id === W2.id, `1000 公尺內應 2 筆且最近的是 B（excludeId 生效）`);

log("\n→ 依類型統計");
for (const s of statsByType()) log(`  ${String(s.type).padEnd(10)} ${s.n} 筆 · 有座標 ${s.located} · 手動 ${s.manual} · 平均精度 ${s.avg_accuracy_m}m`);
ok(statsByType().reduce((a, s) => a + s.n, 0) === 4, "類型統計總數 = 4");

log("\n→ 匯出");
const json = exportJson();
log(`  JSON：${json.count} 筆 · engine=${json.schema.engine} · 第一筆 ${json.buildings[0].code} ${json.buildings[0].name}`);
log(`  範例（第一筆）：${JSON.stringify(json.buildings[0]).slice(0, 300)}…`);
ok(json.count === 4 && json.buildings[0].location.accuracyM === 9, "JSON 匯出內容正確（含 location.accuracyM）");
const bytes = dbBytes();
const magic = Buffer.from(bytes.slice(0, 15)).toString("utf8");
log(`  .sqlite：${bytes.length} bytes · magic="${magic}" · rtree 列數 ${countRtree()}/${countBuildings()}`);
ok(magic === "SQLite format 3", `匯出檔是合法的 SQLite 檔（magic=${magic}）`);
ok(countRtree() === 3, `R-Tree 列數應等於有座標的紀錄數 3——實得 ${countRtree()}`);
ok(stats().total === 4 && stats().located === 3, `stats(): ${JSON.stringify(stats())}`);

log(`\n=== 摘要 ===`);
log(problems.length ? `發現 ${problems.length} 個問題：\n  ${problems.join("\n  ")}` : "SQLite 資料層全部通過（schema / 編號 / R-Tree 查重 / 統計 / 匯出）");

// --------------------------------------------------------------------------
// R-Tree 到底值不值得：在 2 萬筆的庫上比較「R-Tree 粗篩 + haversine」與「全表掃描」
// （普查全澳老建築的量級大約是數千到數萬筆，這裡刻意用偏大的數字看趨勢）
// --------------------------------------------------------------------------
log("\n→ 效能對照：20,000 筆隨機座標，各跑 200 次 50 公尺查重");
deleteAll();
{
  const rnd = (a, b) => a + Math.random() * (b - a);
  const t1 = Date.now();
  for (let i = 0; i < 20000; i++) {
    insertBuilding({ type: "tong_lau", name: `隨機 ${i}`, lat: rnd(22.10, 22.22), lng: rnd(113.53, 113.60), accuracyM: 12, geoSource: "wifi", status: "pending" });
  }
  log(`  建庫（含 R-Tree）：${((Date.now() - t1) / 1000).toFixed(1)} 秒 · ${countBuildings()} 筆 / rtree ${countRtree()} 列`);

  const probes = Array.from({ length: 200 }, () => ({ lat: rnd(22.10, 22.22), lng: rnd(113.53, 113.60) }));
  let hits = 0;
  let tR = Date.now();
  for (const p of probes) hits += findNearby({ lat: p.lat, lng: p.lng, radiusM: 50 }).rows.length;
  tR = Date.now() - tR;

  const all = listBuildings(99999);
  let tF = Date.now();
  let hits2 = 0;
  for (const p of probes) hits2 += all.filter((r) => r.lat != null && haversineM(p.lat, p.lng, r.lat, r.lng) <= 50).length;
  tF = Date.now() - tF;

  log(`  R-Tree 路徑：${tR} ms（200 次，平均 ${(tR / 200).toFixed(2)} ms/次，命中 ${hits} 筆）`);
  log(`  全表掃描（JS haversine 2 萬筆）：${tF} ms（平均 ${(tF / 200).toFixed(2)} ms/次，命中 ${hits2} 筆）`);
  ok(hits === hits2, `兩種算法命中數必須一致（${hits} vs ${hits2}）——一致才表示 R-Tree 沒有漏掉`);
  log(`  → R-Tree 快約 ${(tF / Math.max(1, tR)).toFixed(1)} 倍`);
}

log(`最後一次查重 SQL：${lastQueries.nearby?.sql?.replace(/\s+/g, " ").trim()}`);
if (problems.length) process.exitCode = 1;
