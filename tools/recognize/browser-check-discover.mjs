// 驗證「建檔」這條路徑（UI → SQLite ＋ localStorage 鏡射 → 重新整理後備份還在）。
//
// 這支原本驗的是「標記為新發現」只在查重 <0.48 時出現、而且只把資料收進 localStorage。
// 這一輪產品規則改了（普查建檔成為每次辨識後的主流程），所以斷言跟著調整：
//   · #rc-discover-open 這個「要先按一下才開表單」的閘門移除了 → 改成檢查表單直接可見
//   · 名稱從必填改成可留空（留空自動命名「未命名{類別} #序號」）→ 改成檢查自動命名
//   · 「已記錄」時不再隱藏建檔區塊 → 改成檢查「區塊仍在，且查重結論正確顯示已記錄」
//   · 紀錄的欄位 cls 更名為 type（對齊 SQLite 的 buildings.type）→ 斷言改讀 type
//   · 新增：編號 MM-YYYY-NNNN、真的寫進 SQLite、R-Tree 查重提示
// 其餘（note 不能被定位訊息蓋掉、失敗原因要記下來、重新整理後備份還在）一律保留原樣。
//
// 用法：node tools/recognize/browser-check-discover.mjs
//   前置：Vite dev server（5173）
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";

const args = process.argv.slice(2);
const getArg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const URL_ = getArg("--url", "http://127.0.0.1:5173/recognize.html");
const CHROME = getArg("--chrome", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
const OUT = resolve(import.meta.dirname, "out");
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);
const problems = [];
const KEY = "macau-memory.pending-discoveries";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "shell",
  protocolTimeout: 900000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=swiftshader"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });
  page.on("console", (m) => {
    if (m.type() === "error") { problems.push(`console.error: ${m.text()}`); log(`  [console.error] ${m.text().slice(0, 300)}`); }
    else if (/建檔|SQLite|普查/.test(m.text())) log(`  [console.log] ${m.text().slice(0, 400)}`);
  });
  page.on("pageerror", (e) => { problems.push(`pageerror: ${e.message}`); log(`  [pageerror] ${e.message.slice(0, 400)}`); });

  log(`→ 開啟 ${URL_}`);
  await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 120000 });
  // 等嵌入庫就緒（類別下拉要靠 libMeta.categories）
  await page.waitForFunction(() => window.__recognize?.meta?.count > 0, { timeout: 300000, polling: 500 });
  // 再等載入遮罩真的收起來：遮罩還在時會擋住點擊（Puppeteer 會說 not clickable）
  await page.waitForFunction(() => document.querySelector("#rc-overlay")?.hidden === true, { timeout: 120000, polling: 200 });
  await page.evaluate(() => localStorage.removeItem("macau-memory.pending-discoveries"));

  // ---- 餵一組「尚未記錄」的結果（最高相似度 0.31 < 0.48）
  log("→ 注入一組「尚未記錄」的結果（最高相似度 0.31）並重畫…");
  const injected = await page.evaluate(() => {
    const mk = (zh, cls, sim, spot, model) => ({ id: zh, zh, en: null, cls, clsZh: cls, spot, model, count: 3, sim, margin: 0, clsMatch: null });
    return window.__recognize.showResults({
      results: [{
        index: 0, box: { x: 120, y: 90, w: 1280, h: 853 }, cls: "tong_lau", clsZh: "騎樓與唐樓",
        score: 0.722, source: "yolo",
        topK: [mk("大三巴牌坊", "monument", 0.311, "ruins-of-st-paul", null), mk("媽閣廟", "temple", 0.29, "a-ma-temple", null)],
        totalCompared: 21, margin: 0.021, thresholds: { hit: 0.82, maybe: 0.48 },
      }],
      width: 1280, height: 853, file: "查重示範.jpg",
    });
  });
  if (!injected) problems.push("showResults 回傳 false");
  await new Promise((r) => setTimeout(r, 400));

  const view = await page.evaluate(() => ({
    head: document.querySelector("#rc-results .rc-verdict h3")?.textContent,
    sub: document.querySelector(".rc-verdict-sub")?.textContent,
    dedupLine: document.querySelector(".rc-dedup-line b")?.textContent,
    known: document.querySelector(".rc-known-line")?.textContent,
    secHead: document.querySelector(".rc-sec-head h3")?.textContent,
    cardDedup: [...document.querySelectorAll(".rc-card .rc-dedup-text")].map((e) => e.textContent),
    cardClass: [...document.querySelectorAll(".rc-card .rc-dedup")].map((e) => e.className),
    btn: document.querySelector("#rc-nd-save")?.textContent,
    discoverShown: !document.querySelector("#rc-discover")?.hidden && !!document.querySelector("#rc-discover"),
    formHidden: document.querySelector("#rc-newform")?.hidden,
    formVisible: document.querySelector("#rc-newform")?.offsetParent !== null,
    code: document.querySelector("#rc-nd-code")?.value,
    nearby: document.querySelector("#rc-nd-nearby")?.textContent?.replace(/\s+/g, " ").trim(),
    catCount: document.querySelectorAll("#rc-nd-cls option").length,
    catFirst: document.querySelector("#rc-nd-cls option")?.textContent,
    catSelected: document.querySelector("#rc-nd-cls")?.value,
    legacy: {
      fileInput: !!document.querySelector("#rc-file"),
      drop: !!document.querySelector("#rc-drop"),
      demo: document.querySelectorAll("#rc-demo-list [data-demo]").length,
      viewer: !!document.querySelector("#viewer"),
      diag: !!document.querySelector("#diag-body") && !!document.querySelector("#rc-diag-summary"),
      diagThresholdRow: [...document.querySelectorAll(".dg-row")].map((r) => r.textContent).find((t) => t.includes("查重門檻")),
    },
  }));
  log(`  主標題：${view.head}`);
  log(`  副標題：${view.sub}`);
  log(`  查重結論（大字區）：${view.dedupLine}`);
  log(`  與已記錄相似度：${view.known}`);
  log(`  區塊標題：${view.secHead}`);
  log(`  卡片查重結論：${view.cardDedup.join(" ／ ")}`);
  log(`  建檔表單：直接可見=${view.formVisible}｜編號 ${view.code}｜類別選項 ${view.catCount} 個（第一項 ${view.catFirst}）預設選中 ${view.catSelected}`);
  log(`  空間查重提示：${view.nearby}`);
  log(`  既有功能：上傳=${view.legacy.fileInput} 拖放=${view.legacy.drop} 示範素材=${view.legacy.demo} 個 viewer=${view.legacy.viewer} 診斷=${view.legacy.diag}`);
  log(`  診斷列：${view.legacy.diagThresholdRow}`);
  await page.screenshot({ path: resolve(OUT, "discover-01-尚未記錄.png") });

  if (!view.head?.includes("偵測到：騎樓與唐樓")) problems.push(`主標題不是類別：${view.head}`);
  if (!/信心 72\.2%/.test(view.sub ?? "")) problems.push(`副標題沒有信心值：${view.sub}`);
  if (!view.dedupLine?.startsWith("尚未記錄")) problems.push(`查重結論不是「尚未記錄」：${view.dedupLine}`);
  if (view.secHead !== "已記錄的相似建築（查重）") problems.push(`區塊標題錯：${view.secHead}`);
  if (view.catCount !== 12) problems.push(`類別選項應為 12 個，實得 ${view.catCount}`);
  if (view.catSelected !== "tong_lau") problems.push(`類別預設應帶入 YOLO 的 tong_lau，實得 ${view.catSelected}`);
  if (view.formVisible !== true) problems.push("建檔表單沒有直接顯示（產品規則：每次辨識後都要出現）");
  if (!/^MM-\d{4}-\d{4}$/.test(view.code ?? "")) problems.push(`編號格式不是 MM-YYYY-NNNN：${view.code}`);
  if (view.legacy.demo !== 4) problems.push(`示範素材按鈕應為 4 個，實得 ${view.legacy.demo}`);
  if (!view.legacy.diagThresholdRow?.includes("0.82")) problems.push("診斷區塊沒有查重門檻列");

  // ---- 名稱留空 → 自動命名（產品規則：名稱改為可留空，留空自動命名「未命名{類別} #序號」）
  log("→ 先測「名稱留空會自動命名」，並確認真的寫進 SQLite…");
  await page.click("#rc-nd-save");
  await new Promise((r) => setTimeout(r, 600));
  const auto = await page.evaluate(() => ({
    err: document.querySelector("#rc-nd-err")?.hidden === false ? document.querySelector("#rc-nd-err").textContent : null,
    ok: document.querySelector("#rc-nd-ok")?.textContent?.replace(/\s+/g, " ").trim(),
    previewShown: document.querySelector("#rc-nd-preview")?.hidden === false,
    stored: JSON.parse(localStorage.getItem("macau-memory.pending-discoveries") ?? "[]"),
    total: window.__survey?.total,
    codes: (window.__survey?.json?.buildings ?? []).map((b) => b.code),
  }));
  log(`  錯誤提示：${auto.err ?? "（沒有擋下，符合新規則）"}`);
  log(`  存檔訊息：${auto.ok}`);
  log(`  自動命名：${auto.stored[0]?.building?.name}｜編號 ${auto.stored[0]?.code}｜資料庫 ${auto.total} 筆`);
  if (auto.err) problems.push(`名稱留空不該被擋下（新規則會自動命名）：${auto.err}`);
  if (!/已寫入 SQLite/.test(auto.ok ?? "")) problems.push(`存檔訊息沒有顯示已寫入 SQLite：${auto.ok}`);
  if (auto.stored.length !== 1) problems.push(`名稱留空後 localStorage 應有 1 筆，實得 ${auto.stored.length}`);
  if (!/^未命名騎樓與唐樓 #0001$/.test(auto.stored[0]?.building?.name ?? "")) problems.push(`自動命名不如預期：${auto.stored[0]?.building?.name}`);
  if (auto.total !== 1) problems.push(`SQLite 應有 1 筆，實得 ${auto.total}`);
  if (auto.stored[0]?.code !== auto.codes[0]) problems.push(`資料庫編號與紀錄不一致：${auto.stored[0]?.code} vs ${auto.codes[0]}`);
  await page.screenshot({ path: resolve(OUT, "discover-02-自動命名.png") });

  // ---- 測「取得定位」失敗要顯示可讀訊息（headless 沒有授權 → 應該走 error 回呼）
  log("→ 測「取得定位」（headless 預期失敗，要顯示可讀訊息）…");
  // 先等自動取樣那一輪結束，否則按鈕是停用中的（disabled 不會觸發 click）
  await page.waitForFunction(() => window.__survey?.survey?.state?.session == null, { timeout: 30000, polling: 200 });
  await page.click("#rc-nd-geo");
  await new Promise((r) => setTimeout(r, 2500));
  const geo = await page.evaluate(() => document.querySelector("#rc-nd-locstate")?.textContent);
  log(`  位置狀態：${geo}`);
  if (!geo || geo.startsWith("正在取得") || geo.startsWith("取樣中")) problems.push(`定位沒有給出結果訊息：${geo}`);
  if (!/你拒絕了定位授權/.test(geo ?? "")) problems.push(`定位失敗訊息不是可讀的授權說明：${geo}`);

  // ---- 正常存檔（填名稱／備註）
  log("→ 填名稱／類別／備註，按存檔…");
  await page.evaluate(() => {
    const n = document.querySelector("#rc-nd-name");
    n.value = "沙梨頭麻子街 21 號唐樓";
    n.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("#rc-nd-cls").value = "tong_lau";
    document.querySelector("#rc-nd-note").value = "巷口第二棟，二樓木窗完整";
  });
  await page.click("#rc-nd-save");
  await new Promise((r) => setTimeout(r, 600));
  const saved = await page.evaluate((KEY) => {
    const raw = localStorage.getItem(KEY);
    return {
      raw, ok: document.querySelector("#rc-nd-ok")?.hidden === false ? document.querySelector("#rc-nd-ok").textContent : null,
      json: document.querySelector("#rc-nd-json")?.textContent,
      list: document.querySelector("#rc-ledger-mirror")?.textContent,
    };
  }, KEY);
  log(`  說明：${saved.ok}`);
  log(`  清單：${saved.list?.replace(/\s+/g, " ").trim()}`);
  log(`  預覽 JSON（前 700 字）：\n${(saved.json ?? "").slice(0, 700)}`);
  if (!/已寫入 SQLite/.test(saved.ok ?? "")) problems.push("存檔後沒有顯示「已寫入 SQLite」");
  if (!saved.raw) problems.push("localStorage 沒有寫入");
  const parsed = JSON.parse(saved.raw ?? "[]");
  if (parsed.length !== 2) problems.push(`localStorage 應有 2 筆，實得 ${parsed.length}`);
  const rec = parsed[1] ?? {};
  // 紀錄欄位改名：cls → type（對齊 SQLite 的 buildings.type）
  for (const [k, v] of [["building.name", rec.building?.name], ["building.type", rec.building?.type], ["status", rec.status], ["detection.cls", rec.detection?.cls]]) {
    if (!v) problems.push(`紀錄缺少 ${k}`);
  }
  // 迴歸測試：定位狀態訊息曾經蓋掉使用者填的「備註」（欄位撞名）
  if (rec.building?.note !== "巷口第二棟，二樓木窗完整") problems.push(`使用者備註被蓋掉了：${rec.building?.note}`);
  if (!/你拒絕了定位授權/.test(rec.building?.location?.unavailableReason ?? "")) problems.push(`定位失敗原因沒有被記下：${rec.building?.location?.unavailableReason}`);
  const codes = parsed.map((r) => r.code);
  if (new Set(codes).size !== codes.length) problems.push(`編號重複：${codes.join(" ")}`);
  if (Number(codes[1]?.split("-")[2]) !== Number(codes[0]?.split("-")[2]) + 1) problems.push(`編號沒有遞增：${codes.join(" ")}`);
  await page.screenshot({ path: resolve(OUT, "discover-03-已存檔.png") });

  // ---- 重新整理後還在嗎
  log("→ 重新整理，確認本機備份還在…");
  await page.reload({ waitUntil: "domcontentloaded" });
  const after = await page.evaluate((KEY) => {
    const raw = localStorage.getItem(KEY);
    return { n: JSON.parse(raw ?? "[]").length, first: JSON.parse(raw ?? "[]")[0]?.building?.name ?? null };
  }, KEY);
  log(`  重新整理後：${after.n} 筆（第一筆「${after.first}」）`);
  if (after.n !== 2) problems.push(`重新整理後本機備份應仍有 2 筆，實得 ${after.n}`);

  // ---- 「已記錄」時仍然可以建檔（產品規則改變處：建檔是主流程，不再限於「尚未記錄」）
  log("→ 餵一組「很可能已記錄」（0.969）的結果，確認建檔區塊仍在、而查重結論正確…");
  await page.waitForFunction(() => window.__recognize?.meta?.count > 0, { timeout: 300000, polling: 500 });
  await page.waitForFunction(() => document.querySelector("#rc-overlay")?.hidden === true, { timeout: 120000, polling: 200 });
  await page.evaluate(() => {
    const mk = (zh, cls, sim, spot) => ({ id: zh, zh, en: null, cls, clsZh: cls, spot, model: null, count: 5, sim, margin: 0, clsMatch: true });
    window.__recognize.showResults({
      results: [{
        index: 0, box: { x: 120, y: 90, w: 1280, h: 853 }, cls: "temple", clsZh: "中式廟宇",
        score: 0.922, source: "yolo",
        topK: [mk("媽閣廟", "temple", 0.969, "a-ma-temple"), mk("哪咤廟", "temple", 0.60, null)],
        totalCompared: 21, margin: 0.369, thresholds: { hit: 0.82, maybe: 0.48 },
      }],
      width: 1280, height: 853, file: "查重示範2.jpg",
    });
  });
  await new Promise((r) => setTimeout(r, 400));
  const hit = await page.evaluate(() => ({
    head: document.querySelector("#rc-results .rc-verdict h3")?.textContent,
    dedupLine: document.querySelector(".rc-dedup-line b")?.textContent,
    discover: !!document.querySelector("#rc-discover"),
    formVisible: document.querySelector("#rc-newform")?.offsetParent !== null,
    verdict: document.querySelector("#rc-survey-verdict")?.textContent?.replace(/\s+/g, " ").trim(),
    cardDedup: document.querySelector(".rc-card .rc-dedup-text")?.textContent,
  }));
  log(`  主標題：${hit.head}`);
  log(`  查重結論：${hit.dedupLine}`);
  log(`  卡片查重：${hit.cardDedup}`);
  log(`  建檔區塊存在：${hit.discover} · 表單可見：${hit.formVisible}（新規則：仍然是 true）`);
  log(`  建檔區塊帶入的查重結論：${hit.verdict?.slice(0, 60)}…`);
  if (!hit.discover || !hit.formVisible) problems.push("「已記錄」時建檔表單不見了（新規則：建檔是主流程，仍要顯示）");
  if (!/很可能已記錄/.test(hit.verdict ?? "")) problems.push(`建檔區塊沒有帶入「已記錄」的查重結論：${hit.verdict}`);
  if (!hit.dedupLine?.startsWith("很可能已記錄")) problems.push(`已記錄的結論不對：${hit.dedupLine}`);
  await page.screenshot({ path: resolve(OUT, "discover-04-已記錄.png") });

  // ---- 手機寬度
  await page.setViewport({ width: 420, height: 900, deviceScaleFactor: 2 });
  await new Promise((r) => setTimeout(r, 500));
  await page.evaluate(() => {
    const mk = (zh, cls, sim) => ({ id: zh, zh, en: null, cls, clsZh: "騎樓與唐樓", spot: null, model: null, count: 3, sim, margin: 0, clsMatch: null });
    window.__recognize.showResults({
      results: [{
        index: 0, box: { x: 120, y: 90, w: 1280, h: 853 }, cls: "tong_lau", clsZh: "騎樓與唐樓",
        score: 0.722, source: "yolo",
        topK: [mk("大三巴牌坊", "monument", 0.311), mk("媽閣廟", "temple", 0.29)],
        totalCompared: 21, margin: 0.021, thresholds: { hit: 0.82, maybe: 0.48 },
      }],
      width: 1280, height: 853, file: "查重示範.jpg",
    });
  });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: resolve(OUT, "discover-05-手機.png"), fullPage: true });
  const overflow = await page.evaluate(() => ({
    docW: document.documentElement.scrollWidth, winW: window.innerWidth,
    // 地圖（#rc-nd-minimap）內部的標記由 MapLibre 定位、且被容器裁切，不算版面溢出
    wide: [...document.querySelectorAll("#rc-results *, #rc-survey-host *")]
      .filter((e) => !e.closest("#rc-nd-minimap"))
      .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 2).map((e) => e.className || e.tagName).slice(0, 6),
  }));
  log(`→ 手機：文件寬 ${overflow.docW} / 視窗寬 ${overflow.winW}${overflow.wide.length ? `｜溢出元素：${overflow.wide.join(", ")}` : "｜沒有元素溢出"}`);
  if (overflow.docW > overflow.winW + 2) problems.push(`手機寬度出現水平溢出（${overflow.docW} > ${overflow.winW}）`);
} finally {
  await browser.close();
}

log(`\n=== 摘要 ===`);
log(problems.length ? `發現 ${problems.length} 個問題：\n  ${[...new Set(problems)].join("\n  ")}` : "沒有 console 錯誤/請求失敗，且建檔流程（含 SQLite 寫入與自動命名）符合預期");
if (problems.length) process.exitCode = 1;
