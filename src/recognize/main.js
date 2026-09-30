// 澳門記憶 · 建築辨識示範頁（recognize.html 的進入點）
//
// 流程：上傳照片 → YOLO 框出建築 → 裁切 → DINOv2 取向量 → 與記憶點庫算餘弦相似度 → Top-3
//
// 這個檔案刻意寫得防禦性：
//   · 每一個 await 都包 try/catch，任何一步壞掉都顯示「哪一步壞了」而不是白屏
//   · 模型／嵌入庫非同步載入；失敗時仍可看診斷區塊的可讀中文錯誤
//   · 診斷區塊即時顯示：ORT 版本、YOLO 載入狀態與大小、DINOv2 狀態、嵌入庫筆數、最近一次推理耗時

// 注意：本檔位於 src/recognize/，因此共用模組（styles.css、i18n.js、viewer.js）
// 要往上一層（../）。先前這裡誤用了 src/ 層級的相對路徑，Vite 會直接以
// "Failed to resolve import" 讓整個頁面白屏。
import "../styles.css";
import "./recognize.css";
import { T } from "../i18n.js";
import { clsZh, simLabel } from "./labels.js";
import { createEncoder, DEFAULT_DINO } from "./dino.js";
import { multiCrops } from "./preprocess.js";
import { rankCandidates, marginOf, verdict } from "./compare.js";
import { locationQuality } from "./geo-ranking.js";
import { dedupVerdict, dedupThresholds } from "./dedup.js";
import { ModelViewer } from "../viewer.js";
// 普查建檔（這一輪新增的主流程）：SQLite 資料層、GPS 多次取樣、手動定位地圖、建檔表單、資料庫面板
import { openDb, dbState, persistenceStatus, onStorageChange, flushPersistence, wipeAll, clearPersistence, countBuildings, findNearby, lastQueries, exportJsonText } from "./db.js";
import { createSurvey } from "./survey.js";
import { createLedger, readMirror } from "./ledger.js";
import { GEO_PLANS } from "./geolocate.js";
import yoloWorkerUrl from "./yolo.worker.js?worker&url";
import DEMO_FILES from "./demo-photos.json";

const $ = (s) => document.querySelector(s);
const BASE = new URL("./", document.baseURI).href;
const warn = (...a) => console.warn("[recognize]", ...a);
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const round4 = (x) => Math.round(x * 1e4) / 1e4;

// ------------------------------------------------------------------ 診斷狀態
const diag = {
  ort: "—",
  threads: null,
  yolo: { state: "未載入", bytes: 0, input: null, loadMs: null, error: null },
  dino: { state: "未載入", bytes: 0, size: null, dim: null, loadMs: null, error: null },
  lib: { state: "未載入", count: 0, photos: 0, dims: [], error: null, eval: null, generated: null },
  last: { detectMs: null, embedMs: null, totalMs: null, detections: null, when: null },
};

function diagSummary() {
  const d = diag;
  if (d.yolo.error || d.dino.error || d.lib.error) {
    return `<span class="dg-bad">部分元件載入失敗</span> · 仍可嘗試辨識，細節見下方`;
  }
  const ready = d.yolo.state === "就緒" && d.dino.state === "就緒" && d.lib.state === "就緒";
  const parts = [ready ? `<span class="dg-ok">✓ 模型就緒</span>`
    : `載入中：YOLO ${d.yolo.state} · DINOv2 ${d.dino.state} · 嵌入庫 ${d.lib.state}`];
  if (d.lib.count) parts.push(`嵌入庫 ${d.lib.count} 棟 / ${d.lib.photos} 張參考`);
  if (d.last.totalMs != null) parts.push(`上次辨識 ${d.last.totalMs} ms`);
  // 資料庫的持久化狀態也放進摘要：不展開細節也要看得到「資料到底有沒有存」
  const st = dbState();
  if (st.ready) {
    parts.push(st.persistent
      ? `<span class="dg-ok">✓ 建檔會保存在此裝置</span>`
      : `<span class="dg-danger">⚠ 建檔只在記憶體，重整即清空</span>`);
  } else {
    parts.push(`<span class="dg-danger">⚠ 普查資料庫未就緒</span>`);
  }
  return parts.join(" · ");
}

