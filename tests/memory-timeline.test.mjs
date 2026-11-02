import test from "node:test";
import assert from "node:assert/strict";
import { photoYear, timelineOf } from "../src/memory/timeline.js";

test("photoYear reads a four-digit year from either date field", () => {
  assert.equal(photoYear({ taken: "2011-12-10" }), 2011);
  assert.equal(photoYear({ taken: null, dateOriginal: "Taken on 30 January 2012" }), 2012);
  assert.equal(photoYear({ taken: "", dateOriginal: "Taken on 30 January" }), null);
});

test("timelineOf sorts by year, keeps undated photos last in original order", () => {
  const t = timelineOf([{ id: "a" }, { id: "b", taken: "2015" }, { id: "c", taken: "2003-01-01" }, { id: "d" }]);
  assert.deepEqual(t.photos.map((p) => p.id), ["c", "b", "a", "d"]);
  assert.equal(t.first, 2003); assert.equal(t.last, 2015); assert.equal(t.span, 12); assert.equal(t.dated, 2);
});

test("timelineOf handles an empty gallery", () => {
  assert.deepEqual(timelineOf([]), { photos: [], first: null, last: null, span: 0, dated: 0 });
});
