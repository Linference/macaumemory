// 用 puppeteer 的 WebWorker API 直接在真正的 yolo.worker.js 裡求值。
//
// 用途：module worker 的載入期例外不會冒泡到頁面，主執行緒只看到「永遠沒回應」。
// 這支把 worker 內部的全域狀態、錯誤、以及每一步的結果直接抓出來。
//
// 用法：node tools/recognize/worker-eval-probe.mjs
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
page.on("console", (m) => console.log(`  [page.${m.type()}] ${m.text().slice(0, 240)}`));
page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message.slice(0, 240)}`));

const workerSeen = [];
page.on("workercreated", (w) => {
  console.log(`  [workercreated] ${w.url().slice(0, 120)}`);
  workerSeen.push(w);
  w.on("close", () => console.log(`  [worker closed] ${w.url().slice(0, 100)}`));
});

console.log(`→ 開啟 ${URL_}`);
await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 120000 });
await new Promise((r) => setTimeout(r, 6000));

const workers = page.workers();
console.log(`\n頁面上有 ${workers.length} 個 worker：`);
for (const w of workers) console.log(`  · ${w.url().slice(0, 120)}`);

for (const w of workers) {
  if (!/yolo\.worker/.test(w.url())) continue;
  console.log(`\n→ 在 ${w.url().split("/").pop()} 內求值：`);
  const probe = await w.evaluate(() => {
    const out = { loc: String(self.location?.href), proto: self.location?.protocol };
    try {
      out.ortDirFromSelf = new URL("ort/", self.location.href).href;
    } catch (e) { out.ortDirFromSelf = `ERR ${e.message}`; }
    out.ortDirFromAbs = (() => { try { return new URL("ort/", "http://127.0.0.1:5173/").href; } catch (e) { return `ERR ${e.message}`; } })();
    try {
      out.detectorPresent = typeof detector !== "undefined" ? !!detector : "no binding";
      out.failed = typeof failed !== "undefined" ? failed : "no binding";
      out.ortDir = typeof ORT_DIR !== "undefined" ? ORT_DIR : "no binding";
    } catch (e) { out.bindings = `ERR ${e.message}`; }
    return out;
  }).catch((e) => ({ evalError: e.message.slice(0, 300) }));
  console.log("  " + JSON.stringify(probe, null, 2).replace(/\n/g, "\n  "));

  // 直接在 worker 內「自己再跑一次 init 流程」，看它在哪一步失敗
  console.log("\n→ 在 worker 內逐步重跑載入流程（繞過 worker 自己的 init）：");
  const steps = await w.evaluate(async () => {
    const log = [];
    const push = (s) => log.push(s);
    try {
      push(`location = ${self.location.href}`);
      const ort = await import("./ort/ort.wasm.min.mjs");
      push(`ort 載入 OK · versions=${JSON.stringify(ort.env?.versions ?? null)} · wasmPaths=${ort.env?.wasm?.wasmPaths ?? "(未設)"}`);
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.simd = true;
      const dir = new URL("ort/", "http://127.0.0.1:5173/").href;
      ort.env.wasm.wasmPaths = dir;
      push(`wasmPaths 設為 ${dir}`);
      const t0 = performance.now();
      const res = await fetch("http://127.0.0.1:5173/models/macau-buildings-yolo.onnx");
      push(`fetch 模型 HTTP ${res.status}（${Math.round(performance.now() - t0)}ms）`);
      const buf = await res.arrayBuffer();
      push(`模型 ${(buf.byteLength / 1048576).toFixed(1)} MB`);
      const t1 = performance.now();
      const sess = await ort.InferenceSession.create(buf, { executionProviders: ["wasm"] });
      push(`session OK（${Math.round(performance.now() - t1)}ms）inputs=${sess.inputNames}`);
      const SZ = 768;
      const t2 = performance.now();
      const out = await sess.run({ [sess.inputNames[0]]: new ort.Tensor("float32", new Float32Array(3 * SZ * SZ), [1, 3, SZ, SZ]) });
      const o = out[sess.outputNames[0]];
      push(`推論 OK（${Math.round(performance.now() - t2)}ms）dims=${JSON.stringify(o.dims)}`);
    } catch (e) {
      push(`!! 失敗：${e?.name ?? ""} ${e?.message ?? e}`);
    }
    return log;
  }).catch((e) => [`evaluate 失敗：${e.message.slice(0, 300)}`]);
  for (const s of steps) console.log(`  · ${s}`);

  // 真正的問題：worker 模組自己有沒有載入成功？用動態 import 再載入一次同一支模組
  console.log("\n→ 在 worker 內「重新載入 yolo.worker.js 模組本身」看它拋什麼錯：");
  const modTest = await w.evaluate(async () => {
    const out = [];
    try {
      const m = await import("./yolo.worker.js?probe=1");
      out.push(`模組載入 OK，exports = ${JSON.stringify(Object.keys(m))}`);
    } catch (e) {
      out.push(`!! 模組載入失敗：${e?.name ?? ""} ${e?.message ?? e}`);
      if (e?.stack) out.push(String(e.stack).split("\n").slice(0, 6).join(" | "));
    }
    return out;
  }).catch((e) => [`evaluate 失敗：${e.message.slice(0, 300)}`]);
  for (const s of modTest) console.log(`  · ${s}`);
}

await browser.close();