function renderDiag() {
  const summary = $("#rc-diag-summary");
  if (summary) summary.innerHTML = diagSummary();
  const el = $("#diag-body");
  if (!el) return;
  const d = diag;
  const ok = (s) => (s ? `<span class="dg-ok">${s}</span>` : "");
  const bad = (s) => (s ? `<span class="dg-bad">${escapeHtml(s)}</span>` : "");
  const danger = (s) => (s ? `<span class="dg-danger">${escapeHtml(s)}</span>` : "");
  const mb = (b) => (b ? `${(b / 1048576).toFixed(1)} MB` : "—");
  const row = (k, v) => `<div class="dg-row"><span class="dg-k">${k}</span><span class="dg-v">${v}</span></div>`;
  const ev = d.lib.eval;
  const st = dbState();
  const ps = persistenceStatus();
  const timeZh = (iso) => (iso ? String(iso).slice(11, 19) : "—");
  el.innerHTML = [
    // ① 普查資料庫的持久化狀態放最前面：使用者這次就是看不出「資料根本沒存」才白做一輪
    row("普查資料庫", !st.ready ? bad(st.error ? `未就緒：${st.error}` : "尚未就緒")
      : `${ok(`就緒 v${st.schemaVersion}`)} · ${countBuildings()} 筆 · R-Tree ${st.rtree} 列`),
    row("持久化方式", !st.ready ? "—" : st.persistent
      ? `${ok(st.persistenceLabel)}${ps.reason ? `<span class="dg-sub">（${escapeHtml(ps.reason)}）</span>` : ""}`
      : `${danger("記憶體（重整即清空）")}<span class="dg-sub">——${escapeHtml(ps.reason ?? "沒有可用的儲存")}。請用「③ 普查資料庫」的匯出保存，或改用 Chrome／Edge。</span>`),
    row("目前筆數", st.ready ? `${countBuildings()} 筆（本機備份另有 ${ps.mirrorPending} 筆待還原）` : "—"),
    row("最後儲存", !st.persistent ? danger("沒有儲存（重整即清空）")
      : ps.lastSaveError ? danger(`儲存失敗：${ps.lastSaveError.message}`)
        : `${ps.lastSavedAt ? `${ok("✓")} ${timeZh(ps.lastSavedAt)}（${(ps.lastSavedBytes / 1024).toFixed(0)} KB${ps.lastSaveMs != null ? ` · ${ps.lastSaveMs} ms` : ""}）` : "尚未儲存"}`),
    ...(ps.lastSaveError ? [row("儲存錯誤", `${danger("⚠ " + ps.lastSaveError.message)}`)] : []),
    ...(ps.restoredFrom ? [row("本次還原", `${ok("✓")} 從 ${escapeHtml(ps.restoredFrom.source)} 還原 ${ps.restoredFrom.rows} 筆${ps.restoredFrom.savedAt ? `（存於 ${timeZh(ps.restoredFrom.savedAt)}）` : ""}`)] : []),
    ...(ps.migration?.inserted ? [row("本機備份救援", `${ok("✓")} 已從本機備份還原 ${ps.migration.inserted} 筆（編號 ${escapeHtml(ps.migration.codes.join(", "))}）`)] : []),
    ...(ps.shadowError ? [row("備援快照", bad(ps.shadowError))] : []),
    ...(ps.restoreError ? [row("舊資料警告", danger(`⚠ ${ps.restoreError}`))] : []),
    ...(ps.quarantined ? [row("毀損檔處置", `已另存為 ${escapeHtml(ps.quarantined)}（沒有直接覆蓋）`)] : []),
    ...(ps.schemaMismatch ? [row("schema 警告", bad(ps.schemaMismatch))] : []),
    ...(ps.storagePersisted === false && st.persistence === "opfs"
      ? [row("儲存空間許可", `<span class="dg-sub">瀏覽器未授予持久化（空間不足時可能被自動清除，建議定期匯出 .sqlite）</span>`)] : []),
    row("onnxruntime-web", escapeHtml(d.ort) + (d.threads ? ` · ${d.threads} 執行緒` : "")),
    row("YOLO 偵測模型", d.yolo.error ? bad(d.yolo.error)
      : `${ok(d.yolo.state)} · ${mb(d.yolo.bytes)}${d.yolo.input ? ` · ${d.yolo.input}px` : ""}${d.yolo.loadMs != null ? ` · 載入 ${d.yolo.loadMs} ms` : ""}`),
    row("DINOv2 編碼器", d.dino.error ? bad(d.dino.error)
      : `${ok(d.dino.state)} · ${mb(d.dino.bytes)}${d.dino.dim ? ` · ${d.dino.dim} 維` : ""}${d.dino.size ? ` · ${d.dino.size}px` : ""}${d.dino.loadMs != null ? ` · 載入 ${d.dino.loadMs} ms` : ""}`),
    row("記憶點嵌入庫", d.lib.error ? bad(d.lib.error)
      : `${ok(d.lib.state)} · ${d.lib.count} 棟 / ${d.lib.photos} 張參考${d.lib.dims.length ? ` · ${d.lib.dims.join("/")} 維（已 L2 正規化）` : ""}`),
    row("庫建立時間", escapeHtml(d.lib.generated ?? "—")),
    row("參考庫留一法", ev?.top1 != null
      ? `留一法 Top-1 ${(ev.top1 * 100).toFixed(1)}% · Top-3 ${(ev.top3 * 100).toFixed(1)}%（${ev.n_queries} 筆查詢 / ${ev.n_buildings} 棟）。庫內評估，非獨立實拍或端到端準確率。`
      : "—"),
    row("查重門檻", (() => {
      const t = currentThresholds();
      return t.source === "eval.suggested"
        ? `≥${t.hit} 高度相似 · ${t.maybe}~${t.hit} 需人工確認 · &lt;${t.maybe} 未找到可靠匹配（取自庫的 eval.suggested）`
        : `≥${t.hit} 高度相似 · ${t.maybe}~${t.hit} 需人工確認 · &lt;${t.maybe} 未找到可靠匹配（退回 labels.js 預設，庫沒有 eval.suggested）`;
    })()),
    row("最近一次 YOLO", d.last.detectMs != null ? `${d.last.detectMs} ms · 偵測到 ${d.last.detections} 棟` : "—"),
    row("最近一次 DINOv2", d.last.embedMs != null ? `${d.last.embedMs} ms` : "—"),
    row("最近一次總耗時", d.last.totalMs != null ? `${d.last.totalMs} ms（${d.last.when ?? ""}）` : "—"),
  ].join("");
}

