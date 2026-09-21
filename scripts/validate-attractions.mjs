// 檢查每個景點座標是否落在水域（代表座標有誤），並列出高程異常者
import fs from "node:fs";
const w = JSON.parse(fs.readFileSync("public/data/macau-water.geojson", "utf8"));
const elev = JSON.parse(fs.readFileSync("public/data/macau-elevation.json", "utf8"));
const attr = JSON.parse(fs.readFileSync("public/data/attractions.json", "utf8"));
const polys = [];
for (const f of w.features) {
  const rings = f.geometry.type === "Polygon" ? f.geometry.coordinates : f.geometry.coordinates.flat();
  let minx = 999, maxx = -999, miny = 999, maxy = -999;
  for (const r of rings) for (const p of r) { minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); miny = Math.min(miny, p[1]); maxy = Math.max(maxy, p[1]); }
  polys.push({ rings, minx, maxx, miny, maxy, c: f.properties.c, n: f.properties.n });
}
const inRing = (r, lon, lat) => { let h = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) h = !h; } return h; };
const waterAt = (lon, lat) => polys.find((p) => lon >= p.minx && lon <= p.maxx && lat >= p.miny && lat <= p.maxy && p.rings.reduce((a, r) => a ^ (inRing(r, lon, lat) ? 1 : 0), 0));
let bad = 0;
for (const a of attr.attractions) {
  const h = elev.attractionElevations?.[a.id];
  const wf = waterAt(a.coords[0], a.coords[1]);
  if (wf) { bad++; console.log(`⚠ 在水域  ${a.zh.padEnd(22)} ${a.coords.join(", ")}  → ${wf.c}/${wf.n ?? ""} 高程 ${h ?? "?"}m`); }
}
console.log(`\n共 ${attr.attractions.length} 個景點，${bad} 個座標落在水域`);
console.log("\n高程 < 1m 的景點（可能也在水邊或高度為 0）：");
for (const a of attr.attractions) { const h = elev.attractionElevations?.[a.id]; if (h != null && h < 1) console.log(`  ${a.zh.padEnd(22)} ${a.coords.join(", ")}  ${h}m`); }
console.log("\n高程 > 100m 的景點：");
for (const a of attr.attractions) { const h = elev.attractionElevations?.[a.id]; if (h != null && h > 100) console.log(`  ${a.zh.padEnd(22)} ${a.coords.join(", ")}  ${h}m`); }
