// 影像前處理：與 Python 端（tools/recognize/build_embeddings.py）逐位對齊
//
// 兩條路徑都必須一模一樣，否則查詢照片與嵌入庫會落在不同的特徵空間：
//   DINOv2：shortest-edge resize → center crop → ImageNet 正規化 → NCHW
//   YOLO  ：letterbox（等比例縮放 + 灰邊 114）→ 0~1 → NCHW
//
// 這裡全部用 OffscreenCanvas / createImageBitmap，Worker 與主執行緒都可用。

export const DINO_SIZE = 336;                                  // 336 / 14 = 24 → 576 patch + 1 cls
export const DINO_MEAN = [0.485, 0.456, 0.406];
export const DINO_STD = [0.229, 0.224, 0.225];

/** 把任何來源（File / Blob / ImageBitmap / HTMLImageElement / ImageData）變成 ImageBitmap */
export async function toBitmap(src) {
  if (typeof ImageBitmap !== "undefined" && src instanceof ImageBitmap) return src;
  if (typeof OffscreenCanvas !== "undefined" && src instanceof OffscreenCanvas) return src.transferToImageBitmap();
  if (typeof ImageData !== "undefined" && src instanceof ImageData) return createImageBitmap(src);
  if (typeof Blob !== "undefined" && src instanceof Blob) return createImageBitmap(src);
  return createImageBitmap(src);
}

async function drawScaled(bitmap, w, h, opts = {}) {
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (opts.fill) { ctx.fillStyle = opts.fill; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, opts.dx ?? 0, opts.dy ?? 0, opts.dw ?? canvas.width, opts.dh ?? canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** DINOv2 前處理：shortest-edge resize + center crop + ImageNet 正規化 */
export async function dinoTensor(bitmap, size = DINO_SIZE) {
  const bw = bitmap.width, bh = bitmap.height;
  if (!bw || !bh) throw new Error("影像尺寸為 0");
  const s = size / Math.min(bw, bh);
  const rw = Math.max(1, Math.round(bw * s));
  const rh = Math.max(1, Math.round(bh * s));
  let img;
  if (rw === size && rh === size) {
    img = await drawScaled(bitmap, size, size);
  } else {
    // 先縮到「短邊 = size」，再置中裁切 —— 與 PIL resize(BICUBIC) + crop 對應
    const scaled = await drawScaled(bitmap, rw, rh);
    const tmp = new OffscreenCanvas(rw, rh);
    tmp.getContext("2d").putImageData(scaled, 0, 0);
    const left = (rw - size) >> 1, top = (rh - size) >> 1;
    img = await drawScaled(tmp, size, size, { dx: -left, dy: -top });
  }
  return normalizeToNCHW(img, size, DINO_MEAN, DINO_STD);
}

/** 直接把任意矩形裁切後做 DINOv2 前處理（用於 YOLO 框） */
export async function dinoTensorFromRect(bitmap, rect, size = DINO_SIZE) {
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const w = Math.min(bitmap.width - x, Math.ceil(rect.w));
  const h = Math.min(bitmap.height - y, Math.ceil(rect.h));
  if (w <= 1 || h <= 1) throw new Error("框太小");
  const crop = new OffscreenCanvas(w, h);
  crop.getContext("2d").drawImage(bitmap, x, y, w, h, 0, 0, w, h);
  return dinoTensor(crop, size);
}

/** 水平翻轉（DINOv2 的 TTA：建築左右翻轉仍是同一棟） */
export function flipTensor(t, size = DINO_SIZE) {
  const out = new Float32Array(t.length);
  for (let c = 0; c < 3; c++) {
    const base = c * size * size;
    for (let y = 0; y < size; y++) {
      const row = base + y * size;
      for (let x = 0; x < size; x++) out[row + x] = t[row + (size - 1 - x)];
    }
  }
  return out;
}

/** ImageData(RGBA) → float32 NCHW（(v/255 - mean)/std） */
export function normalizeToNCHW(imageData, size, mean, std) {
  const { data } = imageData;
  const n = size * size;
  const out = new Float32Array(3 * n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = data[p] / 255, g = data[p + 1] / 255, b = data[p + 2] / 255;
    out[i] = (r - mean[0]) / std[0];
    out[n + i] = (g - mean[1]) / std[1];
    out[2 * n + i] = (b - mean[2]) / std[2];
  }
  return out;
}

/**
 * YOLO letterbox：等比例縮到 inputSize 內、其餘填灰 114（與 ultralytics 一致）。
 * 回傳 { tensor, scale, padX, padY, inputSize }，座標換算靠後三者。
 */
export async function letterbox(bitmap, inputSize = 768) {
  const bw = bitmap.width, bh = bitmap.height;
  const scale = Math.min(inputSize / bw, inputSize / bh);
  const nw = Math.max(1, Math.round(bw * scale));
  const nh = Math.max(1, Math.round(bh * scale));
  const padX = Math.floor((inputSize - nw) / 2);
  const padY = Math.floor((inputSize - nh) / 2);
  const img = await drawScaled(bitmap, nw, nh, { fill: "rgb(114,114,114)" }).then((d) => {
    // drawScaled 已經畫在 nw×nh 畫布上；這裡再貼進 inputSize 的灰底畫布
    const canvas = new OffscreenCanvas(inputSize, inputSize);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "rgb(114,114,114)";
    ctx.fillRect(0, 0, inputSize, inputSize);
    const tmp = new OffscreenCanvas(nw, nh);
    tmp.getContext("2d").putImageData(d, 0, 0);
    ctx.drawImage(tmp, padX, padY);
    return ctx.getImageData(0, 0, inputSize, inputSize);
  });
  return { tensor: rgbaToUnitCHW(img, inputSize), scale, padX, padY, inputSize };
}

/** ImageData(RGBA) → float32 NCHW，只做 /255（YOLO 不做 ImageNet 正規化） */
export function rgbaToUnitCHW(imageData, size) {
  const { data } = imageData;
  const n = size * size;
  const out = new Float32Array(3 * n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    out[i] = data[p] / 255;
    out[n + i] = data[p + 1] / 255;
    out[2 * n + i] = data[p + 2] / 255;
  }
  return out;
}

/**
 * 多裁切（與 Python 端 _crops() 同一套）：置中 + 左右各偏 12%。
 * 回傳 [{rect, label}]，座標以 bitmap 為準。
 */
export function multiCrops(width, height, size = DINO_SIZE, n = 3) {
  const s = size / Math.min(width, height);
  const rw = Math.max(size, Math.round(width * s));
  const rh = Math.max(size, Math.round(height * s));
  const baseX = (rw - size) >> 1, baseY = (rh - size) >> 1;
  const out = [{ rect: { x: 0, y: 0, w: width, h: height }, label: "整張" }];
  if (n <= 1) return out;
  for (const [i, frac] of [0.12, -0.12].entries()) {
    const dx = Math.round((rw - size) * frac);
    const dy = Math.round((rh - size) * frac);
    const left = Math.min(Math.max(0, baseX + dx), rw - size);
    const top = Math.min(Math.max(0, baseY + dy), rh - size);
    // 換算回原圖座標
    out.push({
      rect: { x: left / s, y: top / s, w: size / s, h: size / s },
      label: i === 0 ? "偏左" : "偏右",
    });
  }
  return out;
}
