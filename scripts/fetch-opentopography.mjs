// 用 OpenTopography Global DEM API 下載澳門的高精度 DEM（Copernicus GLO-30 / ALOS AW3D30）
import fs from "node:fs";
import path from "node:path";
import { SAMPLING_BBOX, MACAU_BBOX, CACHE, PUBLIC, ensureDir } from "./lib.mjs";

const KEY = process.env.OT_API_KEY ?? "e3a7333f03561938ec50df3302be839a";
const DEM_TYPE = process.argv[2] ?? "COP30";
const FORMAT = process.argv[3] ?? "GTiff";
const b = SAMPLING_BBOX;
const url = `https://portal.opentopography.org/API/globaldem?demtype=${DEM_TYPE}&south=${b.south}&north=${b.north}&west=${b.west}&east=${b.east}&outputFormat=${FORMAT}&API_Key=${KEY}`;
console.log("GET", url.replace(KEY, KEY.slice(0, 6) + "…"));
const t0 = Date.now();
const res = await fetch(url, { headers: { "User-Agent": "macau-memory-3d/1.0" } });
const buf = Buffer.from(await res.arrayBuffer());
console.log("status:", res.status, res.headers.get("content-type"), "bytes:", buf.length, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log("magic:", buf.subarray(0, 16).toString("hex"), JSON.stringify(buf.subarray(0, 80).toString("utf8").replace(/[^\x20-\x7e]/g, ".")));
const out = path.join(CACHE, `ot-${DEM_TYPE}-${FORMAT}.dat`);
ensureDir(CACHE);
fs.writeFileSync(out, buf);
console.log("saved:", out);
