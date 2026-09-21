import sharp from "sharp";
// 將截圖轉成 ASCII 縮圖，方便在終端檢視構圖
const CHARS = " .:-=+*#%@";
export async function asciiPreview(file, w = 76, h = 30) {
  const raw = await sharp(file).resize(w, h, { fit: "fill" }).greyscale().raw().toBuffer();
  let out = "";
  for (let y = 0; y < h; y++) {
    let line = "";
    for (let x = 0; x < w; x++) {
      const v = raw[y * w + x] / 255;
      line += CHARS[Math.min(CHARS.length - 1, Math.floor(v * CHARS.length))];
    }
    out += line + "\n";
  }
  return out;
}
export async function analyze(file) {
  const img = sharp(file);
  const { width, height } = await img.metadata();
  const raw = await img.resize(64, 40, { fit: "fill" }).raw().toBuffer();
  const n = raw.length / 3;
  const mean = [0, 0, 0];
  for (let i = 0; i < raw.length; i += 3) for (let c = 0; c < 3; c++) mean[c] += raw[i + c] / n;
  const sd = [0, 0, 0];
  for (let i = 0; i < raw.length; i += 3) for (let c = 0; c < 3; c++) sd[c] += (raw[i + c] - mean[c]) ** 2 / n;
  return { size: `${width}x${height}`, mean: mean.map((v) => +v.toFixed(0)), sd: sd.map((v) => +Math.sqrt(v).toFixed(1)) };
}
