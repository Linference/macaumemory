import puppeteer from "puppeteer-core";
import { asciiPreview, analyze } from "./imgutil.mjs";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--hide-scrollbars"], defaultViewport: { width: 1400, height: 860 } });
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error") errs.push("[console] " + m.text().slice(0, 160)); });
await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForFunction(() => document.querySelector("#boot")?.classList.contains("gone"), { timeout: 90000, polling: 400 });
await wait(4000);
// 關閉側欄，讓地圖完整呈現
await page.evaluate(() => { document.querySelector("#sidebar").classList.remove("open"); document.querySelector("#controls").classList.remove("open"); });

async function look(name, cam, extra = {}) {
  await page.evaluate((c) => window.__map.jumpTo(c), cam);
  await page.waitForFunction(() => window.__map.areTilesLoaded() && window.__map.loaded(), { timeout: 60000, polling: 500 }).catch(() => {});
  await wait(extra.wait ?? 5000);
  await page.screenshot({ path: `shots/${name}.png` });
  const info = await page.evaluate(() => {
    const m = window.__map;
    return {
      buildings: m.queryRenderedFeatures({ layers: ["buildings"] }).length,
      roads: m.queryRenderedFeatures({ layers: ["road"] }).length,
      markers: document.querySelectorAll(".marker").length,
      zoom: +m.getZoom().toFixed(2),
      elevAtCenter: +(m.queryTerrainElevation(m.getCenter()) ?? -1).toFixed(1),
    };
  });
  console.log(`\n=== ${name} === ${JSON.stringify(info)} ${JSON.stringify(await analyze(`shots/${name}.png`))}`);
  console.log(await asciiPreview(`shots/${name}.png`, 100, 32));
}

await look("30-peninsula-3d", { center: [113.5412, 22.1975], zoom: 16.4, pitch: 70, bearing: -25 });
await look("31-cotai-3d", { center: [113.5600, 22.1485], zoom: 15.2, pitch: 66, bearing: 30 });
await look("32-coloane-hill", { center: [113.5479, 22.1207], zoom: 15.0, pitch: 72, bearing: 8 });
await look("33-wide", { center: [113.5560, 22.1650], zoom: 13.6, pitch: 62, bearing: -10 });
console.log("\n錯誤:", errs.length ? errs.slice(0, 8).join("\n") : "（無）");
await browser.close();
