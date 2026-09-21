// 從 OpenStreetMap (Overpass API) 下載澳門地圖資料，產出 public/data/macau-*.geojson
// 策略：切成小塊逐塊抓取（可續傳、可重跑補齊），避免大型查詢被伺服器拒絕
import path from "node:path";
import { overpass, overpassTiled, bboxStr, MACAU_BBOX, SAMPLING_BBOX, geomOf, q, featureCollection, writeJson, PUBLIC, ringAreaM2 } from "./lib.mjs";

const DATA = path.join(PUBLIC, "data", "osm");

const S = bboxStr(SAMPLING_BBOX);
const log = (...a) => console.log(...a);
const clean = (o) => { const r = {}; for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") r[k] = v; return r; };
const isTrue = (v) => v !== undefined && v !== "no" && v !== "false" && v !== "0";
const parseLen = (v) => {
  if (v == null) return undefined;
  const s = String(v).trim().toLowerCase();
  const n = parseFloat(s);
  if (!isFinite(n)) return undefined;
  return Math.round(n * (s.includes("ft") || s.includes("\u0027") ? 0.3048 : 1) * 10) / 10;
};
const nameOf = (t) => clean({ n: t["name:zh-Hant"] ?? t["name:zh"] ?? t.name ?? t["name:en"] }).n;

// ---------------------------------------------------------- 建築物（6×5 分塊）
async function fetchBuildings() {
  log("\n[1/5] 建築物 building（逐塊下載）…");
  const { elements, failed, tiles } = await overpassTiled(
    `[out:json][timeout:180];way["building"]({bbox});out geom qt;relation["building"]({bbox});out geom qt;`,
    { bbox: MACAU_BBOX, cols: 4, rows: 3, prefix: "bld3", label: "建築物" }
  );
  const feats = [];
  let named = 0, withHeight = 0;
  for (const el of elements) {
    const t = el.tags ?? {};
    if (!t.building) continue;
    const geom = geomOf(el, 0.45);
    if (!geom) continue;
    const levels = parseFloat(t["building:levels"]);
    let h = parseLen(t.height);
    if (h == null && isFinite(levels)) h = Math.round(levels * 3.2 * 10) / 10;
    if (h != null) { h = Math.min(Math.max(h, 2.6), 330); withHeight++; }
    const mh = parseLen(t.min_height) ?? (isFinite(parseFloat(t["building:min_level"])) ? Math.round(parseFloat(t["building:min_level"]) * 3.2 * 10) / 10 : undefined);
    const n = nameOf(t);
    if (n) named++;
    feats.push({
      type: "Feature",
      properties: clean({ id: el.type === "way" ? el.id : undefined, t: t.building === "yes" ? undefined : t.building, h, mh, lv: isFinite(levels) ? levels : undefined, n, u: t.amenity ?? t.shop ?? t.office ?? t.tourism }),
      geometry: geom.type === "Polygon" ? geom : { type: "Polygon", coordinates: [geom.coordinates] },
    });
  }
  log(`  ✓ 建築 ${feats.length} 棟（${named} 棟有名稱、${withHeight} 棟有高度）`);
  return { feats, failed, tiles };
}

// ---------------------------------------------------------- 道路/軌道/水道/機場/橋樑（4×3 分塊）
async function fetchLines() {
  log("\n[2/5] 道路、輕軌、水道、機場設施…");
  const { elements, failed, tiles } = await overpassTiled(
    `[out:json][timeout:180];
way["highway"]({bbox});out geom qt;
way["railway"]({bbox});out geom qt;
way["waterway"]({bbox});out geom qt;
way["aeroway"]({bbox});out geom qt;
way["man_made"~"^(bridge|pier|breakwater|groyne)$"]({bbox});out geom qt;`,
    { bbox: MACAU_BBOX, cols: 4, rows: 3, prefix: "line", label: "線狀地物" }
  );
  const roads = [], rails = [], waterways = [], aero = [], struct = [];
  for (const el of elements) {
    const t = el.tags ?? {};
    const kind = t.highway ? "road" : t.railway ? "rail" : t.waterway ? "water" : t.aeroway ? "aero" : t.man_made ? "struct" : null;
    if (!kind) continue;
    const geom = geomOf(el, kind === "road" ? 1.1 : 1.5);
    if (!geom) continue;
    const f = {
      type: "Feature",
      properties: clean({
        c: t.highway ?? t.railway ?? t.waterway ?? t.aeroway ?? t.man_made,
        n: nameOf(t),
        b: isTrue(t.bridge) ? 1 : isTrue(t.tunnel) ? 2 : undefined,
        l: t.lanes ? parseInt(t.lanes, 10) || undefined : undefined,
        o: isTrue(t.oneway) ? 1 : undefined,
      }),
      geometry: geom,
    };
    ({ road: roads, rail: rails, water: waterways, aero, struct })[kind].push(f);
  }
  log(`  ✓ 道路 ${roads.length}、軌道 ${rails.length}、水道 ${waterways.length}、機場 ${aero.length}、橋樑碼頭 ${struct.length}`);
  return { roads, rails, waterways, aero, struct, failed, tiles };
}

// ---------------------------------------------------------- 面狀地物（4×3 分塊）
async function fetchAreas() {
  log("\n[3/5] 水體、綠地、土地利用…");
  const { elements, failed, tiles } = await overpassTiled(
    `[out:json][timeout:180];
(
  way["natural"="water"]({bbox}); way["water"]({bbox}); way["natural"="bay"]({bbox}); way["landuse"="reservoir"]({bbox});
  relation["natural"="water"]({bbox}); relation["water"]({bbox});
  way["landuse"]({bbox}); way["leisure"]({bbox});
  way["natural"~"^(wood|scrub|heath|grassland|sand|beach|wetland|bare_rock|shingle)$"]({bbox});
  way["amenity"~"^(grave_yard|parking|university|school|hospital|marketplace)$"]({bbox});
  way["tourism"~"^(theme_park|zoo|attraction|viewpoint)$"]({bbox});
  relation["landuse"]({bbox}); relation["leisure"]({bbox});
);
out geom qt;`,
    { bbox: MACAU_BBOX, cols: 4, rows: 3, prefix: "area", label: "面狀地物" }
  );
  const water = [], land = [];
  for (const el of elements) {
    const t = el.tags ?? {};
    const geom = geomOf(el, 2.5);
    if (!geom) continue;
    const isWater = t.natural === "water" || (t.water && t.water !== "no") || t.landuse === "reservoir" || t.natural === "bay";
    const kind = isWater ? "water" : t.leisure ? "leisure" : t.natural ? "natural" : t.landuse ? "landuse" : t.amenity ? "amenity" : "tourism";
    const f = {
      type: "Feature",
      properties: clean({ c: t.water ?? t.landuse ?? t.leisure ?? t.natural ?? t.amenity ?? t.tourism, k: kind, n: nameOf(t) }),
      geometry: geom.type === "Polygon" ? geom : { type: "Polygon", coordinates: [geom.coordinates] },
    };
    (isWater ? water : land).push(f);
  }
  log(`  ✓ 水體 ${water.length}、綠地/土地利用 ${land.length}`);
  return { water, land, failed, tiles };
}

// ---------------------------------------------------------- POI（4×3 分塊）
async function fetchPois() {
  log("\n[4/5] 名勝古蹟與設施 POI…");
  const { elements, failed, tiles } = await overpassTiled(
    `[out:json][timeout:180];
(
  node["tourism"]({bbox}); node["historic"]({bbox});
  node["amenity"~"^(place_of_worship|hospital|university|college|school|library|theatre|cinema|arts_centre|museum|marketplace|ferry_terminal|bus_station|police|fire_station|townhall|community_centre|conference_centre|casino|gambling)$"]({bbox});
  node["leisure"~"^(park|garden|stadium|sports_centre|marina|golf_course|beach_resort|nature_reserve)$"]({bbox});
  node["man_made"="lighthouse"]({bbox}); node["railway"="station"]({bbox});
  node["shop"~"^(mall|department_store)$"]({bbox}); node["office"="government"]({bbox});
);
out body qt;`,
    { bbox: MACAU_BBOX, cols: 4, rows: 3, prefix: "poi", label: "POI" }
  );
  const feats = [], seen = new Set();
  for (const el of elements) {
    if (el.type !== "node" || el.lat == null) continue;
    const t = el.tags ?? {};
    const name = t["name:zh-Hant"] ?? t["name:zh"] ?? t.name ?? t["name:en"];
    if (!name) continue;
    const k = `${name}@${el.lat.toFixed(5)},${el.lon.toFixed(5)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    feats.push({
      type: "Feature",
      properties: clean({
        c: t.tourism ?? t.historic ?? t.amenity ?? t.leisure ?? "other",
        n: name,
        zh: t["name:zh-Hant"] ?? t["name:zh"],
        zhHans: t["name:zh-Hans"],
        en: t["name:en"] ?? (/^[\x00-\x7f]+$/.test(name) ? name : undefined),
        w: t.wikipedia ? String(t.wikipedia).replace(/^zh:/, "") : undefined,
        h: t.heritage ? 1 : undefined,
      }),
      geometry: { type: "Point", coordinates: q([el.lon, el.lat]) },
    });
  }
  log(`  ✓ POI ${feats.length} 個`);
  return { feats, failed, tiles };
}

// ---------------------------------------------------------- 海岸線
async function fetchCoastline() {
  log("\n[5/5] 海岸線與行政邊界…");
  const { elements, failed, tiles } = await overpassTiled(
    `[out:json][timeout:180];way["natural"="coastline"]({bbox});out geom qt;`,
    { bbox: SAMPLING_BBOX, cols: 3, rows: 3, prefix: "coast", label: "海岸線" }
  );
  const feats = [];
  for (const el of elements) {
    if (el.type !== "way" || !el.geometry || el.geometry.length < 2) continue;
    const g = geomOf(el, 2);
    if (g) feats.push({ type: "Feature", properties: {}, geometry: g.type === "LineString" ? g : { type: "LineString", coordinates: g.coordinates[0] } });
  }
  const list = await overpass(`[out:json][timeout:120];relation["boundary"="administrative"](${S});out tags qt;`, { cacheKey: "boundary-list" });
  const re = /澳門|Macau|Macao|堂區|Freguesia|Nossa Senhora|Sé|Santo António|São Lázaro|São Lourenço|Fátima|Taipa|Coloane|Cotai|路氹|氹仔|路環|花地瑪|大堂|望德|聖安多尼|風順堂|聖方濟各|嘉模/;
  const cand = (list.elements ?? []).filter((e) => re.test(`${e.tags?.["name:zh"] ?? ""} ${e.tags?.name ?? ""} ${e.tags?.["name:en"] ?? ""}`));
  log(`  → 邊界候選 ${cand.length} 個：${cand.map((c) => `${c.id}(${c.tags["name:zh"] ?? c.tags.name})`).join("、").slice(0, 300)}`);
  let boundaries = [];
  if (cand.length) {
    const json = await overpass(`[out:json][timeout:300];relation(id:${cand.map((c) => c.id).join(",")});out geom qt;`, { cacheKey: "boundary-geom" });
    for (const el of json.elements ?? []) {
      const g = geomOf(el, 1.2);
      if (!g || g.type !== "Polygon") continue;
      const t = el.tags ?? {};
      boundaries.push({
        type: "Feature",
        properties: clean({ id: el.id, n: t["name:zh"] ?? t["name:zh-Hant"] ?? t.name, e: t["name:en"], admin: t.admin_level, area_km2: +(ringAreaM2(g.coordinates[0]) / 1e6).toFixed(3) }),
        geometry: g,
      });
    }
    boundaries.sort((a, b) => b.properties.area_km2 - a.properties.area_km2);
    for (const f of boundaries.slice(0, 10)) log(`    · ${f.properties.n} (L${f.properties.admin}) ${f.properties.area_km2} km²`);
  }
  return { coast: feats, boundaries, failed, tiles };
}

// ---------------------------------------------------------- 主流程
const t0 = Date.now();
const B = await fetchBuildings();
const L = await fetchLines();
const A = await fetchAreas();
const P = await fetchPois();
const C = await fetchCoastline();

log("\n[輸出] GeoJSON…");
writeJson(`${DATA}/macau-buildings.geojson`, featureCollection(B.feats, { name: "澳門建築物 (OpenStreetMap)" }));
writeJson(`${DATA}/macau-roads.geojson`, featureCollection(L.roads, { name: "澳門道路網 (OpenStreetMap)" }));
writeJson(`${DATA}/macau-rail.geojson`, featureCollection([...L.rails, ...L.aero, ...L.struct], { name: "澳門軌道/機場/橋樑 (OpenStreetMap)" }));
writeJson(`${DATA}/macau-waterways.geojson`, featureCollection(L.waterways, { name: "澳門水道 (OpenStreetMap)" }));
writeJson(`${DATA}/macau-water.geojson`, featureCollection(A.water, { name: "澳門水體 (OpenStreetMap)" }));
writeJson(`${DATA}/macau-landuse.geojson`, featureCollection(A.land, { name: "澳門綠地與土地利用 (OpenStreetMap)" }));
writeJson(`${DATA}/macau-coastline.geojson`, featureCollection(C.coast, { name: "澳門海岸線 (OpenStreetMap)" }));
writeJson(`${DATA}/macau-pois.geojson`, featureCollection(P.feats, { name: "澳門景點與設施 (OpenStreetMap)" }));
if (C.boundaries.length) writeJson(`${DATA}/macau-boundary.geojson`, featureCollection(C.boundaries, { name: "澳門行政邊界 (OpenStreetMap)" }));

const failedTiles = [...B.failed, ...L.failed, ...A.failed, ...P.failed, ...C.failed];
writeJson(`${DATA}/macau-stats.json`, {
  generated: new Date().toISOString(),
  source: "OpenStreetMap contributors (ODbL 1.0) via Overpass API",
  bbox: MACAU_BBOX,
  tiles: { buildings: [4, 3], others: [4, 3] },
  counts: {
    buildings: B.feats.length, buildingsWithHeight: B.feats.filter((f) => f.properties.h != null).length,
    roads: L.roads.length, rails: L.rails.length, poi: P.feats.length,
    waterAreas: A.water.length, landAreas: A.land.length, coastlineSegments: C.coast.length, boundaries: C.boundaries.length,
  },
  failedTiles,
  processingSeconds: +((Date.now() - t0) / 1000).toFixed(1),
});
log(`\n${failedTiles.length ? "⚠ 有 " + failedTiles.length + " 個分塊未完成，可重新執行 npm run data:osm 補齊" : "✅ 全部圖磚下載成功"}｜總耗時 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
