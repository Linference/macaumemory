import puppeteer from "puppeteer-core";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--hide-scrollbars","--autoplay-policy=no-user-gesture-required"], defaultViewport: { width: 1500, height: 920 } });
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 140)));
await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => document.querySelector("#boot")?.classList.contains("gone"), { timeout: 90000, polling: 400 });
await wait(6000);
// 開朗讀
await page.click("#dh-speak");
await wait(800);
// 問一題（透過對話框）
await page.click("#ai-fab");
await wait(2500);
await page.evaluate(() => { document.querySelector("#ai-text").value = "用兩句話介紹議事亭前地"; });
await page.click("#ai-send");
// 觀察狀態變化
const states = new Set();
for (let i = 0; i < 26; i++) {
  await wait(1200);
  const st = await page.evaluate(() => ({
    dh: window.__dhState ?? document.querySelector("#dh-bubble")?.classList.contains("on"),
    bubble: document.querySelector("#dh-bubble")?.textContent?.slice(0, 34),
    answer: (document.querySelector(".ai-msg.ai:last-child .ai-answer")?.textContent ?? "").slice(0, 70),
  }));
  if (st.bubble) states.add(st.bubble.slice(0, 12));
  if (st.answer && st.answer.length > 40 && i > 8) { console.log("AI 回答:", st.answer); break; }
}
console.log("數位人對話泡泡出現過:", [...states].slice(0, 3).join(" / "));
await wait(4000);
await page.screenshot({ path: "preview/38-數位人與語音.jpg", quality: 82, type: "jpeg" });
console.log("錯誤:", errs.length ? errs.join(" | ") : "（無）");
await browser.close();
