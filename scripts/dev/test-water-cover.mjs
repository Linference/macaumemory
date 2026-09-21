import fs from "node:fs";
const w = JSON.parse(fs.readFileSync("public/data/macau-water.geojson", "utf8"));
const polys = [];
for (const f of w.features) {
  const outer = f.geometry.coordinates[0];
  let minx = 180, maxx = -180, miny = 90, maxy = -90;
  for (const p of outer) { if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0]; if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1]; }
  polys.push({ ring: outer, minx, maxx, miny, maxy, cls: f.properties.c });
}
const inRing = (ring, lon, lat) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};
const isWater = (lon, lat) => polys.some((p) => lon >= p.minx && lon <= p.maxx && lat >= p.miny && lat <= p.maxy && inRing(p.ring, lon, lat));
const tests = {
  "外港東側海域(113.60,22.16)": [113.60, 22.16],
  "南灣湖(113.543,22.185)": [113.543, 22.185],
  "西灣(113.532,22.188)": [113.532, 22.188],
  "路環南岸外海(113.55,22.105)": [113.55, 22.105],
  "路氹城(113.56,22.145)": [113.56, 22.145],
  "機場跑道(113.585,22.152)": [113.585, 22.152],
  "黑沙水庫(113.5565,22.1195)": [113.5565, 22.1195],
  "澳門半島(113.545,22.198)": [113.545, 22.198],
  "氹仔市區(113.557,22.158)": [113.557, 22.158],
  "青洲(113.545,22.212)": [113.545, 22.212],
  "橫琴(113.525,22.12)": [113.525, 22.12],
  "港珠澳口岸人工島(113.565,22.208)": [113.565, 22.208],
  "媽祖文化村(113.5619,22.1206)": [113.5619, 22.1206],
};
for (const [k, v] of Object.entries(tests)) console.log((isWater(v[0], v[1]) ? "水域" : "陸地").padEnd(4), k);
