import puppeteer from "puppeteer-core";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--hide-scrollbars"], defaultViewport: { width: 1500, height: 920 } });
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 140)));
await page.goto("https://linference.github.io/macaumemory/", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => document.querySelector("#boot")?.classList.contains("gone"), { timeout: 90000, polling: 400 });
await wait(9000);
await page.click("#ai-fab");
await wait(2500);
console.log("線上首次開啟:", JSON.stringify(await page.evaluate(() => ({
  sub: document.querySelector("#ai-sub").textContent,
  setupShown: document.querySelector("#ai-setup").classList.contains("on"),
}))));
// 輸入金鑰
await page.evaluate(() => { document.querySelector("#ai-key").value = "sk-5aba169001644a47897a3e6f93820d46"; });
await page.click("#ai-save");
await wait(3500);
console.log("儲存後:", JSON.stringify(await page.evaluate(() => ({
  sub: document.querySelector("#ai-sub").textContent,
  models: [...document.querySelectorAll("#ai-model option")].map((o) => o.value),
  selected: document.querySelector("#ai-model").value,
}))));
await page.evaluate(() => { document.querySelector("#ai-text").value = "澳門旅遊塔有多高？"; });
await page.click("#ai-send");
let last = 0, stable = 0;
for (let i = 0; i < 50; i++) {
  await wait(1200);
  const len = await page.evaluate(() => (document.querySelector(".ai-msg.ai:last-child")?.textContent ?? "").length);
  const typing = await page.evaluate(() => document.querySelector(".ai-msg.ai:last-child")?.classList.contains("typing"));
  if (len > 0 && len === last && !typing) { stable++; if (stable >= 2) break; } else stable = 0;
  last = len;
}
console.log("線上問答:", JSON.stringify(await page.evaluate(() => ({
  answer: (document.querySelector(".ai-msg.ai:last-child .ai-answer")?.textContent ?? "").slice(0, 130).replace(/\n/g, " "),
  cmd: document.querySelector(".ai-cmd")?.textContent ?? null,
}))));
await page.screenshot({ path: "preview/37-線上AI問答.jpg", quality: 82, type: "jpeg" });
console.log("錯誤:", errs.length ? errs.join(" | ") : "（無）");
await browser.close();
