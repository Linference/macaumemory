import { distanceMeters } from "./geolocate.js";

const MAX_ACCURACY_M = 60;
const MAX_AGE_MS = 30_000;
const ATTRACTION_RADIUS_M = 42;
const MEMORY_RADIUS_M = 32;

export function nearbyArrival(position, attractions, places, now = Date.now()) {
  const coords = position?.coords;
  if (!Array.isArray(coords) || coords.length !== 2 || !coords.every(Number.isFinite)) return null;
  if (!Number.isFinite(position.accuracy) || position.accuracy <= 0 || position.accuracy > MAX_ACCURACY_M) return null;
  if (!Number.isFinite(position.time) || Math.abs(now - position.time) > MAX_AGE_MS) return null;

  const byId = new Map(attractions.map((a) => [a.id, a]));
  const candidates = [];
  for (const attraction of attractions) {
    if (!Array.isArray(attraction.coords) || !attraction.coords.every(Number.isFinite)) continue;
    const distanceM = distanceMeters(coords, attraction.coords);
    if (distanceM <= ATTRACTION_RADIUS_M) candidates.push({
      kind: "attraction", key: attraction.id, attraction, distanceM,
    });
  }
  for (const place of places) {
    const location = place.geometry?.coordinates;
    const properties = place.properties;
    if (!properties?.id || properties.needsReview || !Array.isArray(location) || !location.every(Number.isFinite)) continue;
    const distanceM = distanceMeters(coords, location);
    if (distanceM > MEMORY_RADIUS_M) continue;
    const related = byId.get(properties.nearId);
    // One building can have both a scenic marker and a photo-memory marker.
    if (related?.coords && distanceMeters(related.coords, location) <= ATTRACTION_RADIUS_M
      && candidates.some((candidate) => candidate.kind === "attraction" && candidate.key === related.id)) continue;
    candidates.push({ kind: "memory", key: properties.id, place, distanceM });
  }
  candidates.sort((a, b) => a.distanceM - b.distanceM || (a.kind === "attraction" ? -1 : 1));
  return candidates[0] ?? null;
}

export class ArrivalGate {
  constructor() { this.pending = null; this.seen = new Set(); }
  resetPending() { this.pending = null; }
  markSeen(key) { this.seen.add(key); this.resetPending(); }
  observe(candidate, now = Date.now(), readingTime = now) {
    if (!candidate || this.seen.has(candidate.key)) { this.resetPending(); return null; }
    if (this.pending?.key !== candidate.key) {
      this.pending = { key: candidate.key, firstAt: now, lastReadingTime: readingTime, count: 1 };
      return null;
    }
    if (readingTime <= this.pending.lastReadingTime) return null;
    this.pending.lastReadingTime = readingTime;
    this.pending.count++;
    if (this.pending.count < 2 || now - this.pending.firstAt < 1200) return null;
    this.markSeen(candidate.key);
    return candidate;
  }
}
