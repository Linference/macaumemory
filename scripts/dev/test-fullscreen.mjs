import puppeteer from "puppeteer-core";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--window-size=1500,900"], defaultViewport: { width: 1500, height: 900 } });
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 200)));
await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => document.querySelector("#boot")?.classList.contains("gone"), { timeout: 90000, polling: 400 });
await wait(5000);
const before = await page.evaluate(() => ({
  hasBtn: !!document.querySelector("#btn-fullscreen"),
  path: document.querySelector("#fs-path")?.getAttribute("d"),
  fullscreenEl: !!document.fullscreenElement,
  size: [innerWidth, innerHeight],
}));
console.log("初始狀態:", JSON.stringify(before));
await page.click("#btn-fullscreen");
await wait(1500);
const after = await page.evaluate(() => ({
  path: document.querySelector("#fs-path")?.getAttribute("d"),
  fullscreenEl: document.fullscreenElement?.tagName ?? null,
  size: [innerWidth, innerHeight],
  canvas: (() => { const c = document.querySelector(".maplibregl-canvas"); return [c.width, c.height]; })(),
  title: document.querySelector("#btn-fullscreen")?.getAttribute("title"),
}));
console.log("點擊後:", JSON.stringify(after));
await page.screenshot({ path: "preview/10-全螢幕模式.png" });
// 用 F 鍵退出
await page.keyboard.press("f");
await wait(1200);
const afterEsc = await page.evaluate(() => ({ fullscreenEl: !!document.fullscreenElement, path: document.querySelector("#fs-path")?.getAttribute("d") }));
console.log("按 F 之後:", JSON.stringify(afterEsc));
console.log("錯誤:", errs.length ? errs.join(" | ") : "（無）");
await browser.close();
