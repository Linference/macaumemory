// 頁面截圖（S7 用）：地圖首頁（含底部入口）與建築檔案整頁；GPU 無頭 Chrome，1920 寬
// 用法：node capture/pages.mjs（需先開網站 dev server）→ public/pages/*.png + public/pages/layout.json
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const puppeteer = createRequire(import.meta.url)("../../../../node_modules/puppeteer-core");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = process.env.SITE ?? "http://127.0.0.1:5173";
const OUT = path.join(ROOT, "public/pages");
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true,
  args: ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu", "--force_high_performance_gpu"] });
const layout = {};
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.goto(`${SITE}/#13.55/22.1862/113.5515`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__map?.loaded?.() && document.querySelector("#boot")?.classList.contains("gone"), { timeout: 240000, polling: 300 });
  await page.evaluate(() => new Promise((r) => { window.__map.once("idle", r); setTimeout(r, 8000); }));
  await new Promise((r) => setTimeout(r, 1500));
  // 側欄清單收起，讓畫面是地圖 + 頂部徽章 + 底部入口
  await page.evaluate(() => { const s = document.querySelector("#sidebar"); if (s && s.getBoundingClientRect().left >= 0 && s.offsetWidth > 100) document.querySelector("#btn-list")?.click(); });
  await new Promise((r) => setTimeout(r, 1200));
  layout.home = await page.evaluate(() => {
    const a = [...document.querySelectorAll(".site-dock a")].find((x) => x.textContent.includes("建築檔案"));
    const b = a.getBoundingClientRect();
    return { archiveLink: { x: b.x, y: b.y, w: b.width, h: b.height } };
  });
  await page.screenshot({ path: path.join(OUT, "home.png") });

  await page.goto(`${SITE}/archive.html`, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  // 卡片照片是 loading="lazy"，整頁截圖前改成立即載入並等每張圖解碼完成
  await page.evaluate(async () => {
    const imgs = [...document.images];
    imgs.forEach((i) => { i.loading = "eager"; });
    await Promise.all(imgs.map((i) => (i.complete && i.naturalWidth ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
    await Promise.all(imgs.map((i) => i.decode().catch(() => {})));
    // 只有公開授權（Wikimedia CC / CC0 / 公有領域）的照片可出現在影片裡；其餘（如使用者提供、限內部評測）模糊處理
    const gj = await fetch("./data/places.geojson").then((r) => r.json());
    const ok = new Set();
    for (const f of gj.features) for (const ph of f.properties.photos ?? [])
      if (ph.source === "wikimedia_commons" && /^(CC BY|CC0|Public domain)/i.test(ph.license ?? "")) ok.add(ph.file.split("/").pop());
    for (const i of imgs) if (/photos\//.test(i.src) && !ok.has(i.src.split("/").pop().split("?")[0])) i.style.filter = "blur(16px) brightness(0.7)";
  });
  await new Promise((r) => setTimeout(r, 1500));
  layout.archive = await page.evaluate(() => {
    const box = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y + scrollY, w: b.width, h: b.height }; };
    const cards = [...document.querySelectorAll(".archive-card")].slice(0, 6).map((e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y + scrollY, w: b.width, h: b.height }; });
    return { pageH: document.documentElement.scrollHeight, nav: box(".site-nav"), tabs: box(".archive-tabs"), search: box("#archive-search"), cards, ledger: box("#rc-ledger") };
  });
  await page.screenshot({ path: path.join(OUT, "archive-full.png"), fullPage: true });
} finally { await browser.close(); }
fs.writeFileSync(path.join(OUT, "layout.json"), JSON.stringify(layout, null, 1));
console.log(JSON.stringify(layout).slice(0, 400));
