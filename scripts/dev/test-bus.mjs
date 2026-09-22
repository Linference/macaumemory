import puppeteer from "puppeteer-core";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--hide-scrollbars"], defaultViewport: { width: 1500, height: 920 } });
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 150)));
page.on("console", (m) => { if (m.type() === "error") errs.push("[console] " + m.text().slice(0, 120)); });
await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => document.querySelector("#boot")?.classList.contains("gone"), { timeout: 90000, polling: 400 });
await wait(5000);
await page.evaluate(() => window.__map.jumpTo({ center: [113.5397, 22.1936], zoom: 16.2, pitch: 55, bearing: 0 }));
await wait(6000);
await page.evaluate(() => document.querySelector("#controls").classList.add("open"));
await wait(500);
await page.click("#tg-bus");
await wait(7000);
const info = await page.evaluate(() => {
  const m = window.__map;
  const f = m.queryRenderedFeatures({ layers: ["bus-stop"] });
  const top = f.find((x) => x.properties.r) ?? f[0];
  const p = top ? m.project(top.geometry.coordinates) : null;
  return { count: f.length, vis: m.getLayoutProperty("bus-stop", "visibility"), sample: f.slice(0, 4).map((x) => `${x.properties.n ?? "?"}｜${x.properties.r ?? "-"}`), point: p ? [Math.round(p.x), Math.round(p.y)] : null };
});
console.log("巴士圖層:", JSON.stringify(info).slice(0, 320));
if (info.point) {
  await page.mouse.click(info.point[0], info.point[1]);
  await wait(2500);
  const popup = await page.evaluate(() => document.querySelector(".maplibregl-popup-content")?.innerText?.replace(/\n+/g, " | ").slice(0, 160) ?? null);
  console.log("站點彈窗:", popup);
}
await page.screenshot({ path: "preview/34-巴士站圖層.jpg", quality: 82, type: "jpeg" });
console.log("錯誤:", errs.length ? errs.join(" | ") : "（無）");
await browser.close();
