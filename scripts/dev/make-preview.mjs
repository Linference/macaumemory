// 產生交付用的預覽截圖
import puppeteer from "puppeteer-core";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--hide-scrollbars"], defaultViewport: { width: 1600, height: 950, deviceScaleFactor: 1 } });
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 160)));
await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForFunction(() => document.querySelector("#boot")?.classList.contains("gone"), { timeout: 90000, polling: 400 });
await wait(6000);

async function view(name, cam, { sidebar = false, controls = false } = {}) {
  await page.evaluate((c) => {
    document.querySelector("#sidebar").classList.toggle("open", c.sidebar);
    document.querySelector("#controls").classList.toggle("open", c.controls);
    window.__map.jumpTo(c.cam);
  }, { cam, sidebar, controls });
  await page.waitForFunction(() => window.__map.areTilesLoaded(), { timeout: 45000, polling: 500 }).catch(() => {});
  await wait(4500);
  await page.screenshot({ path: `preview/${name}.png` });
  console.log("✓", name);
}

await view("01-全景-3D澳門", { center: [113.5560, 22.1660], zoom: 13.5, pitch: 62, bearing: -12 }, { sidebar: true, controls: true });
await view("02-大三巴-三維建築", { center: [113.5412, 22.1975], zoom: 16.4, pitch: 70, bearing: -25 });
await view("03-路環疊石塘山-地形", { center: [113.5619, 22.1206], zoom: 15.2, pitch: 72, bearing: 8 });
await view("04-路氹城-度假村群", { center: [113.5620, 22.1490], zoom: 15.0, pitch: 66, bearing: 28 });

// 等高線
await page.evaluate(() => {
  const m = window.__map;
  m.setLayoutProperty("contour", "visibility", "visible");
  m.setLayoutProperty("contour-50", "visibility", "visible");
  m.jumpTo({ center: [113.5520, 22.1350], zoom: 13.8, pitch: 68, bearing: 0 });
});
await wait(7000);
await page.screenshot({ path: "preview/05-等高線與地形.png" });
console.log("✓ 05-等高線與地形");

// 博物館面板
await page.evaluate(() => {
  document.querySelector("#sidebar").classList.add("open");
  window.__map.jumpTo({ center: [113.5476, 22.1861], zoom: 16.2, pitch: 60, bearing: -18 });
});
await wait(2500);
await page.click('.item[data-id="museum-poly-mgm"]');
await wait(3200);
await page.screenshot({ path: "preview/06-博物館與文物列表.png" });
console.log("✓ 06-博物館與文物列表");

// 文物模型
await page.click('.artifact[data-artifact="tang-sancai-camel"]');
await page.waitForFunction(() => document.querySelector("#viewer-loading")?.classList.contains("gone"), { timeout: 240000, polling: 600 });
await wait(4000);
await page.screenshot({ path: "preview/07-唐三彩雙峰駱駝俑-三維模型.png" });
console.log("✓ 07-唐三彩");
await page.click("#viewer-close");
await wait(1200);
await page.click('.artifact[data-artifact="yongle-blue-white-flask"]');
await page.waitForFunction(() => document.querySelector("#viewer-loading")?.classList.contains("gone"), { timeout: 240000, polling: 600 });
await wait(3500);
await page.screenshot({ path: "preview/08-明永樂青花葫蘆扁瓶-三維模型.png" });
console.log("✓ 08-青花扁瓶");
await page.click("#viewer-close");
await wait(1000);

// 簡體中文介面
await page.click("#btn-lang");
await wait(2500);
await page.screenshot({ path: "preview/09-简体中文介面.png" });
console.log("✓ 09-简体中文介面");

console.log("錯誤:", errs.length ? errs.join(" | ") : "（無）");
await browser.close();
