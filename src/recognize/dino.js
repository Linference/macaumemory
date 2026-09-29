// DINOv2（ViT-S/14, 336px）影像嵌入
//
// 模型：public/models/dinov2-vits14-336.onnx —— tools/recognize/export_dino_onnx.py 匯出
//   輸入 pixel_values: (B,3,336,336)，已做 shortest-edge resize + center crop + ImageNet 正規化
//   輸出 cls: (B,384)，未正規化；本檔一律 L2 正規化，讓相似度 = 點積
//
// 為什麼用 fp32 而不是 int8（實測，不是偏好）：
//   int8 動態量化只有 23 MB，在 Node 的原生 onnxruntime 也能跑（檢索品質幾乎不變：
//   留一法 Top-1 兩者都是 83.95%、Top-3 92.59% vs 95.06%），**但瀏覽器跑不動**：
//   onnxruntime-web 1.23 的 wasm EP 沒有 ConvInteger 的實作（patch embedding 的
//   Conv 被量化成 ConvInteger 就整個 session 建不起來）：
//       Could not find an implementation for ConvInteger(10) node ...
//   因此前端必須用 fp32。實測在 Chrome 裡建立 session 只要 133 ms，可以接受。
//   想再縮小體積的話，正確方向是「不要把 Conv 量化」（見 tools/recognize/README.md）。
//
// 取樣策略（與建立嵌入庫時完全相同，否則查詢與庫會對不上）：
//   3 個裁切（整張 + 偏左 + 偏右）× 水平翻轉 = 6 次前視，平均後再正規化。

import { dinoTensor, dinoTensorFromRect, flipTensor, DINO_SIZE } from "./preprocess.js";

export const DEFAULT_DINO = "models/dinov2-vits14-336.onnx";

export function l2norm(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const n = Math.sqrt(s) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

export const dot = (a, b) => {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
};

export async function createEncoder(ort, modelUrl, { size = DINO_SIZE } = {}) {
  const t0 = performance.now();
  const res = await fetch(modelUrl);
  if (!res.ok) throw new Error(`模型下載失敗 HTTP ${res.status}：${modelUrl}`);
  const buf = await res.arrayBuffer();
  const session = await ort.InferenceSession.create(buf, { executionProviders: ["wasm"] });
  const inName = session.inputNames[0];
  const outName = session.outputNames[0];
  const dim = Number(session.outputMetadata?.[outName]?.dimensions?.at(-1)) || 0;
  return {
    session, inName, outName, size, dim,
    loadMs: performance.now() - t0,
    bytes: buf.byteLength,

    /** 單一 (1,3,size,size) 張量 → 已正規化向量 */
    async forward(tensor) {
      const feeds = { [this.inName]: new ort.Tensor("float32", tensor, [1, 3, this.size, this.size]) };
      const out = await this.session.run(feeds);
      return l2norm(out[this.outName].data);
    },

    /** 一批相同大小的張量（一次 session.run，減少 JS↔wasm 往返） */
    async forwardBatch(tensors) {
      if (!tensors.length) return [];
      const n = tensors.length;
      const flat = new Float32Array(n * 3 * this.size * this.size);
      tensors.forEach((t, i) => flat.set(t, i * 3 * this.size * this.size));
      const feeds = { [this.inName]: new ort.Tensor("float32", flat, [n, 3, this.size, this.size]) };
      const out = await this.session.run(feeds);
      const data = out[this.outName].data;
      const d = out[this.outName].dims.at(-1);
      const vecs = [];
      for (let i = 0; i < n; i++) vecs.push(l2norm(data.subarray(i * d, (i + 1) * d)));
      return vecs;
    },

    /**
     * 對一張圖（或圖上的一個框）取嵌入，含多裁切 + 水平翻轉 TTA。
     * @param {ImageBitmap} bitmap
     * @param {{x,y,w,h}|null} rect  null = 整張圖
     * @param {{crops?:Array, tta?:boolean, onProgress?:Function}} opts
     */
    async embed(bitmap, rect = null, opts = {}) {
      const { crops, tta = true, onProgress } = opts;
      const variants = [];
      if (crops?.length) {
        for (const c of crops) {
          const t = rect ? await dinoTensorFromRect(bitmap, c.rect ?? c, this.size)
                         : await dinoTensor(await cropToBitmap(bitmap, c.rect ?? c), this.size);
          variants.push(t);
        }
      } else {
        variants.push(rect ? await dinoTensorFromRect(bitmap, rect, this.size)
                           : await dinoTensor(bitmap, this.size));
      }
      if (tta) for (const t of [...variants]) variants.push(flipTensor(t, this.size));

      const vecs = await this.forwardBatch(variants);
      const mean = new Float32Array(vecs[0].length);
      for (const v of vecs) for (let i = 0; i < v.length; i++) mean[i] += v[i];
      for (let i = 0; i < mean.length; i++) mean[i] /= vecs.length;
      onProgress?.({ views: variants.length });
      return l2norm(mean);
    },
  };
}

/** 把 bitmap 依 rect 裁成一張新的 bitmap（給整張圖的多裁切用） */
async function cropToBitmap(bitmap, rect) {
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const w = Math.max(1, Math.min(bitmap.width - x, Math.ceil(rect.w)));
  const h = Math.max(1, Math.min(bitmap.height - y, Math.ceil(rect.h)));
  if (x === 0 && y === 0 && w === bitmap.width && h === bitmap.height) return bitmap;
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext("2d").drawImage(bitmap, x, y, w, h, 0, 0, w, h);
  return canvas;
}
