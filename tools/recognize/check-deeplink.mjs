// 驗證「建築辨識 → 在地圖上開啟」這條深連結：?spot=<id> 要能在主站選中該景點。
//
// 用法：node tools/recognize/check-deeplink.mjs
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://127.0.0.1:5173/";

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "shell", protocolTimeout: 300000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"],
});

const CASES = [
  ["?spot=moorish-barracks", "港務局大樓"],
  ["?spot=a-ma-temple", "媽閣廟"],
  ["?spot=macau-tower", "澳門旅遊塔"],
  ["?spot=not-a-real-spot", "（不存在的 id，應只警告不崩）"],
];

for (const [qs, expect] of CASES) {
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await page.goto(BASE + qs, { waitUntil: "networkidle2", timeout: 120000 });
  await new Promise((r) => setTimeout(r, 3500));
  const st = await page.evaluate(() => ({
    open: document.querySelector("#detail")?.classList.contains("open"),
    title: document.querySelector("#detail-body")?.querySelector(".d-title")?.textContent,
    cat: document.querySelector("#detail-body")?.querySelector(".d-cat")?.textContent,
    hash: location.hash,
    search: location.search,
  }));
  const ok = qs.includes("not-a-real") ? true : (st.open && st.title?.includes(expect.replace(/[（）]/g, "").slice(0, 3)));
  console.log(`${ok ? "✓" : "✗"} ${qs.padEnd(26)} → 面板開啟=${st.open} 標題="${st.title ?? "—"}" 類別="${st.cat ?? "—"}" hash="${st.hash}" search="${st.search}"`);
  if (errs.length) console.log(`   !! console 錯誤：${errs.slice(0, 3).join(" | ")}`);
  await page.close();
}
await browser.close();
