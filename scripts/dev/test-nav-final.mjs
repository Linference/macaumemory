import puppeteer from "puppeteer-core";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--hide-scrollbars"], defaultViewport: { width: 1600, height: 940 } });
const ctx = browser.defaultBrowserContext();
await ctx.overridePermissions("http://127.0.0.1:4173", ["geolocation"]);
const page = await browser.newPage();
await page.setGeolocation({ latitude: 22.19358, longitude: 113.53967, accuracy: 25 });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 150)));
await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => document.querySelector("#boot")?.classList.contains("gone"), { timeout: 90000, polling: 400 });
await wait(5000);
await page.click("#btn-locate");
await wait(4500);
const navTo = async (id, label) => {
  await page.evaluate(() => document.querySelector("#sidebar").classList.add("open"));
  await wait(500);
  await page.click(`.item[data-id="${id}"]`);
  await wait(2300);
  const has = await page.$('#detail-body [data-act="nav"]');
  if (!has) { console.log(label, "✗ 沒有導航按鈕"); return; }
  await has.click();
  await wait(7000);
  const r = await page.evaluate(() => ({
    eta: document.querySelector("#nav-eta")?.textContent ?? "—",
    steps: document.querySelectorAll(".nav-step").length,
    barOn: document.querySelector("#navbar").classList.contains("on"),
  }));
  console.log(label.padEnd(14), JSON.stringify(r));
};
await navTo("ruins-st-paul", "大三巴(短)");
await navTo("hac-sa-beach", "黑沙(遠)");
await navTo("macau-tower", "旅遊塔");
await page.evaluate(() => document.querySelector("#sidebar").classList.remove("open"));
await page.click("#nav-steps-btn");
await wait(1500);
await page.screenshot({ path: "preview/28-導航-路線指引.jpg", quality: 82, type: "jpeg" });
await page.click("#nav-stop");
await wait(1000);
console.log("結束後 barOn:", await page.evaluate(() => document.querySelector("#navbar").classList.contains("on")));
console.log("錯誤:", errs.length ? errs.join(" | ") : "（無）");
await browser.close();
