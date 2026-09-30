import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseLandmarkPlacements, replacementFilter } from "../src/landmark-placement.js";

const p = { id: "test", enabled: true, file: "models/test.glb", coords: [113.55, 22.18], metersPerUnit: 1, buildingIds: ["stable-building"] };
const manifest = (...placements) => ({ version: 1, placements });
test("placements require surveyed scale and valid geographic coordinates", () => {
  for (const change of [{ metersPerUnit: 0 }, { metersPerUnit: undefined }, { coords: [181, 22] },
    { file: "models/../secret.glb" }, { file: "https://host/model.glb" }, { lodFile: "models/../bad.glb" },
    { detailZoom: 13 }, { rotationDeg: [0, NaN, 0] }, { buildingIds: [null] }]) {
    assert.throws(() => parseLandmarkPlacements(manifest({ ...p, ...change })));
  }
  assert.throws(() => parseLandmarkPlacements(manifest(p, p)));
  assert.deepEqual(parseLandmarkPlacements(manifest({ enabled: false })), []);
  assert.deepEqual(parseLandmarkPlacements(manifest({ ...p, coords: undefined, spot: "site" }), [{ id: "site", coords: p.coords }])[0].coords, p.coords);
});
test("all four published placements refer to local assets and existing exact building IDs", () => {
  const config = JSON.parse(fs.readFileSync(new URL("../public/models/landmarks.json", import.meta.url)));
  const data = JSON.parse(fs.readFileSync(new URL("../public/data/attractions.json", import.meta.url)));
  const buildings = JSON.parse(fs.readFileSync(new URL("../public/data/macau-buildings.geojson", import.meta.url)));
  const ids = new Set(buildings.features.map((f) => f.id));
  assert.ok(buildings.features.every((f) => f.properties.bid === f.id));
  const placements = parseLandmarkPlacements(config, data.attractions);
  assert.equal(placements.length, 4);
  for (const p of placements) {
    for (const file of [p.file, p.lodFile]) assert.ok(fs.existsSync(new URL(`../public/${file}`, import.meta.url)), file);
    assert.ok(p.buildingIds.length && p.buildingIds.every((id) => ids.has(id)), p.id);
    assert.equal(p.placementQuality, "provisional");
  }
});
test("whitebox is hidden only after successful load, at visible zoom, for explicit stable IDs", () => {
  const base = ["has", "h"];
  const active = { ...p, minZoom: 15.5, loaded: true };
  assert.deepEqual(replacementFilter(base, [active], 16), ["all", base, ["!", ["in", ["get", "bid"], ["literal", ["stable-building"]]]]]);
  assert.deepEqual(replacementFilter(base, [{ ...active, loaded: false }], 16), base);
  assert.deepEqual(replacementFilter(base, [active], 14), base);
  assert.deepEqual(replacementFilter(base, [active], 16, false), base);
  assert.equal(replacementFilter(null, [{ ...active, buildingIds: [] }], 16), null);
});
