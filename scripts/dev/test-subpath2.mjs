import puppeteer from "puppeteer-core";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"], defaultViewport: { width: 1400, height: 880 } });
const page = await browser.newPage();
await page.goto("http://127.0.0.1:4321/macaumemory/", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => document.querySelector("#boot")?.classList.contains("gone"), { timeout: 90000, polling: 400 });
await wait(6000);
// 飛到半島市區再檢查建築
await page.evaluate(() => window.__map.jumpTo({ center: [113.5412, 22.1975], zoom: 16.4, pitch: 65, bearing: 0 }));
await wait(9000);
const r = await page.evaluate(() => {
  const m = window.__map;
  return {
    buildingsLoaded: m.isSourceLoaded("buildings"),
    rendered: m.queryRenderedFeatures({ layers: ["buildings"] }).length,
    roads: m.queryRenderedFeatures({ layers: ["road"] }).length,
    terrain: !!m.getTerrain(),
    elev: m.queryTerrainElevation({ lng: 113.5412, lat: 22.1975 }),
  };
});
console.log("子路徑 3D 建築檢查:", JSON.stringify(r));
await page.screenshot({ path: "preview/30-子路徑部署驗證.jpg", quality: 80, type: "jpeg" });
await browser.close();
