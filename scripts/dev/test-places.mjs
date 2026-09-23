import puppeteer from "puppeteer-core";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--hide-scrollbars"], defaultViewport: { width: 1500, height: 920 } });
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 150)));
page.on("console", (m) => { if (m.type() === "error") errs.push("[console] " + m.text().slice(0, 110)); });
await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => document.querySelector("#boot")?.classList.contains("gone"), { timeout: 90000, polling: 400 });
await wait(6000);
await page.evaluate(() => document.querySelector("#controls").classList.add("open"));
await wait(400);
await page.click("#tg-photos");
await wait(6000);
console.log("圖層標籤:", await page.evaluate(() => document.querySelector("#lb-photos")?.textContent));
console.log("類別 chips:", await page.evaluate(() => [...document.querySelectorAll("#photo-chips .poi-chip")].map((e) => e.textContent.trim()).join(" | ")));
console.log("景點徽章:", await page.evaluate(() => [...document.querySelectorAll(".marker-photo")].map((e) => e.textContent).join(" ")));
await page.evaluate(() => { document.querySelector("#controls").classList.remove("open"); window.__map.jumpTo({ center: [113.54084, 22.19746], zoom: 16.8, pitch: 50, bearing: -18 }); });
await wait(6000);
await page.screenshot({ path: "preview/41-記憶點圖層.jpg", quality: 82, type: "jpeg" });
// 點記憶點（往下偏移避開景點 DOM 標記）
const pt = await page.evaluate(() => {
  const m = window.__map;
  const f = m.queryRenderedFeatures({ layers: ["place-dot"] })[0];
  const p = f ? m.project(f.geometry.coordinates) : null;
  return p ? [Math.round(p.x), Math.round(p.y)] : null;
});
if (pt) {
  await page.mouse.click(pt[0], pt[1] + 18);
  await wait(2500);
  console.log("記憶點彈窗:", await page.evaluate(() => document.querySelector(".place-pop")?.innerText?.replace(/\n+/g, " | ").slice(0, 130) ?? "（未開啟）"));
  await page.screenshot({ path: "preview/42-記憶點彈窗.jpg", quality: 82, type: "jpeg" });
  await page.evaluate(() => document.querySelector(".place-more")?.click());
  await wait(2200);
  const lb = await page.evaluate(() => ({
    on: document.querySelector("#lightbox").classList.contains("on"),
    id: document.querySelector(".lb-id")?.textContent?.trim(),
    name: document.querySelector(".lb-info h3")?.textContent,
    strip: document.querySelectorAll(".lb-strip img").length,
    caption: document.querySelector(".lb-info p")?.textContent?.slice(0, 80),
  }));
  console.log("記憶點卡片:", JSON.stringify(lb));
  await page.screenshot({ path: "preview/43-記憶點卡片與照片時間軸.jpg", quality: 82, type: "jpeg" });
  // 切換到第二張照片
  const second = await page.$('.lb-strip img[data-i="1"]');
  if (second) { await page.evaluate(() => document.querySelector('.lb-strip img[data-i="1"]')?.click()); await wait(1500); console.log("切換第二張:", await page.evaluate(() => document.querySelector("#lb-img")?.src?.split("/").pop())); }
  await page.click("#lb-close");
  await wait(700);
}
// 景點面板的記憶點相簿
await page.evaluate(() => document.querySelector("#sidebar").classList.add("open"));
await wait(600);
await page.click('.item[data-id="ruins-st-paul"]');
await wait(3000);
console.log("景點記憶點區:", await page.evaluate(() => [...document.querySelectorAll(".d-section h3")].map((h) => h.textContent).filter((t) => t.includes("記憶")).join(" / ")));
await page.screenshot({ path: "preview/44-景點記憶點相簿.jpg", quality: 82, type: "jpeg" });
console.log("錯誤:", errs.length ? errs.join(" | ") : "（無）");
await browser.close();
