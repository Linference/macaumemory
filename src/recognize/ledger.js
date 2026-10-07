// 澳門記憶 · 建築普查：資料庫面板（③ 普查資料庫）
//
// 負責：目前總筆數、依類型統計、記錄列表（檢視所有記錄）、匯出 JSON／.sqlite、
// 以及「這份資料到底存在哪裡」的持久化狀態。
//
// 關於 localStorage 備份：資料庫現在**真的會存下來**（OPFS 或 localStorage，見 db.js），
// 逐筆鏡射（MIRROR_KEY）退居第二層保險——它是舊版唯一的保存方式，開機時會由
// db.js 的 migrateMirrorRecords() 依 code 去重後補進資料庫。所以這一節顯示的是
// 「備份幾筆 / 幾筆還沒進資料庫」，而不是「重新整理前請先匯出」。

import {
  countBuildings, stats, statsByType, listBuildings, dbState, persistenceStatus, lastQueries,
  downloadJson, downloadSqlite, exportFilename, fmtLatLng, deleteAll,
  MIRROR_KEY, readMirrorRecords, pendingMirrorCount,
} from "./db.js";
import { clsZh } from "./labels.js";
import { geoSourceZh } from "./geo-math.js";

export { MIRROR_KEY };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (s, root = document) => root.querySelector(s);

// ------------------------------------------------------------------ 本機備份
/** 讀鏡射清單（實作在 db.js：遷移時要用同一份解析，避免兩套讀法不一致） */
export const readMirror = readMirrorRecords;

/** @returns {boolean} 是否真的寫進 localStorage */
export function appendMirror(record) {
  const all = readMirror();
  all.push(record);
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(all));
    return true;
  } catch (e) {
    console.warn("[survey] 寫入本機備份失敗", e?.message ?? e);
    return false;
  }
}

export function clearMirror() {
  try { localStorage.removeItem(MIRROR_KEY); return true; } catch { return false; }
}

/** 備份裡已用過的編號（重新整理後資料庫空了、備份還在時，配號要避開它們） */
export function mirrorCodes() {
  return readMirror().map((r) => r?.code).filter(Boolean);
}

const recType = (r) => r?.building?.type ?? r?.building?.cls ?? null;
const recTypeZh = (r) => r?.building?.typeZh ?? r?.building?.clsZh ?? clsZh(recType(r));

