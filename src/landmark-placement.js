// Geographic placement is explicit: no guessing scale from a model's bounding box.
export function parseLandmarkPlacements(manifest, attractions = []) {
  if (manifest?.version !== 1 || !Array.isArray(manifest.placements)) throw new Error("landmarks.json: expected version 1 and placements array");
  const spots = new Map(attractions.map((a) => [a.id, a]));
  const ids = new Set();
  return manifest.placements.filter((p) => p.enabled === true).map((p) => {
    if (typeof p.id !== "string" || !/^[a-z0-9-]+$/.test(p.id) || ids.has(p.id)) throw new Error("Invalid/duplicate landmark id");
    ids.add(p.id);
    // Keep imported assets under public/models, including GitHub Pages subpaths.
    const validFile = (file) => typeof file === "string" && /^models\/[a-zA-Z0-9_./-]+\.glb$/.test(file) && !file.split("/").includes("..");
    if (!validFile(p.file) || (p.lodFile != null && !validFile(p.lodFile))) throw new Error(`${p.id}: expected local models/*.glb file`);
    const coords = p.coords ?? spots.get(p.spot)?.coords;
    if (!Array.isArray(coords) || coords.length !== 2 || !coords.every(Number.isFinite) || Math.abs(coords[0]) > 180 || Math.abs(coords[1]) > 85) throw new Error(`${p.id}: invalid [longitude, latitude]`);
    if (!Number.isFinite(p.metersPerUnit) || p.metersPerUnit <= 0) throw new Error(`${p.id}: metersPerUnit required`);
    const vector = (name, fallback) => {
      const v = p[name] ?? fallback;
      if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) throw new Error(`${p.id}: invalid ${name}`);
      return v;
    };
    const minZoom = p.minZoom ?? 15.5, altitudeM = p.altitudeM ?? 0, detailZoom = p.detailZoom ?? 17;
    if (!Number.isFinite(minZoom) || minZoom < 0 || minZoom > 24 || !Number.isFinite(detailZoom) || detailZoom < minZoom || detailZoom > 24 || !Number.isFinite(altitudeM)) throw new Error(`${p.id}: invalid zoom/altitude`);
    const buildingIds = p.buildingIds ?? [];
    if (!Array.isArray(buildingIds) || buildingIds.some((id) => !(typeof id === "string" && id.length) && !Number.isFinite(id))) throw new Error(`${p.id}: invalid buildingIds`);
    return { ...p, coords, minZoom, detailZoom, altitudeM, buildingIds, rotationDeg: vector("rotationDeg", [0, 0, 0]), anchor: vector("anchor", [0, 0, 0]) };
  });
}

export function replacementFilter(baseFilter, placements, zoom, visible = true) {
  const ids = [...new Set(placements.filter((p) => visible && p.loaded && zoom >= p.minZoom).flatMap((p) => p.buildingIds))];
  if (!ids.length) return baseFilter ?? null;
  // GeoJSON is tiled before promoteId is applied; filter on the retained UUID property.
  const exclude = ["!", ["in", ["get", "bid"], ["literal", ids]]];
  return baseFilter ? ["all", baseFilter, exclude] : exclude;
}
