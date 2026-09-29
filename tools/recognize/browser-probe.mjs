// recognize.html 的即時診斷：開頁後每隔一段時間把 window.__recognize.diag 與 console 全部印出來。
// 用途：當模型在瀏覽器裡載入不起來時，這支會直接告訴我們卡在哪一步。
//
// 用法：node tools/recognize/browser-probe.mjs [--seconds 90] [--url ...]
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";

const args = process.argv.slice(2);
const getArg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const URL_ = getArg("--url", "http://127.0.0.1:5173/recognize.html");
const CHROME = getArg("--chrome", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
const SECONDS = Number(getArg("--seconds", "90"));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "shell",
  protocolTimeout: 900000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=swiftshader"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
page.on("console", (m) => console.log(`  [console.${m.type()}] ${m.text().slice(0, 400)}`));
page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message.slice(0, 600)}`));
page.on("requestfailed", (r) => console.log(`  [requestfailed] ${r.url().slice(0, 160)} :: ${r.failure()?.errorText}`));
page.on("response", (r) => {
  const u = r.url();
  if (r.status() >= 400 || /\.onnx|ort-|ort\.|memory-embeddings/.test(u)) {
    console.log(`  [response ${r.status()}] ${u.slice(0, 170)}`);
  }
});

console.log(`→ ${URL_}`);
await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 120000 });

const t0 = Date.now();
let last = "";
while ((Date.now() - t0) / 1000 < SECONDS) {
  await new Promise((r) => setTimeout(r, 5000));
  let snap;
  try {
    snap = await page.evaluate(() => {
      const r = window.__recognize;
      return {
        hasGlobal: !!r,
        diag: r ? JSON.parse(JSON.stringify({
          ort: r.diag.ort, threads: r.diag.threads,
          yolo: { state: r.diag.yolo.state, bytes: r.diag.yolo.bytes, loadMs: r.diag.yolo.loadMs, error: r.diag.yolo.error },
          dino: { state: r.diag.dino.state, bytes: r.diag.dino.bytes, loadMs: r.diag.dino.loadMs, error: r.diag.dino.error },
          lib: { state: r.diag.lib.state, count: r.diag.lib.count, photos: r.diag.lib.photos, error: r.diag.lib.error },
        })) : null,
        stage: document.querySelector("#rc-stage")?.textContent,
        overlay: document.querySelector("#rc-overlay") && !document.querySelector("#rc-overlay").hidden,
        errors: [...document.querySelectorAll(".rc-error")].map((e) => e.textContent.slice(0, 400)),
        diagSummary: document.querySelector("#rc-diag-summary")?.textContent,
        perf: performance.getEntriesByType("resource")
          .filter((e) => /onnx|ort|embeddings/.test(e.name))
          .map((e) => `${e.name.split("/").pop()} ${(e.transferSize / 1048576).toFixed(1)}MB ${Math.round(e.duration)}ms`),
      };
    });
  } catch (e) {
    console.log(`  [eval 失敗] ${e.message.slice(0, 200)}`);
    continue;
  }
  const line = JSON.stringify(snap);
  if (line !== last) {
    console.log(`  t+${((Date.now() - t0) / 1000).toFixed(0)}s ${JSON.stringify(snap.diag)}`);
    if (snap.stage) console.log(`       stage: ${snap.stage}`);
    if (snap.errors?.length) console.log(`       !! 錯誤區塊: ${snap.errors.join(" | ")}`);
    if (snap.perf?.length) console.log(`       資源: ${snap.perf.join(" · ")}`);
    last = line;
  }
  if (snap.diag && ["就緒", "失敗"].includes(snap.diag.yolo.state) && ["就緒", "失敗"].includes(snap.diag.dino.state)
      && ["就緒", "失敗"].includes(snap.diag.lib.state)) {
    console.log("  → 三個元件都已結束（就緒或失敗），停止觀察");
    break;
  }
}
await page.screenshot({ path: resolve(import.meta.dirname, "out", "browser-probe.png") });
console.log("→ 截圖 tools/recognize/out/browser-probe.png");
await browser.close();
