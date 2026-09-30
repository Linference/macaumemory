import { test } from "node:test";
import assert from "node:assert/strict";
import { rankCandidates, marginOf, verdict } from "../src/recognize/compare.js";
import { dedupVerdict, dedupThresholds } from "../src/recognize/dedup.js";
import { locationQuality, GEO_POLICY } from "../src/recognize/geo-ranking.js";
import { evaluateQueries, proportion } from "../tools/recognize/independent-eval.mjs";

const now = Date.parse("2026-09-30T00:00:00Z");
const location = { lng: 113.55, lat: 22.18, accuracyM: 20, capturedAt: new Date(now).toISOString(), source: "gps" };
const vector = (s) => [s, Math.sqrt(1 - s * s)];
const library = (a = .9, b = .85) => ({ eval: { suggested: { hit: .82, maybe: .57 } }, buildings: [
  { id: "far", zh: "far", vectors: [vector(a)], files: ["a.jpg"], coords: [113.6, 22.18] },
  { id: "near", zh: "near", vectors: [vector(b)], files: ["b.jpg"], coords: [113.55, 22.18] },
] });
const rank = (lib, geo = {}) => rankCandidates(lib, [1, 0], { thresholds: dedupThresholds(lib), geo });

test("location is opt-in; invalid, inaccurate, stale or future GPS never reranks", () => {
  const lib = library();
  assert.equal(rank(lib, { location, now }).top[0].id, "far");
  for (const loc of [null, { ...location, lng: 181 }, { ...location, accuracyM: 101 },
    { ...location, capturedAt: new Date(now - 300001).toISOString() },
    { ...location, capturedAt: new Date(now + 30001).toISOString() }, { ...location, accuracyM: null }]) {
    const r = rank(lib, { enabled: true, location: loc, now });
    assert.equal(r.top[0].id, "far"); assert.equal(r.geo.used, false);
  }
  assert.equal(locationQuality(location, NaN).usable, false);
});

test("bounded location penalty preserves raw similarity and never upgrades an ambiguous match", () => {
  const lib = library();
  const r = rank(lib, { enabled: true, location, now });
  assert.equal(r.top[0].id, "near");
  assert.equal(r.top[0].sim, .85);
  assert.ok(r.all.every((row) => row.geo.penalty >= 0 && row.geo.penalty <= GEO_POLICY.maxPenalty));
  assert.equal(verdict(r.top, marginOf(r.top), r.thresholds).key, "likely");
  assert.equal(dedupVerdict(r.top, marginOf(r.top), r.thresholds).key, "maybe");
});

test("clear image winner survives location tie-breaker but contradictory position requires review", () => {
  const r = rank(library(.99, .8), { enabled: true, location, now });
  assert.equal(r.top[0].id, "far");
  assert.equal(verdict(r.top, marginOf(r.top), r.thresholds).key, "likely");
  const plain = rank(library(.99, .8));
  assert.equal(dedupVerdict(plain.top, marginOf(plain.top), plain.thresholds).key, "known");
});

test("a stronger visual competitor outside displayed Top-3 still prevents confident acceptance", () => {
  const lib = library(.9, .88);
  lib.buildings.push(...[.87, .86].map((s, i) => ({ id: `local-${i}`, vectors: [vector(s)], coords: location ? [location.lng, location.lat] : null })));
  const r = rank(lib, { enabled: true, location, now });
  assert.equal(r.top[0].id, "near");
  assert.ok(!r.top.some((c) => c.id === "far"));
  assert.ok(marginOf(r.top) < 0);
  assert.equal(verdict(r.top, 1, r.thresholds).key, "likely");
});

test("missing candidate coordinates keep image order and report location unused", () => {
  const lib = library(); lib.buildings.forEach((b) => { b.coords = null; });
  const r = rank(lib, { enabled: true, location, now });
  assert.equal(r.top[0].id, "far"); assert.equal(r.geo.used, false);
  assert.equal(r.top[0].geo.penalty, 0);
});

test("low similarity cannot be promoted by geography and empty libraries are handled", () => {
  const r = rank(library(.2, .1), { enabled: true, location, now });
  assert.equal(dedupVerdict(r.top, marginOf(r.top), r.thresholds).key, "unknown");
  assert.ok(!verdict(r.top, marginOf(r.top), r.thresholds).detail.includes("undefined"));
  const empty = rank({ buildings: [] });
  assert.equal(verdict(empty.top, marginOf(empty.top), empty.thresholds).key, "none");
});

test("independent metrics exclude calibration and count confidently accepted unknown buildings as errors", () => {
  const lib = library(.99, .5);
  const rows = [
    { id: "test-known", split: "test", buildingId: "far", vector: [1, 0] },
    { id: "test-unknown", split: "test", buildingId: "unknown:x", vector: [1, 0] },
    { id: "calibration", split: "calibration", buildingId: "near", vector: [1, 0] },
  ];
  const result = evaluateQueries(lib, rows);
  assert.equal(result.counts.test, 2); assert.equal(result.top1.value, 1);
  assert.equal(result.confidentPrecision.value, .5); assert.equal(result.unknownFalseAcceptance.value, 1);
  assert.equal(proportion(0, 0).value, null);
  assert.ok(proportion(26, 26).interval95[0] < .9);
});
