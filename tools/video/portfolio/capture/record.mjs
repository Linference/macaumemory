// 逐幀確定性錄製網站真實畫面（GPU 無頭 Chrome，1920×1080）
//   地圖：每幀用 jumpTo 設定相機（緩動曲線），等圖磚與標籤繪製完成才截圖 → 任何渲染速度都是穩定 30fps
//   3DGS：注入「虛擬時鐘」接管 requestAnimationFrame / performance.now，每幀只推進 1/30 秒
// 用法：node capture/record.mjs [clip ...]   （需先 npm run dev 開網站，預設 http://127.0.0.1:5173）
// 輸出：public/footage/<clip>.mp4（幀圖暫存在 out/frames/<clip>/）
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const puppeteer = require("../../../../node_modules/puppeteer-core");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = process.env.SITE ?? "http://127.0.0.1:5173";
const FPS = 30;

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2); // cubic in-out
const lerp = (a, b, t) => a + (b - a) * t;
const camAt = (from, to, t) => {
  const k = ease(t);
  return { center: [lerp(from.center[0], to.center[0], k), lerp(from.center[1], to.center[1], k)], zoom: lerp(from.zoom, to.zoom, k), pitch: lerp(from.pitch, to.pitch, k), bearing: lerp(from.bearing, to.bearing, k) };
};

// 只留地圖（標記與標籤都在 #map 內），網站外框交給影片的動態圖形
const HIDE_MAP_UI = `body > :not(#map){display:none!important}`;
const HIDE_GS_UI = `.site-nav,.gs-intro,.gs-toolbar,.gs-memory-panel,#gs-status,#gs-source,#gs-loading{display:none!important}`;

const CLIPS = {
  "map-establish": { kind: "map", frames: 210, from: { center: [113.5565, 22.1700], zoom: 12.35, pitch: 36, bearing: -38 }, to: { center: [113.5515, 22.1862], zoom: 13.45, pitch: 58, bearing: -10 } },
  "map-dive": { kind: "map", frames: 240, from: { center: [113.5450, 22.1920], zoom: 14.2, pitch: 48, bearing: -24 }, to: { center: [113.5398, 22.1937], zoom: 16.95, pitch: 63, bearing: 16 } },
  "map-orbit-stpaul": { kind: "map", frames: 210, from: { center: [113.5408, 22.1972], zoom: 17.1, pitch: 64, bearing: 8 }, to: { center: [113.5408, 22.1972], zoom: 17.35, pitch: 66, bearing: 98 } },
  "map-cotai": { kind: "map", frames: 210, from: { center: [113.5640, 22.1452], zoom: 15.5, pitch: 58, bearing: -34 }, to: { center: [113.5600, 22.1418], zoom: 16.25, pitch: 62, bearing: 18 } },
  "splat-orbit": { kind: "splat", frames: 300 },
};

async function launch() {
  return puppeteer.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    protocolTimeout: 1200000,
    args: ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu", "--force_high_performance_gpu", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
  });
}

// 虛擬時鐘：enable 後頁面的 rAF 由 step() 逐幀驅動，performance.now / Date.now 只隨 step 前進
const VIRTUAL_CLOCK = () => {
  const realRaf = window.requestAnimationFrame.bind(window);
  const realNow = performance.now.bind(performance), realDate = Date.now;
  let manual = false, now = 0, dateOffset = 0, id = 0;
  const queue = new Map();
  window.__realRaf = realRaf;
  window.__clock = {
    enable() { manual = true; now = realNow(); dateOffset = realDate() - now; },
    step(ms) { now += ms; const cbs = [...queue.values()]; queue.clear(); for (const cb of cbs) cb(now); },
  };
  performance.now = () => (manual ? now : realNow());
  Date.now = () => (manual ? Math.round(now + dateOffset) : realDate());
  window.requestAnimationFrame = (cb) => { if (!manual) return realRaf(cb); queue.set(++id, cb); return id; };
  window.cancelAnimationFrame = (i) => queue.delete(i);
};

const settleMap = (page) => page.evaluate(() => new Promise((resolve) => {
  const m = window.__map;
  const done = () => { clearTimeout(t); resolve(); };
  const t = setTimeout(resolve, 6000);
  m.once("idle", done);
  m.triggerRepaint();
}));

async function recordMap(page, name, clip, dir) {
  await page.goto(`${SITE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__map?.loaded?.() && document.querySelector("#boot")?.classList.contains("gone"), { timeout: 240000, polling: 300 });
  await page.addStyleTag({ content: HIDE_MAP_UI });
  // 先沿路徑稀疏走一遍，讓圖磚、地標模型與標籤都進快取
  for (let i = 0; i <= clip.frames; i += 15) { await page.evaluate((c) => window.__map.jumpTo(c), camAt(clip.from, clip.to, i / clip.frames)); await settleMap(page); }
  for (let i = 0; i < clip.frames; i++) {
    await page.evaluate((c) => window.__map.jumpTo(c), camAt(clip.from, clip.to, i / (clip.frames - 1)));
    await settleMap(page);
    await page.screenshot({ path: path.join(dir, `${String(i).padStart(4, "0")}.jpg`), type: "jpeg", quality: 95 });
    if (i % 30 === 0) console.log(`  ${name} ${i}/${clip.frames}`);
  }
}

async function recordSplat(page, name, clip, dir) {
  await page.evaluateOnNewDocument(VIRTUAL_CLOCK);
  await page.goto(`${SITE}/gaussian.html?scene=ruins-st-paul`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => { const l = document.querySelector("#gs-loading"); return l && (l.hidden || getComputedStyle(l).display === "none") && !document.querySelector("#gs-orbit")?.disabled; }, { timeout: 600000, polling: 500 });
  await page.evaluate(() => { const q = document.querySelector("#gs-quality"); if (q) { q.value = q.options[q.options.length - 1].value; q.dispatchEvent(new Event("change", { bubbles: true })); } });
  await new Promise((r) => setTimeout(r, 3000));
  await page.addStyleTag({ content: HIDE_GS_UI });
  await page.evaluate(() => { window.__clock.enable(); document.querySelector("#gs-orbit").click(); });
  const frame = () => page.evaluate((ms) => new Promise((r) => { window.__clock.step(ms); window.__realRaf(() => window.__realRaf(r)); }), 1000 / FPS);
  for (let i = 0; i < 20; i++) await frame(); // 讓環繞起步的緩動先走完一點
  for (let i = 0; i < clip.frames; i++) {
    await frame();
    await page.screenshot({ path: path.join(dir, `${String(i).padStart(4, "0")}.jpg`), type: "jpeg", quality: 95 });
    if (i % 30 === 0) console.log(`  ${name} ${i}/${clip.frames}`);
  }
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CLIPS);
fs.mkdirSync(path.join(ROOT, "public/footage"), { recursive: true });
for (const name of names) {
  const clip = CLIPS[name] && { ...CLIPS[name], frames: Math.min(CLIPS[name].frames, Number(process.env.LIMIT) || Infinity) };
  if (!clip) throw new Error(`unknown clip ${name}`);
  const dir = path.join(ROOT, "out/frames", name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 160)));
    console.log(`recording ${name} (${clip.frames} frames)`);
    await (clip.kind === "map" ? recordMap : recordSplat)(page, name, clip, dir);
  } finally { await browser.close(); }
  const mp4 = path.join(ROOT, "public/footage", `${name}.mp4`);
  execFileSync(path.join(ROOT, "node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe"), ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(dir, "%04d.jpg"), "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4]);
  console.log(`  → ${path.relative(ROOT, mp4)}`);
}
