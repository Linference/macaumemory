// 清理 terrarium DEM：把海底（負值）與異常尖峰壓平為 0，讓 3D 地形的海面平整
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { PUBLIC } from "./lib.mjs";

const ROOT_DEM = path.join(PUBLIC, "dem");
const MAX_ELEV = 720; // 澳門與鄰近地區的合理上限（公尺）
let files = 0, fixed = 0, clamped = 0;

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".png")) process(p);
  }
}
const jobs = [];
walk(ROOT_DEM);
await Promise.all(Array.from({ length: 12 }, async () => {
  while (jobs.length) {
    const fn = jobs.pop();
    await fn();
  }
}));

function process(file) {
  jobs.push(async () => {
    files++;
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let changed = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      let h = data[i] * 256 + data[i + 1] + data[i + 2] / 256 - 32768;
      if (h < 0 || h > MAX_ELEV) { h = 0; changed++; }
      const v = h + 32768;
      const r = Math.floor(v / 256);
      data[i] = r; data[i + 1] = Math.floor(v - r * 256); data[i + 2] = Math.round((v - Math.floor(v)) * 256);
    }
    if (changed) {
      clamped += changed;
      fixed++;
      await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).png({ compressionLevel: 9 }).toFile(file + ".tmp");
      fs.renameSync(file + ".tmp", file);
    }
  });
}
console.log(`DEM 清理完成：處理 ${files} 張圖磚，修正 ${fixed} 張，壓平 ${clamped.toLocaleString()} 個像素`);