// ------------------------------------------------------------------ 狀態與提示
function setStage(text, pct) {
  const el = $("#rc-stage");
  if (el) el.textContent = text;
  const bar = $("#rc-bar");
  if (bar && pct != null) bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  const ob = $("#rc-overlay-bar");
  if (ob && pct != null) ob.style.width = `${Math.max(0, Math.min(100, pct))}%`;
}
function hideOverlay() {
  const o = $("#rc-overlay");
  if (!o) return;
  o.classList.add("gone");
  // 立刻移出無障礙樹／點擊層（遮罩還在時會擋住底下的按鈕），
  // 但保留 display 讓 .gone 的淡出過場播完；HTML 的 hidden 帶 !important，
  // 直接設 hidden 會把 transition 一起關掉（畫面會硬切），所以延後一拍（220ms，過場 400ms）。
  o.setAttribute("aria-hidden", "true");
  clearTimeout(hideOverlay._t);
  hideOverlay._t = setTimeout(() => { o.hidden = true; }, 220);
}
function toast(msg, ms = 3600) {
  const el = $("#rc-toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("on");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("on"), ms);
}
/** 顯示可讀的錯誤，而不是白屏或只有 console */
function showError(where, message) {
  const el = $("#rc-errors");
  if (!el) return;
  const div = document.createElement("div");
  div.className = "rc-error";
  div.innerHTML = `<b>${escapeHtml(where)}</b>：${escapeHtml(message)}`;
  el.prepend(div);
  el.hidden = false;
}

// ------------------------------------------------------------------ 模型載入
let enc = null;              // DINOv2 編碼器（主執行緒，onnxruntime-web）
let yolo = null;             // YOLO Worker
let yoloReady = false;
let lib = null;              // 嵌入庫（Float32Array 版本）
let libMeta = null;
let pendingYolo = null;

async function loadLibrary() {
  diag.lib.state = "載入中…";
  renderDiag();
  try {
    const [res, attractions] = await Promise.all([
      fetch(`${BASE}data/memory-embeddings.json`),
      fetch(`${BASE}data/attractions.json`).then((r) => r.ok ? r.json() : null).catch(() => null),
    ]);
    if (!res.ok) throw new Error(`HTTP ${res.status}：data/memory-embeddings.json`);
    const raw = await res.json();
    const positions = new Map((attractions?.attractions ?? []).map((a) => [a.id, a.coords]));
    const buildings = [];
    for (const b of raw.buildings ?? []) {
      const vectors = (b.vectors ?? []).map((v) => Float32Array.from(v));
      if (!vectors.length) continue;
      buildings.push({
        id: b.id, zh: b.zh, en: b.en, cls: b.cls,
        spot: b.spot ?? null, model: b.model ?? null,
        files: b.files ?? [], vectors,
        coords: b.coords ?? positions.get(b.spot) ?? null,
      });
    }
    if (!buildings.length) throw new Error("嵌入庫裡沒有任何建築");
    const dims = [...new Set(buildings.flatMap((b) => b.vectors.map((v) => v.length)))];
    const badNorm = buildings.some((b) => b.vectors.some((v) => Math.abs(Math.hypot(...v) - 1) > 0.01));
    lib = { buildings };
    libMeta = {
      count: buildings.length,
      photos: buildings.reduce((s, b) => s + b.vectors.length, 0),
      dims, generated: raw.generated ?? null, encoder: raw.encoder ?? null,
      categories: raw.categories ?? null,
      eval: raw.eval ?? null, allNormalized: !badNorm,
    };
    Object.assign(diag.lib, { state: "就緒", ...libMeta, error: null });
    $("#rc-library-buildings").textContent = libMeta.count;
    $("#rc-library-photos").textContent = libMeta.photos;
    renderDiag();
    return libMeta;
  } catch (e) {
    diag.lib.state = "失敗";
    diag.lib.error = e.message;
    renderDiag();
    showError("記憶點嵌入庫載入失敗", `${e.message}（請確認 public/data/memory-embeddings.json 存在）`);
    throw e;
  }
}

function loadYolo() {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => { if (!settled) { settled = true; resolve(ok); } };
    try {
      // 設定走 URL query：module worker 要先下載並執行完模組才會註冊 message 監聽器，
      // 在那之前 postMessage 會被靜默丟棄（實測踩過）。用 query 讓 worker 自己啟動。
      // 由 Vite 輸出 worker 資產；部署版沒有 src/ 目錄，不能用原始碼路徑。
      const workerUrl = new URL(yoloWorkerUrl, document.baseURI);
      workerUrl.searchParams.set("base", BASE);
      workerUrl.searchParams.set("model", `${BASE}models/macau-buildings-yolo.onnx`);
      workerUrl.searchParams.set("imgsz", "768");
      yolo = new Worker(/* @vite-ignore */ workerUrl.href, { type: "module" });
    } catch (e) {
      diag.yolo.state = "失敗";
      diag.yolo.error = `Worker 無法啟動：${e.message}`;
      renderDiag();
      showError("YOLO Worker", diag.yolo.error);
      done(false);
      return;
    }
    yolo.addEventListener("message", (ev) => {
      const m = ev.data ?? {};
      if (m.type === "status") { diag.yolo.state = "載入中…"; setStage(m.text, 30); }
      else if (m.type === "ready") {
        yoloReady = true;
        Object.assign(diag.yolo, { state: "就緒", bytes: m.info.bytes, input: m.info.input, loadMs: m.info.loadMs, error: null });
        diag.ort = String(m.info.ort);
        renderDiag();
        done(true);
      } else if (m.type === "error") {
        if (m.id && pendingYolo) {           // 偵測失敗（不是載入失敗）
          showError("YOLO 偵測", m.message);
          pendingYolo.reject(new Error(m.message));
          pendingYolo = null;
          return;
        }
        diag.yolo.state = "失敗";
        diag.yolo.error = m.message;
        renderDiag();
        showError("YOLO 偵測模型", m.message);
        done(false);
      } else if (m.type === "detected") {
        pendingYolo?.resolve(m);
        pendingYolo = null;
      }
    });
    yolo.addEventListener("error", (e) => {
      diag.yolo.state = "失敗";
      diag.yolo.error = e.message || "Worker 執行錯誤";
      renderDiag();
      showError("YOLO Worker", diag.yolo.error);
      done(false);
    });
    // 保險：若 worker 沒有在時限內回報，主動 ping 一次（不依賴第一次 postMessage）
    setTimeout(() => {
      if (!settled && yolo) {
        diag.yolo.state = "載入中…";
        renderDiag();
        try { yolo.postMessage({ type: "ping" }); } catch { /* ignore */ }
      }
    }, 15000);
    setTimeout(() => {
      if (!settled) {
        diag.yolo.state = "失敗";
        diag.yolo.error = "YOLO worker 120 秒內沒有回應（已略過偵測，仍可用整張圖比對）";
        renderDiag();
        showError("YOLO Worker", diag.yolo.error);
        done(false);
      }
    }, 120000);
  });
}

async function loadDino() {
  diag.dino.state = "載入中…";
  renderDiag();
  try {
    // ORT 的 JS glue 放在 src/recognize/ort/（跟著模組圖一起打包，dev 與 build 都正確）；
    // WASM 二進位留在 public/ort/，執行時才 fetch（Vite 的 public 檔案只能是「執行期取用」）。
    const ort = await import("./ort/ort.wasm.min.mjs");
    ort.env.wasm.numThreads = 1;      // 多執行緒需要 SharedArrayBuffer（COOP/COEP），保守設定
    ort.env.wasm.simd = true;
    ort.env.logLevel = "error";
    ort.env.wasm.wasmPaths = `${BASE}ort/`;   // 明確指向 public/ort/，不依賴 import.meta.url 推導
    diag.ort = String(ort.env.versions?.web ?? ort.version ?? "unknown");
    diag.threads = ort.env.wasm.numThreads;
    renderDiag();
    enc = await createEncoder(ort, `${BASE}${DEFAULT_DINO}`, {});
    Object.assign(diag.dino, { state: "就緒", bytes: enc.bytes, size: enc.size, dim: enc.dim, loadMs: Math.round(enc.loadMs), error: null });
    renderDiag();
    return true;
  } catch (e) {
    diag.dino.state = "失敗";
    diag.dino.error = e.message;
    renderDiag();
    showError("DINOv2 編碼器", `${e.message}（請確認 public/models/dinov2-small-336.onnx 與 public/ort/ 都存在）`);
    return false;
  }
}

function yoloDetect(bitmap, opts) {
  return new Promise((resolve, reject) => {
    if (!yolo || !yoloReady) { reject(new Error(diag.yolo.error ?? "偵測模型尚未就緒")); return; }
    pendingYolo = { resolve, reject };
    yolo.postMessage({ type: "detect", bitmap, conf: opts.conf, iou: opts.iou }, [bitmap]);
  });
}

// ------------------------------------------------------------------ 查重門檻
/**
 * 查重門檻：以嵌入庫的 eval.suggested（留一法實測建議，hit 0.82 / maybe 0.57）為準，
 * 讀不到才退回 labels.js 的 SIM_THRESHOLDS。門檻由資料決定，不寫死在 UI 裡。
 */
function currentThresholds() {
  return dedupThresholds(diag.lib.eval ? { eval: diag.lib.eval } : libMeta);
}

// ------------------------------------------------------------------ 比對排序
function rankTop(query, { topK = 3, clsHint = null, thresholds = currentThresholds() } = {}) {
  return rankCandidates(lib, query, { topK, clsHint, thresholds,
    geo: { enabled: geoMatchEnabled, location: geoMatchLocation },
  });
}

