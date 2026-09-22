import puppeteer from "puppeteer-core";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--hide-scrollbars"], defaultViewport: { width: 1400, height: 880 } });
const page = await browser.newPage();
const bad = [], errs = [];
page.on("response", (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url().replace("http://127.0.0.1:4321", "")}`); });
page.on("pageerror", (e) => errs.push(e.message.slice(0, 140)));
await page.goto("http://127.0.0.1:4321/macaumemory/", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => document.querySelector("#boot")?.classList.contains("gone"), { timeout: 90000, polling: 400 });
await wait(9000);
const r = await page.evaluate(() => {
  const m = window.__map;
  return {
    buildings: m.queryRenderedFeatures({ layers: ["buildings"] }).length,
    markers: document.querySelectorAll(".marker").length,
    labels: document.querySelectorAll(".map-label").length,
    terrain: !!m.getTerrain(),
    style: m.getStyle().sources.dem.tiles[0],
  };
});
console.log("子路徑 /macaumemory/ :", JSON.stringify(r));
console.log("404 請求:", bad.length ? bad.slice(0, 5).join(" | ") : "（無）");
console.log("錯誤:", errs.length ? errs.join(" | ") : "（無）");
await browser.close();
