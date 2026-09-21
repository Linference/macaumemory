import puppeteer from "puppeteer-core";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--hide-scrollbars"], defaultViewport: { width: 1600, height: 900 } });
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 150)));
await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => document.querySelector("#boot")?.classList.contains("gone"), { timeout: 90000, polling: 400 });
await wait(6000);

// 測試各縮放能否左右平移
const panTest = async (zoom) => {
  await page.evaluate((z) => window.__map.jumpTo({ center: [113.5515, 22.1862], zoom: z, pitch: 0, bearing: 0 }), zoom);
  await wait(1500);
  const before = await page.evaluate(() => window.__map.getCenter().lng);
  await page.evaluate(() => window.__map.panBy([700, 0], { duration: 0 }));
  await wait(1200);
  const after = await page.evaluate(() => window.__map.getCenter().lng);
  const moved = Math.abs(after - before) * 102400;
  console.log(`z=${String(zoom).padEnd(5)} 水平可移動 ${Math.round(moved)} 公尺  ${moved > 50 ? "✓" : "✗ 被鎖住"}`);
  return moved;
};
for (const z of [11.6, 12.2, 12.7, 13.5, 15]) await panTest(z);

// 圖層按鈕
await page.evaluate(() => window.__map.jumpTo({ center: [113.5515, 22.1862], zoom: 13.5, pitch: 45, bearing: 0 }));
await page.click("#btn-layers");
await wait(700);
console.log("圖層面板:", await page.evaluate(() => document.querySelector("#controls").classList.contains("open") ? "開啟 ✓" : "未開 ✗"));
// 移出澳門範圍 → 回到澳門鈕
await page.evaluate(() => window.__map.jumpTo({ center: [113.95, 22.6], zoom: 12, pitch: 0, bearing: 0 }));
await wait(2500);
console.log("離開澳門:", await page.evaluate(() => document.querySelector("#recenter-fab").classList.contains("on") ? "出現「回到澳門」✓" : "未出現 ✗"));
await page.click("#recenter-fab");
await wait(3500);
const back = await page.evaluate(() => ({ center: window.__map.getCenter().toArray().map((v) => +v.toFixed(3)), fab: document.querySelector("#recenter-fab").classList.contains("on") }));
console.log("點擊後:", JSON.stringify(back));
await page.screenshot({ path: "preview/23-可自由平移與圖層按鈕.png" });
console.log("錯誤:", errs.length ? errs.join(" | ") : "（無）");
await browser.close();
