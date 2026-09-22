import fs from "node:fs";
const { Router } = await import("../../src/routing.js");
const roads = JSON.parse(fs.readFileSync("public/data/macau-roads.geojson", "utf8")).features;
const r = new Router(roads);
const from = [113.53967, 22.19358];
for (const [label, to] of [["黑沙海灘", [113.5717, 22.1212]], ["澳門旅遊塔", [113.5368, 22.17982]], ["澳門機場", [113.5746, 22.158]], ["澳門大學", [113.54439, 22.1244]], ["竹灣海灘", [113.5599, 22.113]]]) {
  for (const mode of ["walk", "car"]) {
    const a = r.route(from, to, mode, { snapDist: 600 });
    const b = a ? `${(a.distM / 1000).toFixed(2)} km / ${Math.round(a.timeS / 60)} 分` : "✗ 無路徑";
    process.stdout.write(`${label}(${mode}) ${b}   `);
  }
  console.log();
}
