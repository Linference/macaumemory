// 下載澳門巴士站與路線（OSM/Overpass），產出 public/data/macau-bus.geojson
import { overpass, bboxStr, MACAU_BBOX, writeJson, DATA, q } from "./lib.mjs";

const B = bboxStr(MACAU_BBOX);
console.log("① 下載巴士站…");
const stopsJson = await overpass(
  `[out:json][timeout:300];
(node["highway"="bus_stop"](${B}););
out body qt;`,
  { cacheKey: "bus-stops" }
);
console.log(`  巴士站 ${stopsJson.elements.length} 個`);

console.log("② 下載巴士路線（relation route=bus）…");
const routesJson = await overpass(
  `[out:json][timeout:300];
(relation["route"~"^(bus|trolleybus)$"](${B}););
out body qt;`,
  { cacheKey: "bus-routes" }
);
console.log(`  路線 ${routesJson.elements.length} 條`);

// 建立「站點 -> 路線」對應
const refByNode = new Map();
for (const rel of routesJson.elements) {
  const ref = rel.tags?.ref ?? rel.tags?.name ?? "";
  const shortRef = String(ref).split(/[;,、\s]/)[0];
  if (!shortRef) continue;
  for (const m of rel.members ?? []) {
    if (m.type !== "node") continue;
    if (!/stop|platform|station/i.test(m.role ?? "")) continue;
    if (!refByNode.has(m.ref)) refByNode.set(m.ref, new Set());
    refByNode.get(m.ref).add(shortRef);
  }
}
console.log(`  可對應路線的站點 ${refByNode.size} 個`);

const features = [];
for (const el of stopsJson.elements) {
  if (el.type !== "node" || el.lat == null) continue;
  const t = el.tags ?? {};
  const name = t["name:zh"] ?? t["name:zh-Hant"] ?? t.name ?? t["name:en"];
  const relRoutes = [...(refByNode.get(el.id) ?? [])];
  const tagRoutes = (t.route_ref ?? "").split(/[;,、\s]+/).filter(Boolean);
  const routes = [...new Set([...relRoutes, ...tagRoutes])].sort((a, b) => a.localeCompare(b, "zh-Hant"));
  features.push({
    type: "Feature",
    properties: { n: name ?? null, r: routes.length ? routes.join(",") : null, id: el.id },
    geometry: { type: "Point", coordinates: q([el.lon, el.lat]) },
  });
}
const withName = features.filter((f) => f.properties.n).length;
const withRoute = features.filter((f) => f.properties.r).length;
writeJson(`${DATA}/macau-bus.geojson`, {
  type: "FeatureCollection",
  name: "澳門巴士站（OpenStreetMap）",
  source: "OpenStreetMap contributors (ODbL) via Overpass API",
  features,
});
console.log(`✅ 完成：${features.length} 站（${withName} 有站名、${withRoute} 有路線號）`);
