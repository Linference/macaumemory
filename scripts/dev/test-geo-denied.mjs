import puppeteer from "puppeteer-core";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"], defaultViewport: { width: 1200, height: 800 } });
const ctx = browser.defaultBrowserContext();
await ctx.overridePermissions("http://127.0.0.1:4173", []); // 不給定位權限
const page = await browser.newPage();
await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => document.querySelector("#boot")?.classList.contains("gone"), { timeout: 90000, polling: 400 });
await wait(4000);
await page.click("#btn-locate");
await wait(4000);
const r = await page.evaluate(() => ({
  toast: document.querySelector("#toast")?.textContent ?? null,
  toastVisible: document.querySelector("#toast")?.classList.contains("on") ?? false,
  btnOn: document.querySelector("#btn-locate")?.classList.contains("on"),
  gpsHidden: document.querySelector(".gps")?.style.display === "none",
}));
console.log("拒絕權限時:", JSON.stringify(r));
await browser.close();
