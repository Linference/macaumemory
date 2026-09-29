// 元素級截圖：把建檔表單／手動定位地圖／資料庫面板單獨拍下來，用來人眼檢視版面與文案。
//
// 為什麼需要它：browser-check-survey.mjs 拍的是整頁截圖（1440×4000 以上），縮圖後文字讀不清楚；
// 這一支只拍單一元素（deviceScaleFactor 2），字才看得清。定位用 CDP 模擬（精度 45 公尺，
// 剛好會觸發「精度一直很差」的自動展開手動定位）。
//
// 用法：node tools/recognize/capture-shots.mjs（前置：Vite dev server 5173）
//   產出：tools/recognize/out/review/*.png
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL_ = "http://127.0.0.1:5173/recognize.html";
const OUT = resolve(import.meta.dirname, "out", "review");
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "shell", protocolTimeout: 600000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=swiftshader"],
});
try {
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(new URL(URL_).origin, ["geolocation"]);
  const page = await browser.newPage();
  const client = await page.createCDPSession();
  await client.send("Emulation.setGeolocationOverride", { latitude: 22.197458, longitude: 113.540839, accuracy: 45 });
  await page.setViewport({ width: 1440, height: 1200, deviceScaleFactor: 2 });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__survey?.db?.ready === true, { timeout: 120000, polling: 200 });
  await page.evaluate(() => document.querySelector("#rc-overlay-skip")?.click());
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => localStorage.removeItem("macau-memory.pending-discoveries"));
  await page.evaluate(() => {
    const mk = (zh, cls, sim) => ({ id: zh, zh, en: null, cls, clsZh: cls, spot: null, model: null, count: 3, sim, margin: 0, clsMatch: null });
    window.__recognize.showResults({
      results: [{ index: 0, box: { x: 40, y: 40, w: 900, h: 640 }, cls: "tong_lau", clsZh: "騎樓與唐樓", score: 0.712, source: "yolo",
        topK: [mk("大三巴牌坊", "monument", 0.311), mk("媽閣廟", "temple", 0.29)], totalCompared: 38, margin: 0.021, thresholds: { hit: 0.82, maybe: 0.48 } }],
      width: 900, height: 640, file: "普查示範-唐樓.jpg",
    });
  });
  await page.select("#rc-nd-geo-plan", "quick");
  await page.click("#rc-nd-geo");
  await new Promise((r) => setTimeout(r, 2500));
  const shot = async (sel, name) => {
    const el = await page.$(sel);
    if (!el) { console.log("找不到", sel); return; }
    await el.screenshot({ path: resolve(OUT, name) });
    console.log("已截圖", name, sel);
  };
  await shot("#rc-survey-host", "A-建檔表單.png");

  // 手動定位地圖（用 JS 直接展開，不用點擊——精度差時它已經自動展開）
  await page.evaluate(() => { document.querySelector("#rc-nd-manual").open = true; });
  await new Promise((r) => setTimeout(r, 4500));
  await shot("#rc-nd-manual", "B-手動定位.png");

  // 建築輪廓（選用圖層）
  await page.click("#rc-mmap-buildings");
  await new Promise((r) => setTimeout(r, 9000));
  await shot("#rc-nd-manual", "B2-手動定位-含建築輪廓.png");
  console.log("地圖狀態：", JSON.stringify(await page.evaluate(() => window.__survey.survey.state.minimap?.debug())));
  console.log("輪廓狀態文字：", await page.evaluate(() => document.querySelector("#rc-mmap-status")?.textContent));

  // 存兩筆（第二筆在 12 公尺外）
  await page.evaluate(() => { const n = document.querySelector("#rc-nd-name"); n.value = "沙梨頭麻子街 21 號唐樓"; n.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.click("#rc-nd-save");
  await new Promise((r) => setTimeout(r, 500));
  await client.send("Emulation.setGeolocationOverride", { latitude: 22.197568, longitude: 113.540839, accuracy: 45 });
  await page.click("#rc-nd-geo");
  await new Promise((r) => setTimeout(r, 2500));
  await shot("#rc-nd-nearby", "C-查重命中.png");
  await page.click("#rc-nd-save");
  await new Promise((r) => setTimeout(r, 700));
  await shot("#rc-ledger", "D-資料庫面板.png");

  // 手機寬度
  await page.setViewport({ width: 420, height: 900, deviceScaleFactor: 2 });
  await new Promise((r) => setTimeout(r, 900));
  await shot("#rc-survey-host", "E-手機建檔.png");
  await shot("#rc-ledger", "F-手機資料庫.png");
} finally {
  await browser.close();
}
