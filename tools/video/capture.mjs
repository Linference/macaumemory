/**
 * 逐帧擷取 Canvas 動畫 → PNG 序列（供 ffmpeg 編碼）。
 *
 * 為什麼用「設定 frame 再截圖」而不是錄影：
 *   錄影（screencast）的影格時間不精確，會掉格、會有編碼抖動。
 *   這裡每一帧都由 window.__seek(frame) 明確指定，輸出必然是
 *   0..749 連續且可重現的畫面，這是「絲滑」的前提。
 */
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../../docs/video/_work/innovation-canvas");
const W = 1920, H = 1080;

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
               ".jpg": "image/jpeg", ".png": "image/png" };

/** 極簡靜態伺服器：Puppeteer 不能用 file://（跨域限制會讓 fetch/Image 失敗）。 */
function serve(root, port) {
  const srv = createServer(async (req, res) => {
    try {
      const p = resolve(root, "." + decodeURIComponent((req.url || "/").split("?")[0]));
      if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
      const body = await readFile(p);
      const ext = p.slice(p.lastIndexOf("."));
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end(body);
    } catch { res.writeHead(404).end("not found"); }
  });
  return new Promise(r => srv.listen(port, "127.0.0.1", () => r(srv)));
}

function findChrome() {
  const cands = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].filter(Boolean);
  return cands;
}

const PORT = 4188;
const srv = await serve(HERE, PORT);
// 注意：ESM 沒有 require()，先前誤用導致所有候選路徑都被判為不存在。
const exe = findChrome().find(p => existsSync(p));
if (!exe) { console.error("找不到 Chrome/Edge，請設 CHROME_PATH"); process.exit(1); }

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: exe, headless: "new",
  args: ["--no-sandbox", "--disable-gpu-sandbox", "--force-device-scale-factor=1",
         "--hide-scrollbars", "--disable-lcd-text"],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${PORT}/animation.html`, { waitUntil: "load" });
await page.waitForFunction("window.__ready && window.__ready()", { timeout: 20000 });
const info = await page.evaluate("window.__info()");
console.log(`  動畫資訊：${JSON.stringify(info)}`);

const total = info.frames;
const t0 = Date.now();
for (let i = 0; i < total; i++) {
  await page.evaluate(f => window.__seek(f), i);
  await page.screenshot({ path: resolve(OUT, `${String(i).padStart(4, "0")}.png`),
                          type: "png", optimizeForSpeed: true, captureBeyondViewport: false });
  if (i % 50 === 0) {
    const el = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(`    ${i}/${total} …（${el}s，預估總計 ${Math.round(el / Math.max(1, i) * total)}s）`);
  }
}
console.log(`  ✓ 完成 ${total} 帧 → ${OUT}（${((Date.now() - t0) / 1000).toFixed(0)}s）`);
await browser.close();
srv.close();
