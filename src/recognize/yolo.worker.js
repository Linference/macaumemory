// 澳門記憶 · 建築辨識 Worker（只放 YOLO 偵測）
//
// 為什麼只有 YOLO 在 Worker：
//   YOLO11s(768) 是 31 GFLOPs，在 wasm 上要跑數秒；放主執行緒會讓畫面整個凍住。
//   DINOv2(ViT-S/14, 336) 只有 ~12 GFLOPs，且需要「依 YOLO 框即時裁切」再編碼，
//   留在主執行緒可以省掉把 ImageBitmap 來回搬的成本（我們也不打斷它的工作是關鍵）。
//
// 通訊協定
//   主執行緒 → Worker：{ type:"init", base, model, names } / { type:"detect", id, bitmap, conf, iou }
//   Worker → 主執行緒：{ type:"ready", info } / { type:"detected", id, detections, ... } / { type:"error", ... }

// ---------------------------------------------------------------------------
// 啟動方式（重要）
//
// 這個 worker 不接受「先 postMessage(init) 再開始」的流程。原因：
//   module worker 要先下載並執行完模組（然後才註冊 message 監聽器），
//   而 Vite dev 會把每個 import 拆成獨立請求，模組就緒要幾百毫秒到數秒。
//   在那之前送出的 init 會被**靜默丟棄**（沒有錯誤、沒有事件），主執行緒只會看到
//   「永遠停在未載入」。這是我們實際踩到的坑（見 tools/recognize/page-manual-init.mjs
//   的實測：立即送出 init ×1 → 毫無回應；等 800ms 或重送 → 正常）。
//
// 因此改成：設定全部走 URL query（模組一開始就看得到），worker 自己啟動並回報 ready。
// 主執行緒只要負責監聽（並在逾時後重建 worker）。
// ---------------------------------------------------------------------------

import { createDetector } from "./detector.js";
import { CLASS_NAMES } from "./labels.js";
import * as ort from "./ort/ort.wasm.min.mjs";

const params = new URLSearchParams(self.location.search);
const BASE = params.get("base") || "/";
const MODEL = params.get("model") || new URL("models/macau-buildings-yolo.onnx", new URL(BASE, self.location.href)).href;
const INPUT_SIZE = Number(params.get("imgsz")) || 768;

// ORT 需要「絕對」的 wasmPaths。worker 的 location 在某些情況下不是 http(s)
// （Blob worker 的 self.location.href 是 blob:…，new URL(相對, blob) 會直接丟 TypeError），
// 所以這裡一律用主執行緒從 query 傳進來的 base 組絕對網址。
const ORT_DIR = new URL("ort/", new URL(BASE, self.location.href)).href;

// 單執行緒：wasm 多執行緒需要 SharedArrayBuffer（Cross-Origin-Isolation），
// 本專案也要能部署到 GitHub Pages，不保證能加 COOP/COEP 標頭 → 穩定優先。
ort.env.wasm.numThreads = 1;
ort.env.wasm.simd = true;
ort.env.wasm.wasmPaths = ORT_DIR;
ort.env.logLevel = "error";

let detector = null;
let failed = null;

function describe(e) {
  const msg = e?.message ?? String(e);
  if (/Failed to fetch|NetworkError|HTTP 404/i.test(msg)) return `${msg}（模型檔是否存在的問題，請確認 public/models/ 路徑）`;
  if (/protobuf|INVALID_PROTOBUF|Load model from|Can't create session/i.test(msg)) return `${msg}（ONNX 檔損毀或含不支援的算子）`;
  if (/memory|OOM|allocat/i.test(msg)) return `${msg}（記憶體不足）`;
  return msg;
}

const post = (o) => { try { self.postMessage(o); } catch (e) { console.error("[yolo.worker] postMessage 失敗", e); } };

// 載入期/執行期的錯誤一律回報（否則主執行緒只會看到「永遠沒回應」）
self.addEventListener("error", (e) => post({ type: "error", where: "yolo-worker", message: `worker 執行期錯誤：${e.message || "?"}` }));
self.addEventListener("unhandledrejection", (e) => post({ type: "error", where: "yolo-worker", message: `worker 未處理的 Promise 錯誤：${e.reason?.message ?? e.reason}` }));

// 自主啟動（不依賴任何 postMessage）
(async () => {
  try {
    console.info(`[yolo.worker] 啟動 · base=${BASE} · model=${MODEL} · imgsz=${INPUT_SIZE}`);
    post({ type: "status", stage: "yolo", text: "正在載入 YOLO 建築偵測模型（38 MB，第一次較久）…" });
    detector = await createDetector(ort, MODEL, { input: INPUT_SIZE, names: CLASS_NAMES });
    post({
      type: "ready",
      info: {
        ort: ort.env.versions?.web ?? "unknown",
        bytes: detector.bytes, input: detector.size, loadMs: Math.round(detector.loadMs),
        names: detector.names, wasmPaths: ORT_DIR,
      },
    });
  } catch (e) {
    failed = describe(e);
    console.error("[yolo.worker] 載入失敗", e);
    post({ type: "error", where: "yolo-init", message: failed });
  }
})();

async function detect({ id, bitmap, conf = 0.25, iou = 0.45 }) {
  try {
    if (!detector) throw new Error(failed ? `偵測模型未就緒：${failed}` : "偵測模型尚未載入完成");
    const t0 = performance.now();
    const det = await detector.detect(bitmap, { conf, iouThr: iou });
    post({
      type: "detected", id,
      detections: det.detections.map((d) => ({
        cls: d.cls, clsIndex: d.clsIndex, score: d.score, x: d.x, y: d.y, w: d.w, h: d.h,
      })),
      candidates: det.candidates, channels: det.channels, anchors: det.anchors, inputSize: det.inputSize,
      ms: Math.round(performance.now() - t0),
    });
  } catch (e) {
    post({ type: "error", id, where: "yolo-detect", message: describe(e) });
  }
}

self.addEventListener("message", (ev) => {
  const m = ev.data ?? {};
  console.info("[yolo.worker] 收到訊息:", m.type);
  if (m.type === "detect") detect(m);
  else if (m.type === "ping") post({ type: "pong", ready: !!detector, failed });
  else if (m.type === "init") {
    // 舊介面：若模型已就緒就重送 ready，否則忽略（避免無聲等待）
    if (detector) post({ type: "ready", info: { bytes: detector.bytes, input: detector.size, loadMs: Math.round(detector.loadMs), ort: ort.env.versions?.web } });
  }
});
