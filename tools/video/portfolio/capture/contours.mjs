// 把專案的 DEM 等高線與澳門特區邊界投影成 1920×1080 的 SVG 路徑（開場「等高線生長」用）
// 輸出 src/data/contours.json：{ outline: [d], levels: [{ e, d, len }] }，路徑已在像素空間簡化
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.resolve(ROOT, "../../../public/data");
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));

// 取景以陸地堂區（含路氹填海區）為準；特區界線含海域，會把畫面拉偏
const PARISHES = read("macau-boundary.geojson").features.filter((f) => f.properties.k === "parish" && /堂區|填海區/.test(f.properties.n ?? ""));
const BBOX = (() => {
  const c = PARISHES.flatMap((f) => f.geometry.coordinates.flat(3));
  const xs = c.filter((_, i) => i % 2 === 0), ys = c.filter((_, i) => i % 2 === 1);
  return { west: Math.min(...xs) - 0.004, east: Math.max(...xs) + 0.004, south: Math.min(...ys) - 0.004, north: Math.max(...ys) + 0.004 };
})();
const inBox = ([lon, lat]) => lon >= BBOX.west && lon <= BBOX.east && lat >= BBOX.south && lat <= BBOX.north;
const W = 1920, H = 1080, PAD = 50;
const kx = Math.cos((22.16 * Math.PI) / 180);
const s = Math.min((W - 2 * PAD) / ((BBOX.east - BBOX.west) * kx), (H - 2 * PAD) / (BBOX.north - BBOX.south));
const ox = W / 2 - ((BBOX.east - BBOX.west) * kx * s) / 2, oy = H / 2 - ((BBOX.north - BBOX.south) * s) / 2;
const proj = ([lon, lat]) => [ox + (lon - BBOX.west) * kx * s, oy + (BBOX.north - lat) * s];

const dp = (pts, tol) => {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let idx = 0, max = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    // 閉合環首尾重合時基線長度為 0，改量到起點的距離
    const d = len < 1e-9 ? Math.hypot(p[0] - a[0], p[1] - a[1]) : Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
    if (d > max) { max = d; idx = i; }
  }
  return max > tol ? [...dp(pts.slice(0, idx + 1), tol).slice(0, -1), ...dp(pts.slice(idx), tol)] : [a, b];
};
const lineLen = (pts) => pts.reduce((n, p, i) => (i ? n + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
const toD = (pts) => "M" + pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("L");
const lines = (g) => (g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : g.type === "Polygon" ? g.coordinates : g.coordinates.flat());

const levels = new Map();
for (const f of read("macau-dem-contours.geojson").features) {
  const e = f.properties.e;
  if (e % 10 !== 0) continue;
  for (const l of lines(f.geometry)) {
    if (!inBox(l[Math.floor(l.length / 2)])) continue; // 只留澳門範圍內的等高線（資料取樣範圍含珠海山體）
    const pts = dp(l.map(proj), 0.9);
    const len = lineLen(pts);
    if (len < 18) continue;
    if (!levels.has(e)) levels.set(e, { e, d: "", len: 0 });
    const lv = levels.get(e);
    lv.d += toD(pts);
    lv.len = Math.max(lv.len, len);
  }
}
const outline = PARISHES.flatMap((f) => lines(f.geometry)).map((l) => toD(dp(l.map(proj), 0.8)));

const out = { width: W, height: H, outline, levels: [...levels.values()].sort((a, b) => a.e - b.e) };
fs.mkdirSync(path.join(ROOT, "src/data"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "src/data/contours.json"), JSON.stringify(out));
console.log(`levels ${out.levels.length} (e ${out.levels[0].e}–${out.levels.at(-1).e} m), outline rings ${outline.length}, ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`);
