import puppeteer from "puppeteer-core";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--hide-scrollbars"], defaultViewport: { width: 1600, height: 940 } });
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 150)));
await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForFunction(() => document.querySelector("#boot")?.classList.contains("gone"), { timeout: 90000, polling: 400 });
await wait(5000);
await page.evaluate(() => document.querySelector("#sidebar").classList.add("open"));
const shots = [["macau-tower", "12-旅遊塔模型與介紹"], ["parisian", "13-巴黎人模型與介紹"], ["macau-science-center", "14-科學館模型與介紹"], ["galaxy", "15-銀河模型與介紹"], ["londoner", "16-倫敦人模型與介紹"]];
for (const [id, name] of shots) {
  await page.click(`.item[data-id="${id}"]`);
  await wait(2400);
  await page.click('#detail-body [data-act="model"]');
  await page.waitForFunction(() => document.querySelector("#viewer-loading")?.classList.contains("gone"), { timeout: 180000, polling: 600 });
  await wait(4000);
  await page.screenshot({ path: `preview/${name}.png` });
  const badge = await page.$eval("#viewer-badge", (el) => el.textContent);
  console.log("✓", name, "|", badge);
  await page.click("#viewer-close");
  await wait(1100);
}
console.log("錯誤:", errs.length ? errs.join(" | ") : "（無）");
await browser.close();
