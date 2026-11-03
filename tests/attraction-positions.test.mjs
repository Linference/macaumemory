import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const data = (f) => JSON.parse(fs.readFileSync(new URL(`../public/data/${f}`, import.meta.url), "utf8"));
const attractions = data("attractions.json").attractions;
const buildings = data("macau-buildings.geojson").features;

const polygonsOf = (g) => (g.type === "MultiPolygon" ? g.coordinates : [g.coordinates]);
const inRing = (ring, [x, y]) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};
const inside = (f, p) => polygonsOf(f.geometry).some((poly) => poly.reduce((acc, ring) => acc ^ (inRing(ring, p) ? 1 : 0), 0) === 1);
const indexed = buildings.map((f) => {
  const c = f.geometry.coordinates.flat(3);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < c.length; i += 2) { x0 = Math.min(x0, c[i]); x1 = Math.max(x1, c[i]); y0 = Math.min(y0, c[i + 1]); y1 = Math.max(y1, c[i + 1]); }
  return { f, x0, y0, x1, y1 };
});
const footprintAt = (p) => indexed.find((b) => p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.y0 && p[1] <= b.y1 && inside(b.f, p))?.f;

// 這些類別是單一建築；廣場、公園、建築群在 scripts/attractions.data.mjs 標 site: "area"
const BUILDING_CATS = new Set(["heritage", "temple", "museum", "landmark", "resort", "transport"]);

test("every building-type attraction pin sits on a building footprint", () => {
  const off = attractions.filter((a) => BUILDING_CATS.has(a.cat) && a.site !== "area" && !footprintAt(a.coords));
  assert.deepEqual(off.map((a) => `${a.id} ${a.zh}`), [], "pin is off its building: set buildingId in scripts/attractions.data.mjs, or site: \"area\" for squares/parks");
});

test("attractions bound to a footprint ID sit inside that exact footprint", () => {
  const byBid = new Map(buildings.map((f) => [f.properties.bid, f]));
  const bound = attractions.filter((a) => a.buildingId);
  assert.ok(bound.length >= 8);
  for (const a of bound) {
    const f = byBid.get(a.buildingId);
    assert.ok(f, `${a.id}: buildingId ${a.buildingId} no longer exists in the building data`);
    assert.ok(inside(f, a.coords), `${a.id} is not inside its bound footprint`);
  }
});

test("memory points that inherit an attraction's position stay on it", () => {
  const coords = new Map(attractions.map((a) => [a.id, a.coords]));
  for (const f of data("places.geojson").features.filter((f) => f.properties.geoSource === "building-catalog")) {
    assert.deepEqual(f.geometry.coordinates, coords.get(f.properties.nearId), `${f.properties.id}: run node scripts/sync-place-coords.mjs`);
  }
  for (const p of data("system-catalog.json").places) assert.deepEqual(p.coordinates, coords.get(p.spotId), p.id);
});
