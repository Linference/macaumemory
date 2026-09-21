// 位置驗證：檢查每個景點座標是否落在建築物上／水域中，並列出最近的建築距離
import fs from "node:fs";
import { DATA } from "./lib.mjs";

const attr = JSON.parse(fs.readFileSync(`${DATA}/attractions.json`, "utf8"));
const buildings = JSON.parse(fs.readFileSync(`${DATA}/macau-buildings.geojson`, "utf8")).features;
const water = JSON.parse(fs.readFileSync(`${DATA}/macau-water.geojson`, "utf8")).features;

const inRing = (ring, lon, lat) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};
const bboxOf = (coords) => {
  let minx = 999, maxx = -999, miny = 999, maxy = -999;
  for (const r of coords) for (const p of r) { if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0]; if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1]; }
  return { minx, maxx, miny, maxy };
};
const bld = buildings.map((f) => ({ bbox: bboxOf(f.geometry.coordinates), coords: f.geometry.coordinates, n: f.properties.n, t: f.properties.t, h: f.properties.h }));
const wtr = water.map((f) => ({ bbox: bboxOf(f.geometry.coordinates), coords: f.geometry.coordinates, c: f.properties.c, sea: f.properties.sea }));
const inGeom = (g, lon, lat) => lon >= g.bbox.minx && lon <= g.bbox.maxx && lat >= g.bbox.miny && lat <= g.bbox.maxy && g.coords.reduce((acc, ring) => acc ^ (inRing(ring, lon, lat) ? 1 : 0), 0) === 1;
const distM = (a, b) => Math.hypot((a[0] - b[0]) * 102400, (a[1] - b[1]) * 110800);

const buildingCats = new Set(["heritage", "temple", "museum", "landmark", "resort", "transport"]);
const rows = [];
for (const a of attr.attractions) {
  const [lon, lat] = a.coords;
  let insideB = null, nearest = Infinity, nearestB = null;
  for (const b of bld) {
    if (lon < b.bbox.minx - 0.0004 || lon > b.bbox.maxx + 0.0004 || lat < b.bbox.miny - 0.0004 || lat > b.bbox.maxy + 0.0004) continue;
    const d = distM([lon, lat], [(b.bbox.minx + b.bbox.maxx) / 2, (b.bbox.miny + b.bbox.maxy) / 2]);
    if (d < nearest) { nearest = d; nearestB = b; }
    if (!insideB && inGeom(b, lon, lat)) insideB = b;
  }
  const w = wtr.find((x) => inGeom(x, lon, lat));
  rows.push({
    id: a.id, zh: a.zh, cat: a.cat, src: a.geoSource ?? "curated", ref: a.geoRef ?? "",
    onBuilding: !!insideB, building: insideB?.n ?? nearestB?.n ?? null, buildingClass: insideB?.t ?? null, buildingHeight: insideB?.h ?? null,
    nearestBuildingM: isFinite(nearest) ? Math.round(nearest) : null,
    water: w ? `${w.c}${w.sea ? "(海)" : ""}` : null,
  });
}

const needBuilding = rows.filter((r) => buildingCats.has(r.cat));
const onB = needBuilding.filter((r) => r.onBuilding);
console.log(`建築類景點 ${needBuilding.length} 個，其中 ${onB.length} 個座標落在建築物輪廓內`);
console.log(`\n未落在建築物上的建築類景點（依最近建築距離排序）：`);
for (const r of needBuilding.filter((x) => !x.onBuilding).sort((a, b) => (a.nearestBuildingM ?? 999) - (b.nearestBuildingM ?? 999)).slice(0, 25)) {
  console.log(`  ${r.zh.padEnd(22)} ${r.src.padEnd(16)} 最近建築 ${String(r.nearestBuildingM ?? "-").padStart(4)}m  ${r.building ?? ""}`);
}
console.log(`\n落在水域的景點：`);
for (const r of rows.filter((x) => x.water)) console.log(`  ${r.zh.padEnd(22)} ${r.src.padEnd(16)} ${r.water}`);
console.log(`\n座標來源分佈：`);
const bySrc = {};
for (const r of rows) bySrc[r.src] = (bySrc[r.src] ?? 0) + 1;
console.log("  " + Object.entries(bySrc).map(([k, v]) => `${k}=${v}`).join("、"));
console.log(`\n海拔 > 5m 的建築類景點落在建築上比例：${onB.length}/${needBuilding.length} = ${((onB.length / needBuilding.length) * 100).toFixed(0)}%`);
