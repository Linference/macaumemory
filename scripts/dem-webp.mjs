// 把 terrarium DEM 圖磚轉成「無損」WebP，網頁實際載入的是這一份
//  - terrarium 以 RGB 編碼高程，必須逐位元一致，所以只用 lossless，轉完會解碼回來比對
//  - 實測 z10–z14 共 200 張：PNG 7.37 MB → WebP 4.03 MB（-45%），0 張不一致
//  - z15 不轉：來源是 AWS Terrain Tiles（本區為 ~30 m 的 SRTM），z15（約 4.5 m/px）只是 z14 的內插，
//    與 z14 雙線性放大比較平均差 0.06 m；地圖樣式已把 maxzoom 設為 14，由 MapLibre 自行 overzoom
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { PUBLIC } from "./lib.mjs";

const ROOT_DEM = path.join(PUBLIC, "dem");
const DEM_WEBP_MAXZOOM = 14;

const files = [];
for (const z of fs.readdirSync(ROOT_DEM)) {
  if (!/^\d+$/.test(z) || +z > DEM_WEBP_MAXZOOM) continue;
  for (const x of fs.readdirSync(path.join(ROOT_DEM, z))) {
    for (const y of fs.readdirSync(path.join(ROOT_DEM, z, x))) {
      if (y.endsWith(".png")) files.push(path.join(ROOT_DEM, z, x, y));
    }
  }
}

let pngBytes = 0, webpBytes = 0, skipped = 0;
const queue = [...files];
await Promise.all(Array.from({ length: 8 }, async () => {
  while (queue.length) {
    const file = queue.pop();
    const out = file.replace(/\.png$/, ".webp");
    pngBytes += fs.statSync(file).size;
    if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(file).mtimeMs) {
      webpBytes += fs.statSync(out).size;
      skipped++;
      continue;
    }
    const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const webp = await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } })
      .webp({ lossless: true, effort: 6 })
      .toBuffer();
    const back = await sharp(webp).removeAlpha().raw().toBuffer();
    if (Buffer.compare(data, back) !== 0) throw new Error(`WebP 解碼後與原圖不一致：${file}`);
    fs.writeFileSync(out + ".tmp", webp);
    fs.renameSync(out + ".tmp", out);
    webpBytes += webp.length;
  }
}));

const mb = (b) => (b / 1e6).toFixed(2);
console.log(`DEM WebP：${files.length} 張（z≤${DEM_WEBP_MAXZOOM}，沿用 ${skipped} 張），PNG ${mb(pngBytes)} MB → WebP ${mb(webpBytes)} MB`);
