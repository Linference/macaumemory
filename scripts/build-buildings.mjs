// 重新生成 public/data/macau-buildings.geojson：更精細的幾何 + 更合理的高度
//
// 為什麼要這支：原本的資料有兩個問題——
//   ① 幾何以 0.45 m 容差簡化，平均只剩 6.8 個點，建築像方盒子
//   ② 只有 29% 的建築有高度，其餘在樣式裡用「類型固定值」推估（所有公寓都 21 m），天際線失真
//
// 這支腳本用 .cache/overture 的原始快取（不需重新下載）：
//   1. 以更小的容差重新簡化幾何
//   2. 併入 OSM 實測高度（height 或 building:levels×3.2）
//   3. 用 Overture 的 num_floors 補高度
//   4. 對其餘建築，用「足跡面積 → 樓層數」的冪律模型估算高度，
//      並在**有實測高度的建築上做 80/20 分割驗證**，報告 MAE
//
// 用法：node scripts/build-buildings.mjs [--tol 0.2] [--write]
import fs from "node:fs";
import path from "node:path";
import { CACHE, DATA, MACAU_BBOX, ensureDir, simplify, ringAreaM2, writeJson } from "./lib.mjs";

const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith("--")) continue;
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (!m) continue;
  if (m[2] !== undefined) args[m[1]] = m[2];
  else if (argv[i + 1] && !argv[i + 1].startsWith("--")) { args[m[1]] = argv[++i]; }
  else args[m[1]] = "true";
}
const TOL = args.tol ? Number(args.tol) : 0.05;
const WRITE = args.write === "true";
if (!isFinite(TOL)) throw new Error(`--tol 必須是數字，收到「${args.tol}」`);
const RAW = path.join(CACHE, "overture", "building.geojson");
const OUT = path.join(DATA, "macau-buildings.geojson");
const OSM = path.join(DATA, "osm", "macau-buildings.geojson");

