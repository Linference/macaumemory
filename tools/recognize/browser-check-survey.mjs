// 端到端驗證「普查建檔」這條主流程：辨識 → GPS 精準定位 → 編號 → SQLite → R-Tree 查重 → 匯出
//                          ＋ 持久化（重新整理後資料還在）→ 舊備份救援 → 節流落地 → 配額失敗。
//
// 為什麼要另一支（browser-check.mjs / browser-check-discover.mjs 之外）：
//   那兩支驗的是「模型能不能跑」「查重結論對不對」。這一輪新增的是資料庫、GPS 多次取樣、
//   空間查重與匯出，光看 UI 字串不夠，要真的：
//     · 用 CDP 的 Emulation.setGeolocationOverride 造出「有 GPS」「精度很差」「讀數跳動」三種情境
//     · 從資料庫把寫進去的資料讀回來比對（不是只看畫面文字）
//     · 把匯出的 .sqlite 檔用 sqlite-wasm（Node 建置）打開，確認它是可攜的真的 SQLite 檔
//
// ─────────────────────────────────────────────────────────────────────────
// ⚠️ 這一版把 ⑭ 的斷言方向反過來了（**不是**為了讓測試好過，是產品行為真的修好了）
// ─────────────────────────────────────────────────────────────────────────
// 原本 ⑭ 的斷言是：
//     ok(after.total === 0, "重新整理後記憶體資料庫是空的（第一階段不做 OPFS 持久化的已知行為）");
//     ok(after.persistent === false && after.persistence === "memory", "...第二階段換 OPFS");
// 它記錄的是「資料庫只活在記憶體」這個**已知缺陷**：使用者重新整理後 DB 0 筆、備份卻有 4 筆。
// 這一輪把持久化做出來（OPFS／localStorage，見 src/recognize/db.js），所以那兩條斷言現在
// 必須**反過來**，而且驗得比原本更嚴：
//     · 重新整理（真的 page.reload）後筆數、編號、欄位（類型／名稱／狀態／座標／精度／樣本數／
//       來源／定位時間／建立時間）都要一模一樣
//     · 持久化方式不得是 memory，而且 UI（資料庫面板＋診斷區塊）要看得到是哪一種
//     · 再加三組新測試：重整後續建編號不衝突、舊 localStorage 鏡射要被救援進資料庫、
//       連續快速存 3 筆後「立刻」重整也不能掉資料（節流＋關頁前強制落地）
// 也就是說：原本只驗「有沒有壞」，現在驗「有沒有真的存下來」。
//
// 用法：node tools/recognize/browser-check-survey.mjs
//   前置：Vite dev server（5173）。這一支不需要 5180 的照片伺服器（不跑模型，直接注入辨識結果）。
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import puppeteer from "puppeteer-core";

const args = process.argv.slice(2);
const getArg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const URL_ = getArg("--url", "http://127.0.0.1:5173/recognize.html");
const CHROME = getArg("--chrome", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
const OUT = resolve(import.meta.dirname, "out");
const DOWNLOADS = resolve(OUT, "downloads");
mkdirSync(OUT, { recursive: true });
rmSync(DOWNLOADS, { recursive: true, force: true });
mkdirSync(DOWNLOADS, { recursive: true });

const log = (...a) => console.log(...a);
const problems = [];
const checks = [];
/** 斷言：通過就印 ✓，失敗就記進 problems（最後以退出碼 1 回報） */
function ok(cond, msg, extra = "") {
  checks.push({ cond: !!cond, msg });
  log(`  ${cond ? "✓" : "✗"} ${msg}${extra ? `　→ ${extra}` : ""}`);
  if (!cond) problems.push(msg);
}

/** 呼叫 Python 驗證匯出檔（獨立於瀏覽器與 sqlite-wasm 的另一套 SQLite 實作） */
function runPython(argv) {
  const r = spawnSync("python", argv, { encoding: "utf8", timeout: 60000 });
  if (r.error || r.status !== 0) {
    log(`  [python] ${r.error?.message ?? r.stderr?.slice(0, 300) ?? `exit ${r.status}`}`);
    return null;
  }
  try { return JSON.parse(r.stdout.trim().split("\n").pop()); } catch (e) { log(`  [python 解析失敗] ${e.message}／${String(r.stdout).slice(0, 200)}`); return null; }
}

// 澳門半島真座標（大三巴牌坊一帶）
const A = { lat: 22.197458, lng: 113.540839 };
const B = { lat: 22.197568, lng: 113.540839 };     // 往北 ≈ 12 公尺
const FAR = { lat: 22.199258, lng: 113.540839 };   // 往北 ≈ 200 公尺（跳動測試用）

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "shell",
  protocolTimeout: 900000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=swiftshader"],
});

