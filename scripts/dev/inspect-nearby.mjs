import fs from "node:fs";
const blds = JSON.parse(fs.readFileSync("public/data/macau-buildings.geojson", "utf8")).features;
const rep = JSON.parse(fs.readFileSync("public/data/coord-report.json", "utf8"));
const attr = JSON.parse(fs.readFileSync("public/data/attractions.json", "utf8"));
const named = [];
for (const f of blds) {
  const n = f.properties?.n;
  if (!n) continue;
  const r = f.geometry.coordinates[0];
  let cx = 0, cy = 0;
  for (const p of r) { cx += p[0]; cy += p[1]; }
  named.push({ n, c: [cx / r.length, cy / r.length], h: f.properties.h, t: f.properties.t });
}
const d = (a, b) => Math.hypot((a[0] - b[0]) * 102400, (a[1] - b[1]) * 110800);
const ids = process.argv.slice(2);
for (const id of ids) {
  const a = attr.attractions.find((x) => x.id === id);
  const r = rep.find((x) => x.id === id);
  if (!a) continue;
  console.log(`\n=== ${a.zh} [${a.geoSource}] ===`);
  console.log(`  目前座標 ${a.coords.map((v) => v.toFixed(5)).join(", ")}（位移 ${a.coordMovedMeters ?? 0}m）`);
  console.log("  附近有名稱的建築物：");
  for (const b of named.map((b) => ({ ...b, dd: d(b.c, a.coords) })).filter((b) => b.dd < 350).sort((x, y) => x.dd - y.dd).slice(0, 8)) {
    console.log(`    ${String(Math.round(b.dd)).padStart(4)}m ${b.n.slice(0, 40).padEnd(42)} ${b.c.map((v) => v.toFixed(5)).join(", ")} 高度${b.h ?? "-"}`);
  }
}
