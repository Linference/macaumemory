// 澳門記憶 · 建築普查：地理計算（純函式）
//
// 這個檔案刻意不碰 DOM、不碰 SQLite、不碰 navigator，所以在瀏覽器、Worker、
// Node 測試裡都能直接 import。普查會用到的兩個關鍵計算都在這裡：
//   ① 半徑 → 經緯度邊界框（R-Tree 查重的查詢框，db.js 用）
//   ② 多次定位讀數 → 加權座標與精度（geolocate.js 用）

export const EARTH_R = 6371008.8;                 // 平均地球半徑（公尺，IUGG）
export const M_PER_DEG_LAT = 111320;              // 緯度 1 度 ≈ 111.32 km（澳門緯度帶誤差 < 0.1%）
/** 該緯度上「經度 1 度」對應的公尺數 */
export const mPerDegLng = (lat) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

const rad = (d) => (d * Math.PI) / 180;

/** 兩點大圓距離（公尺）。座標順序一律是 (lat, lng)——不是 GeoJSON 的 (lng, lat)。 */
export function haversineM(lat1, lng1, lat2, lng2) {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * 以 (lat,lng) 為中心、半徑 radiusM 的經緯度邊界框。
 *
 * ⚠️ R-Tree 的座標欄位是 **32 位元浮點**（SQLite 的 rtree 模組就是這樣設計的），
 * 113.54 附近的 float32 解析度約 1 公尺，所以查重流程是兩段式：
 *   R-Tree 只當「便宜的粗篩」（框會多留 padM 公尺的安全邊際），
 *   精確距離一律用 REAL 欄位的原始座標算 haversine 再過濾。
 */
export function bboxForRadius(lat, lng, radiusM, padM = 2) {
  const dLat = (radiusM + padM) / M_PER_DEG_LAT;
  const dLng = (radiusM + padM) / Math.max(1e-6, mPerDegLng(lat));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

/** 圓形多邊形（GeoJSON 的 [lng,lat] 環，已閉合）——地圖上的精度圈用 */
export function circlePolygon(lat, lng, radiusM, steps = 48) {
  const ring = [];
  const dLat = radiusM / M_PER_DEG_LAT;
  const dLng = radiusM / Math.max(1e-6, mPerDegLng(lat));
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    ring.push([lng + dLng * Math.cos(t), lat + dLat * Math.sin(t)]);
  }
  return ring;
}

/**
 * 精度加權的平均座標。
 *
 * 為什麼要加權：單次讀數的 accuracy 是「68% 信心水準的半徑」，誤差大的讀數不該
 * 跟誤差小的讀數等權。權重取 1/accuracy²（反變異數加權），精度好 2 倍＝權重 4 倍。
 *
 * @param {Array<{lat:number,lng:number,accuracyM:number}>} samples
 * @returns {{lat:number,lng:number,weightSum:number,sigmaW:number,n:number}}
 *          sigmaW = 加權平均的理論標準差（公尺）= sqrt(1/Σw)
 */
export function weightedCentroid(samples) {
  let sw = 0, swLat = 0, swLng = 0;
  for (const s of samples) {
    const acc = Math.max(1, Number(s.accuracyM) || 1);   // 至少 1 公尺，避免 0 造成無限權重
    const w = 1 / (acc * acc);
    sw += w;
    swLat += w * s.lat;
    swLng += w * s.lng;
  }
  if (!sw) return { lat: null, lng: null, weightSum: 0, sigmaW: null, n: 0 };
  return { lat: swLat / sw, lng: swLng / sw, weightSum: sw, sigmaW: Math.sqrt(1 / sw), n: samples.length };
}

/**
 * 樣本離散程度（公尺）：以給定中心計算的加權 RMS 距離，再換算成樣本標準差。
 * 用途是「讀數跳動過大」的警告（例如邊走邊測、訊號不穩）。
 */
export function spreadM(samples, center = null) {
  if (!samples.length) return { rmsM: 0, stdM: 0 };
  const c = center ?? weightedCentroid(samples);
  if (c.lat == null) return { rmsM: 0, stdM: 0 };
  let sw = 0, swD2 = 0;
  for (const s of samples) {
    const acc = Math.max(1, Number(s.accuracyM) || 1);
    const w = 1 / (acc * acc);
    const d = haversineM(c.lat, c.lng, s.lat, s.lng);
    sw += w;
    swD2 += w * d * d;
  }
  const rms = Math.sqrt(swD2 / sw);
  return { rmsM: rms, stdM: rms };
}

/**
 * 一組讀數 → 最終定位結果。
 *
 * 最終精度估計 accuracyM 的取法（保守但可解釋）：
 *   σ_w    = 加權平均的理論標準差 sqrt(1/Σw)     ← 讀數越多越小
 *   σ_mean = 樣本離散 / sqrt(n)                  ← 讀數跳動大時變大
 *   而且**只有在「讀數之間真的在跳動」時才允許比單次讀數更準**（最多好 2 倍）：
 *     定位誤差在同一次取樣裡高度相關（同一組 WiFi AP／同一批衛星），
 *     八次都回報 ±120 公尺時，平均起來還是 ±120 公尺，不能除以 √8 假裝很準。
 *     讀數有離散（>0.5 公尺）才代表裡面有隨機成分，平均才有意義。
 *   下限 1 公尺：不宣稱次公尺級精度（手機／筆電不可能）。
 */
export function summarizeSamples(samples) {
  const n = samples.length;
  if (!n) return { lat: null, lng: null, accuracyM: null, bestAccuracyM: null, sampleCount: 0, spreadM: 0, rmsM: 0, source: "unknown", hasAltitude: false };
  const c = weightedCentroid(samples);
  const sp = spreadM(samples, c);
  const best = Math.min(...samples.map((s) => (Number.isFinite(s.accuracyM) ? s.accuracyM : Infinity)));
  const bestAccuracyM = Number.isFinite(best) ? best : null;
  const sigmaMean = sp.rmsM / Math.sqrt(n);
  const noisy = sp.rmsM > 0.5;                       // 讀數之間確實有差異 → 誤差含隨機成分
  const gain = noisy ? Math.min(2, Math.sqrt(n)) : 1;  // 最多好 2 倍
  const floorAcc = bestAccuracyM == null ? 1 : bestAccuracyM / gain;
  const raw = Math.max(c.sigmaW ?? 0, sigmaMean, floorAcc, 1);
  const accuracyM = bestAccuracyM == null ? raw : Math.min(raw, Math.max(1, bestAccuracyM));
  const hasAltitude = samples.some((s) => Number.isFinite(s.altitude));
  return {
    lat: c.lat, lng: c.lng,
    accuracyM: round2(accuracyM),
    bestAccuracyM: bestAccuracyM == null ? null : round2(bestAccuracyM),
    sampleCount: n,
    spreadM: round2(sp.rmsM),
    rmsM: round2(sp.rmsM),
    sigmaWeightedM: round2(c.sigmaW ?? 0),
    improved: noisy && bestAccuracyM != null && accuracyM < bestAccuracyM - 1e-9,
    hasAltitude,
    source: classifyGeoSource({ bestAccuracyM, spreadM: sp.rmsM, hasAltitude, sampleCount: n }),
  };
}

/**
 * 判斷座標來自 GPS 還是 WiFi／基地台。
 *
 * ⚠️ 瀏覽器**沒有**提供這個資訊（W3C Geolocation API 沒有 provider 欄位），
 * 所以這是啟發式：精度 ≤ 20 公尺且（拿得到高度或樣本離散 ≤ 15 公尺）→ 判為 gps；
 * 其餘判為 wifi。寫進資料庫的 geo_source 有記錄下來源，日後可以再校正。
 */
export function classifyGeoSource({ bestAccuracyM, spreadM = 0, hasAltitude = false }) {
  if (bestAccuracyM == null || !Number.isFinite(bestAccuracyM)) return "unknown";
  if (bestAccuracyM <= 20 && (hasAltitude || spreadM <= 15)) return "gps";
  return "wifi";
}

export const GEO_SOURCE_ZH = {
  gps: "GPS 衛星",
  wifi: "WiFi／基地台",
  manual: "手動標記",
  unknown: "來源不明",
  none: "未定位",
};
export const geoSourceZh = (s) => GEO_SOURCE_ZH[s] ?? GEO_SOURCE_ZH.unknown;

const round2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
export const round5 = (x) => Math.round((Number(x) || 0) * 1e5) / 1e5;

/** 公尺 → 好讀的中文（給 UI 用） */
export const fmtMeters = (m) => (m == null || !Number.isFinite(m) ? "—" : m < 10 ? `${m.toFixed(1)} 公尺` : `${Math.round(m)} 公尺`);
