// 逐步二分：到底是「module worker」壞、還是「worker 檔裡的某一行」壞。
//
// 比對三個 worker：
//   A. 最小 module worker（_probe.worker.js，只 import ORT 並載入模型）
//   B. 完全不 import 的內嵌 worker（只用 postMessage 回話）
//   C. 真正的 yolo.worker.js
// 每一個都完整記錄「boot / 回應 / 錯誤」，這樣就能定位問題在哪一層。
//
// 用法：node tools/recognize/worker-bisect.mjs
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
page.on("console", (m) => console.log(`  [page.${m.type()}] ${m.text().slice(0, 200)}`));
page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message.slice(0, 200)}`));
await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 120000 });

const result = await page.evaluate(async () => {
  const base = new URL("./", document.baseURI).href;
  const model = `${base}models/macau-buildings-yolo.onnx`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function run(label, factory, msg, waitMs) {
    const log = [];
    let w;
    try { w = factory(); } catch (e) { return { label, log: [`new Worker 失敗：${e.message}`] }; }
    w.addEventListener("message", (ev) => log.push(`MSG ${JSON.stringify(ev.data).slice(0, 220)}`));
    w.addEventListener("error", (e) => log.push(`ERROR ${e.message || "(無訊息)"} @${e.filename ?? "?"}:${e.lineno ?? "?"}`));
    w.addEventListener("messageerror", (e) => log.push(`MESSAGEERROR ${String(e.data).slice(0, 160)}`));
    await sleep(600);                       // 讓 boot 訊息先出來
    if (msg) w.postMessage(msg);
    const t0 = Date.now();
    while (Date.now() - t0 < waitMs && !log.some((s) => /pong|loaded|failed|ready|"type":"error"/.test(s))) await sleep(400);
    try { w.terminate(); } catch { /* ignore */ }
    return { label, log };
  }

  const out = [];

  // A. 最小 module worker
  out.push(await run("A. 最小 module worker（_probe.worker.js）",
    () => new Worker(new URL("src/recognize/_probe.worker.js", document.baseURI).href, { type: "module" }),
    { type: "ping", model, base }, 60000));

  // B. 內嵌 module worker（不 import 任何東西）
  const inlineSrc = `
    self.postMessage({ type: "boot" });
    self.addEventListener("message", (e) => self.postMessage({ type: "pong", got: e.data?.type }));
  `;
  out.push(await run("B. 內嵌 module worker（無 import）",
    () => new Worker(URL.createObjectURL(new Blob([inlineSrc], { type: "text/javascript" })), { type: "module" }),
    { type: "ping" }, 8000));

  // C. 真正的 yolo.worker.js
  out.push(await run("C. yolo.worker.js",
    () => new Worker(new URL("src/recognize/yolo.worker.js", document.baseURI).href, { type: "module" }),
    { type: "init", model, base }, 60000));

  return out;
});

for (const r of result) {
  console.log(`\n${r.label}`);
  if (!r.log.length) console.log("  （完全沒有任何訊息）");
  for (const l of r.log) console.log(`  · ${l}`);
}
await browser.close();