// ------------------------------------------------------------------ 主流程
let currentFile = null;
let currentBitmap = null;
let lastResults = null;
let activeIndex = 0;
let busy = false;
let geoMatchEnabled = false;
let geoMatchLocation = null;
let geoLocationKey = "";
let geoRefreshTimer = null;
let geoExpiryTimer = null;

function refreshGeoRanking() {
  for (const r of lastResults?.results ?? []) {
    if (!r.queryVector) continue;
    const ranked = rankTop(r.queryVector, { clsHint: r.cls ?? null });
    Object.assign(r, { topK: ranked.top, totalCompared: ranked.total,
      margin: marginOf(ranked.top), thresholds: ranked.thresholds, geo: ranked.geo });
  }
}

function receiveSurveyLocation(location) {
  geoMatchLocation = location;
  clearTimeout(geoExpiryTimer);
  if (location.source !== "manual" && locationQuality(location).usable) {
    geoExpiryTimer = setTimeout(() => receiveSurveyLocation(geoMatchLocation),
      Math.max(1, Date.parse(location.capturedAt) + 300001 - Date.now()));
  }
  const key = JSON.stringify([location.lat, location.lng, location.accuracyM, location.source, locationQuality(location).usable]);
  if (key === geoLocationKey) return;
  geoLocationKey = key;
  clearTimeout(geoRefreshTimer);
  geoRefreshTimer = setTimeout(() => {
    if (!lastResults || busy) return;
    refreshGeoRanking();
    renderResults();
  }, 0);
}

function setWorkflow(step) {
  const order = ["photo", "result", "archive"];
  for (const el of document.querySelectorAll("[data-workflow]")) {
    const index = order.indexOf(el.dataset.workflow);
    el.classList.toggle("is-current", index === step);
    el.classList.toggle("is-complete", index < step);
    if (index === step) el.setAttribute("aria-current", "step");
    else el.removeAttribute("aria-current");
  }
}

function resultState(text, state = "") {
  const badge = $("#rc-result-state");
  if (!badge) return;
  badge.textContent = text;
  badge.dataset.state = state;
}

function setBusy(on) {
  busy = on;
  $("#rc-loading").hidden = !on;
  const btn = $("#rc-run");
  if (btn) {
    btn.disabled = on || !currentFile || !enc || !lib;
    btn.innerHTML = on ? "正在辨識…" : '開始辨識 <span aria-hidden="true">↗</span>';
    btn.setAttribute("aria-busy", String(on));
  }
  if (on) {
    $("#rc-empty").hidden = true;
    $("#rc-tabs").hidden = true;
    $("#rc-survey-host").hidden = true;
    setWorkflow(1);
    resultState("正在比對", "busy");
  }
}

