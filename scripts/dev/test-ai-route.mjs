import puppeteer from "puppeteer-core";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--hide-scrollbars"], defaultViewport: { width: 1500, height: 920 } });
const ctx = browser.defaultBrowserContext();
await ctx.overridePermissions("http://127.0.0.1:4173", ["geolocation"]);
const page = await browser.newPage();
await page.setGeolocation({ latitude: 22.19358, longitude: 113.53967, accuracy: 25 });
await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => document.querySelector("#boot")?.classList.contains("gone"), { timeout: 90000, polling: 400 });
await wait(4500);
await page.click("#btn-locate");
await wait(4000);
await page.click("#ai-fab");
await wait(2000);
await page.evaluate(() => { document.querySelector("#ai-text").value = "我要怎麼去澳門旅遊塔？"; });
await page.click("#ai-send");
let last = 0, stable = 0;
for (let i = 0; i < 40; i++) {
  await wait(1500);
  const len = await page.evaluate(() => (document.querySelector(".ai-msg.ai:last-child")?.textContent ?? "").length);
  if (len > 0 && len === last) { stable++; if (stable >= 2) break; } else stable = 0;
  last = len;
}
const r = await page.evaluate(() => ({
  ans: document.querySelector(".ai-msg.ai:last-child")?.textContent?.slice(0, 150),
  cmd: document.querySelector(".ai-cmd")?.textContent ?? null,
  navbarOn: document.querySelector("#navbar").classList.contains("on"),
  eta: document.querySelector("#nav-eta")?.textContent ?? null,
}));
console.log("路線問題 →", JSON.stringify(r, null, 1).slice(0, 520));
await page.screenshot({ path: "preview/33-AI規劃路線.jpg", quality: 82, type: "jpeg" });
await browser.close();
