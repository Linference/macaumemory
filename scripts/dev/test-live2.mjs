import puppeteer from "puppeteer-core";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--hide-scrollbars"], defaultViewport: { width: 1500, height: 920 } });
const page = await browser.newPage();
const errs = [], bad = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 140)));
page.on("response", (r) => { const u = r.url(); if (r.status() >= 400 && !/\/dem\//.test(u)) bad.push(`${r.status()} ${u.replace("https://linference.github.io/macaumemory", "").slice(0, 60)}`); });
await page.goto("https://linference.github.io/macaumemory/", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => document.querySelector("#boot")?.classList.contains("gone"), { timeout: 90000, polling: 400 });
await wait(12000);
await page.evaluate(() => window.__map.jumpTo({ center: [113.5412, 22.1975], zoom: 16.2, pitch: 62, bearing: -18 }));
await wait(9000);
const r = await page.evaluate(() => {
  const m = window.__map;
  return {
    title: document.title,
    buildings: m.queryRenderedFeatures({ layers: ["buildings"] }).length,
    markers: document.querySelectorAll(".marker").length,
    labels: document.querySelectorAll(".map-label").length,
    aiButton: !!document.querySelector("#ai-fab"),
    busLayer: !!m.getLayer("bus-stop"),
    terrainElev: +(m.queryTerrainElevation({ lng: 113.5412, lat: 22.1975 }) ?? 0).toFixed(1),
    navAvailable: !!document.querySelector("#navbar"),
  };
});
console.log("🌐 線上站台:", JSON.stringify(r));
console.log("非地形 404:", bad.length ? [...new Set(bad)].slice(0, 4).join(" | ") : "（無）");
console.log("錯誤:", errs.length ? errs.join(" | ") : "（無）");
await page.screenshot({ path: "preview/35-線上最終驗證.jpg", quality: 82, type: "jpeg" });
await browser.close();
