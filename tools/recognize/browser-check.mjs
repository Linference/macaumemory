// 用 Puppeteer 真正開一次 recognize.html：載入模型 → 跑示範照片 → 檢查結果與截圖。
//
// 這支的設計原則：**永遠印出目前狀態**，不要只是「等不到就 timeout」。
// 模型在瀏覽器裡可能慢或失敗，我們要看到卡在哪一步（哪個資源、哪個階段、什麼錯誤）。
//
// 用法：node tools/recognize/browser-check.mjs [--budget 300]
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";

const args = process.argv.slice(2);
const getArg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const URL_ = getArg("--url", "http://127.0.0.1:5173/recognize.html");
const CHROME = getArg("--chrome", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
const BUDGET = Number(getArg("--budget", "300")) * 1000;   // 等模型就緒的上限
const OUT = resolve(import.meta.dirname, "out");
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);
const problems = [];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "shell",
  protocolTimeout: 1800000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=swiftshader",
         "--js-flags=--max-old-space-size=4096"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });
  page.on("console", (m) => {
    const text = m.text();
    if (m.type() === "error") { problems.push(`console.error: ${text}`); log(`  [console.error] ${text.slice(0, 300)}`); }
    else if (/\[recognize\]|ort|onnx/i.test(text)) log(`  [${m.type()}] ${text.slice(0, 300)}`);
  });
  page.on("pageerror", (e) => { problems.push(`pageerror: ${e.message}`); log(`  [pageerror] ${e.message.slice(0, 400)}`); });
  page.on("requestfailed", (r) => {
    const t = r.failure()?.errorText ?? "";
    if (t !== "net::ERR_ABORTED") { problems.push(`requestfailed ${r.url()}: ${t}`); log(`  [requestfailed] ${r.url().slice(0, 140)} :: ${t}`); }
  });

  log(`→ 開啟 ${URL_}`);
  await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 120000 });

  const snap = () => page.evaluate(() => {
    const r = window.__recognize;
    const d = r?.diag;
    return {
      ready: !!(d && d.yolo.state === "就緒" && d.dino.state === "就緒" && d.lib.state === "就緒"),
      failed: !!(d && (d.yolo.error || d.dino.error || d.lib.error)),
      ort: d?.ort, threads: d?.threads,
      yolo: d ? { state: d.yolo.state, bytes: d.yolo.bytes, loadMs: d.yolo.loadMs, error: d.yolo.error } : null,
      dino: d ? { state: d.dino.state, bytes: d.dino.bytes, loadMs: d.dino.loadMs, error: d.dino.error } : null,
      lib: d ? { state: d.lib.state, count: d.lib.count, photos: d.lib.photos } : null,
      stage: document.querySelector("#rc-stage")?.textContent,
      errors: [...document.querySelectorAll(".rc-error")].map((e) => e.textContent.slice(0, 300)),
      resources: performance.getEntriesByType("resource")
        .filter((e) => /onnx|ort|embeddings|worker/.test(e.name))
        .map((e) => `${e.name.split("/").pop()} ${(e.transferSize / 1048576).toFixed(1)}MB/${Math.round(e.duration)}ms`),
    };
  });

  const t0 = Date.now();
  let last = "";
  let s = null;
  while ((Date.now() - t0) < BUDGET) {
    await new Promise((r) => setTimeout(r, 4000));
    try { s = await snap(); } catch (e) { log(`  [snapshot 失敗] ${e.message.slice(0, 160)}`); continue; }
    const line = JSON.stringify({ y: s.yolo, d: s.dino, l: s.lib, st: s.stage });
    if (line !== last) {
      log(`  t+${((Date.now() - t0) / 1000).toFixed(0)}s  YOLO=${s.yolo?.state} DINOv2=${s.dino?.state} 庫=${s.lib?.state}${s.lib?.count ? `(${s.lib.count}棟/${s.lib.photos}張)` : ""}`);
      if (s.stage) log(`         stage: ${s.stage}`);
      if (s.resources?.length) log(`         已載入: ${s.resources.join(" · ")}`);
      if (s.errors?.length) log(`         !! ${s.errors.join(" | ")}`);
      last = line;
    }
    if (s.ready || s.failed) break;
  }

  if (!s) { log("!! 完全拿不到頁面狀態"); process.exitCode = 1; }
  else if (s.failed) {
    log(`\n!! 有元件載入失敗：YOLO=${s.yolo.error ?? "ok"} / DINOv2=${s.dino.error ?? "ok"} / 庫=${s.lib.state}`);
    process.exitCode = 1;
  } else if (!s.ready) {
    log(`\n!! ${Math.round((Date.now() - t0) / 1000)} 秒內沒能全部就緒（沒有明確錯誤）`);
    process.exitCode = 1;
  } else {
    log(`\n✓ 模型就緒（${((Date.now() - t0) / 1000).toFixed(1)} 秒）`);
    log(`  ORT ${s.ort} · ${s.threads} 執行緒`);
    log(`  YOLO ${(s.yolo.bytes / 1048576).toFixed(1)} MB · 載入 ${s.yolo.loadMs} ms`);
    log(`  DINOv2 ${(s.dino.bytes / 1048576).toFixed(1)} MB · 載入 ${s.dino.loadMs} ms`);
    log(`  嵌入庫 ${s.lib.count} 棟 / ${s.lib.photos} 張`);
    await page.screenshot({ path: resolve(OUT, "recognize-01-ready.png") });

    // ---- 跑完整 UI 流程（用真實照片；照片放在 photos-src，由 photo-server 提供）
    // 主標題（.rc-verdict h3）已改成「偵測到的類別」（標註的成果），
    // 所以「這是哪一棟」改看 .rc-known-line 裡最相似的已記錄建築。
    const CASES = [
      { file: "photos-src/cc/ruins-st-paul/Ruins_of_Saint_Paul_s_Macau_Ank_Kumar_01.jpg", label: "大三巴牌坊（實拍）", expect: "牌坊與紀念物", expectName: "大三巴" },
      { file: "photos-src/cc/moorish-barracks/Moorish_Barracks.jpg", label: "港務局大樓（實拍）", expect: "葡式殖民建築", expectName: "港務局" },
      { file: "photos-src/cc/a-ma-temple/A-Ma_Temple_Macau_built_1488_2_32043656663_.jpg", label: "媽閣廟（實拍）", expect: "中式廟宇", expectName: "媽閣" },
    ];
    const PHOTO_PORT = getArg("--photo-port", "5180");
    for (const c of CASES) {
      log(`→ 辨識「${c.label}」（走完整 UI：上傳 → 開始辨識）…`);
      const t1 = Date.now();
      try {
        await page.evaluate(async ({ url, name }) => {
          const resp = await fetch(url);
          const blob = await resp.blob();
          const file = new File([blob], name, { type: blob.type || "image/jpeg" });
          await window.__recognize.pickFile(file);
          document.querySelector("#rc-results").hidden = true;   // 清掉上一輪，才能等到新結果
          await window.__recognize.run();
        }, { url: `http://127.0.0.1:${PHOTO_PORT}/${c.file}`, name: c.file.split("/").pop() });
        await page.waitForFunction(() => !document.querySelector("#rc-results").hidden, { timeout: 300000, polling: 300 });
      } catch (e) {
        log(`  !! 等不到結果：${e.message.slice(0, 200)}`);
        problems.push(`run ${c.label}: ${e.message.slice(0, 200)}`);
        continue;
      }
      const r = await page.evaluate(() => ({
        verdict: document.querySelector(".rc-verdict-tag")?.textContent,
        title: document.querySelector(".rc-verdict h3")?.textContent,
        sub: document.querySelector(".rc-verdict-sub")?.textContent,
        known: document.querySelector(".rc-known-line")?.textContent,
        dedup: document.querySelector(".rc-dedup-line b")?.textContent,
        secHead: document.querySelector(".rc-sec-head h3")?.textContent,
        cardDedup: [...document.querySelectorAll(".rc-card .rc-dedup-text")].map((e) => e.textContent),
        discover: !!document.querySelector("#rc-newform"),
        meta: document.querySelector(".rc-meta")?.textContent,
        boxes: [...document.querySelectorAll(".rc-box text")].map((t) => t.textContent),
        cards: [...document.querySelectorAll(".rc-card")].map((c2) => ({
          name: c2.querySelector("h4")?.textContent,
          sim: c2.querySelector(".rc-sim b")?.textContent,
          bar: c2.querySelector(".rc-bar-wrap i")?.style.width,
          model: !!c2.querySelector("[data-model]"),
          map: !!c2.querySelector("a[href*=spot]"),
        })),
        last: window.__recognize.diag.last,
        errors: [...document.querySelectorAll(".rc-error")].map((e) => e.textContent.slice(0, 200)),
      }));
      const okClass = r.title?.includes(c.expect);
      const okName = (r.known ?? "").includes(c.expectName);
      const ok = okClass && okName;
      log(`  （${((Date.now() - t1) / 1000).toFixed(1)} 秒）${ok ? "✓" : "✗"} ${r.verdict} → ${r.title}`);
      if (!okClass) log(`  ✗ 類別主標題期望含「${c.expect}」`);
      if (!okName) log(`  ✗ 查重最相似者期望含「${c.expectName}」`);
      log(`  ${r.sub}`);
      log(`  查重：${r.dedup}`);
      log(`  最相似已記錄：${r.known}`);
      log(`  區塊標題：${r.secHead}`);
      log(`  ${r.meta}`);
      log(`  偵測框：${r.boxes.join(" / ") || "（無）"}`);
      for (const cc of r.cards) log(`    · ${cc.name} 相似度 ${cc.sim}（長條 ${cc.bar}）模型=${cc.model} 地圖=${cc.map}`);
      log(`  卡片查重結論：${r.cardDedup.join(" ／ ") || "（無）"}`);
      log(`  建檔表單（普查主流程，每次辨識後都應該出現）：${r.discover ? "有" : "無"}`);
      log(`  耗時：YOLO ${r.last.detectMs}ms · DINOv2 ${r.last.embedMs}ms · 總 ${r.last.totalMs}ms`);
      if (!okClass) problems.push(`${c.label}: 類別主標題 = ${r.title}（期望含 ${c.expect}）`);
      if (!okName) problems.push(`${c.label}: 查重最相似者 = ${r.known}（期望含 ${c.expectName}）`);
      if (r.errors.length) { log(`  !! ${r.errors.join(" | ")}`); problems.push(...r.errors); }
      await page.screenshot({ path: resolve(OUT, `recognize-${c.label.replace(/[^\w\u4e00-\u9fa5（）]/g, "")}.png`) });
    }

    // ---- 手機寬度
    await page.setViewport({ width: 420, height: 900, deviceScaleFactor: 2 });
    await new Promise((r) => setTimeout(r, 700));
    await page.screenshot({ path: resolve(OUT, "recognize-mobile.png"), fullPage: true });

    // ---- 主站首頁仍正常？
    log("→ 檢查主站首頁（既有地圖）…");
    const p2 = await browser.newPage();
    const homeErrors = [];
    p2.on("pageerror", (e) => homeErrors.push(e.message));
    p2.on("console", (m) => { if (m.type() === "error") homeErrors.push(m.text()); });
    await p2.goto(new URL("./", URL_).href, { waitUntil: "networkidle2", timeout: 120000 });
    await new Promise((r) => setTimeout(r, 5000));
    const home = await p2.evaluate(() => ({
      title: document.title,
      boot: document.querySelector("#boot-status")?.textContent,
      map: !!window.__map,
      canvas: !!document.querySelector(".maplibregl-canvas"),
    }));
    log(`  主站：${home.title} · boot="${home.boot}" · map=${home.map} · canvas=${home.canvas}`);
    if (homeErrors.length) { log(`  !! 主站錯誤：${homeErrors.slice(0, 4).join(" | ")}`); problems.push(...homeErrors.slice(0, 4)); }
    await p2.screenshot({ path: resolve(OUT, "home-after.png") });
    log(`\n主站 console 錯誤：${homeErrors.length ? homeErrors.length + " 筆" : "無"}`);
  }

  log(`\n=== 摘要 ===`);
  log(problems.length ? `發現 ${problems.length} 個問題：\n  ${[...new Set(problems)].slice(0, 10).join("\n  ")}` : "沒有 console 錯誤/請求失敗");
  if (problems.length) process.exitCode = 1;
} finally {
  await browser.close();
}
