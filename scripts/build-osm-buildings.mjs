// 從 .cache/overpass/bld-*.json（OSM Overpass 快取）離線重建 OSM 建築資料
//
// 目的：比較 OSM 與 Overture 的建築輪廓精細度。Overture 在這個範圍有大量 ML 推估的矩形足跡
//（平均 7.8 個點），若 OSM 的手繪輪廓明顯較細，就該改以 OSM 為主體、Overture 補缺。
//
// 用法：node scripts/build-osm-buildings.mjs [--tol 0.2] [--write]
import fs from "node:fs";
import path from "node:path";
import { CACHE, DATA, ensureDir, geomOf, writeJson } from "./lib.mjs";

const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith("--")) continue;
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m[2] !== undefined) args[m[1]] = m[2];
  else if (argv[i + 1] && !argv[i + 1].startsWith("--")) args[m[1]] = argv[++i];
  else args[m[1]] = "true";
}
const TOL = args.tol ? Number(args.tol) : 0.2;
const WRITE = args.write === "true";
const DIR = path.join(CACHE, "overpass");
const OUT = path.join(DATA, "osm", "macau-buildings.geojson");

const files = fs.readdirSync(DIR).filter((f) => /^bld-\d+\.json$/.test(f)).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)));
if (!files.length) throw new Error(`找不到 bld-*.json（${DIR}）`);
console.log(`[1/3] 讀取 ${files.length} 塊 OSM 建築快取（容差 ${TOL} m）…`);

const parseLen = (v) => {
  if (v == null) return undefined;
  const s = String(v).trim().toLowerCase();
  const n = parseFloat(s);
  if (!isFinite(n)) return undefined;
  return Math.round(n * (s.includes("ft") || s.includes("'") ? 0.3048 : 1) * 10) / 10;
};
const nameOf = (t) => t["name:zh-Hant"] ?? t["name:zh"] ?? t.name ?? t["name:en"] ?? undefined;
const clean = (o) => { const r = {}; for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") r[k] = v; return r; };

const seen = new Set();
const feats = [];
let withHeight = 0, named = 0, pts = 0, rings = 0;
for (const f of files) {
  const json = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
  for (const el of json.elements ?? []) {
    const t = el.tags ?? {};
    if (!t.building) continue;
    const key = `${el.type}/${el.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const geom = geomOf(el, TOL);
    if (!geom) continue;
    const poly = geom.type === "Polygon" ? geom : { type: "Polygon", coordinates: [geom.coordinates] };
    if (!poly.coordinates?.[0] || poly.coordinates[0].length < 4) continue;
    const levels = parseFloat(t["building:levels"]);
    let h = parseLen(t.height);
    if (h == null && isFinite(levels)) h = Math.round(levels * 3.2 * 10) / 10;
    if (h != null) { h = Math.min(Math.max(h, 2.6), 330); withHeight++; }
    const n = nameOf(t);
    if (n) named++;
    pts += poly.coordinates[0].length;
    rings += poly.coordinates.length;
    feats.push({
      type: "Feature",
      properties: clean({
        oid: el.type === "way" ? el.id : undefined,
        t: t.building === "yes" ? undefined : t.building,
        h, lv: isFinite(levels) ? levels : undefined,
        mh: parseLen(t.min_height) ?? (isFinite(parseFloat(t["building:min_level"])) ? Math.round(parseFloat(t["building:min_level"]) * 3.2 * 10) / 10 : undefined),
        n, u: t.amenity ?? t.shop ?? t.office ?? t.tourism,
      }),
      geometry: poly,
    });
  }
}

console.log(`[2/3] OSM 建築 ${feats.length} 棟`);
console.log(`      平均輪廓點數 ${(pts / feats.length).toFixed(1)}（Overture 版為 7.8）`);
console.log(`      有高度 ${withHeight} 棟（${(withHeight / feats.length * 100).toFixed(1)}%）｜有名稱 ${named} 棟｜含內環 ${rings - feats.length} 個`);
const sizes = feats.map((x) => x.geometry.coordinates[0].length).sort((a, b) => a - b);
console.log(`      點數分位：p50=${sizes[Math.floor(sizes.length * 0.5)]} p90=${sizes[Math.floor(sizes.length * 0.9)]} p99=${sizes[Math.floor(sizes.length * 0.99)]} max=${sizes[sizes.length - 1]}`);

const out = { type: "FeatureCollection", name: "澳門建築物 (OpenStreetMap)", features: feats };
const mb = (JSON.stringify(out).length / 1048576).toFixed(1);
console.log(`[3/3] 輸出大小約 ${mb} MB`);
if (WRITE) {
  ensureDir(path.dirname(OUT));
  writeJson(OUT, out);
  console.log(`      已寫入 ${path.relative(process.cwd(), OUT)}`);
} else console.log("      （未寫入；加 --write 才會寫檔）");
