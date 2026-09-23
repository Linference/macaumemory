// 用 OpenTopography Global DEM API 下載澳門的高精度 DEM（Copernicus GLO-30 / ALOS AW3D30）
//
// ⚠️ 金鑰只從環境變數讀取，**絕對不要寫進檔案或提交**：
//    OpenTopography 使用條款明文禁止 "make their key accessible publicly" 與
//    "embedding keys within an application or service"。
//    這裡曾硬編一組金鑰並進了 git 歷史，該金鑰應視為已洩漏並作廢。
//
// 用法：$env:OT_API_KEY="你的新金鑰"; node scripts/fetch-opentopography.mjs COP30 GTiff
import fs from "node:fs";
import path from "node:path";
import { SAMPLING_BBOX, MACAU_BBOX, CACHE, PUBLIC, ensureDir } from "./lib.mjs";

const KEY = process.env.OT_API_KEY;
if (!KEY) {
  console.error("✗ 缺少 OT_API_KEY 環境變數。");
  console.error("  申請免費金鑰：https://portal.opentopography.org/requestService?service=api");
  console.error("  管理既有金鑰：https://portal.opentopography.org/myopentopo");
  console.error("  本機設定：$env:OT_API_KEY=\"你的金鑰\"（勿寫入檔案、勿提交）");
  process.exit(1);
}
const DEM_TYPE = process.argv[2] ?? "COP30";
const FORMAT = process.argv[3] ?? "GTiff";
const b = SAMPLING_BBOX;
const url = `https://portal.opentopography.org/API/globaldem?demtype=${DEM_TYPE}&south=${b.south}&north=${b.north}&west=${b.west}&east=${b.east}&outputFormat=${FORMAT}&API_Key=${KEY}`;
console.log("GET", url.replace(KEY, KEY.slice(0, 4) + "…（已隱藏）"));
const t0 = Date.now();
const res = await fetch(url, { headers: { "User-Agent": "macau-memory-3d/1.0" } });
const buf = Buffer.from(await res.arrayBuffer());
console.log("status:", res.status, res.headers.get("content-type"), "bytes:", buf.length, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log("magic:", buf.subarray(0, 16).toString("hex"), JSON.stringify(buf.subarray(0, 80).toString("utf8").replace(/[^\x20-\x7e]/g, ".")));
const out = path.join(CACHE, `ot-${DEM_TYPE}-${FORMAT}.dat`);
ensureDir(CACHE);
fs.writeFileSync(out, buf);
console.log("saved:", out);
