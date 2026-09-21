// 共用工具：Overpass 查詢（耐心分塊下載＋快取）、Douglas-Peucker 簡化、GeoJSON 輸出
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CACHE = path.join(ROOT, ".cache");
export const PUBLIC = path.join(ROOT, "public");
export const DATA = path.join(PUBLIC, "data");

// 澳門特別行政區（含路氹城、路環、機場跑道、澳大橫琴校區）外接矩形
export const MACAU_BBOX = { south: 22.098, west: 113.515, north: 22.230, east: 113.615 };
// 取樣範圍（略大，確保海岸線與行政邊界完整）
export const SAMPLING_BBOX = { south: 22.055, west: 113.455, north: 22.275, east: 113.665 };

export const bboxStr = (b) => `${b.south},${b.west},${b.north},${b.east}`;
export const ensureDir = (p) => fs.mkdirSync(p, { recursive: true });

export function splitBBox(b, cols, rows) {
  const tiles = [];
  const dy = (b.north - b.south) / rows, dx = (b.east - b.west) / cols;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    tiles.push({
      south: +(b.south + r * dy).toFixed(6), north: +(b.south + (r + 1) * dy).toFixed(6),
      west: +(b.west + c * dx).toFixed(6), east: +(b.west + (c + 1) * dx).toFixed(6),
    });
  }
  return tiles;
}

const ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(endpoint, query, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: "POST", signal: ac.signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "macau-memory-3d/1.0 (open-data 3D map of Macau; educational)", Accept: "application/json" },
      body: new URLSearchParams({ data: query }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let json;
    try { json = JSON.parse(text); } catch { throw new Error(`伺服器繁忙（非 JSON 回應）`); }
    if (json.remark && /error|timed out|out of memory/i.test(json.remark)) throw new Error(json.remark.slice(0, 100));
    return json;
  } finally { clearTimeout(timer); }
}

/** 單次 Overpass 查詢：多鏡像輪替 + 指數退避 + 快取 */
export async function overpass(query, { cacheKey, timeoutMs = 300_000, retries = 10, quiet = false } = {}) {
  ensureDir(path.join(CACHE, "overpass"));
  const file = cacheKey ? path.join(CACHE, "overpass", cacheKey + ".json") : null;
  if (file && fs.existsSync(file) && !process.env.REFRESH) return JSON.parse(fs.readFileSync(file, "utf8"));
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const endpoint = ENDPOINTS[(attempt - 1) % ENDPOINTS.length];
    try {
      const json = await post(endpoint, query, timeoutMs);
      if (file) fs.writeFileSync(file, JSON.stringify(json));
      return json;
    } catch (e) {
      lastErr = e;
      if (!quiet) console.warn(`      ✗ ${endpoint.split("/")[2]} #${attempt}: ${e.message.slice(0, 70)}`);
      const rateLimited = /429/.test(e.message);
      await sleep(rateLimited ? Math.min(30_000 * attempt, 150_000) : Math.min(6000 * attempt, 45_000));
    }
  }
  throw new Error(`Overpass 失敗：${lastErr?.message?.slice(0, 120)}`);
}

