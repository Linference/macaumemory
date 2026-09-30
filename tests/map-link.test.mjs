import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMapQuery } from "../src/map-link.js";
test("no query or spot-only query never invents [0,0] and cannot override a coordinate hash", () => {
  assert.deepEqual(parseMapQuery(""), { spot: null, coords: null, zoom: null });
  assert.deepEqual(parseMapQuery("?spot=parisian"), { spot: "parisian", coords: null, zoom: null });
  assert.equal(parseMapQuery("?lat=&lng=&zoom=").coords, null);
});
test("complete valid coordinates and zoom are accepted; incomplete or invalid coordinates are not", () => {
  assert.deepEqual(parseMapQuery("?lat=22.14595&lng=113.56465&zoom=17"), { spot: null, coords: [113.56465, 22.14595], zoom: 17 });
  for (const q of ["?lat=22", "?lat=NaN&lng=113", "?lat=91&lng=113", "?lat=22&lng=181"]) assert.equal(parseMapQuery(q).coords, null);
  assert.deepEqual(parseMapQuery("?lat=0&lng=0").coords, [0, 0]);
});
