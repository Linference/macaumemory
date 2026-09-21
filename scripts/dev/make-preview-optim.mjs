import puppeteer from "puppeteer-core";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--hide-scrollbars"], defaultViewport: { width: 1600, height: 940 } });
const page = await browser.newPage();
await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => document.querySelector("#boot")?.classList.contains("gone"), { timeout: 90000, polling: 400 });
await wait(7000);
await page.evaluate(() => { document.querySelector("#sidebar").classList.remove("open"); document.querySelector("#controls").classList.toggle("open", true); });
await wait(800);
// 1) 半島：標籤 + POI
await page.evaluate(() => window.__map.jumpTo({ center: [113.5455, 22.1975], zoom: 15.4, pitch: 55, bearing: -18 }));
await wait(6000);
await page.screenshot({ path: "preview/18-地名標籤與周邊設施.png" });
// 2) 全澳：標記去雜亂
await page.evaluate(() => window.__map.jumpTo({ center: [113.5560, 22.1660], zoom: 12.4, pitch: 55, bearing: -8 }));
await wait(6000);
await page.screenshot({ path: "preview/19-低縮放標記去雜亂.png" });
// 3) 路環：等高線 + 標籤
await page.evaluate(() => { document.querySelector("#controls").classList.add("open"); });
await page.click("#tg-contours");
await wait(7000);
await page.evaluate(() => window.__map.jumpTo({ center: [113.5560, 22.1260], zoom: 14.2, pitch: 60, bearing: 6 }));
await wait(7000);
await page.screenshot({ path: "preview/20-等高線與標籤.png" });
console.log("預覽圖完成");
await browser.close();
