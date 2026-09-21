// 以 OpenTopography 下載的 Copernicus DEM GLO-30 產生：高程統計、等高線、山體陰影圖
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { fromArrayBuffer } from "geotiff";
import { PUBLIC, DATA, ensureDir, simplify, q, writeJson, MACAU_BBOX } from "./lib.mjs";

const TIFF = path.join(".cache", "ot-COP30-GTiff.dat");
const OUT_DIR = path.join(DATA, "elevation");
ensureDir(OUT_DIR);

// ---------------- 讀取 DEM ----------------
const buf = fs.readFileSync(TIFF);
const tiff = await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const img = await tiff.getImage();
const W = img.getWidth(), H = img.getHeight();
const [west, south, east, north] = img.getBoundingBox();
const [ox, oy] = img.getOrigin();
const [dx, dy] = img.getResolution();
const raster = (await img.readRasters({ samples: [0] }))[0];
const elevationAt = (lon, lat) => {
  const px = Math.round((lon - ox) / dx);
  const py = Math.round((lat - oy) / dy);
  if (px < 0 || py < 0 || px >= W || py >= H) return null;
  return raster[py * W + px];
};
console.log(`COP30 DEM：${W}×${H}，範圍 ${west.toFixed(3)}–${east.toFixed(3)}, ${south.toFixed(3)}–${north.toFixed(3)}`);
// 存放原始 GeoTIFF 供再利用
fs.copyFileSync(TIFF, path.join(OUT_DIR, "macau-cop30-glo30.tif"));

// ---------------- 澳門邊界遮罩 ----------------
const boundaryFile = path.join(DATA, "macau-boundary.geojson");
const boundary = fs.existsSync(boundaryFile) ? JSON.parse(fs.readFileSync(boundaryFile, "utf8")) : null;
const sar = boundary?.features?.find((f) => f.properties?.k === "sar") ?? null;
const rings = [];
if (sar) {
  const polys = sar.geometry.type === "Polygon" ? [sar.geometry.coordinates] : sar.geometry.coordinates;
  for (const poly of polys) for (const ring of poly) rings.push(ring);
}
function inside(lon, lat) {
  if (!rings.length) return lon >= MACAU_BBOX.west && lon <= MACAU_BBOX.east && lat >= MACAU_BBOX.south && lat <= MACAU_BBOX.north;
  let hit = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}
console.log(sar ? `使用澳門特別行政區邊界遮罩（${rings.length} 個環）` : "⚠ 無邊界資料，改用外接矩形");

// ---------------- 統計 ----------------
let min = Infinity, max = -Infinity, sum = 0, nLand = 0, nAll = 0, maxPt = null;
const hist = new Array(18).fill(0);
for (let py = 0; py < H; py++) {
  const lat = oy + py * dy;
  for (let px = 0; px < W; px++) {
    const lon = ox + px * dx;
    if (!inside(lon, lat)) continue;
    const h = raster[py * W + px];
    if (!isFinite(h)) continue;
    nAll++;
    if (h <= 0.5) continue;
    nLand++;
    sum += h;
    if (h < min) min = h;
    hist[Math.min(17, Math.floor(h / 10))]++;
    if (h > max) { max = h; maxPt = [lon, lat]; }
  }
}
const landAreaKm2 = +(nLand * (dx * 111320 * Math.cos(22.16 * Math.PI / 180)) * (Math.abs(dy) * 110574) / 1e6).toFixed(2);
console.log(`陸域像素 ${nLand.toLocaleString()}（約 ${landAreaKm2} km²）｜最高 ${max.toFixed(1)} m @ ${maxPt.map((v) => v.toFixed(5))}`);

