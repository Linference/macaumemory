import puppeteer from "puppeteer-core";
import { asciiPreview, analyze } from "./imgutil.mjs";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.env.APP_URL ?? "http://127.0.0.1:4173/";
const shot = (n) => `shots/${n}.png`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars"],
  defaultViewport: { width: 1500, height: 920, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const logs = [];
page.on("console", (m) => { if (m.type() === "error") logs.push(`[error] ${m.text().slice(0, 200)}`); });
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message.slice(0, 300)}`));

await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.waitForFunction(() => document.querySelector("#boot")?.classList.contains("gone"), { timeout: 90_000, polling: 400 });
await wait(6000);
await page.screenshot({ path: shot("01-map-overview") });
console.log("=== 01 地圖總覽 ===", JSON.stringify(await analyze(shot("01-map-overview"))));

// 點選保利美高梅博物館
await page.click('.item[data-id="museum-poly-mgm"]');
await wait(3200);
await page.screenshot({ path: shot("02-detail-museum") });
const t = await page.$eval("#detail-body", (el) => el.innerText.replace(/\n+/g, " | ").slice(0, 260));
console.log("詳情面板文字:", t);
console.log("=== 02 詳情面板 ===", JSON.stringify(await analyze(shot("02-detail-museum"))));

// 開啟唐三彩三維模型
await page.click('.artifact[data-artifact="tang-sancai-camel"]');
await page.waitForSelector("#viewer.open", { timeout: 20_000 });
await page.waitForFunction(() => document.querySelector("#viewer-loading")?.classList.contains("gone"), { timeout: 240_000, polling: 700 });
await wait(4000);
console.log("模型狀態:", await page.$eval("#viewer-badge", (el) => el.textContent));
await page.screenshot({ path: shot("03-model-camel") });
console.log("=== 03 唐三彩模型 ===", JSON.stringify(await analyze(shot("03-model-camel"))));
console.log(await asciiPreview(shot("03-model-camel")));

// 拖曳旋轉
const box = await (await page.$("#viewer-canvas")).boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 300, box.y + box.height / 2 - 30, { steps: 24 });
await page.mouse.up();
await wait(1800);
await page.screenshot({ path: shot("04-model-rotated") });
console.log("=== 04 旋轉後 ===", JSON.stringify(await analyze(shot("04-model-rotated"))));

// 第二件文物
await page.click("#viewer-close");
await wait(1000);
await page.click('.artifact[data-artifact="yongle-blue-white-flask"]');
await page.waitForFunction(() => document.querySelector("#viewer-loading")?.classList.contains("gone"), { timeout: 240_000, polling: 700 });
await wait(3500);
await page.screenshot({ path: shot("05-model-flask") });
console.log("=== 05 青花扁瓶 ===", JSON.stringify(await analyze(shot("05-model-flask"))));
console.log(await asciiPreview(shot("05-model-flask")));

console.log("\n錯誤訊息:", logs.length ? logs.slice(0, 10).join("\n") : "（無）");
await browser.close();

