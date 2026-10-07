// 拍攝者位置與建築位置使用不同欄位；手動標記是確認位置，不代表測量精度。
import { validGeoSample } from "./geo-math.js";

export function captureLocationFromGeo(geo) {
  if (!validGeoSample(geo)) return null;
  return {
    role: "capture", source: "browser", lat: geo.lat, lng: geo.lng,
    accuracyM: geo.accuracyM ?? null, accuracyMethod: geo.accuracyMethod ?? "device-reported",
    sampleCount: geo.sampleCount ?? 0, bestAccuracyM: geo.bestAccuracyM ?? null,
    spreadM: geo.spreadM ?? null, stopReason: geo.reason ?? null,
    capturedAt: geo.samples?.at(-1)?.at ?? null,
  };
}

export function buildingLocationFromPick(pick) {
  if (!validGeoSample(pick)) return {
    role: "building", confirmed: false, source: "none", lat: null, lng: null,
    accuracyM: null, sampleCount: 0, footprintId: null,
    unavailableReason: "尚未在地圖上確認建築位置；拍攝者座標另行保存。",
  };
  return {
    role: "building", confirmed: true, source: "manual", lat: pick.lat, lng: pick.lng,
    accuracyM: null, sampleCount: 0, footprintId: pick.footprintId ?? null,
    origin: pick.origin ?? "typed", capturedAt: pick.confirmedAt ?? null,
    gpsNote: "使用者確認的建築位置；未經測量驗證。", unavailableReason: null,
  };
}

export function matchingLocation(capture, building) {
  return building?.confirmed && validGeoSample(building) ? building : capture;
}

export function parseTypedLocation(latText, lngText) {
  if (!String(latText ?? "").trim() || !String(lngText ?? "").trim()) return null;
  const pick = { lat: Number(latText), lng: Number(lngText) };
  return validGeoSample(pick) ? pick : null;
}
