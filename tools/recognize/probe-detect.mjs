// 在瀏覽器裡測 YOLO 偵測，用「真的實拍照片」（photos-src/cc 的開放授權照片）。
// 會把偵測框畫出來存成 PNG，可直接肉眼確認框對不對。
//
// 用法：node tools/recognize/probe-detect.mjs [--port 5173]
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const args = process.argv.slice(2);
const getArg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PORT = getArg("--port", "5173");
const PHOTO_PORT = getArg("--photo-port", "5180");
const OUT = resolve(import.meta.dirname, "out");
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "shell", protocolTimeout: 900000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log(`  [err] ${m.text().slice(0, 200)}`); });
await page.goto(`http://127.0.0.1:${PORT}/recognize.html`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => window.__recognize?.diag?.yolo?.state === "就緒"
  && window.__recognize?.diag?.dino?.state === "就緒", { timeout: 300000, polling: 1000 });
console.log("✓ 模型就緒\n");

const CASES = [
  ["photos-src/cc/ruins-st-paul/Ruins_of_Saint_Paul_s_Macau_Ank_Kumar_01.jpg", "大三巴牌坊（實拍・預期 monument 高信心）"],
  ["photos-src/cc/moorish-barracks/Moorish_Barracks.jpg", "港務局大樓（實拍・預期 portuguese 高信心）"],
  ["photos-src/cc/a-ma-temple/A-Ma_Temple_Macau_built_1488_2_32043656663_.jpg", "媽閣廟（實拍・預期 temple）"],
  ["photos-src/cc/the-venetian/Venetian_Macau.jpg", "澳門威尼斯人（實拍・夜拍）"],
  ["photos-src/demo/大三巴牌坊-demo.jpg", "大三巴牌坊（3D 截圖・白底，已知偵測器弱項）"],
];

for (const [rel, label] of CASES) {
  const r = await page.evaluate(async ({ rel, photoPort }) => {
    // 直接從 photo-server 取真實照片（photos-src 不在 Vite 的 public/ 底下）
    const url = `http://127.0.0.1:${photoPort}/${rel.split("/").map(encodeURIComponent).join("/")}`;
    const resp = await fetch(url);
    if (!resp.ok) return { error: `取不到照片 HTTP ${resp.status}：${url}` };
    const blob = await resp.blob();
    if (!/^image\//.test(blob.type)) return { error: `不是圖片（Content-Type=${blob.type}，可能是伺服器回傳 HTML）` };
    const bmp = await createImageBitmap(blob);
    const ort = await import("/src/recognize/ort/ort.wasm.min.mjs");
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = new URL("ort/", document.baseURI).href;
    const { createDetector } = await import("/src/recognize/detector.js");
    const { CLASS_NAMES } = await import("/src/recognize/labels.js");
    const det = await createDetector(ort, new URL("models/macau-buildings-yolo.onnx", document.baseURI).href,
      { input: 768, names: CLASS_NAMES });
    const t0 = performance.now();
    const out = await det.detect(bmp, { conf: 0.25, iouThr: 0.45 });
    const ms = Math.round(performance.now() - t0);
    const c = document.createElement("canvas");
    const s = Math.min(1, 880 / bmp.width);
    c.width = Math.round(bmp.width * s);
    c.height = Math.round(bmp.height * s);
    const ctx = c.getContext("2d");
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    ctx.lineWidth = 3;
    ctx.font = "bold 20px sans-serif";
    for (const d of out.detections) {
      ctx.strokeStyle = "#d8b45a";
      ctx.strokeRect(d.x * s, d.y * s, d.w * s, d.h * s);
      ctx.fillStyle = "#0a0e13";
      const txt = `${d.cls} ${(d.score * 100).toFixed(0)}%`;
      ctx.fillStyle = "#d8b45a";
      ctx.fillRect(d.x * s, Math.max(0, d.y * s - 24), ctx.measureText(txt).width + 10, 24);
      ctx.fillStyle = "#0a0e13";
      ctx.fillText(txt, d.x * s + 5, Math.max(18, d.y * s - 6));
    }
    return {
      size: `${bmp.width}×${bmp.height}`, candidates: out.candidates, ms, n: out.detections.length,
      dets: out.detections.slice(0, 6).map((d) => `${d.cls} ${d.score.toFixed(3)} @ ${Math.round(d.x)},${Math.round(d.y)} ${Math.round(d.w)}×${Math.round(d.h)}`),
      png: c.toDataURL("image/png"),
    };
  }, { rel, photoPort: PHOTO_PORT }).catch((e) => ({ error: e.message.slice(0, 300) }));

  if (r.error) { console.log(`${label}\n  !! ${r.error}\n`); continue; }
  console.log(`${label}  ${r.size} · 候選 ${r.candidates} · ${r.ms}ms · 框 ${r.n} 個`);
  for (const d of r.dets) console.log(`   · ${d}`);
  writeFileSync(resolve(OUT, `detect-${label.replace(/[（）\s]/g, "_").replace(/[^\w\u4e00-\u9fa5_-]/g, "")}.png`),
    Buffer.from(r.png.split(",")[1], "base64"));
  console.log("");
}

await browser.close();
