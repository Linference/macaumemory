// Missing parameters must not become Number(null) === 0 and override a hash link.
export function parseMapQuery(search) {
  const q = new URLSearchParams(search);
  const number = (key) => q.get(key)?.trim() ? Number(q.get(key)) : NaN;
  const lat = number("lat"), lng = number("lng"), z = number("zoom");
  return { spot: q.get("spot") || null,
    coords: Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lng, lat] : null,
    zoom: Number.isFinite(z) && z >= 0 && z <= 24 ? z : null };
}
