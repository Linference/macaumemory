// 以 Overture Maps（開放資料，含 OSM 與 ML 建築足跡）下載澳門圖資並轉成 App 用的 GeoJSON
// 需要 Python 套件 overturemaps（pip install overturemaps）
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { CACHE, DATA, MACAU_BBOX, ensureDir, simplify, q, ringAreaM2, writeJson, featureCollection } from "./lib.mjs";

const BBOX = `${MACAU_BBOX.west - 0.01},${MACAU_BBOX.south - 0.01},${MACAU_BBOX.east + 0.01},${MACAU_BBOX.north + 0.01}`;
const OT = path.join(CACHE, "overture");
ensureDir(OT);

function download(type, file) {
  const out = path.join(OT, file);
  if (fs.existsSync(out) && !process.env.REFRESH) { console.log(`  ↳ 快取 ${file}（${(fs.statSync(out).size / 1048576).toFixed(1)} MB）`); return JSON.parse(fs.readFileSync(out, "utf8")); }
  console.log(`  ↓ Overture ${type} …`);
  execFileSync("python", ["-m", "overturemaps", "download", "--bbox", BBOX, "-f", "geojson", "--type", type, "-o", out], { stdio: ["ignore", "ignore", "inherit"] });
  console.log(`  ✓ ${file}（${(fs.statSync(out).size / 1048576).toFixed(1)} MB）`);
  return JSON.parse(fs.readFileSync(out, "utf8"));
}