if (!fs.existsSync(RAW)) throw new Error(`找不到原始快取 ${RAW}，請先執行 npm run data:overture`);
const clean = (o) => { const r = {}; for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") r[k] = v; return r; };
const nameOf = (p) => p?.names?.primary ?? p?.names?.["zh-Hant"] ?? Object.values(p?.names ?? {})[0] ?? null;
const inBox = (lon, lat) => lon >= MACAU_BBOX.west - 0.006 && lon <= MACAU_BBOX.east + 0.006 && lat >= MACAU_BBOX.south - 0.006 && lat <= MACAU_BBOX.north + 0.006;
function geomIntersects(g) {
  const box = { minx: 999, maxx: -999, miny: 999, maxy: -999 };
  const walk = (ring) => { for (const p of ring) { if (p[0] < box.minx) box.minx = p[0]; if (p[0] > box.maxx) box.maxx = p[0]; if (p[1] < box.miny) box.miny = p[1]; if (p[1] > box.maxy) box.maxy = p[1]; } };
  const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  for (const poly of polys) for (const ring of poly) walk(ring);
  return box.maxx >= MACAU_BBOX.west - 0.01 && box.minx <= MACAU_BBOX.east + 0.01 && box.maxy >= MACAU_BBOX.south - 0.01 && box.miny <= MACAU_BBOX.north + 0.01;
}
const precise = (c) => [Math.round(c[0] * 1e7) / 1e7, Math.round(c[1] * 1e7) / 1e7];
const simplifyPoly = (coords, tol) => coords.map((ring) => simplify(ring, tol).map(precise)).filter((ring) => ring.length >= 4);

// ---------------------------------------------------------------- 1. 讀原始資料 + 併入 OSM 高度
console.log(`[1/4] 讀取 Overture 原始建築（容差 ${TOL} m）…`);
const raw = JSON.parse(fs.readFileSync(RAW, "utf8"));
const osmHeight = new Map();
if (fs.existsSync(OSM)) {
  const osm = JSON.parse(fs.readFileSync(OSM, "utf8"));
  for (const f of osm.features ?? []) {
    const { id, h, lv, n } = f.properties ?? {};
    if (id != null) osmHeight.set(id, { h, lv, n });
  }
  console.log(`      OSM 高度快取 ${osmHeight.size} 筆`);
}

const feats = [];
let fromOverture = 0, fromOsm = 0, fromLevels = 0, pts = 0;
for (const f of raw.features) {
  const p = f.properties ?? {};
  const g = f.geometry;
  if (!g || !geomIntersects(g)) continue;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : null;
  if (!polys) continue;
  const ring = polys[0]?.[0];
  if (!ring || ring.length < 4) continue;

  let h = p.height != null ? Math.round(Math.min(Math.max(+p.height, 2.6), 330) * 10) / 10 : undefined;
  let hs = h != null ? "overture" : undefined;
  if (h != null) fromOverture++;
  let lv = p.num_floors ?? undefined;
  let n = nameOf(p);
  const osmSrc = (p.sources ?? []).find((s) => s.dataset === "OpenStreetMap");
  const oid = osmSrc?.record_id ? parseInt(String(osmSrc.record_id).replace(/^[a-z]/, ""), 10) || undefined : undefined;
  // OSM 實測高度優先補上
  if (h == null && oid != null && osmHeight.has(oid)) {
    const hit = osmHeight.get(oid);
    if (hit.h != null) { h = hit.h; hs = "osm"; fromOsm++; }
    else if (hit.lv != null) { lv = hit.lv; fromLevels++; }
    if (!n && hit.n) n = hit.n;
  }
  const coords = polys.map((poly) => simplifyPoly(poly, TOL)).filter((poly) => poly[0]?.length >= 4);
  if (!coords.length) continue;
  pts += coords.reduce((total, poly) => total + poly.reduce((n, part) => n + part.length, 0), 0);
  const footprintArea = coords.reduce((total, poly) => total + Math.max(0, ringAreaM2(poly[0]) - poly.slice(1).reduce((holes, hole) => holes + ringAreaM2(hole), 0)), 0);
  feats.push({
    type: "Feature",
    id: f.id,
    properties: clean({
      t: p.class === "building" || !p.class ? p.subtype : (p.class ?? p.subtype),
      h, hs, lv, n,
      oid,
      mh: p.min_height != null ? Math.round(p.min_height * 10) / 10 : undefined,
      u: p.subtype && !["commercial", "residential", "industrial", "civic"].includes(p.subtype) ? p.subtype : undefined,
      a: Math.round(footprintArea),          // 足跡面積 m²（供高度模型與樣式使用）
    }),
    geometry: coords.length === 1
      ? { type: "Polygon", coordinates: coords[0] }
      : { type: "MultiPolygon", coordinates: coords },
  });
}
console.log(`      保留 ${feats.length} 棟；平均 ${(pts / feats.length).toFixed(1)} 個點（原 6.8）`);
console.log(`      高度來源：Overture ${fromOverture}、OSM ${fromOsm}、OSM 樓層 ${fromLevels}`);

// ---------------------------------------------------------------- 2. 高度模型（在實測資料上擬合 + 驗證）
// 模型：h ≈ k_type · 面積^β（冪律）。β 全域共用、k 依類型，於對數空間最小平方擬合。
const measured = feats.filter((f) => f.properties.h != null && f.properties.a > 8);
console.log(`\n[2/4] 以 ${measured.length} 棟有實測高度的建築擬合「面積 → 高度」模型`);
const rnd = (() => { let s = 20260923; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
const shuffled = [...measured].sort(() => rnd() - 0.5);
const cut = Math.floor(shuffled.length * 0.8);
const train = shuffled.slice(0, cut), test = shuffled.slice(cut);

function fit(rows, beta) {
  const ks = new Map();
  const byType = new Map();
  for (const f of rows) {
    const t = f.properties.t ?? "yes";
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t).push(f);
  }
  for (const [t, arr] of byType) {
    // k = exp( mean( ln(h) - β·ln(a) ) )
    const v = arr.map((f) => Math.log(f.properties.h) - beta * Math.log(f.properties.a));
    ks.set(t, Math.exp(v.reduce((s, x) => s + x, 0) / v.length));
    ks.set(t + "_n", arr.length);
  }
  return ks;
}
function predict(f, beta, ks, fallback) {
  const t = f.properties.t ?? "yes";
  const k = (ks.get(t) ?? ks.get(fallback) ?? 2.2);
  return Math.min(Math.max(k * Math.pow(f.properties.a, beta), 2.6), 150);
}
function mae(rows, beta, ks, fallback) {
  const err = rows.map((f) => Math.abs(predict(f, beta, ks, fallback) - f.properties.h));
  err.sort((a, b) => a - b);
  return { mae: err.reduce((s, x) => s + x, 0) / err.length, med: err[Math.floor(err.length / 2)] };
}

let best = { beta: 0.5, score: Infinity, ks: null };
for (let beta = 0.25; beta <= 0.75; beta += 0.05) {
  const ks = fit(train, beta);
  const m = mae(test, beta, ks, "yes");
  if (m.mae < best.score) best = { beta, score: m.mae, ks, med: m.med };
}
const allKs = fit(measured, best.beta);
const holdout = mae(test, best.beta, best.ks, "yes");
console.log(`      最佳 β = ${best.beta.toFixed(2)}；保留集 MAE = ${holdout.mae.toFixed(1)} m、中位誤差 ${holdout.med.toFixed(1)} m`);
// 基準線：現行程式（map-style.js）對沒有高度的建築所用的「類型固定值」
const FIXED = { house: 6.5, detached: 6.5, bungalow: 6.5, static_caravan: 6.5, cabin: 6.5,
  garage: 3.4, garages: 3.4, shed: 3.4, hut: 3.4, carport: 3.4, garage_boxes: 3.4, roof: 3.4,
  apartments: 21, residential: 21, dormitory: 21, terrace: 21, barracks: 21,
  commercial: 26, retail: 26, office: 26, supermarket: 26, kiosk: 26, hotel: 26,
  industrial: 12, warehouse: 12, factory: 12,
  church: 14, chapel: 14, cathedral: 14, temple: 14, mosque: 14, synagogue: 14, shrine: 14, monastery: 14,
  school: 16, university: 16, college: 16, kindergarten: 16, hospital: 16, civic: 16, public: 16, government: 16, museum: 16, train_station: 16, transportation: 16,
  construction: 8, ruins: 8, yes: 13 };
const baseErr = test.map((f) => Math.abs((FIXED[f.properties.t] ?? 12) - f.properties.h)).sort((a, b) => a - b);
const baseMae = baseErr.reduce((s, x) => s + x, 0) / baseErr.length;
console.log(`      對照基準（現行類型固定值）在同一保留集：MAE = ${baseMae.toFixed(1)} m、中位誤差 ${baseErr[Math.floor(baseErr.length / 2)].toFixed(1)} m`);
console.log(`      → 面積模型 ${holdout.mae < baseMae ? "優於" : "未優於"}固定值（改善 ${(baseMae - holdout.mae).toFixed(1)} m）`);
const typeRows = [...allKs.entries()].filter(([k]) => !k.endsWith("_n"))
  .map(([t, k]) => ({ t, k, n: allKs.get(t + "_n") })).filter((r) => r.n >= 20).sort((a, b) => b.n - a.n).slice(0, 8);
console.log("      各類型係數（樣本 ≥20）：" + typeRows.map((r) => `${r.t}=${r.k.toFixed(1)}(n=${r.n})`).join("、"));

// ---------------------------------------------------------------- 3. 套用到缺高度的建築
let estimated = 0;
const hist = {};
for (const f of feats) {
  const p = f.properties;
  if (p.h != null) continue;
  if (p.lv != null) {                       // 有樓層數就直接換算
    p.h = Math.round(Math.min(Math.max(p.lv * 3.2, 2.6), 330) * 10) / 10;
    p.hs = "levels";
  } else if (p.a > 8) {                      // 面積模型
    p.h = Math.round(predict(f, best.beta, allKs, "yes") * 10) / 10;
    p.hs = "area";
    estimated++;
  } else {
    p.h = 6;                                 // 極小構築物
    p.hs = "tiny";
  }
  const b = Math.min(9, Math.floor(p.h / 10));
  hist[b] = (hist[b] ?? 0) + 1;
}
const withH = feats.filter((f) => f.properties.h != null).length;
console.log(`\n[3/4] 估算 ${estimated} 棟（面積模型）；有高度的建築 ${withH}/${feats.length} = ${(withH / feats.length * 100).toFixed(0)}%`);
console.log("      估算高度分布（10 m 為一級）：" + Object.entries(hist).map(([b, n]) => `${b * 10}–${b * 10 + 9}m:${n}`).join(" "));

// ---------------------------------------------------------------- 4. 輸出
const out = { type: "FeatureCollection", name: "澳門建築物 (Overture Maps + OSM 高度 + 面積推估)", features: feats };
const mb = (o) => (JSON.stringify(o).length / 1048576).toFixed(1);
console.log(`\n[4/4] 輸出大小約 ${mb(out)} MB（壓縮後傳輸約 ${(mb(out) / 4).toFixed(1)} MB）`);
if (WRITE) {
  ensureDir(DATA);
  writeJson(OUT, out);
  console.log(`      已寫入 ${path.relative(process.cwd(), OUT)}`);
} else {
  console.log("      （未寫入；加 --write 才會覆蓋）");
}