/** 選好照片 → 顯示縮圖與檔名（不自動跑，等使用者按「開始辨識」） */
async function pickFile(file) {
  try {
    if (!/^image\//.test(file.type)) { toast("請選擇圖片檔（JPG / PNG / WebP）"); return; }
    currentFile = file;
    currentBitmap = null;
    lastResults = null;
    geoMatchEnabled = false; // Each photo needs its own confirmation that the location applies.
    $("#rc-filename").textContent = file.name;
    $("#rc-filesize").textContent = `${(file.size / 1024).toFixed(0)} KB · ${file.type || "image"}`;
    const url = URL.createObjectURL(file);
    const img = $("#rc-thumb");
    img.src = url;
    img.hidden = false;
    img.onload = () => URL.revokeObjectURL(url);
    $("#rc-file-info").hidden = false;
    $("#rc-drop").hidden = true;
    $("#rc-results").hidden = true;
    $("#rc-tabs").hidden = true;
    $("#rc-stagebox").hidden = true;
    $("#rc-empty").hidden = false;
    $("#rc-errors").hidden = true;
    $("#rc-survey-host").hidden = true;
    resultState("照片已就緒", "ready");
    setWorkflow(0);
    for (const demo of document.querySelectorAll(".rc-demo")) {
      const selected = demo.dataset.demo.split("/").pop() === file.name;
      demo.classList.toggle("is-selected", selected);
      demo.setAttribute("aria-pressed", String(selected));
    }
    setStage("照片已就緒，按「開始辨識」", 2);
    setBusy(false);
  } catch (e) {
    showError("讀取照片", e.message ?? String(e));
  }
}

function clearFile() {
  geoMatchEnabled = false;
  currentFile = null;
  currentBitmap = null;
  lastResults = null;
  const input = $("#rc-file");
  if (input) input.value = "";
  $("#rc-file-info").hidden = true;
  $("#rc-drop").hidden = false;
  $("#rc-stagebox").hidden = true;
  $("#rc-results").hidden = true;
  $("#rc-tabs").hidden = true;
  $("#rc-empty").hidden = false;
  $("#rc-errors").hidden = true;
  $("#rc-survey-host").hidden = true;
  resultState("等待照片");
  setWorkflow(0);
  for (const demo of document.querySelectorAll(".rc-demo")) {
    demo.classList.remove("is-selected");
    demo.setAttribute("aria-pressed", "false");
  }
  setStage("請先選一張照片", 0);
  setBusy(false);
}

async function run() {
  if (busy) return;
  if (!currentFile) { toast("請先選一張照片"); return; }
  if (!lib) { toast(`嵌入庫還沒就緒${diag.lib.error ? `：${diag.lib.error}` : ""}`); return; }
  if (!enc) { toast(`DINOv2 還沒就緒${diag.dino.error ? `：${diag.dino.error}` : ""}`); return; }
  if (!yoloReady && !$("#rc-skip")?.checked) toast("偵測模型未就緒，將直接用整張圖比對", 5000);
  setBusy(true);
  const t0 = performance.now();
  try {
    $("#rc-errors").hidden = true;
    $("#rc-results").hidden = true;
    setStage("正在讀取照片…", 8);

    let bitmap = currentBitmap;
    if (!bitmap) {
      try {
        bitmap = await createImageBitmap(currentFile, { imageOrientation: "from-image" })
          .catch(() => createImageBitmap(currentFile));
        currentBitmap = bitmap;
      } catch (e) {
        showError("讀取照片", `${e.message}（這個格式瀏覽器可能不支援，請改用 JPG/PNG）`);
        setStage("讀取照片失敗", 0);
        resultState("請更換照片");
        return;
      }
    }
    drawPreview(bitmap);

    // ---- ① YOLO 偵測
    let detections = [];
    let detectMs = null;
    const skip = !!$("#rc-skip")?.checked || !yoloReady;
    if (!skip) {
      setStage("YOLO 正在找出照片中的建築…", 24);
      try {
        await new Promise((r) => setTimeout(r, 30));   // 讓瀏覽器先把上面的訊息畫出來
        // 重要：ImageBitmap 用 transfer 送進 worker 後會被 detach（主執行緒這邊就失效了），
        // 後面的 DINOv2 裁切就再也畫不出來。所以另外做一份給 worker，主執行緒保留原本的。
        const forWorker = await createImageBitmap(bitmap);
        const m = await yoloDetect(forWorker, { conf: Number($("#rc-conf")?.value ?? 0.25), iou: 0.45 });
        detections = m.detections ?? [];
        detectMs = m.ms;
        setStage(`YOLO 找到 ${detections.length} 棟建築（候選框 ${m.candidates} 個 · ${m.ms} ms）`, 46);
      } catch (e) {
        showError("YOLO 偵測", e.message);
      }
    } else {
      setStage(!yoloReady ? "偵測模型未就緒，改用整張圖比對" : "已略過偵測，用整張圖比對", 32);
    }

    const regions = detections.length
      ? detections.slice(0, 4).map((d, i) => ({
          index: i, box: { x: d.x, y: d.y, w: d.w, h: d.h },
          cls: d.cls, clsZh: clsZh(d.cls), score: d.score, source: "yolo",
        }))
      : [{ index: 0, box: { x: 0, y: 0, w: bitmap.width, h: bitmap.height }, cls: null, clsZh: "未偵測到建築", score: null, source: "fallback" }];

    // ---- ②③ 每個區域：裁切 → DINOv2 → 比對
    const results = [];
    let embedMsTotal = 0;
    for (const r of regions) {
      setStage(`DINOv2 正在編碼第 ${r.index + 1}/${regions.length} 個區域…`, 46 + (44 * r.index) / regions.length);
      const t1 = performance.now();
      try {
        await new Promise((r2) => setTimeout(r2, 20));
        const tta = !$("#rc-notta")?.checked;
        const crops = r.source === "fallback" ? multiCrops(bitmap.width, bitmap.height, enc.size, tta ? 3 : 1) : null;
        const vec = await enc.embed(bitmap, r.source === "fallback" ? null : r.box, { crops, tta });
        embedMsTotal += performance.now() - t1;
        const ranked = rankTop(vec, { topK: 3, clsHint: r.cls ?? null });
        results.push({ ...r, queryVector: vec, topK: ranked.top, totalCompared: ranked.total,
          margin: marginOf(ranked.top), thresholds: ranked.thresholds, geo: ranked.geo });
      } catch (e) {
        embedMsTotal += performance.now() - t1;
        showError(`DINOv2 編碼（第 ${r.index + 1} 個區域）`, e.message);
        results.push({ ...r, topK: [], totalCompared: 0, margin: 0, error: e.message });
      }
    }
    if (!results.length) { setStage("沒有可用的結果", 0); return; }

    activeIndex = 0;
    lastResults = { results, width: bitmap.width, height: bitmap.height, file: currentFile.name };
    renderResults();
    const totalMs = Math.round(performance.now() - t0);
    diag.last = { detectMs: detectMs ?? null, embedMs: Math.round(embedMsTotal), totalMs, detections: detections.length, when: new Date().toLocaleTimeString() };
    renderDiag();
    setStage(`完成：${results.length} 個區域 · 總耗時 ${totalMs} ms`, 100);
  } catch (e) {
    warn(e);
    showError("辨識流程", e.message ?? String(e));
    setStage("辨識失敗", 0);
    resultState("請重試", "busy");
  } finally {
    setBusy(false);
  }
}

// ------------------------------------------------------------------ 預覽與框線
function drawPreview(bitmap) {
  $("#rc-thumb").hidden = true;
  const canvas = $("#rc-canvas");
  const stage = $("#rc-stagebox");
  if (!canvas || !stage) return;
  const maxW = (stage.parentElement?.clientWidth ?? 720) - 34;
  const maxH = Math.max(220, Math.min(430, window.innerHeight * 0.46));
  const s = Math.min(maxW / bitmap.width, maxH / bitmap.height, 1);
  canvas.width = Math.round(bitmap.width * s);
  canvas.height = Math.round(bitmap.height * s);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  stage.dataset.scale = String(s);
  stage.hidden = false;
  $("#rc-empty").hidden = true;
}

function drawBoxes() {
  const canvas = $("#rc-canvas");
  const layer = $("#rc-boxes");
  if (!canvas || !layer || !lastResults) return;
  const s = Number($("#rc-stagebox").dataset.scale) || 1;
  layer.setAttribute("viewBox", `0 0 ${canvas.width} ${canvas.height}`);
  layer.setAttribute("width", canvas.width);
  layer.setAttribute("height", canvas.height);
  layer.innerHTML = lastResults.results.map((r, i) => {
    const x = r.box.x * s, y = r.box.y * s, w = r.box.w * s, h = r.box.h * s;
    const label = r.source === "yolo"
      ? `${r.clsZh} ${(r.score * 100).toFixed(0)}%`
      : "整張圖（未偵測到建築）";
    return `<g class="rc-box ${i === activeIndex ? "on" : ""}" data-i="${i}">
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" />
      <text x="${(x + 5).toFixed(1)}" y="${Math.max(15, y - 7).toFixed(1)}">${escapeHtml(label)}</text>
    </g>`;
  }).join("");
  layer.hidden = false;
  for (const g of layer.querySelectorAll(".rc-box")) {
    g.addEventListener("click", () => { activeIndex = Number(g.dataset.i); renderResults(); });
  }
}

// ------------------------------------------------------------------ 結果畫面
//
// 這一頁的主結果是「標註」＋「查重」，「這是哪一棟」只是查重的手段：
//   ① 標註：YOLO 判定的類別（大字）＋ 信心／框大小／比對棟數
//   ② 查重：與已記錄建築的相似度 → 已記錄 / 可能是同一棟 / 尚未記錄
//   ③ 建檔：不論查重結果都會出現（見 survey.js）——普查的主流程是「記錄下來」，查重只是輔助
function renderResults() {
  if (!lastResults) return;
  $("#rc-empty").hidden = true;
  $("#rc-survey-host").hidden = false;
  resultState("辨識完成", "ready");
  setWorkflow(2);
  const { results } = lastResults;
  const r = results[activeIndex] ?? results[0];
  drawBoxes();
  renderTabs(results);

  const top = r.topK ?? [];
  const m = r.margin ?? 0;
  const matched = top[0] ?? null;
  const th = r.thresholds ?? currentThresholds();
  const v = verdict(top, m, th);
  const dd = r.dedup ?? dedupVerdict(top, m, th);

  // ① 標註：大字顯示「偵測到的類別」，不是建築名
  const headline = r.source === "yolo" ? `偵測到：${r.clsZh}` : "整張照片比對";
  const headlineSub = r.source === "yolo"
    ? `信心 <b>${(r.score * 100).toFixed(1)}%</b> · 框 <b>${Math.round(r.box.w)}×${Math.round(r.box.h)} px</b> · 與 <b>${r.totalCompared}</b> 棟已記錄建築比對`
    : `YOLO 沒有框出建築，退回整張圖取特徵 · 與 <b>${r.totalCompared}</b> 棟已記錄建築比對`;

  // ② 查重結論
  const knownLine = matched
    ? `<div class="rc-known-line"><span class="rc-known-tag">與已記錄建築的影像相似度</span> <b>${matched.sim.toFixed(3)}</b> · 首位候選「<b>${escapeHtml(matched.zh)}</b>」 · 影像分差 ${m.toFixed(3)}</div>`
    : `<div class="rc-known-line">目前沒有可比的已記錄建築</div>`;

  const head = `
    <div class="rc-verdict v-${v.key}">
      <div class="rc-verdict-main">
        <span class="rc-verdict-tag">${escapeHtml(v.zh)}</span>
        <h3>${escapeHtml(headline)}</h3>
        ${knownLine}
        <div class="rc-dedup-line d-${dd.key}">
          <b>${escapeHtml(dd.text)}</b>
          <span>${escapeHtml(dd.hint)}</span>
        </div>
      </div>
      ${matched ? `<div class="rc-verdict-actions">
        ${matched.model ? `<button class="btn gold" data-model="${escapeHtml(matched.model)}" data-title="${escapeHtml(matched.zh)}" data-sub="${escapeHtml(matched.en ?? "")}">看三維模型</button>` : ""}
        ${matched.spot ? `<a class="btn sec" href="${escapeHtml(mapLink(matched))}">在地圖上開啟</a>` : ""}
        ${!matched.model && !matched.spot ? `<span class="rc-nomodel">最相似的記憶點尚無三維模型與地圖連結</span>` : ""}
      </div>` : ""}
    </div>`;

  const boxLine = `<div class="rc-meta">${r.source === "yolo"
    ? `YOLO 判定類別：<b>${escapeHtml(r.clsZh)}</b> · 信心 ${(r.score * 100).toFixed(1)}%`
    : `YOLO：<b>未偵測到建築</b>（退回整張圖比對）`} · 框 ${Math.round(r.box.w)}×${Math.round(r.box.h)} px · 與 ${r.totalCompared} 棟已記錄建築比對</div>`;

  // ② 已記錄的相似建築（查重）
  const maxSim = Math.max(0.001, ...top.map((c) => c.sim));
  const cards = top.map((c, i) => {
    return `
    <article class="rc-card ${i === 0 ? "first" : ""}">
      <div class="rc-card-rank">${i + 1}</div>
      <div class="rc-card-body">
        <div class="rc-card-title">
          <h4>${escapeHtml(c.zh)}</h4>
          <span class="rc-sim">相似度 <b>${c.sim.toFixed(3)}</b></span>
        </div>
        <div class="rc-card-sub">${escapeHtml(c.clsZh)}${c.en ? ` · ${escapeHtml(c.en)}` : ""} · 參考照片 ${c.count} 張${c.clsMatch ? " · 類別與 YOLO 一致" : ""}</div>
        ${r.geo?.used ? `<div class="rc-card-sub">${c.geo?.used ? `距離建檔位置 ${Math.round(c.geo.distanceM).toLocaleString()} 公尺${c.geo.conflict ? " · 位置不一致，請核對" : ""}` : "此候選缺少座標，保留影像分數"}</div>` : ""}
        <div class="rc-bar-wrap" title="相對於本張照片最高分的比例">
          <i style="width:${Math.max(2, Math.min(100, (c.sim / maxSim) * 100)).toFixed(1)}%"></i>
        </div>
        <div class="rc-card-actions">
          ${c.model ? `<button class="btn gold sm" data-model="${escapeHtml(c.model)}" data-title="${escapeHtml(c.zh)}" data-sub="${escapeHtml(c.en ?? "")}">三維模型</button>` : ""}
          ${c.spot ? `<a class="btn sec sm" href="${escapeHtml(mapLink(c))}">地圖位置</a>` : ""}
        </div>
      </div>
    </article>`;
  }).join("");

  const dedupHead = top.length
    ? `<div class="rc-sec-head"><h3>相似的城市記憶</h3>
        <span>${r.geo?.used ? "影像＋位置輔助排序" : "影像排序"} · ${top.length} 個候選建築</span></div>`
    : "";

  // ③ 建檔：普查的主流程——**不再只有「尚未記錄」才出現**，每一次辨識都會顯示。
  // 查重結論（dd）仍然會帶進建檔區塊，因為「這可能已經記錄過」正是要提醒使用者的重點。
  survey.setContext({ r, dd, thresholds: th, key: `${lastResults.file ?? ""}|${activeIndex}|${r.cls ?? ""}|${r.source ?? ""}` });

  const geoQuality = locationQuality(geoMatchLocation);
  const geoNote = !geoMatchEnabled ? "只在這個位置對應目前照片時開啟；舊照片或遠景請保持關閉。"
    : !geoQuality.usable ? geoQuality.reason
      : "已參考下方建檔位置；遠方候選小幅降權，影像相似度保持原值。位置不一致時需要人工確認。";
  const geoControl = `<div class="rc-geo-match"><label><input type="checkbox" id="rc-geo-match" ${geoMatchEnabled ? "checked" : ""} /> 用建檔位置輔助比對這張照片</label>
    <p role="status">${escapeHtml(geoNote)}</p></div>`;
  $("#rc-results").innerHTML = head + geoControl + dedupHead +
    (top.length ? `<div class="rc-cards">${cards}</div>` : `<p class="rc-none">這張照片沒有可比對的候選。</p>`) +
    `<details class="rc-method"><summary>比對細節與相似度說明</summary>${boxLine}<div class="rc-meta">${headlineSub}</div><p class="rc-note">查重門檻：${th.hit} 以上＝高度相似、${th.maybe}~${th.hit}＝需要人工確認、低於 ${th.maybe}＝未找到可靠匹配。<br />相似度 = DINOv2 影像特徵的餘弦相似度（1.000 = 特徵完全相同）。
      相似度不是正確機率，低分也可能來自角度、光線或遮擋。這些門檻由參考庫留一法提出，尚未完成獨立實拍校準。
      位置輔助需要主動開啟，精度超過 100 公尺或 GPS 超過 5 分鐘會退回影像排序；它不讀取照片 EXIF。
      建檔時的 R-Tree（半徑 50 公尺）另外檢查附近檔案。低於門檻代表未找到可靠匹配，不能據此斷定未建檔。</p></details>`;
  $("#rc-results").hidden = false;
  $("#rc-geo-match")?.addEventListener("change", (event) => {
    geoMatchEnabled = event.target.checked;
    refreshGeoRanking();
    renderResults();
  });

  for (const b of $("#rc-results").querySelectorAll("[data-model]")) {
    b.addEventListener("click", () => openModel(b.dataset.model, b.dataset.title, b.dataset.sub));
  }
}

// ------------------------------------------------------------------ 建檔與資料庫（先前寫在這裡的「標記為新發現」區塊）
//
// 原本的入庫表單只在「查重相似度 < 0.48（尚未記錄）」時出現，而且只把資料收進 localStorage。
// 這一輪把它升為每次辨識後都顯示的主流程，並真的寫進資料庫，所以整段搬到：
//   · src/recognize/survey.js  —— 建檔表單、GPS 面板、手動定位、編號、存檔
//   · src/recognize/ledger.js  —— 記錄列表、依類型統計、匯出、本機備份
//   · src/recognize/db.js      —— SQLite（schema、R-Tree 空間查重、編號、匯出）
//   · src/recognize/geolocate.js —— 多次取樣與精度加權
//   · src/recognize/minimap.js —— 手動定位用的小地圖與精度圈

// ------------------------------------------------------------------ 普查建檔實例
//
// survey（建檔表單）掛在右欄的 #rc-survey-host，與 #rc-results 分開：
// 這樣切換偵測框／重畫結果時，表單的狀態（GPS 讀數、手動座標、已填欄位）不會被清掉。
const ledger = createLedger({ onNotice: (m) => toast(m) });
const survey = createSurvey({
  host: $("#rc-survey-host"),
  getCategories: () => libMeta?.categories ?? null,
  getEncoder: () => (libMeta?.encoder ? { name: libMeta.encoder.name, dim: libMeta.encoder.dim } : null),
  getPhoto: () => ({
    name: currentFile?.name ?? null,
    bytes: currentFile?.size ?? null,
    width: currentBitmap?.width ?? null,
    height: currentBitmap?.height ?? null,
  }),
  onNotice: (m) => toast(m),
  onSaved: () => ledger.refresh(),     // 存檔後立刻更新「③ 普查資料庫」的統計與列表
  onLocationChange: receiveSurveyLocation,
});

function renderTabs(results) {
  const el = $("#rc-tabs");
  if (!el) return;
  if (results.length <= 1) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  el.innerHTML = `<span class="rc-tabs-label">偵測到多棟，點選切換：</span>` + results.map((r, i) =>
    `<button class="rc-tab ${i === activeIndex ? "on" : ""}" data-i="${i}">${i + 1}. ${escapeHtml(r.source === "yolo" ? `${r.clsZh} ${(r.score * 100).toFixed(0)}%` : "整張圖")}</button>`).join("");
  for (const b of el.querySelectorAll(".rc-tab")) {
    b.addEventListener("click", () => { activeIndex = Number(b.dataset.i); renderResults(); });
  }
}

/** 深連結回主站：主站用 ?spot=<id> 開啟景點（見 src/main.js readHash/applyHash） */
function mapLink(c) {
  if (!c.spot) return BASE;
  return `${BASE}?spot=${encodeURIComponent(c.spot)}&from=recognize`;
}

// ------------------------------------------------------------------ 三維模型
const viewer = new ModelViewer({
  root: $("#viewer"), canvas: $("#viewer-canvas"), loadingEl: $("#viewer-loading"),
  loadingTextEl: $("#viewer-loading-text"), barEl: $("#viewer-bar"), badgeEl: $("#viewer-badge"),
  nameEl: $("#viewer-name"), metaEl: $("#viewer-meta"), factsEl: $("#viewer-facts"),
});
$("#viewer-close")?.addEventListener("click", () => viewer.close());
$("#viewer")?.addEventListener("click", (e) => { if (e.target.id === "viewer") viewer.close(); });
$("#tool-rotate")?.addEventListener("click", (e) => { const on = !viewer.autoRotate; viewer.setAutoRotate(on); e.currentTarget.classList.toggle("on", on); });
$("#tool-wire")?.addEventListener("click", (e) => { const on = !viewer.wireframe; viewer.setWireframe(on); e.currentTarget.classList.toggle("on", on); });
$("#tool-reset")?.addEventListener("click", () => viewer.resetView());
$("#tool-full")?.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $(".viewer-panel")?.requestFullscreen?.();
  } catch { toast("無法切換全螢幕"); }
  setTimeout(() => viewer.resize(), 150);
});
$("#tool-rotate")?.classList.add("on");

