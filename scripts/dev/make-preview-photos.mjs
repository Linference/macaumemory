import puppeteer from "puppeteer-core";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--hide-scrollbars"], defaultViewport: { width: 1500, height: 920 } });
const page = await browser.newPage();
await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => document.querySelector("#boot")?.classList.contains("gone"), { timeout: 90000, polling: 400 });
await wait(6000);
await page.evaluate(() => document.querySelector("#controls").classList.add("open"));
await wait(400);
await page.click("#tg-photos");
await wait(6000);
// ① 大三巴：照片標記 + 景點徽章
await page.evaluate(() => { document.querySelector("#controls").classList.remove("open"); window.__map.jumpTo({ center: [113.54084, 22.19746], zoom: 17, pitch: 55, bearing: -20 }); });
await wait(6000);
await page.screenshot({ path: "preview/41-實景照片圖層.jpg", quality: 82, type: "jpeg" });
console.log("① 照片圖層截圖完成");
// ② 拍下彈窗
const pt = await page.evaluate(() => {
  const m = window.__map;
  const f = m.queryRenderedFeatures({ layers: ["photo-dot"] })[0];
  const p = f ? m.project(f.geometry.coordinates) : null;
  return p ? [Math.round(p.x), Math.round(p.y)] : null;
});
if (pt) {
  await page.mouse.click(pt[0], pt[1] + 16);
  await wait(2600);
  await page.screenshot({ path: "preview/42-照片彈窗.jpg", quality: 82, type: "jpeg" });
  console.log("② 彈窗截圖完成:", await page.evaluate(() => document.querySelector(".photo-pop-cls")?.textContent?.trim()));
  await page.evaluate(() => document.querySelector(".photo-more")?.click());
  await wait(2200);
  await page.screenshot({ path: "preview/43-照片大圖與建築解讀.jpg", quality: 82, type: "jpeg" });
  console.log("③ 大圖截圖完成");
  await page.click("#lb-close");
  await wait(800);
}
// ④ 景點面板相簿
await page.evaluate(() => document.querySelector("#sidebar").classList.add("open"));
await wait(600);
await page.click('.item[data-id="ruins-st-paul"]');
await wait(3000);
await page.screenshot({ path: "preview/44-景點實景照片相簿.jpg", quality: 82, type: "jpeg" });
console.log("④ 相簿截圖完成:", await page.evaluate(() => document.querySelectorAll(".d-photos img").length + " 張"));
await browser.close();
