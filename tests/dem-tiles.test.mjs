import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildStyle } from "../src/map-style.js";

const DEM = new URL("../public/dem/", import.meta.url);

test("both raster-dem sources load lossless WebP and stop at the source data's real resolution", () => {
  const dems = Object.values(buildStyle().sources).filter((s) => s.type === "raster-dem");
  assert.equal(dems.length, 2);
  for (const s of dems) {
    assert.deepEqual(s.tiles, ["dem/{z}/{x}/{y}.webp"]);
    assert.ok(s.maxzoom <= 14, "z15 is interpolated from z14; loading it only multiplies startup tiles");
  }
});

test("every PNG DEM tile the map can request has an up-to-date WebP copy", () => {
  const { minzoom, maxzoom } = buildStyle().sources.dem;
  let n = 0;
  for (let z = minzoom; z <= maxzoom; z++) {
    for (const x of fs.readdirSync(new URL(`${z}/`, DEM))) {
      for (const y of fs.readdirSync(new URL(`${z}/${x}/`, DEM)).filter((f) => f.endsWith(".png"))) {
        const png = new URL(`${z}/${x}/${y}`, DEM), webp = new URL(`${z}/${x}/${y.replace(/\.png$/, ".webp")}`, DEM);
        assert.ok(fs.existsSync(webp), `missing ${z}/${x}/${y} WebP — run npm run data:dem-webp`);
        assert.ok(fs.statSync(webp).mtimeMs >= fs.statSync(png).mtimeMs, `stale ${z}/${x}/${y} WebP — run npm run data:dem-webp`);
        n++;
      }
    }
  }
  assert.ok(n > 0);
});