let manifest = null;
async function openModel(modelId, title, subtitle) {
  try {
    if (!manifest) {
      const res = await fetch(`${BASE}models/manifest.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}：models/manifest.json`);
      manifest = await res.json();
    }
    const model = manifest.models?.[modelId];
    if (!model) { toast(`找不到模型「${modelId}」`); return; }
    const v = (manifest.generated ?? "").slice(0, 19).replace(/[:T]/g, "");
    const q = v ? `?v=${v}` : "";
    await viewer.open({
      title: title ?? model.titleZh,
      subtitle: subtitle ?? model.titleEn,
      description: "你在建築辨識結果中選取的記憶點。可拖曳旋轉、滾輪縮放。",
      dimensions: model.dimensionsMeters,
      triangles: model.full?.triangles,
      sizes: { full: model.full?.bytes },
      files: { full: `${BASE}models/${model.full.file}${q}`, lod: model.lod ? `${BASE}models/${model.lod.file}${q}` : null },
      kind: model.kind ?? "artifact",
      realWorldScale: model.realWorldScale !== false,
      source: model.kind === "building" ? T("模型來源：AI 三維生成檔（非實測比例）") : T("模型來源：高精度掃描檔（1:1 尺度）"),
    });
  } catch (e) {
    showError("開啟三維模型", e.message);
    toast("三維模型開啟失敗，詳見錯誤訊息");
  }
}

