import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { memoryDate, escapeMemoryText, memorySourceLink } from "../src/memory-photo.js";

const places = JSON.parse(readFileSync(new URL("../public/data/places.geojson", import.meta.url))).features;

test("city memory uses existing real photos and consistent covers/counts", () => {
  const ids = new Set();
  for (const { properties: p } of places) {
    assert.ok(!ids.has(p.id));
    ids.add(p.id);
    assert.equal(p.photoCount, p.photos.length);
    assert.ok(p.photos.some((ph) => ph.file === p.cover && ph.thumb === p.coverThumb));
    for (const ph of p.photos) {
      assert.match(ph.file, /^photos\/real\//);
      assert.ok(existsSync(new URL(`../public/${ph.file}`, import.meta.url)));
      assert.ok(existsSync(new URL(`../public/${ph.thumb}`, import.meta.url)));
      assert.ok(["user-provided", "wikimedia_commons"].includes(ph.source));
      if (ph.source === "wikimedia_commons") {
        assert.ok(ph.author && ph.license && memorySourceLink(ph.sourcePage));
      }
    }
    const dated = p.photos.map((ph) => ph.taken).filter(Boolean);
    assert.deepEqual(dated, [...dated].sort());
    assert.equal(p.firstSeen, dated[0] ?? null);
    assert.equal(p.lastSeen, dated.at(-1) ?? null);
  }
  for (const id of ["ruins-st-paul", "parisian", "macau-tower", "macau-science-center"]) {
    assert.ok(places.some((f) => f.properties.nearId === id), `${id} keeps its memory album`);
  }
});

test("photo sources escape attribution and reject executable URLs", () => {
  assert.equal(memoryDate(null), "日期未記錄");
  assert.equal(memoryDate("Taken on 15 May 201"), "日期未記錄");
  assert.equal(memoryDate("2023-08-22"), "2023.08.22");
  assert.equal(memorySourceLink("javascript:alert(1)"), "");
  assert.equal(escapeMemoryText('<img onerror="x">'), "&lt;img onerror=&quot;x&quot;&gt;");
});