const clean = (o) => { const r = {}; for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") r[k] = v; return r; };
const nameOf = (p) => p?.names?.primary ?? p?.names?.["zh-Hant"] ?? Object.values(p?.names ?? {})[0] ?? null;
const inBox = (lon, lat) => lon >= MACAU_BBOX.west - 0.006 && lon <= MACAU_BBOX.east + 0.006 && lat >= MACAU_BBOX.south - 0.006 && lat <= MACAU_BBOX.north + 0.006;
/** 幾何外框是否與澳門範圍相交（±0.01 度緩衝） */
function geomIntersects(g) {
  const box = { minx: 999, maxx: -999, miny: 999, maxy: -999 };
  const walkRing = (ring) => { for (const p of ring) { if (p[0] < box.minx) box.minx = p[0]; if (p[0] > box.maxx) box.maxx = p[0]; if (p[1] < box.miny) box.miny = p[1]; if (p[1] > box.maxy) box.maxy = p[1]; } };
  const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  for (const poly of polys) for (const ring of poly) walkRing(ring);
  return box.maxx >= MACAU_BBOX.west - 0.01 && box.minx <= MACAU_BBOX.east + 0.01 && box.maxy >= MACAU_BBOX.south - 0.01 && box.miny <= MACAU_BBOX.north + 0.01;
}

function simplifyPoly(coords, tol) {
  return coords.map((ring) => {
    const s = simplify(ring, tol);
    return s.map(q);
  });
}
function ringCentroid(ring) {
  let x = 0, y = 0, n = 0;
  for (const p of ring) { if (n > 400) break; x += p[0]; y += p[1]; n++; }
  return [x / n, y / n];
}

// ------------------------------------------------------------ 1. 建築
console.log("\n[1/6] 建築物");
const b = download("building", "building.geojson");
const buildings = [];
let heights = 0;
for (const f of b.features) {
  const p = f.properties ?? {};
  const g = f.geometry;
  if (!g) continue;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : null;
  if (!polys) continue;
  if (!geomIntersects(g)) continue;
  const h = p.height != null ? Math.round(Math.min(Math.max(+p.height, 2.6), 330) * 10) / 10 : undefined;
  if (h != null) heights++;
  const n = nameOf(p);
  const osmSrc = (p.sources ?? []).find((s) => s.dataset === "OpenStreetMap");
  const source = osmSrc ? "osm" : "ml";
  const oid = osmSrc?.record_id ? parseInt(String(osmSrc.record_id).replace(/^[a-z]/, ""), 10) || undefined : undefined;
  buildings.push({
    type: "Feature",
    id: p.id ?? f.id ?? (oid ? `osm-${oid}` : undefined),
    properties: clean({
      bid: p.id ?? f.id ?? (oid ? `osm-${oid}` : undefined),
      t: p.class === "building" || !p.class ? p.subtype : (p.class ?? p.subtype),
      h, lv: p.num_floors ?? undefined, n: n ?? undefined,
      s: source === "ml" ? 1 : undefined, // 1 = ML 推估足跡（無高度資料）
      oid,
      mh: p.min_height != null ? Math.round(p.min_height * 10) / 10 : undefined,
      u: p.subtype && !["commercial", "residential", "industrial", "civic"].includes(p.subtype) ? p.subtype : undefined,
    }),
    geometry: { type: "Polygon", coordinates: polys[0].length > 1 ? simplifyPoly(polys[0], 0.45) : simplifyPoly(polys[0], 0.45) },
  });
}
console.log(`  保留 ${buildings.length} 棟（${heights} 棟有真實高度）`);

// ------------------------------------------------------------ 2. 道路 / 軌道
console.log("\n[2/6] 道路與軌道");
const s = download("segment", "segment.geojson");
const roads = [], rails = [], waterways = [];
const RAIL = /rail|subway|tram|light_rail|monorail|narrow_gauge|funicular/i;
for (const f of s.features) {
  const p = f.properties ?? {};
  const g = f.geometry;
  if (!g || !p.class) continue;
  const lines = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : null;
  if (!lines) continue;
  const flags = (p.road_flags ?? []).map((x) => (typeof x === "string" ? x : x?.value ?? JSON.stringify(x))).join(",");
  const cls = p.class;
  const isRail = RAIL.test(cls);
  const isWater = /ferry/i.test(cls);
  const tol = isRail ? 1.5 : /footway|path|steps|cycleway|service/.test(cls) ? 1.4 : 1.1;
  const coords = simplify(lines[0], tol).map(q);
  if (coords.length < 2) continue;
  const feat = {
    type: "Feature",
    properties: clean({
      c: cls,
      n: nameOf(p) ?? undefined,
      b: /is_bridge|bridge/.test(flags) ? 1 : /is_tunnel|tunnel/.test(flags) ? 2 : undefined,
      o: /is_oneway|oneway/.test(flags) ? 1 : undefined,
      w: p.width != null ? Math.round(p.width) : undefined,
    }),
    geometry: { type: "LineString", coordinates: coords },
  };
  if (isWater) waterways.push(feat);
  else if (isRail) rails.push(feat);
  else roads.push(feat);
}
console.log(`  道路 ${roads.length}、軌道 ${rails.length}、航線/水道 ${waterways.length}`);

// ------------------------------------------------------------ 3. 水體
console.log("\n[3/6] 水體");
const w = download("water", "water.geojson");
const water = [];
for (const f of w.features) {
  const p = f.properties ?? {};
  if (!f.geometry) continue;
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : null;
  if (!polys) continue;
  if (!geomIntersects(f.geometry)) continue;
  water.push({
    type: "Feature",
    properties: clean({ c: p.class, k: "water", n: nameOf(p) ?? undefined, sea: p.class === "ocean" || p.class === "sea" || p.class === "strait" || p.class === "bay" ? 1 : undefined }),
    geometry: { type: "Polygon", coordinates: simplifyPoly(polys[0], /ocean|sea|strait/.test(p.class ?? "") ? 10 : 3) },
  });
}
console.log(`  水體 ${water.length}`);

// ------------------------------------------------------------ 4. 土地利用 / 地表覆蓋
console.log("\n[4/6] 土地利用與地表覆蓋");
const land = [];
for (const [type, file, kind] of [["land_use", "land_use.geojson", "landuse"], ["land_cover", "land_cover.geojson", "landcover"], ["land", "land.geojson", "land"]]) {
  let j;
  try { j = download(type, file); } catch (e) { console.warn(`  ⚠ ${type} 下載失敗：${e.message.slice(0, 80)}`); continue; }
  for (const f of j.features ?? []) {
    const p = f.properties ?? {};
    if (!f.geometry) continue;
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : null;
    if (!polys) continue;
    if (!geomIntersects(f.geometry)) continue;
    land.push({
      type: "Feature",
      properties: clean({ c: p.class ?? p.subtype, k: kind, n: nameOf(p) ?? undefined }),
      geometry: { type: "Polygon", coordinates: simplifyPoly(polys[0], 3.5) },
    });
  }
  console.log(`  ${type}: 累計 ${land.length}`);
}

// ------------------------------------------------------------ 5. 行政邊界
console.log("\n[5/6] 行政邊界");
let boundaries = [];
try {
  const d = download("division_area", "division_area.geojson");
  for (const f of d.features ?? []) {
    const p = f.properties ?? {};
    if (!f.geometry) continue;
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : null;
    if (!polys) continue;
    if (!geomIntersects(f.geometry)) continue;
    if (p.country && p.country !== "MO") continue; // 只保留澳門（含堂區），排除珠海/中山
    const name = nameOf(p) ?? "";
    const area = polys.reduce((acc, poly) => acc + poly.reduce((a2, r) => a2 + ringAreaM2(r), 0), 0) / 1e6;
    const isSar = /澳門|Macau|Macao/i.test(`${name} ${p.names?.["en"] ?? ""}`) && area > 20;
    const subtype = p.subtype ?? "";
    boundaries.push({
      type: "Feature",
      properties: clean({ id: p.id ?? f.id, n: name, e: p.names?.en ?? undefined, admin: p.admin_level ?? undefined, subtype: subtype || undefined, k: isSar ? "sar" : "parish", area_km2: +area.toFixed(3) }),
      geometry: { type: "MultiPolygon", coordinates: polys.map((poly) => simplifyPoly(poly, 1.5)) },
    });
  }
} catch (e) { console.warn("  ⚠ division_area 失敗：", e.message.slice(0, 100)); }
boundaries.sort((a, b2) => (b2.properties.k === "sar" ? 1 : 0) - (a.properties.k === "sar" ? 1 : 0) || b2.properties.area_km2 - a.properties.area_km2);
for (const f of boundaries.slice(0, 8)) console.log(`   · ${f.properties.n} [${f.properties.k}] ${f.properties.area_km2} km²`);
const sar = boundaries.find((f) => f.properties.k === "sar");
if (sar) console.log(`  ★ 澳門特別行政區邊界：${sar.properties.area_km2} km²`);

// ------------------------------------------------------------ 6. POI
console.log("\n[6/6] 地點 POI");
const pois = [];
try {
  const pl = download("place", "place.geojson");
  for (const f of pl.features ?? []) {
    const p = f.properties ?? {};
    if (f.geometry?.type !== "Point") continue;
    const [lon, lat] = f.geometry.coordinates;
    if (!inBox(lon, lat)) continue;
    const n = nameOf(p);
    if (!n) continue;
    pois.push({
      type: "Feature",
      properties: clean({ c: (p.categories?.alternate ?? p.categories?.primary ?? "other")[0] ?? "other", n, zh: p.names?.["zh-Hant"] ?? (p.names?.primary && /[\u4e00-\u9fff]/.test(p.names.primary) ? p.names.primary : undefined), zhHans: p.names?.["zh-Hans"], en: p.names?.en, w: p.wikidata ?? undefined, conf: p.confidence != null ? +(+p.confidence).toFixed(2) : undefined }),
      geometry: { type: "Point", coordinates: q([lon, lat]) },
    });
  }
} catch (e) { console.warn("  ⚠ place 失敗：", e.message.slice(0, 100)); }
console.log(`  POI ${pois.length}`);

// ------------------------------------------------------------ 輸出
console.log("\n[輸出]");
writeJson(`${DATA}/macau-buildings.geojson`, featureCollection(buildings, { name: "澳門建築物 (Overture Maps)", source: "Overture Maps Foundation — 含 OpenStreetMap (ODbL) 與 Microsoft ML 建築足跡" }));
writeJson(`${DATA}/macau-roads.geojson`, featureCollection(roads, { name: "澳門道路 (Overture Maps)" }));
writeJson(`${DATA}/macau-rail.geojson`, featureCollection(rails, { name: "澳門軌道 (Overture Maps)" }));
writeJson(`${DATA}/macau-waterways.geojson`, featureCollection(waterways, { name: "澳門航線/水道 (Overture Maps)" }));
writeJson(`${DATA}/macau-water.geojson`, featureCollection(water, { name: "澳門水體 (Overture Maps)" }));
writeJson(`${DATA}/macau-landuse.geojson`, featureCollection(land, { name: "澳門土地利用 (Overture Maps)" }));
writeJson(`${DATA}/macau-pois.geojson`, featureCollection(pois, { name: "澳門地點 (Overture Maps)" }));
if (boundaries.length) writeJson(`${DATA}/macau-boundary.geojson`, featureCollection(boundaries, { name: "澳門行政邊界 (Overture Maps)" }));
if (!fs.existsSync(`${DATA}/macau-coastline.geojson`)) writeJson(`${DATA}/macau-coastline.geojson`, featureCollection([], {}));
writeJson(`${DATA}/macau-stats.json`, {
  generated: new Date().toISOString(),
  source: "Overture Maps Foundation（含 OpenStreetMap ODbL 1.0、Microsoft Building Footprints）",
  bbox: MACAU_BBOX,
  counts: {
    buildings: buildings.length,
    buildingsWithHeight: buildings.filter((x) => x.properties.h != null).length,
    buildingsFromOSM: buildings.filter((x) => !x.properties.s).length,
    roads: roads.length, rails: rails.length, poi: pois.length,
    waterAreas: water.length, landAreas: land.length, boundaries: boundaries.length,
  },
  sarAreaKm2: sar?.properties.area_km2 ?? null,
});
console.log("✅ Overture 圖資完成");
