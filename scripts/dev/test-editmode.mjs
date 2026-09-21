import puppeteer from "puppeteer-core";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--window-size=1500,950"], defaultViewport: { width: 1500, height: 950 } });
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 200)));
await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => document.querySelector("#boot")?.classList.contains("gone"), { timeout: 90000, polling: 400 });
await wait(6000);
// 飛到媽閣廟附近
await page.evaluate(() => window.__map.jumpTo({ center: [113.5313, 22.1862], zoom: 17, pitch: 40, bearing: 0 }));
await wait(5000);
// 開啟圖層面板並點「校正標記位置」
await page.evaluate(() => document.querySelector("#controls").classList.add("open"));
await wait(600);
await page.click("#btn-edit-mode");
await wait(800);
const before = await page.evaluate(() => {
  const el = [...document.querySelectorAll(".marker")].find((e) => e.getAttribute("aria-label")?.includes("媽閣廟"));
  const r = el.getBoundingClientRect();
  const a = window.__map;
  return { box: [Math.round(r.x), Math.round(r.y)], coords: [...document.querySelectorAll(".marker")].find((e) => e.getAttribute("aria-label")?.includes("媽閣廟")) ? null : null, editbar: document.querySelector("#editbar").className };
});
console.log("校正模式:", JSON.stringify(before));
// 拖曳標記 +60px 水平、+40px 垂直
await page.mouse.move(before.box[0] + 12, before.box[1] + 12);
await page.mouse.down();
await page.mouse.move(before.box[0] + 72, before.box[1] + 52, { steps: 18 });
await page.mouse.up();
await wait(900);
const after = await page.evaluate(() => {
  const el = [...document.querySelectorAll(".marker")].find((e) => e.getAttribute("aria-label")?.includes("媽閣廟"));
  const r = el.getBoundingClientRect();
  let ls = null;
  try { ls = JSON.parse(localStorage.getItem("macau.coordFixes.v1") || "{}"); } catch {}
  return { box: [Math.round(r.x), Math.round(r.y)], moved: el.classList.contains("moved"), count: document.querySelector("#editbar-count").textContent, fixes: ls };
});
console.log("拖曳後:", JSON.stringify(after));
await page.screenshot({ path: "preview/11-位置校正模式.png" });
console.log("錯誤:", errs.length ? errs.join(" | ") : "（無）");
await browser.close();
