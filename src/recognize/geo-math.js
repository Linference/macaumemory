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
 * 瀏覽器 accuracy 是設備回報的水平誤差半徑（規格要求 95% 信心水準）。
 * 1/accuracy² 僅作為平滑座標的權重；連續讀數有相關性，不能由此推導真實精度。
 *
 * @param {Array<{lat:number,lng:number,accuracyM:number}>} samples
 * @returns {{lat:number,lng:number,weightSum:number,sigmaW:number,n:number}}
 *          sigmaW = 權重尺度 sqrt(1/Σw)，不是已校準的定位誤差
 */
export function weightedCentroid(samples) {
  let sw = 0, swLat = 0, swLng = 0;
  const anchor = samples[0];
  for (const s of samples) {
    const acc = Number.isFinite(s.accuracyM) && s.accuracyM >= 0 ? Math.max(1, s.accuracyM) : 1000;
    const w = 1 / (acc * acc);
    sw += w;
    swLat += w * (s.lat - anchor.lat);
    swLng += w * (s.lng - anchor.lng);
  }
  if (!sw) return { lat: null, lng: null, weightSum: 0, sigmaW: null, n: 0 };
  return { lat: anchor.lat + swLat / sw, lng: anchor.lng + swLng / sw, weightSum: sw, sigmaW: Math.sqrt(1 / sw), n: samples.length };
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
    const acc = Number.isFinite(s.accuracyM) && s.accuracyM >= 0 ? Math.max(1, s.accuracyM) : 1000;
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
 * 平滑座標與保守顯示範圍：包住所有有效讀數的設備誤差圈。
 * radius = max(讀數到加權中心的距離 + 該讀數回報半徑)。
 * 不以樣本數縮小誤差，也不把跳動當成獨立隨機誤差；這個範圍不是實測精度保證。
 * 任一有效座標缺少誤差半徑時，範圍保持未知。
 */
export function summarizeSamples(samples) {
  samples = samples.filter(validGeoSample);
  const n = samples.length;
  if (!n) return { lat: null, lng: null, accuracyM: null, bestAccuracyM: null, sampleCount: 0, spreadM: 0, rmsM: 0, source: "unknown", hasAltitude: false };
  const c = weightedCentroid(samples);
  const sp = spreadM(samples, c);
  const best = Math.min(...samples.map((s) => (Number.isFinite(s.accuracyM) ? s.accuracyM : Infinity)));
  const bestAccuracyM = Number.isFinite(best) ? best : null;
  const accuracyKnown = samples.every((s) => Number.isFinite(s.accuracyM) && s.accuracyM >= 0);
  const accuracyM = accuracyKnown ? Math.max(...samples.map((s) =>
    haversineM(c.lat, c.lng, s.lat, s.lng) + s.accuracyM)) : null;
  const hasAltitude = samples.some((s) => Number.isFinite(s.altitude));
  return {
    lat: c.lat, lng: c.lng,
    accuracyM: accuracyM == null ? null : Math.ceil(accuracyM * 100) / 100,
    accuracyMethod: "reported-envelope-v1",
    bestAccuracyM: bestAccuracyM == null ? null : round2(bestAccuracyM),
    sampleCount: n,
    spreadM: round2(sp.rmsM),
    rmsM: round2(sp.rmsM),
    sigmaWeightedM: round2(c.sigmaW ?? 0),
    improved: false,
    hasAltitude,
    source: classifyGeoSource({ bestAccuracyM, spreadM: sp.rmsM, hasAltitude, sampleCount: n }),
  };
}

/**
 * API 不提供 provider，不能用精度或高度猜測 GPS／WiFi。
 */
export function classifyGeoSource({ bestAccuracyM }) {
  if (bestAccuracyM == null || !Number.isFinite(bestAccuracyM)) return "unknown";
  return "browser";
}

export const validGeoSample = (s) => s && Number.isFinite(s.lat) && Number.isFinite(s.lng)
  && Math.abs(s.lat) <= 90 && Math.abs(s.lng) <= 180
  && (s.accuracyM == null || (Number.isFinite(s.accuracyM) && s.accuracyM >= 0));

export const GEO_SOURCE_ZH = {
  gps: "舊版推測 GPS",
  wifi: "舊版推測 WiFi／基地台",
  browser: "裝置定位（來源未提供）",
  manual: "手動標記",
  unknown: "來源不明",
  none: "未定位",
};
export const geoSourceZh = (s) => GEO_SOURCE_ZH[s] ?? GEO_SOURCE_ZH.unknown;

const round2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
export const round5 = (x) => Math.round((Number(x) || 0) * 1e5) / 1e5;

/** 公尺 → 好讀的中文（給 UI 用） */
export const fmtMeters = (m) => (m == null || !Number.isFinite(m) ? "—" : m < 10 ? `${m.toFixed(1)} 公尺` : `${Math.round(m)} 公尺`);