// ------------------------------------------------------------------ 示範素材

async function loadDemo(url) {
  try {
    const name = decodeURIComponent(url.split("/").pop());
    setStage(`正在讀取示範照片 ${name}…`, 4);
    const res = await fetch(`${BASE}${url}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    await pickFile(new File([blob], name, { type: blob.type || "image/jpeg" }));
    await run();
  } catch (e) {
    showError("讀取示範照片", `${e.message}（${url}）`);
    setStage("示範照片讀取失敗", 0);
  }
}

// ------------------------------------------------------------------ 事件
function wireEvents() {
  const input = $("#rc-file");
  const openPicker = () => input?.click();
  $("#rc-pick")?.addEventListener("click", openPicker);
  $("#rc-drop")?.addEventListener("click", openPicker);
  $("#rc-drop")?.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPicker(); } });
  input?.addEventListener("change", async () => {
    const f = input.files?.[0];
    if (f) await pickFile(f);
  });

  $("#rc-run")?.addEventListener("click", () => run());
  $("#rc-clear")?.addEventListener("click", () => clearFile());
  $("#rc-overlay-skip")?.addEventListener("click", () => hideOverlay());

  const drop = $("#rc-drop");
  for (const ev of ["dragenter", "dragover"]) drop?.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop?.addEventListener("dragleave", (e) => { e.preventDefault(); drop.classList.remove("over"); });
  drop?.addEventListener("drop", async (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    await pickFile(f);
    if (lib && enc) await run();
  });
  // 整頁都能拖放
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", async (e) => {
    if (e.target.closest("#rc-drop")) return;
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    e.preventDefault();
    await pickFile(f);
    if (lib && enc) await run();
  });
  // 貼上（Ctrl+V）
  window.addEventListener("paste", async (e) => {
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
    if (!item) return;
    const f = item.getAsFile();
    if (!f) return;
    await pickFile(f);
    if (lib && enc) await run();
  });

  $("#rc-demo-list")?.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-demo]");
    if (!b) return;
    await loadDemo(b.dataset.demo);
  });
  $("#rc-conf")?.addEventListener("input", () => {
    const out = $("#rc-conf-out");
    if (out) out.textContent = Number($("#rc-conf").value).toFixed(2);
  });
  $("#rc-diag-toggle")?.addEventListener("click", () => {
    const body = $("#diag-body");
    const btn = $("#rc-diag-toggle");
    body.hidden = !body.hidden;
    btn.textContent = body.hidden ? "顯示細節" : "收起";
    btn.setAttribute("aria-expanded", String(!body.hidden));
  });
}

// ------------------------------------------------------------------ 啟動
async function boot() {
  renderDiag();
  wireEvents();
  setBusy(false);
  $("#rc-demo-list").innerHTML = DEMO_FILES
    .map((d) => `<button class="rc-demo" data-demo="${d.file}" aria-pressed="false" aria-label="使用${escapeHtml(d.label)}示範照片"><span class="rc-demo-image"><img src="${BASE}${encodeURI(d.file)}" alt="" loading="lazy" /></span><span class="rc-demo-label">${escapeHtml(d.label)}</span></button>`)
    .join("");
  $("#rc-photo-credits-list").innerHTML = DEMO_FILES.map((d) =>
    `<li><a href="${escapeHtml(d.source)}" target="_blank" rel="noopener noreferrer">${escapeHtml(d.label)}</a> · ${escapeHtml(d.author)} · <a href="${escapeHtml(d.licenseUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(d.license)}</a></li>`
  ).join("");

  // 資料庫與模型並行載入：SQLite 幾十毫秒就好了，不該排在 87 MB 的模型後面；
  // 但 openDb() 現在還要讀回持久化的位元組＋遷移舊備份，所以是非同步的（見 db.js）。
  const dbPromise = openDb()
    .then(() => {
      ledger.init();
      survey.updateDbState();
      const st = dbState();
      const ps = persistenceStatus();
      const bits = [];
      if (ps.restoredFrom?.rows) bits.push(`已從${ps.restoredFrom.source}還原 ${ps.restoredFrom.rows} 筆`);
      if (ps.migration?.inserted) bits.push(`已從本機備份還原 ${ps.migration.inserted} 筆`);
      if (bits.length) toast(`${bits.join(" · ")}（${st.persistenceLabel}）`, 6000);
      if (ps.restoreError) toast(`⚠ ${ps.restoreError}`, 8000);
      if (!st.persistent) toast("⚠ 這個瀏覽器沒有可用的本機儲存：資料只留在記憶體，重新整理就清空", 8000);
      renderDiag();
      return true;
    })
    .catch((e) => {
      warn("SQLite 初始化失敗", e);
      showError("普查資料庫（SQLite）", `${e.message}——建檔仍可用，但資料只會寫進本機備份（localStorage），請看「③ 普查資料庫」面板`);
      ledger.init();
      survey.updateDbState();
      renderDiag();
      return false;
    });

  // 每次存檔（節流後）都重畫診斷區塊、資料庫面板與表單狀態：
  // 使用者隨時看得到「最後儲存時間」與儲存錯誤，而不是以為資料已經存好了
  onStorageChange(() => { renderDiag(); ledger.refresh(); survey.updateDbState(); });

  setStage("正在載入模型與嵌入庫…", 5);
  const [libOk, dinoOk] = await Promise.all([
    loadLibrary().then(() => true).catch(() => false),
    loadDino(),
  ]);
  const yoloOk = await loadYolo();
  await dbPromise;

  if (libOk && dinoOk && yoloOk) {
    setStage("全部就緒，請選一張照片", 100);
  } else {
    const bad = [libOk ? null : "嵌入庫", dinoOk ? null : "DINOv2", yoloOk ? null : "YOLO"].filter(Boolean);
    setStage(`部分元件載入失敗（${bad.join("、")}）——仍可嘗試辨識，細節見診斷`, 100);
  }
  hideOverlay();
  setBusy(false);
}

boot().catch((e) => {
  warn(e);
  showError("啟動", e.message ?? String(e));
  setStage("啟動失敗", 0);
  hideOverlay();
});

/** 外部（console／自動化測試／示範）直接餵入一組結果並重畫，不需要重跑模型 */
function showResults(bundle) {
  if (!bundle?.results?.length) { toast("沒有可顯示的結果"); return false; }
  lastResults = {
    results: bundle.results,
    width: bundle.width ?? currentBitmap?.width ?? null,
    height: bundle.height ?? currentBitmap?.height ?? null,
    file: bundle.file ?? currentFile?.name ?? null,
  };
  activeIndex = Math.min(activeIndex, lastResults.results.length - 1);
  renderResults();
  return true;
}

// 方便在 console 檢查
window.__recognize = {
  diag,
  get meta() { return libMeta; },
  get thresholds() { return currentThresholds(); },
  run, pickFile, clearFile, showResults,
  get results() { return lastResults; },
  get lib() { return lib; },
  get enc() { return enc; },
};

// 同理，普查建檔／資料庫的檢查入口（自動化測試也用這一組）
window.__survey = {
  survey,
  ledger,
  get db() { return dbState(); },
  get persistence() { return persistenceStatus(); },
  /** 立刻把資料庫寫進 provider（測試與 pagehide 用同一條路徑） */
  flush: (opts) => flushPersistence(opts),
  /** 清空資料庫 + 清掉裝置上的檔（重新整理後真的是空的） */
  wipeAll: () => wipeAll(),
  clearPersistence: () => clearPersistence(),
  get total() { try { return countBuildings(); } catch { return null; } },
  get nearby() { try { return findNearby({ lat: survey.location.lat, lng: survey.location.lng, radiusM: 50 }); } catch { return null; } },
  get lastQuery() { return lastQueries.nearby; },
  get json() { try { return JSON.parse(exportJsonText()); } catch { return null; } },
  get plans() { return GEO_PLANS; },
  get mirror() { return readMirror(); },
  /** 存檔（與按下「存檔」按鈕同一條路徑） */
  save: () => survey.save(),
  /** 目前這一筆會寫進資料庫的內容（存檔前檢查用） */
  get pending() {
    return { code: $("#rc-nd-code")?.value ?? null, type: $("#rc-nd-cls")?.value ?? null, name: $("#rc-nd-name")?.value ?? null, location: survey.location };
  },
};