// ---------------- 等高線 ----------------
const LEVELS = [];
for (let v = 5; v <= Math.ceil(max / 10) * 10; v += 5) LEVELS.push(v);
const segs = new Map();
for (let py = 0; py < H - 1; py++) {
  const latA = oy + py * dy, latB = oy + (py + 1) * dy;
  for (let px = 0; px < W - 1; px++) {
    const lonA = ox + px * dx, lonB = ox + (px + 1) * dx;
    const z = [raster[py * W + px], raster[py * W + px + 1], raster[(py + 1) * W + px + 1], raster[(py + 1) * W + px]];
    if (z.some((v) => !isFinite(v))) continue;
    const lo = Math.min(...z), hi = Math.max(...z);
    if (hi < 5 || lo > Math.ceil(max / 10) * 10) continue;
    const X = [lonA, lonB, lonB, lonA], Y = [latA, latA, latB, latB];
    for (const level of LEVELS) {
      if (level <= lo || level > hi) continue;
      const pts = [];
      for (let e = 0; e < 4; e++) {
        const f = (e + 1) & 3;
        const za = z[e], zc = z[f];
        if ((za < level && zc >= level) || (zc < level && za >= level)) {
          const t = (level - za) / (zc - za);
          pts.push([X[e] + t * (X[f] - X[e]), Y[e] + t * (Y[f] - Y[e])]);
        }
      }
      if (pts.length === 2) {
        if (!segs.has(level)) segs.set(level, []);
        segs.get(level).push(pts);
      }
    }
  }
}
const features = [];
for (const [level, list] of segs) {
  const key = (p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  const buckets = new Map();
  for (const s of list) for (const p of s) { if (!buckets.has(key(p))) buckets.set(key(p), []); buckets.get(key(p)).push(s); }
  const used = new Set();
  for (const s of list) {
    if (used.has(s)) continue;
    used.add(s);
    const chain = [s[0], s[1]];
    let ext = true;
    while (ext) {
      ext = false;
      for (const end of [0, 1]) {
        const p = end === 0 ? chain[0] : chain[chain.length - 1];
        for (const c of buckets.get(key(p)) ?? []) {
          if (used.has(c)) continue;
          used.add(c);
          const other = key(c[0]) === key(p) ? c[1] : c[0];
          if (end === 0) chain.unshift(other); else chain.push(other);
          ext = true; break;
        }
        if (ext) break;
      }
    }
    if (chain.length < 3) continue;
    features.push({ type: "Feature", properties: { e: level }, geometry: { type: "LineString", coordinates: simplify(chain, 4).map(q) } });
  }
}
writeJson(path.join(DATA, "macau-dem-contours.geojson"), { type: "FeatureCollection", name: "澳門等高線（Copernicus DEM GLO-30）", source: "Copernicus DEM GLO-30 via OpenTopography", features });
console.log(`等高線 ${features.length} 條`);

// ---------------- 山體陰影圖 ----------------
const shade = Buffer.alloc(W * H);
const cell = 30;
for (let py = 1; py < H - 1; py++) {
  for (let px = 1; px < W - 1; px++) {
    const z0 = raster[py * W + px];
    const zx = raster[py * W + px + 1] - raster[py * W + px - 1];
    const zy = raster[(py + 1) * W + px] - raster[(py - 1) * W + px];
    const slope = Math.atan(Math.hypot(zx, zy) / (2 * cell));
    const aspect = Math.atan2(zy, -zx);
    const az = (315 * Math.PI) / 180, alt = (45 * Math.PI) / 180;
    let v = Math.cos(Math.PI / 2 - alt) * Math.cos(slope) + Math.sin(Math.PI / 2 - alt) * Math.sin(slope) * Math.cos(az - aspect);
    v = Math.max(0, Math.min(1, 0.35 + 0.75 * v));
    shade[py * W + px] = Math.round(v * 255);
  }
}
await sharp(shade, { raw: { width: W, height: H, channels: 1 } }).png().toFile(path.join(OUT_DIR, "macau-hillshade.png"));
console.log("山體陰影圖已輸出");

// ---------------- 景點高程取樣 ----------------
const attrFile = path.join(DATA, "attractions.json");
let attractionElevations = {};
if (fs.existsSync(attrFile)) {
  const a = JSON.parse(fs.readFileSync(attrFile, "utf8"));
  for (const item of a.attractions ?? []) {
    const h = elevationAt(item.coords[0], item.coords[1]);
    if (h != null) attractionElevations[item.id] = +h.toFixed(1);
  }
  console.log(`景點高程取樣 ${Object.keys(attractionElevations).length} 筆`);
}

writeJson(path.join(DATA, "macau-elevation.json"), {
  source: "Copernicus DEM GLO-30（30 公尺解析度）",
  provider: "© DLR e.V. 2010-2014 / © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the EU and ESA；經 OpenTopography Global DEM API 下載",
  license: "Copernicus DEM 免費授權（需標示來源）",
  download: {
    api: "https://portal.opentopography.org/API/globaldem?demtype=COP30",
    bbox: [west, south, east, north],
    gridSize: `${W}×${H}`,
    resolutionArcSec: 1,
    file: "data/elevation/macau-cop30-glo30.tif",
    hillshade: "data/elevation/macau-hillshade.png",
  },
  stats: {
    landAreaKm2,
    minMeters: +min.toFixed(1),
    maxMeters: +max.toFixed(1),
    meanMeters: +(sum / nLand).toFixed(1),
    highestPoint: maxPt ? { lon: +maxPt[0].toFixed(5), lat: +maxPt[1].toFixed(5), name: "疊石塘山（路環）" } : null,
    samples: nAll,
    histogram: hist.map((c, i) => ({ range: `${i * 10}-${i * 10 + 10}m`, count: c })),
  },
  contourLevels: LEVELS,
  attractionElevations,
});
console.log("✅ 海拔資料處理完成");
