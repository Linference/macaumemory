// 下載開放海拔資料 (AWS Open Data / Mapzen Terrain Tiles, terrarium 編碼)
// 產出：public/dem/{z}/{x}/{y}.png  + 等高線 GeoJSON + 高程統計
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { MACAU_BBOX, SAMPLING_BBOX, ensureDir, writeJson, PUBLIC, DATA, toMeters, simplify, q } from "./lib.mjs";

const ZMIN = 10, ZMAX = 15;
const SOURCE = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
const OUT = path.join(PUBLIC, "dem");

const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};
const x2lon = (x, z) => (x / 2 ** z) * 360 - 180;
const y2lat = (y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

const b = SAMPLING_BBOX;
const jobs = [];
for (let z = ZMIN; z <= ZMAX; z++) {
  const x0 = lon2x(b.west, z), x1 = lon2x(b.east, z);
  const y0 = lat2y(b.north, z), y1 = lat2y(b.south, z);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push({ z, x, y });
}
console.log(`terrarium 圖磚：共 ${jobs.length} 張 (z${ZMIN}–z${ZMAX})`);

let done = 0, bytes = 0, failed = 0;
const CONCURRENCY = 8;
async function worker() {
  while (jobs.length) {
    const { z, x, y } = jobs.pop();
    const dir = path.join(OUT, String(z), String(x));
    const file = path.join(dir, `${y}.png`);
    if (fs.existsSync(file)) { done++; bytes += fs.statSync(file).size; continue; }
    ensureDir(dir);
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(`${SOURCE}/${z}/${x}/${y}.png`, { headers: { "User-Agent": "macau-memory-3d/1.0" } });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const buf = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(file, buf);
        bytes += buf.length; done++;
        break;
      } catch (e) {
        if (attempt === 3) { failed++; console.warn(`  ✗ ${z}/${x}/${y}: ${e.message}`); }
        else await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
    if (done % 50 === 0) process.stdout.write(`\r  ${done}/${jobs.length + done} 張…`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`\n  ✓ 完成 ${done} 張，${(bytes / 1048576).toFixed(1)} MB，失敗 ${failed}`);

// ---------------- 解碼 terrarium 成為高度矩陣（用於等高線與統計） ----------------
const MZ = 14;
const mx0 = lon2x(b.west, MZ), mx1 = lon2x(b.east, MZ), my0 = lat2y(b.north, MZ), my1 = lat2y(b.south, MZ);
const W = (mx1 - mx0 + 1) * 256, H = (my1 - my0 + 1) * 256;
console.log(`\n  DEM 拼接 (z${MZ})：${W} x ${H} px  ≈ ${((W * H) / 1e6).toFixed(1)} MP`);
const dem = new Float32Array(W * H).fill(NaN);
for (let ty = my0; ty <= my1; ty++) {
  for (let tx = mx0; tx <= mx1; tx++) {
    const f = path.join(OUT, String(MZ), String(tx), `${ty}.png`);
    if (!fs.existsSync(f)) continue;
    const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const ox = (tx - mx0) * 256, oy = (ty - my0) * 256;
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const i = (y * info.width + x) * info.channels;
        const h = data[i] * 256 + data[i + 1] + data[i + 2] / 256 - 32768;
        dem[(oy + y) * W + (ox + x)] = h;
      }
    }
  }
}
const lonOf = (px) => x2lon(mx0 + px / 256, MZ);
const latOf = (py) => y2lat(my0 + py / 256, MZ);
const inMacau = (lon, lat) => lon >= MACAU_BBOX.west - 0.002 && lon <= MACAU_BBOX.east + 0.002 && lat >= MACAU_BBOX.south - 0.002 && lat <= MACAU_BBOX.north + 0.002;

let min = Infinity, max = -Infinity, sum = 0, n = 0;
const hist = new Array(20).fill(0);
let maxAt = null;
for (let py = 0; py < H; py++) {
  const lat = latOf(py);
  for (let px = 0; px < W; px++) {
    const lon = lonOf(px);
    if (!inMacau(lon, lat)) continue;
    const h = dem[py * W + px];
    if (!isFinite(h) || h < -50) continue;
    if (h > 0.5) { min = Math.min(min, h); sum += h; n++; hist[Math.min(19, Math.floor(h / 10))]++; }
    if (h > max) { max = h; maxAt = [lon, lat]; }
  }
}
console.log(`  澳門陸域高程：min ${min.toFixed(1)} m，max ${max.toFixed(1)} m，平均 ${(sum / n).toFixed(1)} m（最高點 ${maxAt.map((v) => v.toFixed(5))}）`);

// ---------------- 等高線 (marching squares) ----------------
console.log("\n  產生等高線…");
const LEVELS = [];
for (let v = 10; v <= Math.ceil(max / 10) * 10; v += 10) LEVELS.push(v);
for (let v = 5; v < 10; v += 5) LEVELS.push(v);
LEVELS.sort((a, c) => a - c);

const segs = new Map();
const key = (lon, lat) => `${Math.round(lon * 1e5)},${Math.round(lat * 1e5)}`;
function interp(p1, p2, v1, v2, level) {
  const t = (level - v1) / (v2 - v1);
  return [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])];
}
const LMIN = LEVELS[0], LMAX = LEVELS[LEVELS.length - 1];
const px0 = Math.max(0, Math.floor(((MACAU_BBOX.west - 0.004 + 180) / 360) * 2 ** MZ) - mx0) * 256;
const px1 = Math.min(W - 2, Math.ceil(((MACAU_BBOX.east + 0.004 + 180) / 360) * 2 ** MZ) * 256 - mx0);
const py0 = Math.max(0, lat2y(MACAU_BBOX.north + 0.004, MZ) - my0) * 256;
const py1 = Math.min(H - 2, lat2y(MACAU_BBOX.south - 0.004, MZ) - my0 + 1) * 256;
console.log(`  等高線計算範圍 ${px1 - px0} x ${py1 - py0} px`);
const cx = new Float64Array(4), cy = new Float64Array(4), cz = new Float64Array(4);
for (let py = py0; py <= py1; py++) {
  const latA = latOf(py), latB = latOf(py + 1);
  for (let px = px0; px <= px1; px++) {
    const lonA = lonOf(px), lonB = lonOf(px + 1);
    cz[0] = dem[py * W + px]; cz[1] = dem[py * W + px + 1]; cz[2] = dem[(py + 1) * W + px + 1]; cz[3] = dem[(py + 1) * W + px];
    if (!isFinite(cz[0]) || !isFinite(cz[1]) || !isFinite(cz[2]) || !isFinite(cz[3])) continue;
    let lo = cz[0], hi = cz[0];
    for (let i = 1; i < 4; i++) { if (cz[i] < lo) lo = cz[i]; if (cz[i] > hi) hi = cz[i]; }
    if (hi < LMIN || lo > LMAX) continue;
    if (lo < -50) continue;
    cx[0] = lonA; cy[0] = latA; cx[1] = lonB; cy[1] = latA; cx[2] = lonB; cy[2] = latB; cx[3] = lonA; cy[3] = latB;
    for (let li = 0; li < LEVELS.length; li++) {
      const level = LEVELS[li];
      if (level <= lo || level > hi) continue;
      let n2 = 0; let ax = 0, ay = 0, bx = 0, by = 0;
      for (let e = 0; e < 4; e++) {
        const f = (e + 1) & 3;
        const za = cz[e], zc = cz[f];
        if ((za < level && zc >= level) || (zc < level && za >= level)) {
          const t = (level - za) / (zc - za);
          const ix = cx[e] + t * (cx[f] - cx[e]), iy = cy[e] + t * (cy[f] - cy[e]);
          if (n2 === 0) { ax = ix; ay = iy; } else if (n2 === 1) { bx = ix; by = iy; }
          n2++;
        }
      }
      if (n2 === 2) {
        let bucket = segs.get(level);
        if (!bucket) { bucket = []; segs.set(level, bucket); }
        bucket.push([ax, ay, bx, by]);
      }
    }
  }
}
// 連接線段成折線
const features = [];
for (const [level, list] of segs) {
  const buckets = new Map();
  const add = (k, s) => { let a = buckets.get(k); if (!a) { a = []; buckets.set(k, a); } a.push(s); };
  for (const s of list) { add(key(s[0], s[1]), s); add(key(s[2], s[3]), s); }
  const used = new Set();
  const takeFrom = (k, exclude) => {
    const a = buckets.get(k);
    if (!a) return null;
    for (const c of a) if (c !== exclude && !used.has(c)) return c;
    return null;
  };
  for (const s of list) {
    if (used.has(s)) continue;
    used.add(s);
    const chain = [[s[0], s[1]], [s[2], s[3]]];
    let extended = true;
    while (extended) {
      extended = false;
      for (const end of [0, 1]) {
        const p = end === 0 ? chain[0] : chain[chain.length - 1];
        const c = takeFrom(key(p[0], p[1]), null);
        if (!c) continue;
        used.add(c);
        const same = Math.abs(c[0] - p[0]) < 1e-12 && Math.abs(c[1] - p[1]) < 1e-12;
        const other = same ? [c[2], c[3]] : [c[0], c[1]];
        if (end === 0) chain.unshift(other); else chain.push(other);
        extended = true;
        break;
      }
    }
    if (chain.length < 4) continue;
    const simplified = simplify(chain, 1.5);
    features.push({ type: "Feature", properties: { e: level }, geometry: { type: "LineString", coordinates: simplified.map(q) } });
  }
}
console.log(`  等高線 ${features.length} 條，高程分級 ${LEVELS.length} 級`);
writeJson(`${DATA}/macau-dem-contours.geojson`, { type: "FeatureCollection", name: "澳門等高線", features });

writeJson(`${DATA}/macau-elevation.json`, {
  source: "Terrain Tiles (AWS Open Data / Mapzen, terrarium encoding)",
  license: "Public domain / CC-BY (Mapzen, SRTM, ETOPO1, ...)",
  attribution: "Elevation: Mapzen/AWS Open Data — 地形資料由開放資料集提供",
  bbox: MACAU_BBOX,
  tileRange: { zmin: ZMIN, zmax: ZMAX },
  stats: {
    minMeters: +min.toFixed(1),
    maxMeters: +max.toFixed(1),
    meanMeters: +(sum / n).toFixed(1),
    highestPoint: maxAt ? { lon: +maxAt[0].toFixed(5), lat: +maxAt[1].toFixed(5), name: "疊石塘山（路環）" } : null,
    histogram: hist.map((c, i) => ({ range: `${i * 10}-${i * 10 + 10}m`, count: c })),
  },
  contourLevels: LEVELS,
  tiles: { zmin: ZMIN, zmax: ZMAX, count: done, bytes },
});
console.log("\n✅ 海拔資料完成");

