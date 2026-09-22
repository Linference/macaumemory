import fs from "node:fs";
const { Router } = await import("../../src/routing.js");
const roads = JSON.parse(fs.readFileSync("public/data/macau-roads.geojson", "utf8")).features;
const r = new Router(roads);
for (const mode of ["car", "walk"]) {
  const t0 = Date.now();
  const g = r.graph(mode);
  console.log(`${mode}: 節點 ${g.N.toLocaleString()}、邊 ${g.eu.length.toLocaleString()}、建立耗時 ${Date.now() - t0} ms`);
}
const cases = [
  ["步行：議事亭前地 → 大三巴", "walk", [113.53967, 22.19358], [113.54084, 22.19746]],
  ["步行：媽閣廟 → 亞婆井前地", "walk", [113.53127, 22.18609], [113.53503, 22.1884]],
  ["開車：澳門旅遊塔 → 澳門機場", "car", [113.5368, 22.17982], [113.5746, 22.158]],
  ["開車：關閘 → 威尼斯人", "car", [113.54912, 22.21593], [113.56078, 22.14852]],
  ["開車：議事亭前地 → 路環黑沙海灘", "car", [113.53967, 22.19358], [113.5717, 22.1212]],
];
for (const [label, mode, a, b] of cases) {
  const t0 = Date.now();
  const res = r.route(a, b, mode);
  const ms = Date.now() - t0;
  if (!res) { console.log(label.padEnd(30), "✗ 找不到路徑"); continue; }
  console.log(`${label.padEnd(30)} ${(res.distM / 1000).toFixed(2)} km  ${Math.round(res.timeS / 60)} 分鐘  直線 ${(Math.hypot((b[0]-a[0])*102400,(b[1]-a[1])*110800)/1000).toFixed(2)} km  搜尋 ${res.visited.length.toLocaleString()} 節點  ${ms} ms`);
  console.log(`   ${res.steps.slice(0, 4).map((s) => `${s.name}(${Math.round(s.len)}m)`).join(" → ")}${res.steps.length > 4 ? " → …" : ""}`);
}

