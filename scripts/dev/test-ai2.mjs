import puppeteer from "puppeteer-core";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--hide-scrollbars"], defaultViewport: { width: 1500, height: 920 } });
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 140)));
await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => document.querySelector("#boot")?.classList.contains("gone"), { timeout: 90000, polling: 400 });
await wait(5000);
await page.click("#ai-fab");
await wait(3500);
console.log("面板狀態:", JSON.stringify(await page.evaluate(() => ({
  sub: document.querySelector("#ai-sub").textContent,
  setupShown: document.querySelector("#ai-setup").classList.contains("on"),
  models: [...document.querySelectorAll("#ai-model option")].map((o) => o.value),
  selected: document.querySelector("#ai-model").value,
  think: document.querySelector("#ai-think")?.checked,
}))));
const ask = async (q, label) => {
  await page.evaluate((t) => { document.querySelector("#ai-text").value = t; }, q);
  await page.click("#ai-send");
  let last = 0, stable = 0;
  for (let i = 0; i < 50; i++) {
    await wait(1200);
    const len = await page.evaluate(() => (document.querySelector(".ai-msg.ai:last-child")?.textContent ?? "").length);
    const typing = await page.evaluate(() => document.querySelector(".ai-msg.ai:last-child")?.classList.contains("typing"));
    if (len > 0 && len === last && !typing) { stable++; if (stable >= 2) break; } else stable = 0;
    last = len;
  }
  const r = await page.evaluate(() => {
    const last = document.querySelector(".ai-msg.ai:last-child");
    return {
      hasThinkBox: !!last?.querySelector(".ai-think-box"),
      answer: (last?.querySelector(".ai-answer")?.textContent ?? last?.textContent ?? "").slice(0, 110).replace(/\n/g, " "),
      cmd: document.querySelector(".ai-cmd")?.textContent ?? null,
    };
  });
  console.log(`${label}:`, JSON.stringify(r));
};
await ask("大三巴牌坊有什麼特色？", "快速模式");
// 開深度思考再問
await page.click("#ai-settings");
await wait(1200);
await page.evaluate(() => { document.querySelector("#ai-think").checked = true; document.querySelector("#ai-save").click(); });
await wait(1500);
await ask("推薦一條半日遊路線", "深度思考");
await page.screenshot({ path: "preview/36-AI對話框-新模型.jpg", quality: 82, type: "jpeg" });
console.log("錯誤:", errs.length ? errs.join(" | ") : "（無）");
await browser.close();
