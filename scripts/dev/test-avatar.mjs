import puppeteer from "puppeteer-core";
import sharp from "sharp";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ["--no-sandbox","--disable-dev-shm-usage","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--hide-scrollbars",
    "--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream"],
  defaultViewport: { width: 1500, height: 920 },
});
const ctx = browser.defaultBrowserContext();
await ctx.overridePermissions("http://127.0.0.1:4173", ["geolocation", "microphone"]);
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 140)));
page.on("console", (m) => { if (m.type() === "error") errs.push("[console] " + m.text().slice(0, 120)); });
await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForFunction(() => document.querySelector("#boot")?.classList.contains("gone"), { timeout: 90000, polling: 400 });
await wait(7000);
const info = await page.evaluate(() => {
  const c = document.querySelector("#dh-canvas");
  return {
    card: !!document.querySelector("#dh-card"),
    canvasSize: c ? [c.width, c.height] : null,
    bubbleOn: document.querySelector("#dh-bubble")?.classList.contains("on"),
    bubbleText: document.querySelector("#dh-bubble")?.textContent?.slice(0, 40),
    ttsSupported: !!window.speechSynthesis,
    voices: (window.speechSynthesis?.getVoices() ?? []).length,
    asrSupported: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
    micBtn: !!document.querySelector("#dh-mic"),
    speakBtnOn: document.querySelector("#dh-speak")?.classList.contains("on"),
  };
});
console.log("數位人:", JSON.stringify(info));
// 擷取數位人區域，確認真的畫出東西
const box = await (await page.$("#dh-card")).boundingBox();
await page.screenshot({ path: "shots/avatar.png", clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
const { data, info: meta } = await sharp("shots/avatar.png").raw().toBuffer({ resolveWithObject: true });
let nonBg = 0;
for (let i = 0; i < data.length; i += meta.channels) {
  const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
  if (Math.abs(r - g) + Math.abs(g - b) > 24 || r > 90) nonBg++;
}
console.log(`數位人區域像素：${meta.width}×${meta.height}，有內容像素 ${(nonBg / (meta.width * meta.height) * 100).toFixed(1)}%`);
// 朗讀開關
await page.click("#dh-speak"); await wait(1200);
console.log("朗讀開關:", await page.evaluate(() => document.querySelector("#dh-speak").classList.contains("on") ? "已開啟 ✓" : "未開啟"));
// 麥克風
await page.click("#dh-mic"); await wait(4000);
console.log("麥克風狀態:", JSON.stringify(await page.evaluate(() => ({
  micOn: document.querySelector("#dh-mic").classList.contains("listening"),
  panelOpen: document.querySelector("#ai-panel").classList.contains("on"),
  toast: document.querySelector("#toast")?.textContent?.slice(0, 60),
}))));
await page.screenshot({ path: "preview/38-數位人與語音.jpg", quality: 82, type: "jpeg" });
console.log("錯誤:", errs.length ? errs.join(" | ") : "（無）");
await browser.close();
