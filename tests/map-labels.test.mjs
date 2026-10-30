import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { roadLabel } from "../scripts/road-labels.mjs";
import { buildStyle, LABEL_LAYERS } from "../src/map-style.js";

const data = (f) => JSON.parse(fs.readFileSync(new URL(`../public/data/${f}`, import.meta.url), "utf8"));

test("road labels keep only the Chinese part of bilingual Macau street names", () => {
  assert.equal(roadLabel("新馬路 Avenida de Almeida Ribeiro"), "新馬路");
  assert.equal(roadLabel("美副將大馬路(Avenida)"), "美副將大馬路");
  assert.equal(roadLabel("學院四徑 4ª"), "學院四徑");
  assert.equal(roadLabel("1 號臨時路"), "1 號臨時路");
  assert.equal(roadLabel("Estrada do Istmo"), null);
  assert.equal(roadLabel(undefined), null);
});

test("labels are native layers drawn with local fonts, so the map needs no font server", () => {
  const style = buildStyle();
  assert.equal(style.glyphs, undefined, "a glyphs URL would make MapLibre fetch Latin/digit glyphs from a server");
  const ids = new Set(style.layers.map((l) => l.id));
  for (const id of LABEL_LAYERS) assert.ok(ids.has(id), id);
  for (const l of style.layers.filter((l) => l.id.startsWith("road-label"))) assert.deepEqual(l.layout["text-field"], ["get", "zh"]);
});

test("road data carries the label field the style reads", () => {
  const roads = data("macau-roads.geojson").features;
  const labelled = roads.filter((f) => f.properties.zh);
  assert.ok(labelled.length > 7000, `only ${labelled.length} labelled roads — run node scripts/road-labels.mjs`);
  assert.ok(labelled.every((f) => f.properties.zh === roadLabel(f.properties.n)));
});

test("place names shown on the site use current official names", () => {
  for (const a of data("attractions.json").attractions) assert.notEqual(a.zh, "民政總署大樓", "renamed 市政署大樓 in 2019");
});
