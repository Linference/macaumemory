// Location is an opt-in, bounded tie-breaker. It never raises visual similarity.
export const GEO_POLICY = Object.freeze({ maxAccuracyM: 100, maxAgeMs: 300000, cameraRadiusM: 120, maxPenalty: 0.08 });

export function validCoords(coords) {
  return Array.isArray(coords) && coords.length === 2 && coords.every(Number.isFinite)
    && Math.abs(coords[0]) <= 180 && Math.abs(coords[1]) <= 90;
}

export function distanceM(a, b) {
  const rad = Math.PI / 180;
  const dlat = (b[1] - a[1]) * rad, dlng = (b[0] - a[0]) * rad;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dlng / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function locationQuality(location, now = Date.now()) {
  if (!location || !validCoords([location.lng, location.lat])) return { usable: false, reason: "請先在下方取得定位，或手動標記照片中的建築位置。" };
  const manual = location.source === "manual";
  const accuracy = manual ? 15 : location.accuracyM;
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > GEO_POLICY.maxAccuracyM) return { usable: false, reason: "定位精度不足（需 ≤100 公尺），已保留純影像排序。可改用手動標記。" };
  const at = Date.parse(location.capturedAt);
  if (!manual && (!Number.isFinite(now) || !Number.isFinite(at) || now - at > GEO_POLICY.maxAgeMs || at - now > 30000)) return { usable: false, reason: "定位已過期，請重新取樣；目前使用純影像排序。" };
  return { usable: true, accuracyM: accuracy, radiusM: GEO_POLICY.cameraRadiusM + 3 * accuracy };
}

export function rankWithLocation(rows, { enabled = false, location = null, now } = {}) {
  const quality = locationQuality(location, now);
  const usable = enabled && quality.usable;
  const ranked = rows.map((row) => {
    const known = validCoords(row.coords);
    const distance = usable && known ? distanceM([location.lng, location.lat], row.coords) : null;
    const excess = distance == null ? 0 : Math.max(0, distance - quality.radiusM);
    // Keep camera distance and GPS uncertainty inside the neutral zone.
    const penalty = usable && known ? GEO_POLICY.maxPenalty * (1 - Math.exp(-excess / 250)) : 0;
    return { ...row, adjusted: row.adjusted - penalty, geo: {
      used: usable && known, distanceM: distance, penalty,
      conflict: distance != null && distance > quality.radiusM + 500,
    } };
  }).sort((a, b) => b.adjusted - a.adjusted || b.mean - a.mean);
  return { rows: ranked, geo: { enabled, used: ranked.some((r) => r.geo.used), ...quality } };
}