// ------------------------------------------------------------------ 面板
export function createLedger({ onNotice = () => {} } = {}) {
  const root = $("#rc-ledger");
  if (!root) return { refresh() {}, init() {} };

  root.innerHTML = `
    <div class="rc-ledger-head">
      <div>
        <span class="rc-section-kicker">YOUR CITY ARCHIVE</span>
        <h2>留下的城市記憶</h2>
        <p class="hint">查看本次普查建立的建築檔案。<b>資料會自動保存在此裝置</b>，重新整理不會消失；仍建議定期匯出留存。</p>
      </div>
      <div class="rc-ledger-actions">
        <button class="btn sec sm" id="rc-export-json">匯出 JSON</button>
        <button class="btn sec sm" id="rc-export-sqlite">匯出 .sqlite</button>
        <button class="btn sec sm" id="rc-ledger-refresh">更新列表</button>
        <button class="btn sec sm" id="rc-ledger-wipe" title="清空資料庫（示範／重新開始用）">清空資料庫</button>
      </div>
    </div>
    <div class="rc-storage" id="rc-storage"></div>
    <div class="rc-ledger-summary" id="rc-ledger-summary">正在準備你的城市檔案…</div>
    <div class="rc-ledger-stats" id="rc-ledger-stats"></div>
    <div class="rc-ledger-table-wrap">
      <div class="rc-ledger-table-head"><b>建築檔案</b><span id="rc-ledger-count"></span></div>
      <div class="rc-ledger-table" id="rc-ledger-table"></div>
    </div>
    <details class="rc-ledger-tech">
      <summary>技術細節：R-Tree 空間查重 SQL 與資料庫狀態</summary>
      <pre id="rc-ledger-sql"></pre>
    </details>
    <div class="rc-ledger-mirror" id="rc-ledger-mirror"></div>`;

  const hhmmss = (iso) => (iso ? String(iso).slice(11, 19) : "—");

  /** 持久化狀態條：資料存在哪裡、存了幾筆、最後儲存時間、失敗訊息（全部要看得懂） */
  function renderStorage() {
    const el = $("#rc-storage");
    if (!el) return;
    const ps = persistenceStatus();
    const st = dbState();
    if (!st.ready) {
      el.className = "rc-storage s-bad";
      el.innerHTML = `<b>⚠ 資料庫未就緒</b><span>${esc(st.error ?? "載入中…")}</span>`;
      return;
    }
    if (!ps.persistent) {
      el.className = "rc-storage s-danger";
      el.innerHTML = `<b>⚠ 目前是「記憶體（重整即清空）」——重新整理後資料會全部消失</b>
        <span>這個瀏覽器沒有可用的本機儲存（${esc(ps.reason ?? "未知原因")}）。
        請按「匯出 JSON／.sqlite」保存，或改用 Chrome／Edge 開啟本頁（支援 OPFS，容量無上限）。</span>`;
      return;
    }
    const err = ps.lastSaveError;
    el.className = `rc-storage ${err ? "s-danger" : "s-ok"}`;
    const when = err
      ? `⚠ 儲存失敗：${esc(err.message)}`
      : ps.lastSavedAt
        ? `✓ 最後儲存 ${hhmmss(ps.lastSavedAt)}（${(ps.lastSavedBytes / 1024).toFixed(0)} KB${ps.lastSaveMs != null ? ` · ${ps.lastSaveMs} ms` : ""}）`
        : `尚未儲存`;
    const extra = [
      ps.restoredFrom?.rows ? `本次已從${ps.restoredFrom.source}還原 ${ps.restoredFrom.rows} 筆` : null,
      ps.migration?.inserted ? `已從本機備份還原 ${ps.migration.inserted} 筆` : null,
      ps.mirrorPending ? `本機備份還有 ${ps.mirrorPending} 筆待還原` : null,
      ps.shadowError ? `備援快照：${ps.shadowError}` : null,
      ps.restoreError ? `舊資料：${ps.restoreError}` : null,
    ].filter(Boolean).join(" · ");
    el.innerHTML = `<b>持久化方式：${esc(ps.label)}</b>
      <span>${when}${extra ? ` · ${esc(extra)}` : ""}</span>`;
  }

  function refresh() {
    let st = null;
    try { st = stats(); } catch (e) { st = null; }
    const state = dbState();
    const ps = persistenceStatus();
    renderStorage();
    const sum = $("#rc-ledger-summary");
    if (!state.ready) {
      sum.innerHTML = `<span class="rc-bad">資料庫未就緒</span>${state.error ? `：${esc(state.error)}` : ""}`;
      $("#rc-ledger-stats").innerHTML = "";
      $("#rc-ledger-table").innerHTML = `<p class="rc-ledger-empty">資料庫尚未就緒，建檔與查重都不能用。其餘功能（辨識、查重、三維模型）不受影響。</p>`;
    } else {
      sum.innerHTML = `<div class="rc-ledger-metrics">
        <div class="rc-ledger-metric"><span>已建立檔案</span><strong>${st.total}<small>筆</small></strong></div>
        <div class="rc-ledger-metric"><span>已記錄位置</span><strong>${st.located}<small>筆</small></strong></div>
        <div class="rc-ledger-metric"><span>等待複核</span><strong>${st.pending}<small>筆</small></strong></div>
        <div class="rc-ledger-metric"><span>手動定位</span><strong>${st.manual}<small>筆</small></strong></div>
        </div><p class="rc-ledger-detail">精度 &gt;30 公尺 ${st.poor} 筆 · 本次資料 ${(st.approxBytes / 1024).toFixed(0)} KB · ${ps.persistent
          ? `資料自動保存在此裝置（${esc(ps.label)}），重新整理不會消失；仍建議定期匯出備份。`
          : `<span class="rc-danger">目前只存在記憶體，重新整理會清空——請立即用上方按鈕匯出。</span>`}</p>`;
      renderStats();
      renderTable();
    }
    renderMirror();
    renderTech();
    return st;
  }

  function renderStats() {
    const rows = statsByType();
    const el = $("#rc-ledger-stats");
    if (!rows.length) { el.innerHTML = ""; return; }
    const max = Math.max(...rows.map((r) => r.n));
    el.innerHTML = `<div class="rc-ledger-stat-head">依類型統計</div>` + rows.map((r) => `
      <div class="rc-ledger-stat">
        <span class="k">${esc(clsZh(r.type))}</span>
        <span class="bar"><i style="width:${Math.max(3, (r.n / max) * 100).toFixed(0)}%"></i></span>
        <span class="n">${r.n} 筆</span>
        <span class="d">有座標 ${r.located}${r.manual ? ` · 手動 ${r.manual}` : ""}${r.avg_accuracy_m ? ` · 平均精度 ${r.avg_accuracy_m} m` : ""}</span>
      </div>`).join("");
  }

  function renderTable() {
    const rows = listBuildings(100);
    $("#rc-ledger-count").textContent = rows.length ? `（最新 ${rows.length} 筆${countBuildings() > rows.length ? `／共 ${countBuildings()} 筆` : ""}）` : "";
    const el = $("#rc-ledger-table");
    if (!rows.length) { el.innerHTML = `<p class="rc-ledger-empty"><strong>你的第一份城市檔案，從這裡開始</strong>辨識一棟建築並完成建檔後，它就會出現在這裡。</p>`; return; }
    el.innerHTML = `<table>
      <thead><tr><th>編號</th><th>類型</th><th>名稱</th><th>建築位置</th><th>位置確認</th><th>拍攝位置</th><th>估計範圍</th><th>來源</th><th>樣本</th><th>時間</th><th>狀態</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td class="code">${esc(r.code)}</td>
        <td>${esc(clsZh(r.type))}</td>
        <td class="name">${esc(r.name ?? "（未命名）")}</td>
        <td class="coord">${esc(fmtLatLng(r.lat, r.lng))}</td>
        <td>${r.location_role === "building-confirmed" ? (r.footprint_id ? "已選輪廓" : "已手動確認") : r.location_role === "building-unlocated" ? "待補位置" : "舊紀錄待確認"}</td>
        <td class="coord">${r.capture_location ? esc((() => { const p = JSON.parse(r.capture_location); return `${fmtLatLng(p.lat, p.lng)} · ${p.accuracyM == null ? "範圍未知" : `約 ${p.accuracyM.toFixed(1)} m`}`; })()) : "—"}</td>
        <td>${r.accuracy_m == null ? "—" : `±${Number(r.accuracy_m).toFixed(1)} m`}</td>
        <td><span class="src s-${esc(r.geo_source ?? "none")}">${esc(geoSourceZh(r.geo_source))}</span></td>
        <td>${r.sample_count ?? 0}</td>
        <td class="when">${esc(String(r.created_at ?? "").slice(0, 19).replace("T", " "))}</td>
        <td>${r.status === "approved" ? "已複核" : "待審核"}</td>
      </tr>`).join("")}</tbody></table>`;
  }

  function renderTech() {
    const q = lastQueries.nearby;
    const state = dbState();
    const ps = persistenceStatus();
    $("#rc-ledger-sql").textContent = [
      `資料庫：${state.ready ? "就緒" : "未就緒"} · schema v${state.schemaVersion ?? "—"} · 引擎 ${state.engine ?? "—"}`,
      `持久化：${ps.label} · ${ps.persistent ? "重新整理後會自動還原" : "重新整理即清空"}${ps.reason ? `（${ps.reason}）` : ""}`,
      ps.lastSavedAt ? `最後儲存：${ps.lastSavedAt}（${(ps.lastSavedBytes / 1024).toFixed(0)} KB · ${ps.lastSaveMs ?? "?"} ms · 累計 ${ps.saveCount} 次）` : "最後儲存：尚未儲存",
      ps.restoredFrom ? `本次還原：${ps.restoredFrom.rows} 筆 ← ${ps.restoredFrom.source}${ps.restoredFrom.savedAt ? `（存於 ${ps.restoredFrom.savedAt}）` : ""}` : "",
      ps.migration?.inserted ? `本機備份救援：已遷移 ${ps.migration.inserted} 筆（${ps.migration.codes.join(", ")}）` : "",
      ps.lastSaveError ? `⚠ 儲存錯誤：${ps.lastSaveError.message}` : "",
      "",
      "⭐ 空間查重（R-Tree 粗篩 → haversine 精確距離）：",
      q?.sql ?? "（還沒查過；存檔或輸入座標時會執行）",
      q ? `綁定值（查詢框）：${JSON.stringify(q.bind)}` : "",
      q ? `R-Tree 粗篩候選 ${q.candidates} 筆 · 半徑 ${q.radiusM} 公尺` : "",
      "",
      "⚠️ SQLite 的 rtree 座標欄位是 32 位元浮點（在澳門的經度上解析度約 1 公尺），",
      "   所以 R-Tree 只當粗篩；最終距離一律用 buildings.lat/lng 的原始座標算 haversine。",
    ].filter(Boolean).join("\n");
  }

  function renderMirror() {
    const all = readMirror();
    const el = $("#rc-ledger-mirror");
    const ps = persistenceStatus();
    const pending = pendingMirrorCount();
    el.innerHTML = `
      <details><summary class="rc-ledger-mirror-head">本機備份（第二層保險）· ${all.length} 筆</summary>
      <p>${all.length
        ? `逐筆鏡射 <b>${all.length}</b> 筆${pending ? `，其中 <b>${pending}</b> 筆還沒進資料庫（重新載入會自動補進去）` : "，全部都已進資料庫"}。
           這份備份在資料庫存檔成功後仍然保留，當作第二層保險；資料庫本身已存於 ${esc(ps.label)}。`
        : "目前沒有備份（資料庫本身已自動保存，這個備份只是多一層保險）。"}</p>
      ${all.length ? `<div class="rc-nd-saved" id="rc-nd-saved">${all.slice(-6).reverse().map((d) => `
        <div class="rc-nd-row"><span>${esc(d.building?.name ?? "（無名稱）")}</span>
        <em>${esc(d.code ?? "—")} · ${esc(recTypeZh(d))} · ${esc(String(d.createdAt ?? "").slice(0, 19).replace("T", " "))}</em></div>`).join("")}</div>
        <button class="btn sec sm" id="rc-mirror-clear">清除本機備份</button>` : ""}</details>`;

    $("#rc-mirror-clear")?.addEventListener("click", () => {
      if (!confirm(`確定要清除本機備份的 ${all.length} 筆資料嗎？（資料庫裡的資料不受影響）`)) return;
      clearMirror();
      renderMirror();
      onNotice("已清除本機備份");
    });
  }

  // ---- 匯出與其他動作
  $("#rc-export-json")?.addEventListener("click", () => {
    try {
      const n = countBuildings();
      downloadJson();
      onNotice(`已匯出 JSON（${n} 筆）`);
    } catch (e) { onNotice(`匯出 JSON 失敗：${e.message}`); }
  });
  $("#rc-export-sqlite")?.addEventListener("click", () => {
    try {
      const n = countBuildings();
      downloadSqlite();
      onNotice(`已匯出 ${exportFilename("sqlite")}（${n} 筆）`);
    } catch (e) { onNotice(`匯出 .sqlite 失敗：${e.message}`); }
  });
  $("#rc-ledger-refresh")?.addEventListener("click", () => { refresh(); onNotice("已重新整理資料庫面板"); });
  $("#rc-ledger-wipe")?.addEventListener("click", () => {
    if (!confirm("確定要清空普查資料庫裡的資料嗎？（清空後會立刻覆蓋裝置上的存檔；本機備份不受影響，可另外清除）")) return;
    try { deleteAll(); refresh(); onNotice("已清空資料庫（裝置上的存檔也會一起更新）"); } catch (e) { onNotice(`清空失敗：${e.message}`); }
  });

  return { refresh, init: refresh, root };
}

/** 給其他模組用的類型顯示（相容舊紀錄的 cls / clsZh） */
export { recType, recTypeZh };
