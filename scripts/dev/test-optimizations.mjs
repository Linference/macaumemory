import puppeteer from "puppeteer-core";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--hide-scrollbars"], defaultViewport: { width: 1500, height: 920 } });
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 150)));
page.on("console", (m) => { if (m.type() === "error") errs.push("[console] " + m.text().slice(0, 130)); });
await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => document.querySelector("#boot")?.classList.contains("gone"), { timeout: 90000, polling: 400 });
await wait(6000);

const check = async (label) => {
  const r = await page.evaluate(() => {
    const m = window.__map;
    const visMarkers = [...document.querySelectorAll(".marker")].filter((e) => !e.classList.contains("hidden")).length;
    const labels = document.querySelectorAll(".map-label");
    const placed = [...labels].filter((e) => !e.classList.contains("hidden")).length;
    return {
      zoom: +m.getZoom().toFixed(2),
      visibleMarkers: visMarkers,
      labels: labels.length,
      labelsShown: placed,
      contourSource: !!m.getSource("contours"),
      poi: m.getLayer("poi") ? m.queryRenderedFeatures({ layers: ["poi"] }).length : -1,
      hash: location.hash,
    };
  });
  console.log(label.padEnd(18), JSON.stringify(r));
  return r;
};
await check("起始 (z13)");
await page.evaluate(() => window.__map.jumpTo({ center: [113.5455, 22.1995], zoom: 15.5, pitch: 55, bearing: 0 }));
await wait(4500);
await check("半島 z15.5");
await page.evaluate(() => window.__map.jumpTo({ center: [113.556, 22.166], zoom: 11.6, pitch: 40, bearing: 0 }));
await wait(4500);
await check("全澳 z11.6");
// 開等高線
await page.evaluate(() => document.querySelector("#controls").classList.add("open"));
await page.click("#tg-contours");
await wait(6000);
await check("開等高線後");
// 深連結
await page.evaluate(() => { location.hash = "#16.20/22.17982/113.53680/spot/macau-tower"; location.reload(); });
await wait(12000);
await page.waitForFunction(() => document.querySelector("#boot")?.classList.contains("gone"), { timeout: 90000, polling: 500 }).catch(() => {});
await wait(3000);
const deep = await page.evaluate(() => ({
  hash: location.hash,
  center: window.__map.getCenter().toArray().map((v) => +v.toFixed(4)),
  zoom: +window.__map.getZoom().toFixed(2),
  detailOpen: document.querySelector("#detail")?.classList.contains("open"),
  detailTitle: document.querySelector(".d-title")?.textContent ?? null,
}));
console.log("深連結還原      ", JSON.stringify(deep));
await page.screenshot({ path: "shots/opt-labels.png" });
console.log("錯誤:", errs.length ? errs.join(" | ") : "（無）");
await browser.close();
