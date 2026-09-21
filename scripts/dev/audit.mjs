import puppeteer from "puppeteer-core";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"], defaultViewport: { width: 1500, height: 920 } });
const page = await browser.newPage();
const bytes = { js: 0, css: 0, geojson: 0, dem: 0, model: 0, other: 0 };
page.on("response", async (r) => {
  try {
    const u = r.url();
    const len = Number(r.headers()["content-length"] ?? 0);
    if (/\.js(\?|$)/.test(u)) bytes.js += len;
    else if (/\.css(\?|$)/.test(u)) bytes.css += len;
    else if (/\.geojson/.test(u)) bytes.geojson += len;
    else if (/\/dem\//.test(u)) bytes.dem += len;
    else if (/\.glb/.test(u)) bytes.model += len;
    else bytes.other += len;
  } catch {}
});
const t0 = Date.now();
await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => document.querySelector("#boot")?.classList.contains("gone"), { timeout: 90000, polling: 300 });
const readyMs = Date.now() - t0;
await wait(8000);
const perf = await page.evaluate(() => {
  const nav = performance.getEntriesByType("navigation")[0];
  const res = performance.getEntriesByType("resource");
  const byType = (re) => res.filter((e) => re.test(e.name)).reduce((s, e) => s + (e.transferSize || 0), 0);
  return {
    domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
    loadEvent: Math.round(nav.loadEventEnd),
    resources: res.length,
    transferredMB: +(res.reduce((s, e) => s + (e.transferSize || 0), 0) / 1048576).toFixed(2),
    geojsonMB: +(byType(/geojson/).toFixed(1) / 1048576).toFixed(2),
    demMB: +(byType(/\/dem\//).toFixed(1) / 1048576).toFixed(2),
    jsMB: +(byType(/\.js/).toFixed(1) / 1048576).toFixed(2),
    markers: document.querySelectorAll(".marker").length,
  };
});
// 標記重疊檢查（不同縮放）
const overlap = await page.evaluate(() => {
  const m = window.__map;
  const out = {};
  for (const z of [12, 13, 14]) {
    m.jumpTo({ center: [113.556, 22.166], zoom: z, pitch: 45, bearing: 0 });
    m._render?.();
    const boxes = [...document.querySelectorAll(".marker")].map((el) => el.getBoundingClientRect()).filter((b) => b.width);
    let hits = 0;
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (Math.abs(a.x - b.x) < 22 && Math.abs(a.y - b.y) < 22) hits++;
    }
    out["z" + z] = { visible: boxes.length, overlappingPairs: hits };
  }
  return out;
});
console.log("首次就緒時間:", readyMs, "ms");
console.log("效能指標:", JSON.stringify(perf));
console.log("標記重疊:", JSON.stringify(overlap));
await browser.close();

