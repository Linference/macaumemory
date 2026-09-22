import puppeteer from "puppeteer-core";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--hide-scrollbars"], defaultViewport: { width: 1500, height: 920 } });
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 150)));
await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => document.querySelector("#boot")?.classList.contains("gone"), { timeout: 90000, polling: 400 });
await wait(5000);
console.log("AI 按鈕存在:", await page.evaluate(() => !!document.querySelector("#ai-fab")));
await page.click("#ai-fab");
await wait(2500);
const st = await page.evaluate(() => ({
  panelOn: document.querySelector("#ai-panel").classList.contains("on"),
  setupShown: document.querySelector("#ai-setup").classList.contains("on"),
  sub: document.querySelector("#ai-sub").textContent,
  msgs: document.querySelectorAll(".ai-msg").length,
  greeting: document.querySelector(".ai-msg.ai")?.textContent?.slice(0, 40),
}));
console.log("開啟後:", JSON.stringify(st));
// 送出一題
await page.evaluate(() => { document.querySelectorAll(".ai-chip")[0].click(); });
console.log("已送出第一個問題，等待串流…");
let lastLen = 0, stable = 0;
for (let i = 0; i < 40; i++) {
  await wait(1500);
  const len = await page.evaluate(() => (document.querySelector(".ai-msg.ai:last-child")?.textContent ?? "").length);
  if (len > 0 && len === lastLen) { stable++; if (stable >= 2) break; } else stable = 0;
  lastLen = len;
}
const out = await page.evaluate(() => ({
  answer: document.querySelector(".ai-msg.ai:last-child")?.textContent?.slice(0, 220),
  hasCmd: !!document.querySelector(".ai-cmd"),
  cmdText: document.querySelector(".ai-cmd")?.textContent ?? null,
  detailOpen: document.querySelector("#detail")?.classList.contains("open"),
  detailTitle: document.querySelector(".d-title")?.textContent ?? null,
}));
console.log("AI 回覆:", JSON.stringify(out, null, 1).slice(0, 700));
await page.screenshot({ path: "preview/32-AI導覽助理.jpg", quality: 82, type: "jpeg" });
console.log("錯誤:", errs.length ? errs.join(" | ") : "（無）");
await browser.close();
