// 單獨測 YOLO Worker：直接建立 worker、送 init、把每個訊息都印出來。
// 用來分辨「worker 沒啟動」「ORT 載入失敗」「模型下載慢」「偵測當掉」。
//
// 用法：node tools/recognize/probe-yolo.mjs
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL_ = "http://127.0.0.1:5173/recognize.html";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "shell",
  protocolTimeout: 900000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage();
page.on("console", (m) => console.log(`  [page.${m.type()}] ${m.text().slice(0, 300)}`));
page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message.slice(0, 300)}`));
page.on("requestfailed", (r) => console.log(`  [requestfailed] ${r.url().slice(0, 120)} ${r.failure()?.errorText}`));

await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 120000 });

const result = await page.evaluate(async () => {
  const log = [];
  return await new Promise((resolve) => {
    // 在頁面裡開一個「內嵌 worker」，它把收到的程式碼當 module 跑 —— 這樣就能在
    // worker 裡 console.log/onerror，全部回流到頁面 console（外部 worker 的 console
    // 在 headless shell 裡看不到）。第一階段只做「載入 + 回報」，不碰 ORT。
    const src = `
      const post = (o) => self.postMessage(o);
      const ABS = new URL("src/recognize/", self.location.href).href;
      self.addEventListener("error", (e) => post({ t: 0, type: "error", message: "worker onerror: " + (e.message || "?") }));
      self.addEventListener("message", async (ev) => {
        const m = ev.data ?? {};
        if (m.type !== "init") return;
        post({ t: 0, type: "step", text: "收到 init" });
        try {
          post({ t: 0, type: "step", text: "開始 import detector.js" });
          const { createDetector } = await import(ABS + "detector.js");
          post({ t: 0, type: "step", text: "detector.js 載入完成" });
          post({ t: 0, type: "step", text: "開始 import ort" });
          const ort = await import(ABS + "ort/ort.wasm.min.mjs");
          post({ t: 0, type: "step", text: "ort 載入完成 " + (ort.env?.versions?.web ?? "?") });
          ort.env.wasm.numThreads = 1;
          ort.env.wasm.simd = true;
          ort.env.wasm.wasmPaths = new URL("ort/", self.location.href).href;
          post({ t: 0, type: "step", text: "開始下載模型 " + m.model });
          const t0 = performance.now();
          const res = await fetch(m.model);
          post({ t: 0, type: "step", text: "模型 HTTP " + res.status + "（" + Math.round(performance.now()-t0) + "ms）" });
          const buf = await res.arrayBuffer();
          post({ t: 0, type: "step", text: "模型 bytes " + buf.byteLength });
          const t1 = performance.now();
          const sess = await ort.InferenceSession.create(buf, { executionProviders: ["wasm"] });
          post({ t: 0, type: "step", text: "session 建好 " + Math.round(performance.now()-t1) + "ms，開始跑一次推論" });
          const SZ = 768;
          const inp = new Float32Array(3 * SZ * SZ);
          const t2 = performance.now();
          const out = await sess.run({ [sess.inputNames[0]]: new ort.Tensor("float32", inp, [1, 3, SZ, SZ]) });
          const o = out[sess.outputNames[0]];
          post({ t: 0, type: "ready", info: { bytes: buf.byteLength, loadMs: Math.round(performance.now()-t1), inferMs: Math.round(performance.now()-t2), dims: o.dims, ort: ort.env.versions?.web } });
        } catch (e) {
          post({ t: 0, type: "error", message: String(e && e.message || e).slice(0, 400) });
        }
      });
    `;
    const blob = new Blob([src], { type: "text/javascript" });
    const w = new Worker(URL.createObjectURL(blob), { type: "module" });
    const t0 = performance.now();
    w.addEventListener("message", (ev) => {
      const m = ev.data ?? {};
      log.push({ t: Math.round(performance.now() - t0), type: m.type, text: m.text, info: m.info, error: m.message });
      if (m.type === "ready" || m.type === "error") {
        w.terminate();
        resolve({ ok: m.type === "ready", log });
      }
    });
    w.addEventListener("error", (e) => {
      log.push({ t: Math.round(performance.now() - t0), type: "workererror", error: e.message });
      resolve({ ok: false, log, fatal: `worker error: ${e.message}` });
    });
    const base = new URL("./", document.baseURI).href;
    w.postMessage({ type: "init", model: `${base}models/macau-buildings-yolo.onnx`, base });
    setTimeout(() => { log.push({ t: Math.round(performance.now() - t0), type: "timeout" }); w.terminate(); resolve({ ok: false, log, fatal: "120 秒內沒有 ready/error" }); }, 120000);
  });
});

console.log(JSON.stringify(result, null, 1));
await browser.close();
