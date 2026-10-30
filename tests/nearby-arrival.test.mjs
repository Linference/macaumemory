import test from "node:test";
import assert from "node:assert/strict";
import { nearbyArrival, ArrivalGate } from "../src/nearby-arrival.js";

const now = Date.now();
const site = { id: "site", coords: [113.5400, 22.1900] };
const memory = { geometry: { coordinates: [113.5401, 22.1900] }, properties: { id: "MM-1", nearId: "site" } };
const independent = { geometry: { coordinates: [113.5500, 22.1900] }, properties: { id: "MM-2" } };
const fix = (coords, accuracy = 12, time = now) => ({ coords, accuracy, time });

test("arrival uses the scenic introduction for a colocated photo memory", () => {
  const hit = nearbyArrival(fix(memory.geometry.coordinates), [site], [memory], now);
  assert.equal(hit.kind, "attraction");
  assert.equal(hit.key, "site");
});

test("an independent memory point is introduced on its own", () => {
  const hit = nearbyArrival(fix(independent.geometry.coordinates), [site], [independent], now);
  assert.equal(hit.kind, "memory");
  assert.equal(hit.key, "MM-2");
});

test("the memory remains reachable when its related scenic marker is outside arrival range", () => {
  const fartherMemory = { ...memory, geometry: { coordinates: [113.5403, 22.1900] } };
  const hit = nearbyArrival(fix([113.54058, 22.1900]), [site], [fartherMemory], now);
  assert.equal(hit?.kind, "memory");
});

test("poor, old and distant fixes never open a guide", () => {
  assert.equal(nearbyArrival(fix(site.coords, 90), [site], [], now), null);
  assert.equal(nearbyArrival(fix(site.coords, 12, now - 31_000), [site], [], now), null);
  assert.equal(nearbyArrival(fix([113.55, 22.2]), [site], [], now), null);
});

test("arrival requires stable repeated fixes and opens once per place", () => {
  const gate = new ArrivalGate();
  const hit = nearbyArrival(fix(site.coords), [site], [], now);
  assert.equal(gate.observe(hit, now, now), null);
  assert.equal(gate.observe(hit, now + 1500, now), null);
  assert.equal(gate.observe(hit, now + 2000, now + 2000)?.key, "site");
  assert.equal(gate.observe(hit, now + 3000, now + 3000), null);
});
