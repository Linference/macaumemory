import puppeteer from "puppeteer-core";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"], defaultViewport: { width: 1400, height: 880 } });
const page = await browser.newPage();
await page.goto("http://127.0.0.1:4173/#16.20/22.17982/113.53680/spot/macau-tower", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => document.querySelector("#boot")?.classList.contains("gone"), { timeout: 90000, polling: 400 });
await wait(7000);
const r = await page.evaluate(() => ({
  center: window.__map.getCenter().toArray().map((v) => +v.toFixed(4)),
  zoom: +window.__map.getZoom().toFixed(2),
  pitch: Math.round(window.__map.getPitch()),
  detailOpen: document.querySelector("#detail")?.classList.contains("open"),
  title: document.querySelector(".d-title")?.textContent ?? null,
  hash: location.hash,
  hasModelBtn: !!document.querySelector('#detail-body [data-act="model"]'),
}));
console.log("深連結開啟 澳門旅遊塔:", JSON.stringify(r));
await page.screenshot({ path: "preview/17-深連結還原.png" });
await browser.close();