/** 樣板中的 {bbox} 換成各分塊，逐塊抓取後合併 elements；失敗的分塊會被記錄下來 */
export async function overpassTiled(template, { bbox, cols, rows, prefix, timeoutMs = 240_000, label = "" } = {}) {
  const tiles = splitBBox(bbox, cols, rows);
  const all = [];
  const failed = [];
  let cachedCount = 0;
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    const key = `${prefix}-${i}`;
    const existed = fs.existsSync(path.join(CACHE, "overpass", key + ".json"));
    try {
      const json = await overpass(template.replaceAll("{bbox}", bboxStr(t)), { cacheKey: key, timeoutMs });
      all.push(...(json.elements ?? []));
      if (i < tiles.length - 1) await sleep(Number(process.env.TILE_DELAY ?? 9000));
      if (existed) cachedCount++;
      process.stdout.write(`\r  ${label} ${i + 1}/${tiles.length} 塊 · ${all.length} 元素        `);
    } catch (e) {
      failed.push({ tile: i, bbox: t, error: e.message.slice(0, 120) });
      console.warn(`\n  ⚠ ${label} 第 ${i + 1} 塊失敗（稍後可重跑補齊）：${e.message.slice(0, 90)}`);
    }
  }
  const uniq = new Map();
  for (const el of all) uniq.set(`${el.type}/${el.id}`, el);
  const elements = [...uniq.values()];
  process.stdout.write(`\r  ✓ ${label}：${tiles.length - failed.length}/${tiles.length} 塊成功（快取 ${cachedCount}）、去重後 ${elements.length} 個元素\n`);
  return { elements, failed, tiles: tiles.length };
}

// ---- 幾何工具 ----
const R = 6378137;
const lat0Rad = ((MACAU_BBOX.south + MACAU_BBOX.north) / 2) * Math.PI / 180;
export const lonScale = Math.cos(lat0Rad);
export const toMeters = ([lon, lat]) => [lon * (Math.PI / 180) * R * lonScale, lat * (Math.PI / 180) * R];

function perpDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const den = Math.hypot(dx, dy);
  if (den === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / den;
}

/** Douglas-Peucker（公尺座標），tol 單位：公尺 */
export function simplify(points, tol) {
  if (!tol || points.length < 3) return points;
  const pts = points.map(toMeters);
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let maxD = -1, idx = -1;
    for (let k = i + 1; k < j; k++) {
      const d = perpDist(pts[k], pts[i], pts[j]);
      if (d > maxD) { maxD = d; idx = k; }
    }
    if (maxD > tol && idx > 0) { keep[idx] = 1; stack.push([i, idx], [idx, j]); }
  }
  const out = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out.length >= 2 ? out : [points[0], points[points.length - 1]];
}

export const q = (c) => [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6];

export function ringAreaM2(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = toMeters(ring[i]), r = toMeters(ring[(i + 1) % n]);
    a += p[0] * r[1] - r[0] * p[1];
  }
  return Math.abs(a / 2);
}

/** Overpass way/relation -> GeoJSON geometry */
export function geomOf(el, tol) {
  if (el.type === "way") {
    const g = el.geometry;
    if (!g || g.length < 2) return null;
    let pts = g.map((p) => [p.lon, p.lat]);
    const closed = pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
    if (tol) {
      const body = closed ? pts.slice(0, -1) : pts;
      const s = simplify(closed ? [...body, body[0]] : body, tol);
      pts = closed ? [...s.slice(0, -1), s[0]] : s;
    }
    if (pts.length < 2) return null;
    const isPoly = closed && pts.length > 3;
    return { type: isPoly ? "Polygon" : "LineString", coordinates: isPoly ? [pts.map(q)] : pts.map(q) };
  }
  if (el.type === "relation" && el.members) {
    const outer = [], inner = [];
    for (const m of el.members) {
      if (m.type !== "way" || !m.geometry || m.geometry.length < 4) continue;
      (m.role === "inner" ? inner : outer).push(m.geometry.map((p) => q([p.lon, p.lat])));
    }
    if (!outer.length) return null;
    return { type: "Polygon", coordinates: [...outer, ...inner] };
  }
  return null;
}

export const featureCollection = (features, meta = {}) => ({ type: "FeatureCollection", ...meta, features });

export function writeJson(file, obj, { pretty = false } = {}) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, pretty ? JSON.stringify(obj, null, 1) : JSON.stringify(obj));
  const mb = fs.statSync(file).size / 1048576;
  console.log(`  → ${path.relative(ROOT, file)}  ${mb < 1 ? (mb * 1024).toFixed(0) + " KB" : mb.toFixed(2) + " MB"}  (${obj.features?.length ?? "?"} features)`);
  return mb;
}
