// YOLO（澳門建築 11 類）推論與解碼
//
// 模型：public/models/macau-buildings-yolo.onnx（yolo11s 微調、imgsz=768、opset 17）
//   ultralytics 的偵測頭輸出是 (1, 4 + nc, N)：前 4 個是 cx, cy, w, h（letterbox 後的像素座標，
//   已做過解碼，不是 anchor offset），後 nc 個是各類別分數（已過 sigmoid）。
//   這裡只做「信心篩選 → 座標還原 → 類別感知 NMS」。
//
// 為什麼要自己寫 NMS：onnxruntime-web 只回張量，非極大值抑制必須在前端做。

import { letterbox } from "./preprocess.js";

export const DEFAULT_INPUT = 768;

/** 從 letterbox 後的框還原成原圖座標 */
export function scaleBox({ cx, cy, w, h }, scale, padX, padY, imgW, imgH) {
  const x1 = (cx - w / 2 - padX) / scale;
  const y1 = (cy - h / 2 - padY) / scale;
  const x2 = (cx + w / 2 - padX) / scale;
  const y2 = (cy + h / 2 - padY) / scale;
  return {
    x: Math.max(0, Math.min(imgW, x1)),
    y: Math.max(0, Math.min(imgH, y1)),
    w: Math.max(1, Math.min(imgW, x2) - Math.max(0, x1)),
    h: Math.max(1, Math.min(imgH, y2) - Math.max(0, y1)),
  };
}

export const iou = (a, b) => {
  const ax2 = a.x + a.w, ay2 = a.y + a.h, bx2 = b.x + b.w, by2 = b.y + b.h;
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const uni = a.w * a.h + b.w * b.h - inter;
  return uni > 0 ? inter / uni : 0;
};

/** 類別感知的貪婪 NMS（同一類才互相抑制） */
export function nms(dets, iouThr = 0.45) {
  const keep = [];
  const byClass = new Map();
  for (const d of dets) {
    if (!byClass.has(d.cls)) byClass.set(d.cls, []);
    byClass.get(d.cls).push(d);
  }
  for (const list of byClass.values()) {
    list.sort((a, b) => b.score - a.score);
    const taken = [];
    for (const d of list) {
      if (taken.some((t) => iou(t, d) > iouThr)) continue;
      taken.push(d);
      keep.push(d);
    }
  }
  return keep.sort((a, b) => b.score - a.score);
}

/**
 * 解析 ultralytics 的偵測輸出。
 * @param {Float32Array} data 展平的 (4+nc) × N
 * @param {number[]} dims    輸出張量的形狀（容忍 (1,C,N) 或 (C,N) 或 (N,C)）
 * @param {string[]} names   類別名稱（索引 = 類別 id）
 */
export function decodeDetections(data, dims, names, { conf = 0.25, iouThr = 0.45, scale = 1, padX = 0, padY = 0, imgW = 1, imgH = 1 } = {}) {
  // 正規化成 [C, N]
  let C, N, get;
  if (dims.length === 3) {
    const [, d1, d2] = dims;
    if (d1 <= d2) { C = d1; N = d2; get = (c, i) => data[c * N + i]; }
    else { C = d2; N = d1; get = (c, i) => data[i * C + c]; }
  } else if (dims.length === 2) {
    const [d1, d2] = dims;
    if (d1 <= d2) { C = d1; N = d2; get = (c, i) => data[c * N + i]; }
    else { C = d2; N = d1; get = (c, i) => data[i * C + c]; }
  } else {
    throw new Error(`不支援的輸出形狀：${JSON.stringify(dims)}`);
  }
  const nc = C - 4;
  if (nc <= 0) throw new Error(`輸出通道數不合理：C=${C}`);
  const classNames = names?.length === nc ? names : Array.from({ length: nc }, (_, i) => names?.[i] ?? `class_${i}`);

  const raw = [];
  for (let i = 0; i < N; i++) {
    let best = -1, bestC = -1;
    for (let c = 0; c < nc; c++) {
      const s = get(4 + c, i);
      if (s > best) { best = s; bestC = c; }
    }
    if (best < conf) continue;
    const box = scaleBox(
      { cx: get(0, i), cy: get(1, i), w: get(2, i), h: get(3, i) },
      scale, padX, padY, imgW, imgH,
    );
    raw.push({ cls: classNames[bestC], clsIndex: bestC, score: best, ...box });
  }
  return { detections: nms(raw, iouThr), candidates: raw.length, channels: C, anchors: N };
}

/** 載入並包裝 ONNX 模型（ort 由呼叫端注入，避免這個檔案綁定特定 runtime） */
export async function createDetector(ort, modelUrl, { input = DEFAULT_INPUT, names = null } = {}) {
  const t0 = performance.now();
  const res = await fetch(modelUrl);
  if (!res.ok) throw new Error(`模型下載失敗 HTTP ${res.status}：${modelUrl}`);
  const buf = await res.arrayBuffer();
  const session = await ort.InferenceSession.create(buf, { executionProviders: ["wasm"] });
  const inName = session.inputNames[0];
  const outName = session.outputNames[0];
  const size = Number(session.inputMetadata?.[inName]?.dimensions?.at(-1)) || input;
  return {
    session, inName, outName, size,
    names,
    loadMs: performance.now() - t0,
    bytes: buf.byteLength,
    /** @param {ImageBitmap} bitmap */
    async detect(bitmap, opts = {}) {
      const { tensor, scale, padX, padY } = await letterbox(bitmap, size);
      const feeds = { [this.inName]: new ort.Tensor("float32", tensor, [1, 3, size, size]) };
      const out = await this.session.run(feeds);
      const o = out[this.outName];
      const decoded = decodeDetections(o.data, o.dims, this.names, {
        scale, padX, padY, imgW: bitmap.width, imgH: bitmap.height, ...opts,
      });
      return { ...decoded, inputSize: size, tensor };
    },
  };
}