try {
  const context = browser.defaultBrowserContext();
  await context.overridePermissions(new URL(URL_).origin, ["geolocation"]);
  const page = await browser.newPage();
  const client = await page.createCDPSession();
  await client.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DOWNLOADS });
  const setGeo = (c) => client.send("Emulation.setGeolocationOverride", { latitude: c.lat, longitude: c.lng, accuracy: c.accuracy ?? 8 });
  await setGeo({ ...A, accuracy: 8 });
  /** 每次重新整理後遮罩都會回來（模型在背景載入）：程式點掉它，免得擋住後面的點擊 */
  const dismissOverlay = async () => {
    await page.evaluate(() => document.querySelector("#rc-overlay-skip")?.click());
    await page.waitForFunction(() => {
      const o = document.querySelector("#rc-overlay");
      return !o || o.hidden || o.classList.contains("gone");
    }, { timeout: 30000, polling: 100 }).catch(() => {});
  };

  await page.setViewport({ width: 1440, height: 1200, deviceScaleFactor: 1 });
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error") { problems.push(`console.error: ${t}`); log(`  [console.error] ${t.slice(0, 300)}`); }
    else if (/\[survey\]|SQLite|sqlite/i.test(t)) log(`  [console.log] ${t.slice(0, 240)}`);
  });
  page.on("pageerror", (e) => { problems.push(`pageerror: ${e.message}`); log(`  [pageerror] ${e.message.slice(0, 400)}`); });
  page.on("requestfailed", (r) => {
    const t = r.failure()?.errorText ?? "";
    if (t !== "net::ERR_ABORTED") { problems.push(`requestfailed ${r.url()}: ${t}`); log(`  [requestfailed] ${r.url().slice(0, 130)} :: ${t}`); }
  });

  log(`→ 開啟 ${URL_}`);
  await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 120000 });

  // ---------------------------------------------------------------- ① SQLite 就緒
  log("\n① SQLite（sqlite-wasm）在瀏覽器裡的就緒狀態＋持久化 provider");
  await page.waitForFunction(() => window.__survey?.db?.ready === true, { timeout: 120000, polling: 200 });
  const db = await page.evaluate(() => window.__survey.db);
  log(`  ${JSON.stringify(db)}`);
  ok(db.ready, "SQLite 已就緒（sqlite-wasm）");
  ok(db.schemaVersion === 1, `schema v1（實得 v${db.schemaVersion}）`);
  ok(/SQLite/.test(db.engine ?? ""), `引擎字串：${db.engine}`);
  ok(db.persistent === true && db.persistence !== "memory",
    `自動挑到可持久化的 provider（${db.persistence}／${db.persistenceLabel}），不是記憶體`);
  const wasmReq = await page.evaluate(() => performance.getEntriesByType("resource").filter((e) => /sqlite3\.wasm/.test(e.name)).map((e) => ({ url: e.name.split("/").slice(-1)[0], bytes: e.transferSize, ms: Math.round(e.duration) })));
  log(`  sqlite3.wasm 請求：${JSON.stringify(wasmReq)}`);
  ok(wasmReq.length > 0, "sqlite3.wasm 是走 Vite 的資產 URL 載入的（不是 public/ 的 import）");

  // 先把載入遮罩關掉（模型在背景繼續載；這支測試不跑模型）
  await dismissOverlay();
  await page.evaluate(() => localStorage.removeItem("macau-memory.pending-discoveries"));

  // 這一輪之後的斷言都假設「從 0 筆開始」：先把裝置上的存檔與資料庫清乾淨再重新整理。
  // 這樣即使測試被跑在一個帶著舊資料的 profile 上（例如 --user-data-dir）也不會誤判，
  // 同時也驗證「持久化不只能寫，也能清」。
  log("  → 清空裝置上的存檔＋資料庫，重新整理確認真的是 0 筆");
  await page.evaluate(async () => { await window.__survey.wipeAll(); });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__survey?.db?.ready === true, { timeout: 120000, polling: 200 });
  const fresh = await page.evaluate(() => ({
    total: window.__survey.total,
    persistence: window.__survey.db.persistence,
    restored: window.__survey.db.restoredFrom,
  }));
  log(`  清空後重新整理：${fresh.total} 筆 · provider=${fresh.persistence} · 還原=${JSON.stringify(fresh.restored)}`);
  ok(fresh.total === 0, `清空後重新整理仍是 0 筆（實得 ${fresh.total}）`);
  await dismissOverlay();
  await page.evaluate(() => localStorage.removeItem("macau-memory.pending-discoveries"));

  // ---------------------------------------------------------------- ② 注入辨識結果 → 建檔區塊出現
  log("\n② 注入一筆「尚未記錄」的辨識結果 → 建檔區塊應該每次都出現");
  const inject = (sim, cls, clsZh, file) => page.evaluate(({ sim, cls, clsZh, file }) => {
    const mk = (zh, c, s) => ({ id: zh, zh, en: null, cls: c, clsZh: c, spot: null, model: null, count: 3, sim: s, margin: 0, clsMatch: null });
    return window.__recognize.showResults({
      results: [{
        index: 0, box: { x: 40, y: 40, w: 900, h: 640 }, cls, clsZh, score: 0.712, source: "yolo",
        topK: [mk("大三巴牌坊", "monument", sim), mk("媽閣廟", "temple", Math.max(0.1, sim - 0.05))],
        totalCompared: 38, margin: 0.02, thresholds: { hit: 0.82, maybe: 0.48 },
      }],
      width: 900, height: 640, file,
    });
  }, { sim, cls, clsZh, file });

  await inject(0.31, "tong_lau", "騎樓與唐樓", "普查示範-唐樓.jpg");
  await new Promise((r) => setTimeout(r, 800));
  const block = await page.evaluate(() => ({
    host: !document.querySelector("#rc-survey-host")?.hidden,
    form: !!document.querySelector("#rc-newform"),
    formVisible: document.querySelector("#rc-newform")?.offsetParent !== null,
    code: document.querySelector("#rc-nd-code")?.value,
    cats: document.querySelectorAll("#rc-nd-cls option").length,
    type: document.querySelector("#rc-nd-cls")?.value,
    verdict: document.querySelector("#rc-survey-verdict")?.textContent?.replace(/\s+/g, " ").slice(0, 120),
  }));
  log(`  表單：顯示=${block.formVisible} 編號=${block.code} 類型=${block.type} 類別選項=${block.cats}`);
  log(`  查重結論：${block.verdict}`);
  ok(block.formVisible, "建檔表單直接顯示（不用先按「標記為新發現」）");
  ok(/^MM-\d{4}-\d{4}$/.test(block.code ?? ""), `編號格式 MM-YYYY-NNNN：${block.code}`);
  ok(block.cats === 12, `類型下拉 12 個選項（實得 ${block.cats}）`);
  ok(block.type === "tong_lau", `類型自動帶入 YOLO 判定（實得 ${block.type}）`);

  // ---------------------------------------------------------------- ③ GPS 多次取樣（理想情境）
  log("\n③ GPS 精準定位：多次取樣 → 精度加權 → 達到目標精度自動停");
  const planInfo = await page.evaluate(() => {
    const opts = [...document.querySelectorAll("#rc-nd-geo-plan option")].map((o) => ({ v: o.value, t: o.textContent }));
    return { opts, current: document.querySelector("#rc-nd-geo-plan")?.value, plans: window.__survey.plans };
  });
  log(`  取樣計畫選項：${planInfo.opts.map((o) => o.t).join(" ／ ")}`);
  ok(planInfo.current === "standard", `預設計畫是「標準」（實得 ${planInfo.current}）`);
  ok(planInfo.plans.standard.maxSamples === 30 && planInfo.plans.standard.intervalMs === 1000 && planInfo.plans.standard.targetAccuracyM === 5,
    `標準計畫＝30 次 × 1 秒 · 目標 5 公尺（實得 ${JSON.stringify(planInfo.plans.standard)}）`);

  // 模擬精度 8 公尺：用「快速」計畫（8 次 × 0.25 秒 · 目標 15 公尺）→ 3 次就會達到目標精度
  await page.select("#rc-nd-geo-plan", "quick");
  await new Promise((r) => setTimeout(r, 300));
  await page.click("#rc-nd-geo");
  await new Promise((r) => setTimeout(r, 1500));
  const g1 = await page.evaluate(() => ({
    status: document.querySelector("#rc-nd-locstate")?.textContent,
    cls: document.querySelector("#rc-nd-locstate")?.className,
    samples: [...document.querySelectorAll("#rc-nd-geo-samples li")].map((li) => li.textContent.replace(/\s+/g, " ").trim()),
    bar: document.querySelector("#rc-nd-geo-bar")?.style.width,
    loc: window.__survey.survey.location,
    warn: document.querySelector("#rc-nd-geo-warn")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    doneHidden: document.querySelector("#rc-nd-geo-done")?.hidden,
  }));
  log(`  狀態：${g1.status}`);
  log(`  讀數：${g1.samples.join(" ｜ ")}`);
  log(`  進度條：${g1.bar} · 完成鈕已收起=${g1.doneHidden}`);
  ok(/完成：最終座標/.test(g1.status ?? ""), "定位完成並顯示最終座標");
  ok(/最終精度 ±\d/.test(g1.status ?? ""), "有顯示最終精度（accuracy）");
  ok(/樣本 3 次/.test(g1.status ?? ""), `達到目標精度就停止（樣本 3 次）——實得「${(g1.status ?? "").match(/樣本 \d+ 次/)?.[0]}」`);
  ok(/停止原因：達到目標精度/.test(g1.status ?? ""), "停止原因＝達到目標精度");
  ok(/來源 GPS 衛星/.test(g1.status ?? ""), `精度 8 公尺判為 GPS 衛星——實得「${(g1.status ?? "").match(/來源 [^·]+/)?.[0]}」`);
  ok(g1.loc.source === "gps", `location.source=gps（實得 ${g1.loc.source}）`);
  ok(Math.abs(g1.loc.lat - A.lat) < 1e-6 && Math.abs(g1.loc.lng - A.lng) < 1e-6, `座標＝模擬座標（${g1.loc.lat}, ${g1.loc.lng}）`);
  ok(g1.loc.accuracyM === 8, `讀數完全一致時最終精度＝最佳單次精度 8 公尺（保守，不除以 √n 假裝更準）——實得 ${g1.loc.accuracyM}`);
  ok(g1.loc.sampleCount === 3, `sample_count=3（實得 ${g1.loc.sampleCount}）`);
  ok(g1.doneHidden === true, "取樣結束後「完成取樣」按鈕自動收起");
  await page.screenshot({ path: resolve(OUT, "survey-01-定位完成.png") });

  // 精度圈＋手動定位地圖
  log("  → 打開「手動定位」檢查精度圈與標記");
  await page.click("#rc-nd-manual > summary");
  await new Promise((r) => setTimeout(r, 3500));
  const mm1 = await page.evaluate(() => window.__survey.survey.state.minimap?.debug() ?? null);
  log(`  地圖：${JSON.stringify(mm1)}`);
  ok(mm1?.ready, "手動定位地圖已載入（MapLibre）");
  ok(mm1?.accuracyCircle?.has === true, "地圖上有畫出精度圈（±accuracy 公尺的多邊形）");
  ok(Math.abs((mm1?.accuracyCircle?.radiusM ?? 0) - g1.loc.accuracyM) < 0.5, `精度圈半徑＝最終精度 ${g1.loc.accuracyM} 公尺`);
  ok(Math.abs((mm1?.marker?.lat ?? 0) - A.lat) < 1e-6, "標記在模擬座標上");
  ok((mm1?.regionLabels ?? 0) >= 8, `行政區標籤 ${mm1?.regionLabels} 個`);
  await page.screenshot({ path: resolve(OUT, "survey-02-精度圈.png") });

  // ---------------------------------------------------------------- ④ 存檔 → SQLite
  log("\n④ 填名稱 → 存檔 → 驗證真的寫進 SQLite（不是只有畫面文字）");
  await page.evaluate(() => {
    const n = document.querySelector("#rc-nd-name");
    n.value = "沙梨頭麻子街 21 號唐樓";
    n.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("#rc-nd-note").value = "巷口第二棟，二樓木窗完整";
  });
  await page.click("#rc-nd-save");
  await new Promise((r) => setTimeout(r, 700));
  const s1 = await page.evaluate(() => ({
    ok: document.querySelector("#rc-nd-ok")?.textContent?.replace(/\s+/g, " ").trim(),
    json: document.querySelector("#rc-nd-json")?.textContent ?? "",
    total: window.__survey.total,
    rows: window.__survey.json,
    ledger: document.querySelector("#rc-ledger-summary")?.textContent?.replace(/\s+/g, " ").trim(),
    table: [...document.querySelectorAll("#rc-ledger-table tbody tr")].map((tr) => [...tr.children].map((td) => td.textContent.trim())),
    mirror: JSON.parse(localStorage.getItem("macau-memory.pending-discoveries") ?? "[]"),
    query: window.__survey.lastQuery,
    code: document.querySelector("#rc-nd-code")?.value,
  }));
  log(`  訊息：${s1.ok}`);
  log(`  資料庫：${s1.total} 筆 · ${s1.rows.buildings.map((b) => `${b.code}/${b.location.source}/±${b.location.accuracyM}`).join(" ")}`);
  log(`  面板：${s1.ledger}`);
  log(`  列表第一列：${s1.table[0]?.join(" | ")}`);
  ok(/已寫入 SQLite/.test(s1.ok ?? ""), "存檔訊息顯示「已寫入 SQLite」");
  ok(/MM-\d{4}-0001/.test(s1.ok ?? ""), `第一筆編號是 0001（訊息：${s1.ok?.slice(0, 60)}）`);
  ok(s1.total === 1, `資料庫目前 1 筆（實得 ${s1.total}）`);
  const b1 = s1.rows.buildings[0] ?? {};
  ok(b1.code?.endsWith("-0001") && b1.type === "tong_lau" && b1.name === "沙梨頭麻子街 21 號唐樓", `DB 內容正確：${b1.code} ${b1.type} ${b1.name}`);
  ok(b1.location.source === "gps" && b1.location.sampleCount === 3 && b1.location.accuracyM > 0,
    `DB 有記錄 geo_source/sample_count/accuracy_m：${b1.location.source}/${b1.location.sampleCount}/±${b1.location.accuracyM}`);
  ok(Math.abs(b1.location.lat - A.lat) < 1e-6, `DB 座標＝模擬座標（${b1.location.lat}, ${b1.location.lng}）`);
  ok(s1.table.length === 1, `記錄列表出現 1 列（實得 ${s1.table.length}）`);
  ok(s1.mirror.length === 1 && s1.mirror[0].building?.note === "巷口第二棟，二樓木窗完整", "本機備份（localStorage）也寫入且備註沒有被蓋掉");
  ok(/buildings_rtree/.test(s1.query?.sql ?? ""), "存檔流程真的跑了 R-Tree 查重 SQL");
  ok(s1.code === `MM-${new Date().getFullYear()}-0002`, `存檔後編號預覽推進到 0002（實得 ${s1.code}）`);
  await page.screenshot({ path: resolve(OUT, "survey-03-建檔完成.png"), fullPage: true });

  // ---------------------------------------------------------------- ⑤ R-Tree 空間查重：12 公尺外再建一筆
  log("\n⑤ R-Tree 空間查重：把座標移到 12 公尺外再建一筆，應該出現「附近已有記錄」");
  await setGeo({ ...B, accuracy: 6 });
  await page.click("#rc-nd-geo");
  await new Promise((r) => setTimeout(r, 1500));
  const near = await page.evaluate(() => ({
    nearby: document.querySelector("#rc-nd-nearby")?.textContent?.replace(/\s+/g, " ").trim(),
    cls: document.querySelector("#rc-nd-nearby")?.className,
    loc: window.__survey.survey.location,
    query: window.__survey.lastQuery,
  }));
  log(`  查重提示：${near.nearby}`);
  log(`  SQL：${near.query?.sql?.replace(/\s+/g, " ")}`);
  log(`  綁定值：${JSON.stringify(near.query?.bind)} → 候選 ${near.query?.candidates} 筆`);
  ok(/已有\s*1\s*筆記錄/.test(near.nearby ?? ""), "顯示「此位置 50 公尺內已有 1 筆記錄」");
  ok(/MM-\d{4}-0001/.test(near.nearby ?? ""), "提示裡帶出最近那筆的編號");
  ok(new RegExp(`${near.query?.radiusM === 50 ? "" : ""}1[0-9] 公尺`).test((near.nearby ?? "").split("·").pop() ?? ""),
    `提示裡有實際距離（${(near.nearby ?? "").match(/·\s*([\d.]+ 公尺)/)?.[1] ?? "?"}）`);
  ok(near.query?.radiusM === 50, "查重半徑 50 公尺");
  // 名稱留空 → 自動命名
  await page.click("#rc-nd-save");
  await new Promise((r) => setTimeout(r, 600));
  const s2 = await page.evaluate(() => ({
    ok: document.querySelector("#rc-nd-ok")?.textContent?.replace(/\s+/g, " ").trim(),
    codes: window.__survey.json.buildings.map((b) => b.code),
    names: window.__survey.json.buildings.map((b) => b.name),
    total: window.__survey.total,
  }));
  log(`  訊息：${s2.ok}`);
  log(`  兩筆：${s2.codes.join(" ")} · 名稱：${s2.names.join(" / ")}`);
  ok(s2.total === 2, `資料庫 2 筆（實得 ${s2.total}）`);
  ok(new Set(s2.codes).size === 2, `編號不重複：${s2.codes.join(" ")}`);
  ok(Number(s2.codes[1].split("-")[2]) === Number(s2.codes[0].split("-")[2]) + 1, "編號遞增（0001 → 0002）");
  ok(/未命名騎樓與唐樓 #0002/.test(s2.names[1] ?? ""), `名稱留空自動命名為「${s2.names[1]}」`);
  await page.screenshot({ path: resolve(OUT, "survey-04-查重命中.png"), fullPage: true });

  // ---------------------------------------------------------------- ⑥ 精度很差（筆電沒有 GPS 晶片）
  log("\n⑥ 筆電沒有 GPS 晶片的情境：精度 120 公尺 → 要警示並自動展開手動定位");
  await setGeo({ ...A, accuracy: 120 });
  await page.click("#rc-nd-geo");
  await new Promise((r) => setTimeout(r, 4000));
  const poor = await page.evaluate(() => ({
    status: document.querySelector("#rc-nd-locstate")?.textContent,
    warn: document.querySelector("#rc-nd-geo-warn")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    warnRows: [...document.querySelectorAll(".rc-geo-warn-row")].map((d) => d.className),
    manualOpen: document.querySelector("#rc-nd-manual")?.open === true,
    loc: window.__survey.survey.location,
    mmap: window.__survey.survey.state.minimap?.debug() ?? null,
  }));
  log(`  狀態：${poor.status}`);
  log(`  警語：${poor.warn}`);
  ok(/精度一直很差/.test(poor.warn), "出現「精度一直很差」警示");
  ok(/此裝置可能沒有 GPS 晶片（筆電常見）/.test(poor.warn), "警示明確指出「這台裝置可能沒有 GPS 晶片（筆電常見）」");
  ok(/建議用手機開啟本頁/.test(poor.warn), "建議「用手機開啟本頁」");
  ok(/手動定位（在地圖上拖曳標記）/.test(poor.warn), "建議指向畫面上真正的控制項名稱「手動定位（在地圖上拖曳標記）」");
  ok(poor.manualOpen === true, "精度差時自動展開「手動定位」面板");
  ok(poor.mmap?.footprints && poor.mmap.footprints !== "idle", `精度差時順便開始載入建築輪廓（狀態 ${poor.mmap?.footprints}）——使用者才知道要對哪一棟`);
  ok(poor.loc.source === "wifi", `精度 120 公尺判為 WiFi／基地台（實得 ${poor.loc.source}）`);
  ok(poor.loc.accuracyM === 120, `最終精度如實顯示 ±${poor.loc.accuracyM} 公尺（8 次讀數都一樣，不會假裝平均後變準）`);
  ok(/最終精度 ±120/.test(poor.status ?? ""), "狀態列顯示的精度與 CDP 模擬的 accuracy 一致");
  ok(poor.warnRows.some((c) => /lv-warn/.test(c)), "警示用警示樣式（lv-warn）");
  await page.screenshot({ path: resolve(OUT, "survey-05-精度差警告.png"), fullPage: true });

  // ---------------------------------------------------------------- ⑦ 手動定位（點地圖）
  log("\n⑦ 手動定位：在地圖上點一下 → 座標改成手動（geo_source=manual）");
  // 先把地圖捲進視窗中央再量座標：這一頁在表格上方累積了很高的內容，地圖的頂端會落在
  // 視窗下緣之外（實測 y≈1112、高度 280 → 點擊點 1230 > 視窗 1200），
  // page.mouse.click 打在視窗外就等於沒點到（原本這一段有 10 條斷言因此失敗）。
  // 這只是把「使用者真的點得到地圖」這件事做對，斷言本身沒有放寬。
  await page.evaluate(() => document.querySelector("#rc-nd-minimap")?.scrollIntoView({ block: "center" }));
  await new Promise((r) => setTimeout(r, 300));
  const mapBox = await page.evaluate(() => {
    const el = document.querySelector("#rc-nd-minimap");
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  log(`  地圖區塊：${JSON.stringify(mapBox)}（視窗高 ${await page.evaluate(() => window.innerHeight)}）`);
  ok(mapBox.w > 100 && mapBox.h > 100, "地圖有實際尺寸（沒有被折疊成 0）");
  ok(mapBox.y >= 0 && mapBox.y + mapBox.h <= await page.evaluate(() => window.innerHeight), "地圖完整落在視窗內（點擊才會真的打到地圖上）");
  // 建築輪廓是非同步載入的（7.8 MB），等一下再驗它真的畫上去了
  await page.waitForFunction(() => window.__survey.survey.state.minimap?.buildingsState === "ready", { timeout: 60000, polling: 500 })
    .then(() => log("  建築輪廓已載入完成"))
    .catch(() => log("  ⚠ 建築輪廓 60 秒內沒載完"));
  const fp = await page.evaluate(() => document.querySelector("#rc-mmap-status")?.textContent ?? "");
  log(`  輪廓狀態：${fp}`);
  ok(/已載入 \d+ 棟建築輪廓/.test(fp), `建築輪廓（選用圖層）真的載入並畫上地圖：${fp}`);
  await page.mouse.click(Math.round(mapBox.x + mapBox.w * 0.62), Math.round(mapBox.y + mapBox.h * 0.42));
  await new Promise((r) => setTimeout(r, 800));
  const manual = await page.evaluate(() => ({
    status: document.querySelector("#rc-nd-locstate")?.textContent,
    loc: window.__survey.survey.location,
    mmap: window.__survey.survey.state.minimap?.debug() ?? null,
    useGps: document.querySelector("#rc-nd-use-gps")?.hidden === false,
  }));
  log(`  狀態：${manual.status}`);
  log(`  座標：${manual.loc.lat}, ${manual.loc.lng}（來源 ${manual.loc.source}）`);
  ok(manual.loc.source === "manual", `location.source=manual（實得 ${manual.loc.source}）`);
  ok(/已手動標記/.test(manual.status ?? ""), "狀態列顯示「已手動標記」");
  ok(Math.abs(manual.loc.lat - A.lat) > 1e-5 || Math.abs(manual.loc.lng - A.lng) > 1e-5, `手動座標與 GPS 座標不同（Δlat=${(manual.loc.lat - A.lat).toFixed(5)}）`);
  ok(Math.abs(manual.mmap.marker.lat - manual.loc.lat) < 1e-9, "標記跟著移動到點選的位置");
  ok(manual.mmap.accuracyCircle.has === false, "手動座標不畫精度圈（沒有假精度）");
  ok(manual.useGps === true, "出現「改回 GPS 座標」按鈕");
  await page.screenshot({ path: resolve(OUT, "survey-06-手動定位.png"), fullPage: true });

  // 拖曳標記（需求：點選／拖曳都要能設定座標）
  log("  → 再測「拖曳標記」");
  const before = await page.evaluate(() => window.__survey.survey.location);
  const pin = await page.evaluate(() => {
    const el = document.querySelector(".rc-mmap-pin");
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(pin.x, pin.y);
  await page.mouse.down();
  await page.mouse.move(pin.x - 60, pin.y + 40, { steps: 12 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 700));
  const dragged = await page.evaluate(() => window.__survey.survey.location);
  log(`  拖曳前 ${before.lat.toFixed(5)}, ${before.lng.toFixed(5)} → 拖曳後 ${dragged.lat.toFixed(5)}, ${dragged.lng.toFixed(5)}`);
  ok(dragged.source === "manual" && (Math.abs(dragged.lat - before.lat) > 1e-6 || Math.abs(dragged.lng - before.lng) > 1e-6),
    "拖曳標記也會更新座標（geo_source=manual）");

  // 存檔 → 驗證 manual 有寫進資料庫
  await page.click("#rc-nd-save");
  await new Promise((r) => setTimeout(r, 600));
  const s3 = await page.evaluate(() => ({
    buildings: window.__survey.json.buildings,
    total: window.__survey.total,
  }));
  const manualRow = s3.buildings.find((b) => b.location.source === "manual");
  log(`  DB 手動那筆：${manualRow?.code} ${manualRow?.location.lat}, ${manualRow?.location.lng} · 精度 ${manualRow?.location.accuracyM} · 說明：${manualRow?.location.note}`);
  ok(!!manualRow, "手動座標的紀錄已寫進資料庫");
  ok(manualRow?.location.accuracyM === null, `手動座標的 accuracy_m 是 NULL（不是假造精度）`);
  ok(manualRow?.location.sampleCount === 0, "手動座標的 sample_count=0");
  ok(/GPS 原讀數/.test(manualRow?.location.note ?? ""), "geo_note 保留了修正前的 GPS 讀數（可追溯）");

  // ---------------------------------------------------------------- ⑧ 讀數跳動過大
  log("\n⑧ 讀數跳動過大：取樣期間把座標在兩點之間來回改（相距約 200 公尺）");
  await page.evaluate(() => window.__survey.survey.state.minimap?.setPoint({ lat: null, lng: null }));
  // 精度刻意設 40 公尺（> 快速計畫的目標 15 公尺），否則第一個讀數就會觸發
  // 「達到目標精度」而提前停止，來不及把座標移走（實測踩過）
  await setGeo({ ...A, accuracy: 40 });
  await page.click("#rc-nd-geo");                       // 快速計畫：8 次 × 0.25 秒
  await page.waitForFunction(() => window.__survey.survey.state.session != null, { timeout: 10000, polling: 50 });
  for (let i = 0; i < 9; i++) {
    await setGeo({ ...(i % 2 ? FAR : A), accuracy: 40 });
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 1500));
  const jump = await page.evaluate(() => ({
    warn: document.querySelector("#rc-nd-geo-warn")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    status: document.querySelector("#rc-nd-locstate")?.textContent,
    loc: window.__survey.survey.location,
  }));
  log(`  警語：${jump.warn}`);
  log(`  狀態：${jump.status}`);
  ok(/讀數跳動過大/.test(jump.warn), "出現「讀數跳動過大」警示");
  ok(/移動中/.test(jump.warn) || /訊號/.test(jump.warn), "警示說明可能原因（移動中／訊號不穩）");
  ok(/樣本離散 ±\d+ 公尺/.test(jump.warn), `警示帶出樣本離散值（${(jump.warn.match(/樣本離散 ±\d+ 公尺/) ?? [])[0]}）`);
  ok(!/已達目標精度/.test(jump.warn) && !/停止原因：達到目標精度/.test(jump.status ?? ""),
    `讀數跳動時不會同時宣布「達到目標精度」（實際停止原因：${(jump.status ?? "").match(/停止原因：\S+/) ?? "?"}）`);
  await page.screenshot({ path: resolve(OUT, "survey-07-跳動警告.png"), fullPage: true });

  // ---------------------------------------------------------------- ⑨ 失敗情境：拒絕授權
  log("\n⑨ 失敗情境：使用者拒絕定位授權 → 必須有可讀中文訊息，且仍能建檔（只做文字記錄）");
  await context.clearPermissionOverrides();
  await page.click("#rc-nd-geo");
  await new Promise((r) => setTimeout(r, 1500));
  const denied = await page.evaluate(() => ({
    status: document.querySelector("#rc-nd-locstate")?.textContent,
    warn: document.querySelector("#rc-nd-geo-warn")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    nearby: document.querySelector("#rc-nd-nearby")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    loc: window.__survey.survey.location,
  }));
  log(`  狀態：${denied.status}`);
  ok(/你拒絕了定位授權/.test(denied.status ?? ""), "顯示「你拒絕了定位授權」（不是只有 console）");
  ok(/允許/.test(denied.status ?? ""), "附上重新授權的具體做法");
  ok(/手動在地圖上標記|手動定位/.test(denied.status ?? ""), "附上補救方式（手動定位）");
  ok(denied.loc.source === "unavailable", `location.source=unavailable（實得 ${denied.loc.source}）`);
  ok(/這一筆沒有座標/.test(denied.nearby), "沒有座標時，查重區塊明確說「這一筆沒有座標」");
  await page.click("#rc-nd-save");                      // 沒有座標也應該可以存
  await new Promise((r) => setTimeout(r, 600));
  const s4 = await page.evaluate(() => ({
    total: window.__survey.total,
    buildings: window.__survey.json.buildings,
    mirror: JSON.parse(localStorage.getItem("macau-memory.pending-discoveries") ?? "[]"),
  }));
  const noGeo = s4.buildings.find((b) => b.location.lat == null);
  const noGeoMirror = s4.mirror.find((b) => b.building?.location?.lat == null);
  log(`  沒有座標那筆：${noGeo?.code} 座標=${noGeo?.location.lat} · DB geo_note=${String(noGeo?.location.note).slice(0, 30)}…`);
  ok(!!noGeo, "沒有座標的紀錄仍可建檔（普查現場常見：先記錄，之後再補座標）");
  ok(/你拒絕了定位授權/.test(noGeo?.location.note ?? ""), "拒絕授權的原因有寫進資料庫的 geo_note（可追溯）");
  ok(/你拒絕了定位授權/.test(noGeoMirror?.building?.location?.unavailableReason ?? ""), "本機備份也留下失敗原因（unavailableReason，沿用舊欄位名）");
  await page.screenshot({ path: resolve(OUT, "survey-08-拒絕授權.png"), fullPage: true });

  // ---------------------------------------------------------------- ⑩ 匯出
  log("\n⑩ 匯出 JSON 與 .sqlite");
  await page.click("#rc-export-json");
  await page.click("#rc-export-sqlite");
  await new Promise((r) => setTimeout(r, 2500));
  const files = readdirSync(DOWNLOADS).filter((f) => !f.endsWith(".crdownload"));
  log(`  下載目錄：${files.join(", ") || "（空）"}`);
  const jsonFile = files.find((f) => f.endsWith(".json"));
  const sqliteFile = files.find((f) => f.endsWith(".sqlite"));
  ok(!!jsonFile, `匯出 JSON 檔（${jsonFile}）`);
  ok(!!sqliteFile, `匯出 .sqlite 檔（${sqliteFile}）`);
  if (jsonFile) {
    const raw = JSON.parse(readFileSync(resolve(DOWNLOADS, jsonFile), "utf8"));
    log(`  JSON：${raw.count} 筆 · engine=${raw.schema?.engine} · schema v${raw.schema?.version}`);
    ok(raw.count === s4.total, `JSON 筆數＝資料庫筆數（${raw.count}）`);
    ok(raw.buildings.every((b) => b.code && b.type && b.location), "JSON 每筆都有 code/type/location");
    ok(Array.isArray(raw.stats?.byType) && raw.stats.byType.length > 0, `JSON 也帶了依類型統計（${raw.stats?.byType?.map((s) => `${s.type}:${s.n}`).join(" ")}）`);
    log(`  JSON 第一筆：${JSON.stringify(raw.buildings[0]).slice(0, 260)}…`);
  }
  if (sqliteFile) {
    const p = resolve(DOWNLOADS, sqliteFile);
    const buf = readFileSync(p);
    const magic = buf.subarray(0, 15).toString("utf8");
    log(`  .sqlite：${statSync(p).size} bytes · magic="${magic}"`);
    ok(magic === "SQLite format 3", "匯出的 .sqlite 是合法的 SQLite 檔");

    // 用完全不同的一套 SQLite（CPython 內建的 sqlite3）打開匯出檔：
    // 這是「可攜」最直接的證據——別的裝置／工具真的讀得到，而且 R-Tree 查得到。
    const py = runPython([resolve(import.meta.dirname, "check-exported-sqlite.py"), p, String(B.lat), String(B.lng), "50"]);
    if (!py) {
      ok(false, "無法用 Python 的 sqlite3 驗證匯出檔（找不到 python？）");
    } else {
      log(`  Python sqlite3 ${py.sqlite_version} 打開匯出檔：資料表 ${py.tables.join(", ")}`);
      log(`  匯出檔裡的資料：${py.buildings.map((r) => `${r.code}/${r.type}/${r.geo_source}/±${r.accuracy_m ?? "—"}/${r.sample_count}次`).join("  ")}`);
      log(`  在匯出檔上跑同一段 R-Tree 查詢（中心 ${py.rtree.center.join(",")} 半徑 ${py.rtree.radius_m} 公尺）：粗篩 ${py.rtree.coarse_candidates} 筆 → 命中 ${py.rtree.hits.length} 筆 ${JSON.stringify(py.rtree.hits)}`);
      ok(py.tables.includes("buildings") && py.tables.includes("buildings_rtree"), "匯出檔裡有 buildings 與 buildings_rtree（含 R*Tree 虛擬表）");
      ok(py.count === s4.total, `匯出檔裡的筆數正確（${py.count}）`);
      const hitCodes = py.rtree.hits.map((h) => h.code);
      ok(hitCodes.some((c) => c.endsWith("-0001")) && hitCodes.some((c) => c.endsWith("-0002")),
        `在匯出檔上用 R-Tree 查得到那兩筆 GPS 記錄（${hitCodes.join(",")}）`);
      ok(py.rtree.hits.length >= 2 && py.rtree.hits.every((h) => h.distance_m <= 50),
        `命中的距離都在半徑內（${py.rtree.hits.map((h) => h.distance_m + "m").join(", ")}）`);
      ok(py.buildings.some((r) => r.geo_source === "manual" && r.accuracy_m === null), "匯出檔保留了 manual 且 accuracy_m 為 NULL");
    }
  }

  // ---------------------------------------------------------------- ⑪ 記錄列表／統計
  log("\n⑪ 記錄列表與依類型統計");
  const ledger = await page.evaluate(() => ({
    summary: document.querySelector("#rc-ledger-summary")?.textContent?.replace(/\s+/g, " ").trim(),
    stats: [...document.querySelectorAll(".rc-ledger-stat")].map((d) => d.textContent.replace(/\s+/g, " ").trim()),
    rows: [...document.querySelectorAll("#rc-ledger-table tbody tr")].map((tr) => [...tr.children].map((td) => td.textContent.trim())),
    sql: document.querySelector("#rc-ledger-sql")?.textContent ?? "",
    mirror: document.querySelector("#rc-ledger-mirror")?.textContent?.replace(/\s+/g, " ").trim(),
  }));
  log(`  總計：${ledger.summary}`);
  log(`  類型統計：${ledger.stats.join(" ／ ")}`);
  for (const r of ledger.rows) log(`    ${r.join(" | ")}`);
  ok(ledger.rows.length === s4.total, `記錄列表列出全部 ${s4.total} 筆`);
  ok(ledger.stats.length >= 1, `依類型統計有 ${ledger.stats.length} 列`);
  ok(/buildings_rtree/.test(ledger.sql), "技術細節面板有顯示 R-Tree 查重的 SQL");
  ok(/本機備份/.test(ledger.mirror), "面板顯示本機備份狀態");
  await page.screenshot({ path: resolve(OUT, "survey-09-記錄列表.png"), fullPage: true });

  // ---------------------------------------------------------------- ⑫ 已記錄的情況也要能建檔 + 既有功能仍在
  log("\n⑫ 「很可能已記錄」的辨識結果仍然顯示建檔區塊（產品規則改變處）");
  await inject(0.969, "temple", "中式廟宇", "普查示範2-廟宇.jpg");
  await new Promise((r) => setTimeout(r, 700));
  const known = await page.evaluate(() => ({
    discover: !!document.querySelector("#rc-discover"),
    form: !!document.querySelector("#rc-newform"),
    verdict: document.querySelector("#rc-survey-verdict")?.textContent?.replace(/\s+/g, " ").slice(0, 80),
    dedupLine: document.querySelector(".rc-dedup-line b")?.textContent,
    type: document.querySelector("#rc-nd-cls")?.value,
    code: document.querySelector("#rc-nd-code")?.value,
    legacy: {
      file: !!document.querySelector("#rc-file"), drop: !!document.querySelector("#rc-drop"),
      demo: document.querySelectorAll("#rc-demo-list [data-demo]").length,
      viewer: !!document.querySelector("#viewer"), diag: !!document.querySelector("#diag-body"),
      cards: document.querySelectorAll(".rc-card").length,
    },
  }));
  log(`  查重結論：${known.dedupLine}`);
  log(`  建檔區塊：${known.discover} · 表單：${known.form} · 類型=${known.type} · 編號=${known.code}`);
  ok(known.form === true, "「很可能已記錄」時建檔表單仍然顯示（不再只出現於相似度 <0.48）");
  ok(/很可能已記錄/.test(known.dedupLine ?? ""), `查重結論仍正確顯示「${known.dedupLine}」`);
  ok(known.type === "temple", "類型跟著新的 YOLO 判定更新");
  ok(known.legacy.demo === 4 && known.legacy.file && known.legacy.drop && known.legacy.viewer && known.legacy.diag,
    `既有功能都在（上傳/拖放/示範素材 4 個/viewer/診斷）：${JSON.stringify(known.legacy)}`);

  // ---------------------------------------------------------------- ⑬ 手機寬度
  log("\n⑬ 手機寬度（420px）有沒有水平溢出");
  await page.setViewport({ width: 420, height: 900, deviceScaleFactor: 2 });
  await new Promise((r) => setTimeout(r, 800));
  const m = await page.evaluate(() => ({
    docW: document.documentElement.scrollWidth, winW: window.innerWidth,
    // 地圖（#rc-nd-minimap）內的標記由 MapLibre 定位、且被容器裁切，不算版面溢出
    wide: [...document.querySelectorAll("#rc-results *, #rc-survey-host *, #rc-ledger *")]
      .filter((e) => !e.closest("#rc-nd-minimap"))
      .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 2)
      .map((e) => e.className || e.tagName).slice(0, 6),
  }));
  log(`  文件寬 ${m.docW} / 視窗寬 ${m.winW}${m.wide.length ? ` · 溢出：${m.wide.join(", ")}` : " · 沒有溢出"}`);
  ok(m.docW <= m.winW + 2, `手機寬度沒有水平溢出（${m.docW} ≤ ${m.winW}）`);
  await page.screenshot({ path: resolve(OUT, "survey-10-手機.png"), fullPage: true });
  await page.setViewport({ width: 1440, height: 1200, deviceScaleFactor: 1 });

  // ---------------------------------------------------------------- ⑭ 重新整理：資料必須還在
  //
  // 這是這一次修好的缺陷本體。舊版這裡驗的是「重新整理後記憶體資料庫是空的（已知行為）」——
  // 那條斷言記錄的是缺陷、不是需求。現在反過來驗：重整後一個欄位都不能少。
  log("\n⑭ 真的重新整理（page.reload）→ 資料必須還在，而且欄位一模一樣");
  const preReload = await page.evaluate(() => ({
    total: window.__survey.total,
    buildings: window.__survey.json.buildings,
    persistence: window.__survey.db.persistence,
    label: window.__survey.db.persistenceLabel,
  }));
  log(`  重新整理前：${preReload.total} 筆 · provider=${preReload.persistence}（${preReload.label}）`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__survey?.db?.ready === true, { timeout: 120000, polling: 200 });
  await page.waitForFunction(() => window.__survey.persistence.restoredFrom != null || window.__survey.total === 0, { timeout: 60000, polling: 100 });
  await dismissOverlay();
  const after = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("#diag-body .dg-row")].map((r) => r.textContent.replace(/\s+/g, " ").trim());
    return {
      total: window.__survey.total,
      buildings: window.__survey.json.buildings,
      mirror: JSON.parse(localStorage.getItem("macau-memory.pending-discoveries") ?? "[]").length,
      persistence: window.__survey.db.persistence,
      persistent: window.__survey.db.persistent,
      label: window.__survey.db.persistenceLabel,
      restored: window.__survey.db.restoredFrom,
      lastSavedAt: window.__survey.db.lastSavedAt,
      storage: document.querySelector("#rc-storage")?.textContent?.replace(/\s+/g, " ").trim(),
      storageClass: document.querySelector("#rc-storage")?.className,
      storageRow: rows.find((t) => t.startsWith("持久化方式")),
      savedRow: rows.find((t) => t.startsWith("最後儲存")),
      table: [...document.querySelectorAll("#rc-ledger-table tbody tr")].map((tr) => [...tr.children].map((td) => td.textContent.trim())),
    };
  });
  log(`  重新整理後：DB ${after.total} 筆 · 本機備份 ${after.mirror} 筆 · persistence=${after.persistence}`);
  log(`  還原來源：${JSON.stringify(after.restored)}`);
  log(`  面板狀態條：${after.storage}`);
  log(`  診斷列：${after.storageRow} ／ ${after.savedRow}`);
  ok(after.total === preReload.total && after.total === s4.total,
    `重新整理後資料還在：${after.total} 筆（修正前會是 0 筆）`);
  const codesBefore = preReload.buildings.map((b) => b.code).join(" ");
  const codesAfter = after.buildings.map((b) => b.code).join(" ");
  ok(codesAfter === codesBefore, `編號完全一致：${codesAfter}`);
  const b1a = preReload.buildings.find((x) => x.code.endsWith("-0001"));
  const b1b = after.buildings.find((x) => x.code.endsWith("-0001"));
  log(`  第一筆（重整前）：${JSON.stringify(b1a)}`);
  log(`  第一筆（重整後）：${JSON.stringify(b1b)}`);
  ok(!!b1b && b1b.type === b1a.type && b1b.name === b1a.name && b1b.status === b1a.status && b1b.createdAt === b1a.createdAt,
    `第一筆的類型／名稱／狀態／建立時間都一致（${b1b?.type} / ${b1b?.name} / ${b1b?.createdAt}）`);
  ok(b1b && b1b.location.lat === b1a.location.lat && b1b.location.lng === b1a.location.lng
    && b1b.location.accuracyM === b1a.location.accuracyM && b1b.location.sampleCount === b1a.location.sampleCount
    && b1b.location.source === b1a.location.source && b1b.location.capturedAt === b1a.location.capturedAt,
    `座標／精度／樣本數／來源／定位時間都一致（${b1b?.location.lat}, ${b1b?.location.lng} ±${b1b?.location.accuracyM}m · ${b1b?.location.sampleCount} 次 · ${b1b?.location.source}）`);
  ok(after.persistent === true && after.persistence !== "memory",
    `持久化方式不是記憶體：${after.persistence}／${after.label}`);
  ok(after.mirror === s4.total, `本機備份仍在（${after.mirror} 筆）`);
  ok(after.table.length === after.total, `記錄列表也還原了 ${after.table.length} 列`);
  ok(!/重整即清空/.test(`${after.storage} ${after.storageRow}`),
    "UI（資料庫面板狀態條＋診斷區塊）顯示的不是「記憶體（重整即清空）」");
  ok(/OPFS|localStorage/.test(after.storageRow ?? ""), `診斷區塊明確顯示持久化方式：${after.storageRow}`);
  ok(!!after.storageClass?.includes("rc-storage") && !after.storageClass.includes("s-danger"),
    `狀態條是正常色（${after.storageClass}）：${after.storage}`);
  await page.screenshot({ path: resolve(OUT, "survey-11-重整後資料還在.png"), fullPage: true });

  // ---------------------------------------------------------------- ⑮ 重整後續建：編號不衝突
  log("\n⑮ 重新整理後再建一筆 → 編號必須接續（不與已有的衝突）");
  await context.overridePermissions(new URL(URL_).origin, ["geolocation"]);
  await setGeo({ ...B, accuracy: 6 });
  await inject(0.35, "church", "天主教教堂", "重整後續建.jpg");
  await page.select("#rc-nd-geo-plan", "quick");            // change → 用「快速」計畫重新取樣（8 次 × 0.25 秒）
  await page.waitForFunction(() => window.__survey.survey.state.session == null, { timeout: 30000, polling: 100 });
  await new Promise((r) => setTimeout(r, 300));
  const codePreview = await page.evaluate(() => ({ code: document.querySelector("#rc-nd-code")?.value, loc: window.__survey.survey.location }));
  log(`  取樣結果：${codePreview.loc.lat}, ${codePreview.loc.lng}（${codePreview.loc.source}）· 預覽編號 ${codePreview.code}`);
  ok(codePreview.code === `MM-${new Date().getFullYear()}-0005`, `重整後預覽編號接續到 0005（實得 ${codePreview.code}）`);
  await page.evaluate(() => {
    const n = document.querySelector("#rc-nd-name");
    n.value = "重整後新建的教堂";
    n.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.click("#rc-nd-save");
  await new Promise((r) => setTimeout(r, 700));
  const s5 = await page.evaluate(() => ({
    ok: document.querySelector("#rc-nd-ok")?.textContent?.replace(/\s+/g, " ").trim(),
    codes: window.__survey.json.buildings.map((b) => b.code),
    total: window.__survey.total,
  }));
  log(`  訊息：${s5.ok}`);
  log(`  五筆：${s5.codes.join(" ")}`);
  ok(s5.total === 5, `資料庫 5 筆（實得 ${s5.total}）`);
  ok(new Set(s5.codes).size === 5, `五筆編號都不重複：${s5.codes.join(" ")}`);
  ok(/0005/.test(s5.ok ?? ""), `新的一筆配到 0005（訊息：${s5.ok?.slice(0, 70)}）`);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__survey?.db?.ready === true, { timeout: 120000, polling: 200 });
  const after5 = await page.evaluate(() => ({ total: window.__survey.total, codes: window.__survey.json.buildings.map((b) => b.code) }));
  log(`  再重新整理一次：${after5.total} 筆 · ${after5.codes.join(" ")}`);
  ok(after5.total === 5 && after5.codes.join(" ") === s5.codes.join(" "), "第二次重新整理後 5 筆都還在（編號一致）");
  await dismissOverlay();

  // ---------------------------------------------------------------- ⑯ 救援：舊 localStorage 鏡射
  log("\n⑯ 救援既有資料：使用者已經卡在 localStorage 鏡射裡的紀錄，第一次載入要遷進資料庫");
  const legacy = await page.evaluate((year) => {
    const KEY = "macau-memory.pending-discoveries";
    const existing = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    const legacyRec = {
      id: "legacy-1", code: "MM-2025-0777", createdAt: "2025-03-04T05:06:07.000Z", status: "pending",
      building: {
        name: "舊版鏡射・福隆新街 12 號", type: "tong_lau", typeZh: "騎樓與唐樓", note: "舊版只存在 localStorage",
        location: {
          source: "manual", lat: 22.19321, lng: 113.53987, accuracyM: null, sampleCount: 0,
          gpsNote: "GPS 原讀數 22.19300, 113.53900 ±51.0m（手動修正）", unavailableReason: null, ok: true,
        },
      },
      photo: { name: "legacy.jpg" }, detection: { source: "yolo", cls: "tong_lau", score: 0.66, box: { x: 10, y: 20, w: 100, h: 80 } },
      dedup: { verdict: "尚未記錄", top1: { id: "ruins", zh: "大三巴牌坊", sim: 0.31 }, compared: 38 },
      encoder: { name: "dinov2-s14", dim: 384 },
    };
    // 再塞一筆「編號與資料庫既有紀錄相同」的：必須被跳過（用 code 去重）
    const dupRec = { ...legacyRec, id: "legacy-dup", code: `MM-${year}-0001`, building: { ...legacyRec.building, name: "重複編號不該被插入" } };
    const next = [...existing, legacyRec, dupRec];
    localStorage.setItem(KEY, JSON.stringify(next));
    return { before: existing.length, total: next.length, legacyCode: legacyRec.code, dupCode: dupRec.code };
  }, new Date().getFullYear());
  log(`  鏡射：原本 ${legacy.before} 筆 → 塞入舊格式後 ${legacy.total} 筆（${legacy.legacyCode}＋重複的 ${legacy.dupCode}）`);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__survey?.db?.ready === true, { timeout: 120000, polling: 200 });
  await dismissOverlay();
  const rescued = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("#diag-body .dg-row")].map((r) => r.textContent.replace(/\s+/g, " ").trim());
    return {
      total: window.__survey.total,
      migration: window.__survey.db.migration,
      buildings: window.__survey.json.buildings,
      mirror: JSON.parse(localStorage.getItem("macau-memory.pending-discoveries") ?? "[]"),
      storage: document.querySelector("#rc-storage")?.textContent?.replace(/\s+/g, " ").trim(),
      rescueRow: rows.find((t) => t.startsWith("本機備份救援")),
    };
  });
  log(`  遷移結果：${JSON.stringify(rescued.migration)}`);
  log(`  面板：${rescued.storage}`);
  log(`  診斷列：${rescued.rescueRow}`);
  const oldRec = rescued.buildings.find((b) => b.code === "MM-2025-0777");
  ok(rescued.migration?.inserted === 1, `只遷進 1 筆（重複編號那筆被跳過；inserted=${rescued.migration?.inserted} / skipped=${rescued.migration?.skipped}）`);
  ok(rescued.total === 6, `資料庫變成 6 筆（5＋救援 1；實得 ${rescued.total}）`);
  ok(!!oldRec, `舊鏡射那筆進資料庫了，編號原封不動保留 ${oldRec?.code}`);
  ok(oldRec?.createdAt === "2025-03-04T05:06:07.000Z" && oldRec?.status === "pending" && oldRec?.name === "舊版鏡射・福隆新街 12 號",
    `created_at / status / name 都保留（${oldRec?.createdAt} / ${oldRec?.status}）`);
  ok(oldRec?.location.source === "manual" && oldRec?.location.lat === 22.19321 && oldRec?.location.lng === 113.53987 && oldRec?.location.accuracyM === null,
    `座標與來源保留、精度如實為 null（${oldRec?.location.lat}, ${oldRec?.location.lng} · ${oldRec?.location.source}）`);
  ok(oldRec?.location.note === "GPS 原讀數 22.19300, 113.53900 ±51.0m（手動修正）", `gpsNote 對應到 geo_note：${oldRec?.location.note}`);
  ok(oldRec?.photo?.name === "legacy.jpg" && oldRec?.detection?.score === 0.66 && oldRec?.dedup?.compared === 38 && oldRec?.encoder === "dinov2-s14-384d",
    `photo / detection / dedup / encoder 欄位對應正確（${oldRec?.photo?.name} / ${oldRec?.detection?.score} / ${oldRec?.dedup?.compared} / ${oldRec?.encoder}）`);
  ok(rescued.buildings.filter((b) => b.code === `MM-${new Date().getFullYear()}-0001`).length === 1,
    "重複編號的那筆沒有被插入第二次（用 code 去重）");
  ok(rescued.mirror.some((r) => r.code === "MM-2025-0777"), "鏡射本身保留（第二層保險，沒有被刪掉）");
  ok(/已從本機備份還原 1 筆/.test(`${rescued.storage} ${rescued.rescueRow}`), `UI 顯示「已從本機備份還原 1 筆」：${rescued.rescueRow}`);
  await page.screenshot({ path: resolve(OUT, "survey-12-鏡射救援.png"), fullPage: true });

  // 再重整一次：遷移必須是幂等的（同一筆不能一直重複插入）
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__survey?.db?.ready === true, { timeout: 120000, polling: 200 });
  const idem = await page.evaluate(() => ({ total: window.__survey.total, migration: window.__survey.db.migration }));
  log(`  再重整一次：${idem.total} 筆 · 遷移 ${JSON.stringify(idem.migration)}`);
  ok(idem.total === 6 && idem.migration?.inserted === 0, `遷移是幂等的：第二次重整沒有再插入（${idem.total} 筆、inserted=${idem.migration?.inserted}）`);
  await dismissOverlay();

  // ---------------------------------------------------------------- ⑰ 節流＋關頁前落地
  log("\n⑰ 節流：連續快速存 3 筆後「立刻」重新整理（不等節流窗）→ 3 筆都不能掉");
  await context.overridePermissions(new URL(URL_).origin, ["geolocation"]);
  await setGeo({ ...A, accuracy: 7 });
  await inject(0.4, "temple", "中式廟宇", "節流測試.jpg");
  await page.select("#rc-nd-geo-plan", "quick");
  await page.waitForFunction(() => window.__survey.survey.state.session == null, { timeout: 30000, polling: 100 });
  await new Promise((r) => setTimeout(r, 300));
  const burstStart = Date.now();
  for (let i = 1; i <= 3; i++) {
    await page.evaluate((n) => {
      const el = document.querySelector("#rc-nd-name");
      el.value = n;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, `節流測試 ${i}`);
    await page.click("#rc-nd-save");
    await new Promise((r) => setTimeout(r, 80));            // 遠小於節流窗 350 ms
  }
  const burst = await page.evaluate(() => ({
    total: window.__survey.total,
    dirty: window.__survey.persistence.dirty,
    saveCount: window.__survey.persistence.saveCount,
  }));
  log(`  連存 3 筆花了 ${Date.now() - burstStart} ms · DB ${burst.total} 筆 · 尚未落地(dirty)=${burst.dirty} · 累計存檔 ${burst.saveCount} 次`);
  ok(burst.total === 9, `記憶體裡的資料庫 9 筆（實得 ${burst.total}）`);
  ok(burst.dirty === true, "節流窗內仍標記為 dirty（證明真的有節流，不是每按一次就序列化整個 DB）");
  // 立刻重整：非同步的 OPFS 寫入可能來不及完成，靠 pagehide 的同步快照救回來
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__survey?.db?.ready === true, { timeout: 120000, polling: 200 });
  const throttled = await page.evaluate(() => ({
    total: window.__survey.total,
    names: window.__survey.json.buildings.map((b) => b.name),
    codes: window.__survey.json.buildings.map((b) => b.code),
    restored: window.__survey.db.restoredFrom,
  }));
  log(`  立刻重整後：${throttled.total} 筆 · 還原來源 ${JSON.stringify(throttled.restored)}`);
  log(`  編號：${throttled.codes.join(" ")}`);
  ok(throttled.total === 9, `節流＋關頁前落地：9 筆全部都在（實得 ${throttled.total}）`);
  ok([1, 2, 3].every((i) => throttled.names.includes(`節流測試 ${i}`)), `三筆節流測試紀錄都在：${throttled.names.filter((n) => n?.startsWith("節流測試")).join(" / ")}`);
  ok(new Set(throttled.codes).size === throttled.codes.length, `9 筆編號都不重複：${throttled.codes.join(" ")}`);
  await dismissOverlay();

  // ---------------------------------------------------------------- ⑱ 配額失敗要看得見
  log("\n⑱ 配額失敗：模擬 localStorage 寫入丟 QuotaExceededError → 必須顯示可讀錯誤（不能靜默）");
  {
    const qp = await browser.newPage();
    await qp.setViewport({ width: 1280, height: 1000 });
    qp.on("pageerror", (e) => { problems.push(`[配額頁] pageerror: ${e.message}`); log(`  [配額頁 pageerror] ${e.message.slice(0, 300)}`); });
    await qp.goto(`${URL_}?persist=localStorage`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await qp.waitForFunction(() => window.__survey?.db?.ready === true, { timeout: 120000, polling: 200 });
    await qp.evaluate(() => document.querySelector("#rc-overlay-skip")?.click());
    const prov = await qp.evaluate(() => ({ p: window.__survey.db.persistence, label: window.__survey.db.persistenceLabel }));
    log(`  這頁的 provider：${prov.p}（${prov.label}）`);
    ok(prov.p === "localStorage", `?persist=localStorage 有生效（實得 ${prov.p}）`);
    // 這一頁與主測試共用同一個 origin 的 localStorage：先把自己的存檔與鏡射清乾淨，
    // 再塞一筆「舊鏡射」進去（順便再走一次救援路徑），配額測試才不會被前面的資料干擾。
    await qp.evaluate(async (year) => {
      await window.__survey.wipeAll();
      const KEY = "macau-memory.pending-discoveries";
      localStorage.removeItem(KEY);
      localStorage.setItem(KEY, JSON.stringify([{
        code: `MM-${year}-0900`, createdAt: new Date().toISOString(), status: "pending",
        building: { name: "配額測試用", type: "temple", location: { source: "manual", lat: 22.19, lng: 113.54 } },
      }]));
    }, new Date().getFullYear());
    await qp.reload({ waitUntil: "domcontentloaded" });
    await qp.waitForFunction(() => window.__survey?.db?.ready === true, { timeout: 120000, polling: 200 });
    await qp.evaluate(() => document.querySelector("#rc-overlay-skip")?.click());
    const beforeQuota = await qp.evaluate(() => ({ total: window.__survey.total, saved: window.__survey.persistence.lastSavedAt }));
    log(`  配額測試前：${beforeQuota.total} 筆 · 最後儲存 ${beforeQuota.saved}`);
    ok(beforeQuota.total === 1, `測試頁從乾淨狀態開始，只有救援進來的 1 筆（實得 ${beforeQuota.total}）`);

    // monkey-patch：之後寫 DB 都丟 QuotaExceededError（模擬 localStorage 的 5 MB 額度爆掉）
    await qp.evaluate(() => {
      const orig = localStorage.setItem.bind(localStorage);
      localStorage.setItem = (k, v) => {
        if (k === "macau-memory.sqlite") { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; }
        return orig(k, v);
      };
    });
    const qres = await qp.evaluate(async () => {
      const r = await window.__survey.flush({ force: true });
      const rows = [...document.querySelectorAll("#diag-body .dg-row")].map((x) => x.textContent.replace(/\s+/g, " ").trim());
      return {
        flush: r,
        err: window.__survey.persistence.lastSaveError,
        dirty: window.__survey.persistence.dirty,
        storage: document.querySelector("#rc-storage")?.textContent?.replace(/\s+/g, " ").trim(),
        storageClass: document.querySelector("#rc-storage")?.className,
        errRow: rows.find((t) => t.startsWith("儲存錯誤")),
        total: window.__survey.total,
        codes: window.__survey.json.buildings.map((b) => b.code),
      };
    });
    log(`  flush 結果：${JSON.stringify(qres.flush).slice(0, 200)}`);
    log(`  面板：${qres.storage}`);
    log(`  診斷列：${qres.errRow}`);
    ok(qres.flush?.ok === false && qres.flush?.quota === true, "寫入失敗有被回報（不是靜默吞掉）");
    ok(/QuotaExceededError/.test(qres.err?.message ?? ""), `錯誤訊息指出是配額問題：${qres.err?.message?.slice(0, 52)}…`);
    ok(/匯出 \.sqlite/.test(qres.err?.message ?? "") && /清空資料庫/.test(qres.err?.message ?? ""), "錯誤訊息附上可執行的建議（先匯出 .sqlite、再清空舊資料）");
    ok(qres.storageClass?.includes("s-danger"), `資料庫面板轉成紅色警示（${qres.storageClass}）`);
    ok(/儲存失敗/.test(qres.storage ?? "") && /QuotaExceededError/.test(qres.storage ?? ""), "面板文字顯示儲存失敗與原因");
    ok(/儲存錯誤/.test(qres.errRow ?? "") && /QuotaExceededError/.test(qres.errRow ?? ""), `診斷區塊有「儲存錯誤」列：${qres.errRow?.slice(0, 90)}`);
    ok(qres.dirty === true, "失敗後仍標記 dirty（下次會再重試）");
    ok(qres.total === 1 && qres.codes.length === 1, "資料仍在記憶體裡，沒有因為存不進去就消失");
    await qp.screenshot({ path: resolve(OUT, "survey-13-配額失敗.png"), fullPage: true });
    await qp.close();
  }

  // ---------------------------------------------------------------- ⑲ 記憶體模式要紅色警示
  log("\n⑲ 兩種儲存都不能用時（?persist=memory）：必須是紅色警示，不是靜靜地不存");
  {
    const mp = await browser.newPage();
    await mp.setViewport({ width: 1280, height: 1000 });
    await mp.goto(`${URL_}?persist=memory`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await mp.waitForFunction(() => window.__survey?.db?.ready === true, { timeout: 120000, polling: 200 });
    await mp.evaluate(() => document.querySelector("#rc-overlay-skip")?.click());
    await new Promise((r) => setTimeout(r, 400));
    const mem = await mp.evaluate(() => {
      const rows = [...document.querySelectorAll("#diag-body .dg-row")];
      const persistRowEl = rows.find((x) => x.textContent.trim().startsWith("持久化方式"));
      return {
        persistence: window.__survey.db.persistence, label: window.__survey.db.persistenceLabel,
        storage: document.querySelector("#rc-storage")?.textContent?.replace(/\s+/g, " ").trim(),
        storageClass: document.querySelector("#rc-storage")?.className,
        storageColor: getComputedStyle(document.querySelector("#rc-storage b")).color,
        summary: document.querySelector("#rc-diag-summary")?.innerHTML ?? "",
        persistRow: persistRowEl?.textContent?.replace(/\s+/g, " ").trim(),
        persistRowHtml: persistRowEl?.innerHTML ?? "",
        savedRow: rows.find((x) => x.textContent.trim().startsWith("最後儲存"))?.textContent?.replace(/\s+/g, " ").trim(),
      };
    });
    log(`  面板：${mem.storage}`);
    log(`  診斷列：${mem.persistRow} ／ ${mem.savedRow}`);
    log(`  標題顏色：${mem.storageColor} · class=${mem.storageClass}`);
    ok(mem.persistence === "memory" && mem.label.includes("記憶體"), `?persist=memory 生效（${mem.label}）`);
    ok(mem.storageClass?.includes("s-danger"), `面板狀態條是紅色警示樣式（${mem.storageClass}）`);
    ok(/重整即清空/.test(mem.storage ?? ""), "面板明確寫出「重整即清空」");
    ok(/重整即清空/.test(mem.persistRow ?? "") && /dg-danger/.test(mem.persistRowHtml), `診斷區塊的持久化方式用紅色標示（dg-danger）：${mem.persistRow}`);
    ok(/重整即清空|只在記憶體/.test(mem.summary) && /dg-danger/.test(mem.summary), `診斷摘要（不用展開）就有紅色警示：${mem.summary.replace(/<[^>]+>/g, "")}`);
    ok(mem.storageColor === "rgb(176, 61, 36)", `紅色是 #b03d24（實得 ${mem.storageColor}）`);
    ok(/匯出|Chrome/.test(mem.storage ?? ""), "有告訴使用者該怎麼做（先匯出／改用 Chrome）");
    await mp.screenshot({ path: resolve(OUT, "survey-14-記憶體警示.png"), fullPage: true });
    await mp.close();
  }
} finally {
  await browser.close();
}

log("\n=== 摘要 ===");
const failed = checks.filter((c) => !c.cond);
log(`檢查 ${checks.length} 項：通過 ${checks.length - failed.length} · 失敗 ${failed.length}`);
if (problems.length) {
  log(`發現 ${problems.length} 個問題：\n  ${[...new Set(problems)].join("\n  ")}`);
  process.exitCode = 1;
} else {
  log("建檔主流程（SQLite ＋ GPS 多次取樣 ＋ R-Tree 查重 ＋ 匯出）全部符合預期");
}
