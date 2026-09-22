import puppeteer from "puppeteer-core";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--hide-scrollbars"], defaultViewport: { width: 1500, height: 920 } });
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 120)));
await page.goto("https://linference.github.io/macaumemory/", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => document.querySelector("#boot")?.classList.contains("gone"), { timeout: 90000, polling: 400 });
await wait(11000);
const r = await page.evaluate(() => {
  const m = window.__map;
  return {
    url: location.href,
    title: document.title,
    buildings: m.queryRenderedFeatures({ layers: ["buildings"] }).length,
    markers: document.querySelectorAll(".marker").length,
    labels: document.querySelectorAll(".map-label").length,
    digitalHuman: !!document.querySelector("#dh-canvas"),
    aiButton: !!document.querySelector("#ai-fab"),
    busLayer: !!m.getLayer("bus-stop"),
    nav: !!document.querySelector("#navbar"),
    terrain: +(m.queryTerrainElevation({ lng: 113.5412, lat: 22.1975 }) ?? 0).toFixed(1),
  };
});
console.log("線上檢查:", JSON.stringify(r, null, 1));
console.log("錯誤:", errs.length ? errs.join(" | ") : "（無）");
await page.screenshot({ path: "preview/39-線上最新版.jpg", quality: 82, type: "jpeg" });
await browser.close();
