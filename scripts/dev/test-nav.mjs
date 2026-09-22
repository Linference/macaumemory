import puppeteer from "puppeteer-core";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--hide-scrollbars"], defaultViewport: { width: 1500, height: 920 } });
const ctx = browser.defaultBrowserContext();
await ctx.overridePermissions("http://127.0.0.1:4173", ["geolocation"]);
const page = await browser.newPage();
await page.setGeolocation({ latitude: 22.19358, longitude: 113.53967, accuracy: 25 }); // 議事亭前地
const errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 160)));
page.on("console", (m) => { if (m.type() === "error") errs.push("[console] " + m.text().slice(0, 150)); });
await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => document.querySelector("#boot")?.classList.contains("gone"), { timeout: 90000, polling: 400 });
await wait(5000);
// 開啟定位
await page.click("#btn-locate");
await wait(5000);
// 選一個較遠的目的地：澳門旅遊塔
await page.evaluate(() => document.querySelector("#sidebar").classList.add("open"));
await wait(500);
await page.click('.item[data-id="macau-tower"]');
await wait(2500);
await page.click('#detail-body [data-act="nav"]');
console.log("已按下導航…");
// 捕捉搜尋動畫
await wait(1800);
await page.screenshot({ path: "preview/26-導航-搜尋動畫.jpg", quality: 80, type: "jpeg" });
const mid = await page.evaluate(() => ({ navbarOn: document.querySelector("#navbar").classList.contains("on"), eta: document.querySelector("#nav-eta")?.textContent?.slice(0, 40) }));
console.log("搜尋中:", JSON.stringify(mid));
await wait(4200);
await page.screenshot({ path: "preview/27-導航-路線與指引.jpg", quality: 80, type: "jpeg" });
const done = await page.evaluate(() => {
  const m = window.__map;
  const src = (id) => m.getSource(id)?._data?.features?.length ?? -1;
  return {
    navbarOn: document.querySelector("#navbar").classList.contains("on"),
    dest: document.querySelector("#nav-dest").textContent,
    eta: document.querySelector("#nav-eta").textContent,
    routeFeatures: src("nav-route"),
    flowFeatures: src("nav-flow"),
    ends: src("nav-ends"),
    steps: document.querySelectorAll(".nav-step").length,
  };
});
console.log("導航完成:", JSON.stringify(done));
// 展開指引
await page.click("#nav-steps-btn");
await wait(1200);
await page.screenshot({ path: "preview/28-導航-路線指引.jpg", quality: 80, type: "jpeg" });
// 切換開車
await page.click('.nav-mode[data-mode="car"]');
await wait(7000);
const car = await page.evaluate(() => ({ eta: document.querySelector("#nav-eta").textContent, mode: document.querySelector(".nav-mode.on")?.dataset.mode }));
console.log("切換開車:", JSON.stringify(car));
await page.screenshot({ path: "preview/29-導航-開車模式.jpg", quality: 80, type: "jpeg" });
// 結束
await page.click("#nav-stop");
await wait(1200);
console.log("結束後 barOn:", await page.evaluate(() => document.querySelector("#navbar").classList.contains("on")));
console.log("錯誤:", errs.length ? errs.join(" | ") : "（無）");
await browser.close();
