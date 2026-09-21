// 把 OSM 的實測高度（height 標籤或 building:levels 推算）併入 Overture 建築資料
// Overture 建築若來自 OSM 會保留 oid（OSM way id），據此對應可補上缺少的高度
import fs from "node:fs";
import path from "node:path";
import { DATA, writeJson } from "./lib.mjs";

const overtureFile = path.join(DATA, "macau-buildings.geojson");
const osmFile = path.join(DATA, "osm", "macau-buildings.geojson");
if (!fs.existsSync(overtureFile)) throw new Error("找不到 Overture 建築資料，請先執行 npm run data:overture");
if (!fs.existsSync(osmFile)) {
  console.log("⚠ 找不到 OSM 建築快取（public/data/osm/macau-buildings.geojson），略過高度合併（可執行 npm run data:osm 補齊）");
  process.exit(0);
}

const overture = JSON.parse(fs.readFileSync(overtureFile, "utf8"));
const osm = JSON.parse(fs.readFileSync(osmFile, "utf8"));
const osmHeight = new Map();
for (const f of osm.features ?? []) {
  const { id, h, lv, n } = f.properties ?? {};
  if (id == null) continue;
  osmHeight.set(id, { h, lv, n });
}
console.log(`OSM 建築 ${osmHeight.size} 筆、Overture 建築 ${overture.features.length} 筆`);

let filled = 0, already = 0;
for (const f of overture.features) {
  const p = f.properties;
  if (p.h != null) { already++; continue; }
  const hit = p.oid != null ? osmHeight.get(p.oid) : null;
  if (!hit) continue;
  if (hit.h != null) { p.h = hit.h; p.hs = "osm"; filled++; }
  else if (hit.lv != null) { p.h = Math.min(Math.max(hit.lv * 3.2, 2.6), 330); p.lv = hit.lv; p.hs = "levels"; filled++; }
  if (!p.n && hit.n) p.n = hit.n;
}

const withH = overture.features.filter((f) => f.properties.h != null).length;
console.log(`補上高度 ${filled} 棟（原本已有 ${already} 棟）→ 共 ${withH} 棟有高度（${((withH / overture.features.length) * 100).toFixed(0)}%）`);
overture.name = "澳門建築物 (Overture Maps + OpenStreetMap 高度)";
writeJson(overtureFile, overture);
