import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeSamples, haversineM, classifyGeoSource } from "../src/recognize/geo-math.js";
import { createGeoSession, GEO_PLANS } from "../src/recognize/geolocate.js";
import { buildingLocationFromPick, captureLocationFromGeo, matchingLocation, parseTypedLocation } from "../src/recognize/survey-location.js";
import { locationQuality } from "../src/recognize/geo-ranking.js";
import { rankCandidates } from "../src/recognize/compare.js";
import * as db from "../src/recognize/db.js";

const at = (northM = 0, accuracyM = 30) => ({ lat: 22.18 + northM / 111320, lng: 113.55, accuracyM, at: new Date().toISOString() });

test("repeated and drifting fixes cannot manufacture a smaller error radius", () => {
  for (const samples of [Array.from({ length: 40 }, () => at()), [at(-12), at(12), at(4)]]) {
    const result = summarizeSamples(samples);
    assert.ok(result.accuracyM >= 30);
    assert.equal(result.improved, false);
    for (const s of samples) assert.ok(result.accuracyM >= haversineM(result.lat, result.lng, s.lat, s.lng) + s.accuracyM);
  }
  assert.ok(summarizeSamples([at(-100, 8), at(100, 8)]).accuracyM > 100);
});

test("missing errors stay unknown and invalid coordinates cannot poison a valid fix", () => {
  assert.equal(summarizeSamples([{ ...at(), accuracyM: null }]).accuracyM, null);
  assert.equal(summarizeSamples([{ ...at(), lat: NaN }]).lat, null);
  assert.equal(summarizeSamples([at(), { ...at(), lng: 181 }]).sampleCount, 1);
  assert.equal(summarizeSamples([{ ...at(), accuracyM: -2 }]).sampleCount, 0);
  assert.equal(classifyGeoSource({ bestAccuracyM: 5, hasAltitude: true }), "browser");
  assert.equal(classifyGeoSource({ bestAccuracyM: 200 }), "browser");
});

test("device position never becomes a building position without a user pick", () => {
  const capture = captureLocationFromGeo({ ...summarizeSamples([at()]), samples: [at()] });
  const empty = buildingLocationFromPick(null);
  assert.equal(empty.lat, null);
  assert.equal(empty.confirmed, false);
  assert.equal(capture.role, "capture");
  assert.equal(matchingLocation(capture, empty), capture);
  const building = buildingLocationFromPick({ ...at(40), footprintId: "building-42", origin: "footprint" });
  assert.equal(building.accuracyM, null);
  assert.equal(building.footprintId, "building-42");
  assert.equal(matchingLocation(capture, building), building);
  assert.ok(haversineM(building.lat, building.lng, capture.lat, capture.lng) > 39);
  assert.equal(locationQuality({ ...building, confirmed: false }).usable, false);
  assert.equal(locationQuality(building).accuracyM, null);
  assert.equal(locationQuality({ ...capture, capturedAt: "2000-01-01T00:00:00Z" }).usable, false);
});

test("blank coordinate fields cannot silently select the equator", () => {
  assert.equal(parseTypedLocation("", ""), null);
  assert.equal(parseTypedLocation("22.18", " "), null);
  assert.equal(parseTypedLocation("91", "113.55"), null);
  assert.deepEqual(parseTypedLocation("22.18", "113.55"), { lat: 22.18, lng: 113.55 });
  assert.deepEqual(parseTypedLocation("0", "0"), { lat: 0, lng: 0 });
});

test("side-by-side ranking uses identical image scores and retains the original winner", () => {
  const vector = (s) => [s, Math.sqrt(1 - s * s)];
  const lib = { buildings: [
    { id: "far", vectors: [vector(.9)], coords: [113.6, 22.18] },
    { id: "near", vectors: [vector(.86)], coords: [113.55, 22.18] },
  ] };
  const result = rankCandidates(lib, [1, 0], { geo: { enabled: true,
    location: buildingLocationFromPick(at()) } });
  assert.equal(result.visualTop[0].id, "far");
  assert.equal(result.top[0].id, "near");
  assert.equal(result.comparison.changed, true);
  assert.equal(result.top[0].sim, result.visualTop.find((r) => r.id === "near").sim);
});

test("invalid browser readings end the session and never report a successful target", async () => {
  let calls = 0;
  const result = await new Promise((resolve) => {
    createGeoSession({ plan: { ...GEO_PLANS.quick, intervalMs: 0 }, onEnd: resolve,
      geolocation: { getCurrentPosition(ok) { calls++; queueMicrotask(() => ok({ coords: { latitude: NaN, longitude: 113.55, accuracy: 5 } })); } },
    }).start();
  });
  assert.equal(calls, 3);
  assert.equal(result.reason, "error");
  assert.equal(result.sampleCount, 0);
});

test("v1 database upgrade preserves records and stores capture/building positions separately after reload", async () => {
  const { default: initSqlite } = await import("@sqlite.org/sqlite-wasm");
  const sqlite = await initSqlite();
  const old = new sqlite.oo1.DB(":memory:", "c");
  old.exec(db.SCHEMA_SQL.replace(/,\s*location_role[\s\S]*?match_comparison\s+TEXT/, ""));
  old.exec("INSERT INTO meta VALUES ('schema_version','1'); INSERT INTO buildings(code,type,name,lat,lng,created_at) VALUES ('MM-2025-0042','tong_lau','舊唐樓',22.18,113.55,'2025-01-01'); INSERT INTO buildings_rtree VALUES(1,22.18,22.18,113.55,113.55)");
  const oldBytes = sqlite.capi.sqlite3_js_db_export(old);
  old.close();
  const provider = (bytes) => ({ ...db.memoryPersistence, name: "test", persistent: true,
    load: async () => bytes, save: async (saved) => ({ ok: true, bytes: saved.length }) });
  await db.openDb({ persistence: provider(oldBytes), migrate: false });
  assert.equal(db.schemaVersion(), 2);
  assert.equal(db.listBuildings()[0].code, "MM-2025-0042");
  assert.equal(db.listBuildings()[0].location_role, "legacy-unverified");
  assert.equal(db.countRtree(), 1);
  const capture = captureLocationFromGeo({ ...summarizeSamples([at()]), samples: [at()] });
  db.insertBuilding({ type: "tong_lau", name: "待定位唐樓", locationRole: "building-unlocated", captureLocation: capture });
  assert.equal(db.countRtree(), 1);
  const pick = buildingLocationFromPick({ ...at(40), footprintId: "b42" });
  db.insertBuilding({ type: "tong_lau", name: "新唐樓", lat: pick.lat, lng: pick.lng, geoSource: "manual",
    locationRole: "building-confirmed", footprintId: pick.footprintId, captureLocation: capture,
    matchComparison: { visualFirst: "a", locatedFirst: "b", changed: true } });
  assert.equal(db.countRtree(), 2);
  const saved = db.dbBytes();
  const reloaded = await import(`../src/recognize/db.js?location-reload=${Date.now()}`);
  await reloaded.openDb({ persistence: provider(saved), migrate: false });
  const rows = reloaded.exportJson().buildings;
  const located = rows.find((r) => r.name === "新唐樓");
  assert.equal(located.location.footprintId, "b42");
  assert.equal(located.location.confirmed, true);
  assert.equal(located.captureLocation.lat, capture.lat);
  assert.notEqual(located.location.lat, located.captureLocation.lat);
  assert.equal(located.matchComparison.changed, true);
  assert.equal(rows.find((r) => r.name === "待定位唐樓").location.lat, null);
  assert.equal(reloaded.countRtree(), 2);
});
