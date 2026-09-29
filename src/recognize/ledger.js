// 澳門記憶 · 建築普查：資料庫面板（③ 普查資料庫）
//
// 負責：目前總筆數、依類型統計、記錄列表（檢視所有記錄）、匯出 JSON／.sqlite、
// 以及 localStorage 的本機備份狀態。
//
// 為什麼還要 localStorage 備份：這一階段資料庫只存在記憶體（重新整理就空了，靠匯出檔
// 保存）。把每一筆同時鏡射一份到 localStorage，重新整理後至少還看得到清單，
// 第二階段接上 OPFS 之後這個備份就只是保險。鏡射記錄的欄位與舊版「標記為新發現」
// 收集的格式相容（舊紀錄只有 cls/typeZh，讀取時兩種都吃）。

import {
  countBuildings, stats, statsByType, listBuildings, dbState, lastQueries,
  downloadJson, downloadSqlite, exportFilename, fmtLatLng, deleteAll,
} from "./db.js";
import { clsZh } from "./labels.js";
import { geoSourceZh } from "./geo-math.js";

export const MIRROR_KEY = "macau-memory.pending-discoveries";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (s, root = document) => root.querySelector(s);

// ------------------------------------------------------------------ 本機備份
export function readMirror() {
  try {
    const raw = localStorage.getItem(MIRROR_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.warn("[survey] 讀取本機備份失敗", e?.message ?? e);
    return [];
  }
}

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
        <p class="hint">查看本次普查建立的建築檔案。<b>重新整理前請先匯出保存</b>；本機備份會另行保留。</p>
      </div>
      <div class="rc-ledger-actions">
        <button class="btn sec sm" id="rc-export-json">匯出 JSON</button>
        <button class="btn sec sm" id="rc-export-sqlite">匯出 .sqlite</button>
        <button class="btn sec sm" id="rc-ledger-refresh">更新列表</button>
        <button class="btn sec sm" id="rc-ledger-wipe" title="清空資料庫（示範／重新開始用）">清空資料庫</button>
      </div>
    </div>
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

  function refresh() {
    let st = null;
    try { st = stats(); } catch (e) { st = null; }
    const state = dbState();
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
        </div><p class="rc-ledger-detail">精度 &gt;30 公尺 ${st.poor} 筆 · 本次資料 ${(st.approxBytes / 1024).toFixed(0)} KB · 重新整理會清空本次資料庫，請使用上方按鈕匯出。</p>`;
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
      <thead><tr><th>編號</th><th>類型</th><th>名稱</th><th>座標</th><th>精度</th><th>來源</th><th>樣本</th><th>時間</th><th>狀態</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td class="code">${esc(r.code)}</td>
        <td>${esc(clsZh(r.type))}</td>
        <td class="name">${esc(r.name ?? "（未命名）")}</td>
        <td class="coord">${esc(fmtLatLng(r.lat, r.lng))}</td>
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
    $("#rc-ledger-sql").textContent = [
      `資料庫：${state.ready ? "就緒" : "未就緒"} · schema v${state.schemaVersion ?? "—"} · 持久化 adapter：${state.persistence}（第二階段換 OPFS）`,
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
    const state = dbState();
    el.innerHTML = `
      <details><summary class="rc-ledger-mirror-head">本機備份 · ${all.length} 筆</summary>
      <p>${all.length
        ? `已鏡射 <b>${all.length}</b> 筆${state.persistence === "memory" ? "；重新整理後資料庫會清空，但這份備份還在，可作為第二階段匯入的來源。" : "。"}`
        : "目前沒有備份。"}</p>
      ${all.length ? `<div class="rc-nd-saved" id="rc-nd-saved">${all.slice(-6).reverse().map((d) => `
        <div class="rc-nd-row"><span>${esc(d.building?.name ?? "（無名稱）")}</span>
        <em>${esc(d.code ?? "—")} · ${esc(recTypeZh(d))} · ${esc(String(d.createdAt ?? "").slice(0, 19).replace("T", " "))}</em></div>`).join("")}</div>
        <button class="btn sec sm" id="rc-mirror-clear">清除本機備份</button>` : ""}</details>`;

    $("#rc-mirror-clear")?.addEventListener("click", () => {
      if (!confirm(`確定要清除本機備份的 ${all.length} 筆資料嗎？（SQLite 記憶體裡的資料不受影響）`)) return;
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
    if (!confirm("確定要清空 SQLite 裡的普查資料嗎？（本機備份不受影響，可另外清除）")) return;
    try { deleteAll(); refresh(); onNotice("已清空資料庫"); } catch (e) { onNotice(`清空失敗：${e.message}`); }
  });

  return { refresh, init: refresh, root };
}

/** 給其他模組用的類型顯示（相容舊紀錄的 cls / clsZh） */
export { recType, recTypeZh };
