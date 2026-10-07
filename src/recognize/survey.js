// 澳門記憶 · 建築普查：建檔表單（建檔，這一頁的主流程）
//
// 流程（每一次辨識完都會出現，不再是「查重 <0.48 才出現」的次要分支）：
//   ① 拍一棟建築 → YOLO 判類型
//   ② 選用裝置定位，另行確認建築位置
//   ③ 配一個編號 MM-YYYY-NNNN
//   ④ 錄入 SQLite（同時更新 R-Tree）
//   ⑤ 顯示成功與目前總筆數
//
// 這個模組只做 UI 與流程；定位在 geolocate.js、資料庫在 db.js、地圖在 minimap.js。
// 裝置估計範圍與建築確認位置分開顯示、分開儲存；新照片不沿用舊位置。

import { insertBuilding, findNearby, peekNextCode, dbState, persistenceStatus, flushPersistence, fmtLatLng, countBuildings } from "./db.js";
import { createGeoSession, GEO_PLANS, DEFAULT_PLAN, progressText, GEO_STOP_ZH, geoWarnings } from "./geolocate.js";
import { SurveyMiniMap } from "./minimap.js";
import { appendMirror, mirrorCodes, MIRROR_KEY } from "./ledger.js";
import { CLASS_ZH, clsZh } from "./labels.js";
import { geoSourceZh, summarizeSamples } from "./geo-math.js";
import { captureLocationFromGeo, buildingLocationFromPick, matchingLocation, parseTypedLocation } from "./survey-location.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const NEARBY_RADIUS_M = 50;      // 普查的空間查重半徑（需求單指定 50 公尺）

export function createSurvey({
  host,
  getCategories = () => null,
  getEncoder = () => null,
  getPhoto = () => null,
  onNotice = () => {},
  onSaved = () => {},
  onLocationChange = () => {},
}) {
  const st = {
    ctx: null, key: null, mounted: false,
    plan: GEO_PLANS[DEFAULT_PLAN],
    session: null,
    samples: [],
    geo: null, geoError: null, geoLive: null,
    manual: null,
    nearby: null, lastInserted: null,
    minimap: null,
    dbReady: false, dbError: null,
    lastSaved: null, lastInserted: null,
  };

  // ---------------------------------------------------------------- 畫面
  function blockHtml() {
    const cats = getCategories();
    const options = cats && typeof cats === "object" ? Object.entries(cats) : Object.entries(CLASS_ZH);
    return `
    <div class="rc-discover" id="rc-discover">
      <div class="rc-discover-head">
        <span class="rc-section-kicker">03 · NEW CITY MEMORY</span>
        <h3>為這棟建築，建立一份檔案</h3>
        <span id="rc-survey-verdict"></span>
      </div>
      <div class="rc-survey-nearby" id="rc-nd-nearby" hidden></div>

      <form class="rc-newform" id="rc-newform" novalidate>
        <div class="rc-field-row">
          <div class="rc-field">
            <label for="rc-nd-code">編號 <em>自動產生</em></label>
            <input type="text" id="rc-nd-code" readonly />
          </div>
          <div class="rc-field">
            <label for="rc-nd-cls">類型 <em>YOLO 判定，可改</em></label>
            <select id="rc-nd-cls">${options.map(([k, zh]) => `<option value="${esc(k)}">${esc(zh)}</option>`).join("")}</select>
          </div>
        </div>

        <div class="rc-field">
          <label for="rc-nd-name">名稱 <em>可留空（留空會自動命名）</em></label>
          <input type="text" id="rc-nd-name" placeholder="例如：沙梨頭麻子街 21 號唐樓" autocomplete="off" />
        </div>

        <div class="rc-field">
          <label for="rc-nd-note">備註 <em>可選</em></label>
          <textarea id="rc-nd-note" rows="2" placeholder="例如：巷口第二棟、二樓木窗完整、外牆磁磚剝落"></textarea>
        </div>

        <div class="rc-field rc-geo">
          <label>① 取得拍攝位置 <em>裝置位置，不等於建築位置</em></label>
          <p class="rc-location-help">現場拍攝可取得定位；上傳舊照片時，請直接在下方標記照片中的建築。</p>
          <div class="rc-geo-controls">
            <button type="button" class="btn gold sm" id="rc-nd-geo">取得定位</button>
            <button type="button" class="btn sec sm" id="rc-nd-geo-done" hidden>完成取樣</button>
            <label class="rc-geo-plan">計畫
              <select id="rc-nd-geo-plan">${Object.values(GEO_PLANS).map((p) => `<option value="${p.id}">${p.zh}：${p.text}</option>`).join("")}</select>
            </label>
          </div>
          <div class="rc-geo-bar"><i id="rc-nd-geo-bar"></i></div>
          <div class="rc-nd-locstate" id="rc-nd-locstate"></div>
          <ul class="rc-geo-samples" id="rc-nd-geo-samples"></ul>
          <div class="rc-geo-warn" id="rc-nd-geo-warn" hidden></div>

          <div class="rc-location-pair" aria-live="polite">
            <div class="capture"><span>拍攝位置 · 藍色</span><strong id="rc-capture-summary">尚未取得裝置位置</strong></div>
            <div class="building"><span>建築位置 · 金色</span><strong id="rc-building-summary">尚未確認建築位置</strong></div>
          </div>
          <button type="button" class="btn sec sm" id="rc-confirm-building">② 在地圖上確認這棟建築 ↗</button>

          <details class="rc-manual" id="rc-nd-manual">
            <summary>建築位置：點選輪廓或拖曳金色標記</summary>
            <div class="rc-mmap-wrap">
              <div class="rc-mmap" id="rc-nd-minimap"></div>
              <div class="rc-mmap-tag">藍點／圈：裝置位置與估計範圍 · 金點：建築位置</div>
            </div>
            <div class="rc-mmap-opts">
              <label><input type="checkbox" id="rc-mmap-buildings" /> 顯示建築輪廓（約 7.8 MB，第一次較慢）</label>
              <span class="rc-mmap-status" id="rc-mmap-status"></span>
            </div>
            <p class="rc-manual-hint">放大後點選照片中的建築輪廓，系統會高亮並保存其輪廓編號；也可以點地圖或拖曳金色標記。
              手動確認不代表測量精度。尚未確認時，檔案可先儲存，建築座標留空，裝置定位另行保存。</p>
            <div class="rc-manual-row">
              <input type="number" step="0.000001" id="rc-nd-lat" aria-label="建築緯度" placeholder="緯度 22.19745" />
              <input type="number" step="0.000001" id="rc-nd-lng" aria-label="建築經度" placeholder="經度 113.54084" />
              <button type="button" class="btn sec sm" id="rc-nd-apply">套用這個座標</button>
              <button type="button" class="btn sec sm" id="rc-nd-use-gps" hidden>清除建築位置</button>
            </div>
          </details>
        </div>

        <p class="rc-nd-err" id="rc-nd-err" hidden></p>
        <div class="rc-nd-actions">
          <button type="submit" class="btn gold" id="rc-nd-save">儲存建築檔案 ↗</button>
          <button type="button" class="btn sec" id="rc-nd-cancel">清除重填</button>
          <span class="rc-nd-dbstate" id="rc-nd-dbstate"></span>
        </div>
      </form>

      <div class="rc-nd-preview" id="rc-nd-preview" hidden>
        <div class="rc-nd-ok" id="rc-nd-ok" hidden></div>
        <details><summary class="rc-nd-preview-head">查看這份檔案的資料</summary><pre id="rc-nd-json"></pre></details>
      </div>
    </div>`;
  }

  function mount() {
    if (!host || st.mounted) return;
    host.innerHTML = blockHtml();
    host.hidden = false;
    wire();
    st.mounted = true;
    refreshCode();
    setStatus(idleStatusText());
    updateDbState();
  }

  // ---------------------------------------------------------------- 編號
  function nextCode() {
    try { return peekNextCode(new Date().getFullYear(), mirrorCodes()); } catch { return `MM-${new Date().getFullYear()}-????`; }
  }
  function refreshCode() {
    const el = $("#rc-nd-code");
    if (!el) return;
    const code = nextCode();
    el.value = code;
    el.dataset.code = code;
  }

  function updateDbState() {
    const el = $("#rc-nd-dbstate");
    const s = dbState();
    const ps = persistenceStatus();
    st.dbReady = s.ready;
    st.dbError = s.error;
    if (!el) return;
    el.className = `rc-nd-dbstate ${s.ready ? (ps.persistent ? "ok" : "bad") : "bad"}`;
    if (!s.ready) { el.textContent = `SQLite 尚未就緒${s.error ? `：${s.error}` : "（載入中…）"}`; return; }
    const last = ps.lastSaveError
      ? `⚠ 儲存失敗：${ps.lastSaveError.message}`
      : ps.lastSavedAt ? `最後儲存 ${String(ps.lastSavedAt).slice(11, 19)}` : "尚未儲存";
    el.textContent = ps.persistent
      ? `✓ 建檔服務已就緒 · 資料保存在此裝置（${ps.label}）· ${last}`
      : `⚠ 目前是「記憶體（重整即清空）」：重新整理後資料會消失——請先匯出，或改用 Chrome／Edge`;
  }

  // ---------------------------------------------------------------- 狀態文字
  const manualText = () => `已手動標記：${fmtLatLng(st.manual.lat, st.manual.lng)}（來源：手動標記，沒有精度圈）`;
  function idleStatusText() {
    if (st.manual) return manualText();
    if (st.geoError) return `${st.geoError.zh}——${st.geoError.hint}`;
    return "按「取得定位」記錄裝置位置，或直接在下方地圖確認建築。多次取樣用於觀察穩定性，不保證提高實際精度。";
  }
  function resultText(g) {
    const reasonZh = g.reasonZh ?? GEO_STOP_ZH[g.reason] ?? g.reason ?? "—";
    return `裝置位置 ${fmtLatLng(g.lat, g.lng)} · 設備估計範圍 ${g.accuracyM?.toFixed(1) ?? "未知"} 公尺`
      + ` · 樣本 ${g.sampleCount} 次 · 最佳 ±${g.bestAccuracyM?.toFixed(1) ?? "—"} 公尺`
      + ` · 離散 ±${g.spreadM?.toFixed(1) ?? "—"} 公尺 · 來源 ${g.sourceZh ?? geoSourceZh(g.source)} · 停止原因：${reasonZh}`;
  }
  function setStatus(text, cls = "") {
    const el = $("#rc-nd-locstate");
    if (!el) return;
    el.className = `rc-nd-locstate ${cls}`;
    el.textContent = text;
  }

  function renderWarnings(warnings) {
    const el = $("#rc-nd-geo-warn");
    if (!el) return;
    const list = warnings ?? [];
    if (!list.length) { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;
    el.innerHTML = list.map((w) => `<div class="rc-geo-warn-row lv-${w.level}">
      <b>${w.level === "warn" ? "⚠ " : w.level === "ok" ? "✓ " : "ⓘ "}${esc(w.zh)}</b>
      <span>${esc(w.hint)}</span></div>`).join("");
  }

  function renderSamples() {
    const el = $("#rc-nd-geo-samples");
    if (!el) return;
    const all = st.samples;
    if (!all.length) { el.innerHTML = ""; return; }
    const tail = all.slice(-6).reverse();
    el.innerHTML = `<li class="rc-geo-samples-head">最近 ${tail.length} 次讀數（共 ${all.length} 次）</li>`
      + tail.map((s) => `<li><span class="i">#${s.index}</span>
          <span class="c">${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}</span>
          <span class="a">${s.accuracyM == null ? "未知" : `${s.accuracyM.toFixed(1)} m`}</span></li>`).join("");
  }

  function setProgress(pct) {
    const el = $("#rc-nd-geo-bar");
    if (el) el.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }

  // ---------------------------------------------------------------- 座標
  function effectiveLocation() {
    return buildingLocationFromPick(st.manual);
  }

  const captureLocation = () => captureLocationFromGeo(st.geo);
  function syncMap() {
    if (!st.minimap?.ready) return;
    st.minimap.setCapture(captureLocation() ?? captureLocationFromGeo(st.geoLive));
    const loc = effectiveLocation();
    st.minimap.setPoint(loc.lat == null ? null : loc);
  }

  /** 座標變了 → 更新地圖、精度圈、R-Tree 查重提示。 */
  function onLocationChanged() {
    const loc = effectiveLocation();
    syncMap();
    checkNearby(loc);
    const capture = captureLocation();
    onLocationChange(matchingLocation(capture, loc) ?? loc);
    const cs = $("#rc-capture-summary");
    const bs = $("#rc-building-summary");
    if (cs) cs.textContent = capture ? `${fmtLatLng(capture.lat, capture.lng)} · 估計範圍 ${capture.accuracyM?.toFixed(1) ?? "未知"} m` : "尚未取得裝置位置";
    if (bs) bs.textContent = loc.confirmed ? `${fmtLatLng(loc.lat, loc.lng)}${loc.footprintId ? " · 已選建築輪廓" : " · 已手動確認"}` : "尚未確認 · 儲存時建築座標留空";
    const useGps = $("#rc-nd-use-gps");
    if (useGps) useGps.hidden = !st.manual;
  }

  /**
   * 查重時要不要排除剛存進去的那一筆？
   * 只有「還站在剛記錄的同一個點上」（1 公尺內）才排除——否則會把自己算成重複記錄。
   * 座標一移動（例如往北走 12 公尺重測），上一筆就是合法的鄰居，必須照實顯示。
   */
  function nearbyExcludeId(loc) {
    const last = st.lastInserted;
    if (!last || loc.lat == null) return null;
    const same = Math.abs(last.lat - loc.lat) < 1e-5 && Math.abs(last.lng - loc.lng) < 1e-5;   // 約 1 公尺
    return same ? last.id : null;
  }

  function checkNearby(loc) {
    const el = $("#rc-nd-nearby");
    if (!el) return;
    st.nearby = null;
    el.hidden = false;
    if (loc.lat == null || loc.lng == null) {
      el.className = "rc-survey-nearby n-none";
      el.innerHTML = `<span>請在地圖上確認建築位置，以便檢查附近是否已有檔案。裝置定位僅保存為拍攝位置。</span>`;
      return;
    }
    let res = null;
    try {
      res = findNearby({ lat: loc.lat, lng: loc.lng, radiusM: NEARBY_RADIUS_M, excludeId: nearbyExcludeId(loc) });
    } catch (e) {
      el.className = "rc-survey-nearby n-warn";
      el.innerHTML = `<span>空間查重無法執行：${esc(e.message)}</span>`;
      return;
    }
    st.nearby = res;
    if (!res.rows.length) {
      el.className = "rc-survey-nearby n-ok";
      el.innerHTML = `<span>✓ 半徑 ${NEARBY_RADIUS_M} 公尺內沒有既有記錄（R-Tree 粗篩 ${res.candidates} 筆候選，精確距離比對後 0 筆）——這可能是新發現。</span>`;
      return;
    }
    const nearest = res.rows[0];
    el.className = "rc-survey-nearby n-hit";
    el.innerHTML = `<span>⚠ 此位置 ${NEARBY_RADIUS_M} 公尺內已有 <b>${res.rows.length}</b> 筆記錄（最近：<b>${esc(nearest.name ?? "（未命名）")}</b>
      ${esc(nearest.code)} · ${nearest.distanceM < 10 ? nearest.distanceM.toFixed(1) : Math.round(nearest.distanceM)} 公尺）——仍然可以建檔，但請確認不是同一棟重複記錄。</span>
      ${res.rows.length > 1 ? `<ul>${res.rows.slice(1, 4).map((r) => `<li>${esc(r.name ?? "（未命名）")} · ${esc(r.code)} · ${Math.round(r.distanceM)} 公尺</li>`).join("")}</ul>` : ""}`;
  }

  // ---------------------------------------------------------------- GPS
  const planById = (id) => Object.values(GEO_PLANS).find((p) => p.id === id) ?? GEO_PLANS[DEFAULT_PLAN];

  function startSampling({ auto = false } = {}) {
    if (st.session?.active) st.session.cancel();
    st.geo = null;
    st.geoError = null;
    st.geoLive = null;
    st.samples = [];
    onLocationChanged();
    renderWarnings([]);
    renderSamples();
    setProgress(0);
    setStatus(`${auto ? "自動開始取樣" : "重新取樣"}：${st.plan.text}…`, "live");
    const done = $("#rc-nd-geo-done");
    if (done) done.hidden = false;
    const btn = $("#rc-nd-geo");
    if (btn) { btn.disabled = true; btn.textContent = "取樣中…"; }

    st.session = createGeoSession({
      plan: st.plan,
      onStatus: (text, err) => {
        if (err) { st.geoError = err; setStatus(`${text}——${err.hint}`, "bad"); }
        else setStatus(text, "live");
      },
      onSample: (sample, live, count) => {
        st.samples = st.session?.samples ?? [...st.samples, sample];
        st.geoLive = live;
        setStatus(progressText(count, st.plan, live), "live");
        renderSamples();
        setProgress((count / st.plan.maxSamples) * 100);
        syncMap();
      },
      onEnd: (result) => {
        st.session = null;
        st.geoLive = null;
        st.samples = result.samples ?? st.samples;
        const doneEl = $("#rc-nd-geo-done");
        if (doneEl) doneEl.hidden = true;
        const btnEl = $("#rc-nd-geo");
        if (btnEl) { btnEl.disabled = false; btnEl.textContent = "重新取樣"; }
        setProgress(100);
        renderSamples();
        if (result.lat == null) {
          st.geo = null;
          st.geoError = result.error ?? { code: "error", zh: "沒有取得任何有效讀數", hint: "請重試，或改用「手動定位（在地圖上拖曳標記）」。" };
          setStatus(`${st.geoError.zh}——${st.geoError.hint}`, "bad");
          renderWarnings([{ level: "warn", zh: st.geoError.zh, hint: st.geoError.hint }]);
          onLocationChanged();
          return;
        }
        st.geo = result;
        st.geoError = null;
        setStatus(resultText(result), "ok");
        renderWarnings(result.warnings);
        if (result.warnings?.some((w) => w.key === "poor-accuracy" || w.key === "spread")) openManual({ reason: "accuracy" });
        onLocationChanged();
      },
    });
    st.session.start();
  }

  const stopSampling = () => { if (st.session?.active) st.session.stop(); };

  async function openManual({ reason = null } = {}) {
    const box = $("#rc-nd-manual");
    if (box && !box.open) box.open = true;
    if (!st.minimap) {
      st.minimap = new SurveyMiniMap({
        container: $("#rc-nd-minimap"),
        onPick: (lat, lng, origin, footprintId = null) => {
          st.manual = { lat, lng, origin, footprintId, confirmedAt: new Date().toISOString() };
          const latInput = $("#rc-nd-lat"), lngInput = $("#rc-nd-lng");
          if (latInput) latInput.value = lat.toFixed(6);
          if (lngInput) lngInput.value = lng.toFixed(6);
          setStatus(manualText(), "manual");
          if (st.geo?.warnings) renderWarnings(st.geo.warnings);
          onLocationChanged();
        },
        onError: (msg) => onNotice(msg),
        onBuildingStatus: (msg, state) => {
          const el = $("#rc-mmap-status");
          if (el) { el.textContent = msg; el.className = `rc-mmap-status s-${state}`; }
        },
      });
    }
    const ok = await st.minimap.start();
    if (ok) {
      syncMap();
      st.minimap.resize();
      if (reason === "accuracy" || reason === "building") {
        if (reason === "accuracy") onNotice("定位估計範圍較大，請在地圖上確認建築位置");
        // 精度差時使用者就是要在圖上找「哪一棟」，所以順便載入建築輪廓（狀態會即時顯示）
        const cb = $("#rc-mmap-buildings");
        if (cb && !cb.checked) {
          cb.checked = true;
          st.minimap.loadBuildings();
        }
      }
    }
    return ok;
  }

  function applyTypedCoords() {
    const pick = parseTypedLocation($("#rc-nd-lat")?.value, $("#rc-nd-lng")?.value);
    if (!pick) {
      showErr("請輸入有效的經緯度（例如 22.19745 / 113.54084）");
      return;
    }
    st.manual = { ...pick, origin: "typed", confirmedAt: new Date().toISOString() };
    clearErr();
    setStatus(manualText(), "manual");
    onLocationChanged();
    onNotice("已套用輸入的座標（來源：手動標記）");
  }

  // ---------------------------------------------------------------- 錯誤
  function showErr(msg) { const el = $("#rc-nd-err"); if (el) { el.textContent = msg; el.hidden = false; } }
  function clearErr() { const el = $("#rc-nd-err"); if (el) { el.hidden = true; el.textContent = ""; } }

  // ---------------------------------------------------------------- 存檔
  function buildRecord({ code, name, type, note, loc, createdAt }) {
    const ctx = st.ctx ?? {};
    const r = ctx.r ?? {};
    const photo = getPhoto?.() ?? {};
    return {
      id: `nd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      code,
      createdAt,
      status: "pending",
      building: {
        name,
        type,
        typeZh: clsZh(type),
        note: note || null,
        location: {
          source: loc.source,
          role: loc.role, confirmed: loc.confirmed, footprintId: loc.footprintId,
          lat: loc.lat, lng: loc.lng,
          accuracyM: loc.accuracyM ?? null,
          sampleCount: loc.sampleCount ?? 0,
          bestAccuracyM: loc.bestAccuracyM ?? null,
          spreadM: loc.spreadM ?? null,
          stopReason: loc.stopReason ?? null,
          capturedAt: loc.capturedAt ?? null,
          gpsNote: loc.gpsNote ?? null,
          ok: loc.lat != null,
          // 沒有座標時的可讀原因（既有紀錄與測試都在讀這個欄位名）
          unavailableReason: loc.unavailableReason ?? null,
        },
      },
      photo: { name: photo.name ?? null, bytes: photo.bytes ?? null, width: photo.width ?? null, height: photo.height ?? null,
        captureLocation: captureLocation() },
      detection: {
        source: r.source ?? null, cls: r.cls ?? null, clsZh: r.clsZh ?? null,
        score: r.score != null ? Math.round(r.score * 1e4) / 1e4 : null,
        box: r.box ? { x: r.box.x, y: r.box.y, w: r.box.w, h: r.box.h } : null,
      },
      dedup: {
        verdict: ctx.dd?.text ?? null,
        key: ctx.dd?.key ?? null,
        thresholds: ctx.thresholds ?? null,
        top1: r.topK?.[0] ? { id: r.topK[0].id, zh: r.topK[0].zh, sim: r.topK[0].sim } : null,
        compared: r.totalCompared ?? 0,
        locationRanking: r.geo ?? null,
        comparison: { ...(r.comparison ?? {}), visualCandidates: (r.visualTopK ?? []).map((c) => ({ id: c.id, similarity: c.sim })),
          locationCandidates: (r.topK ?? []).map((c) => ({ id: c.id, similarity: c.sim })) },
        visualMargin: r.margin ?? null,
        candidates: (r.topK ?? []).map((c) => ({ id: c.id, similarity: c.sim,
          distanceM: c.geo?.distanceM ?? null, locationPenalty: c.geo?.penalty ?? 0, locationConflict: c.geo?.conflict ?? false })),
      },
      nearby: (st.nearby?.rows ?? []).map((n) => ({ code: n.code, name: n.name, distanceM: Math.round(n.distanceM * 10) / 10 })),
      encoder: getEncoder?.() ?? null,
      note: "由「建築辨識」頁的建檔表單寫入 SQLite（src/recognize/db.js）；同時鏡射一份到本機備份。",
    };
  }

  function save(e) {
    if (e?.preventDefault) e.preventDefault();
    clearErr();
    const type = $("#rc-nd-cls")?.value || st.ctx?.r?.cls || null;
    if (!type) { showErr("請選擇類型"); return null; }

    const loc = effectiveLocation();
    const rawName = $("#rc-nd-name")?.value.trim() ?? "";
    const note = $("#rc-nd-note")?.value.trim() ?? "";
    const code = ($("#rc-nd-code")?.value || "").trim() || nextCode();
    const seq = Number(String(code).split("-")[2]) || 0;
    const name = rawName || `未命名${clsZh(type)} #${String(seq).padStart(4, "0")}`;
    const createdAt = new Date().toISOString();
    const record = buildRecord({ code, name, type, note, loc, createdAt });

    // ① SQLite（同一個交易內更新 R-Tree）
    let inserted = null;
    let dbError = null;
    try {
      inserted = insertBuilding({
        type, name, note,
        lat: loc.lat, lng: loc.lng,
        accuracyM: loc.accuracyM, sampleCount: loc.sampleCount, geoSource: loc.source,
        geoBestAccuracyM: loc.bestAccuracyM, geoSpreadM: loc.spreadM,
        // geo_note 兩種用途：手動修正時記下原 GPS 讀數；失敗時記下原因（可追溯）
        geoStopReason: loc.stopReason, geoNote: loc.gpsNote ?? loc.unavailableReason ?? null,
        capturedAt: loc.capturedAt,
        locationRole: loc.confirmed ? "building-confirmed" : "building-unlocated",
        footprintId: loc.footprintId, captureLocation: record.photo.captureLocation,
        matchComparison: record.dedup.comparison,
        status: "pending",
        photoName: record.photo.name,
        detectorScore: record.detection.score, detectorCls: record.detection.cls,
        detectorSource: record.detection.source, detectorBox: record.detection.box,
        dedupSim: record.dedup.top1?.sim ?? null, dedupCompared: record.dedup.compared,
        encoder: record.encoder?.name ? `${record.encoder.name}${record.encoder.dim ? `-${record.encoder.dim}d` : ""}` : null,
        createdAt,
      });
    } catch (err) {
      dbError = err?.message ?? String(err);
      st.dbError = dbError;
    }

    // ② 本機鏡射（SQLite 失敗時至少不要讓這一筆消失）
    record.code = inserted?.code ?? code;
    const mirrored = appendMirror(record);
    st.lastSaved = record;
    st.lastInserted = inserted;

    // ③ 畫面回饋
    const ps = persistenceStatus();
    const okEl = $("#rc-nd-ok");
    if (okEl) {
      okEl.hidden = false;
      okEl.innerHTML = inserted
        ? `✓ 已寫入 SQLite：<b>${esc(inserted.code)}</b>（${esc(clsZh(inserted.type))} · ${esc(inserted.name)}） · 目前共 <b>${countBuildings()}</b> 筆${mirrored ? " · 本機備份也寫入成功" : " · ⚠️ 本機備份寫入失敗"}${ps.persistent ? ` · 已自動保存在此裝置（${esc(ps.label)}）` : " · <span class=\"rc-danger\">⚠️ 只在記憶體，重新整理會消失</span>"}`
        : `<span class="rc-bad">⚠️ SQLite 寫入失敗：${esc(dbError)}</span>——這一筆只寫進本機備份（localStorage ${MIRROR_KEY}）。`;
    }
    const jsonEl = $("#rc-nd-json");
    if (jsonEl) {
      jsonEl.textContent = JSON.stringify({
        ...record,
        _storedTo: inserted ? `SQLite buildings 表（id=${inserted.id}）＋ localStorage ${MIRROR_KEY}` : `localStorage ${MIRROR_KEY}（SQLite 失敗）`,
      }, null, 1);
    }
    const preview = $("#rc-nd-preview");
    if (preview) preview.hidden = false;

    // ④ 準備下一筆：重新配號，並用剛存進去的座標重查（同一點上排除自己）
    refreshCode();
    const nameIn = $("#rc-nd-name"); if (nameIn) nameIn.value = "";
    const noteIn = $("#rc-nd-note"); if (noteIn) noteIn.value = "";
    onLocationChanged();
    updateDbState();
    onNotice(inserted ? `已建檔 ${inserted.code}（${inserted.name}）· 目前共 ${countBuildings()} 筆` : `SQLite 寫入失敗：${dbError}`);
    onSaved(record, inserted);
    return record;
  }

  // ---------------------------------------------------------------- 事件
  function wire() {
    $("#rc-newform")?.addEventListener("submit", save);
    $("#rc-nd-name")?.addEventListener("input", clearErr);
    $("#rc-nd-cls")?.addEventListener("change", clearErr);

    $("#rc-nd-geo")?.addEventListener("click", () => startSampling());
    $("#rc-confirm-building")?.addEventListener("click", () => openManual({ reason: "building" }));
    $("#rc-nd-geo-done")?.addEventListener("click", () => { stopSampling(); onNotice("已停止取樣，使用目前結果"); });
    $("#rc-nd-geo-plan")?.addEventListener("change", (e) => {
      st.plan = planById(e.target.value);
      onNotice(`取樣計畫改為「${st.plan.zh}」：${st.plan.text}`);
      if (st.session?.active) startSampling();
    });
    $("#rc-nd-manual")?.addEventListener("toggle", (e) => { if (e.target.open) openManual(); });
    $("#rc-mmap-buildings")?.addEventListener("change", async (e) => {
      if (!e.target.checked) { st.minimap?.setBuildingsVisible(false); return; }
      if (!st.minimap) await openManual();
      const state = await st.minimap?.loadBuildings();
      if (state !== "ready") e.target.checked = false;
      else st.minimap?.setBuildingsVisible(e.target.checked);
    });
    $("#rc-nd-apply")?.addEventListener("click", applyTypedCoords);
    $("#rc-nd-use-gps")?.addEventListener("click", () => {
      st.manual = null;
      for (const id of ["#rc-nd-lat", "#rc-nd-lng"]) { const el = $(id); if (el) el.value = ""; }
      setStatus(st.geo ? resultText(st.geo) : idleStatusText(), st.geo ? "ok" : "");
      onLocationChanged();
      onNotice("已清除建築位置，拍攝位置另行保留");
    });
    $("#rc-nd-cancel")?.addEventListener("click", () => {
      for (const id of ["#rc-nd-name", "#rc-nd-note", "#rc-nd-lat", "#rc-nd-lng"]) { const el = $(id); if (el) el.value = ""; }
      clearErr();
      onNotice("已清除表單內容（座標保留）");
    });
  }

  // ---------------------------------------------------------------- 對外
  function resetLocations() {
    st.session?.cancel(); st.session = null;
    clearErr();
    st.manual = null; st.geo = null; st.geoLive = null; st.geoError = null; st.samples = [];
    for (const id of ["#rc-nd-lat", "#rc-nd-lng"]) { const el = $(id); if (el) el.value = ""; }
    const geoButton = $("#rc-nd-geo"); if (geoButton) { geoButton.disabled = false; geoButton.textContent = "取得定位"; }
    const done = $("#rc-nd-geo-done"); if (done) done.hidden = true;
    setProgress(0); renderSamples(); renderWarnings([]);
    setStatus(idleStatusText()); onLocationChanged();
  }

  function setContext({ r, dd, thresholds, key }) {
    if (!st.mounted) mount();          // 第一次有辨識結果時才畫（類別清單要靠已載入的嵌入庫）
    st.ctx = { r, dd, thresholds };
    const verdict = $("#rc-survey-verdict");
    if (verdict) {
      verdict.innerHTML = `${esc(dd?.text ?? "（這次沒有查重結論）")}
        <span class="rc-survey-tip">確認建築類型與位置後再儲存。系統也會檢查附近是否已有建築檔案。</span>`;
    }
    if (st.key !== key) {
      st.key = key;
      const sel = $("#rc-nd-cls");
      if (sel && r?.cls && [...sel.options].some((o) => o.value === r.cls)) sel.value = r.cls;
      for (const id of ["#rc-nd-name", "#rc-nd-note"]) { const el = $(id); if (el) el.value = ""; }
      const preview = $("#rc-nd-preview"); if (preview) preview.hidden = true;
      refreshCode();
      // 每張照片／建築區域都重新確認，不把上一張的位置套到新照片。
      resetLocations();
    } else {
      onLocationChanged();
    }
    updateDbState();
  }

  return {
    mount, setContext, save, resetLocations,
    refreshCode, updateDbState, openManual,
    get state() { return st; },
    get plan() { return st.plan; },
    get location() { return effectiveLocation(); },
    get captureLocation() { return captureLocation(); },
    get nearby() { return st.nearby; },
    /** 測試／示範用：直接餵一組讀數（走跟真實取樣同一套 summarise + warning 邏輯） */
    injectGeo({ samples = [], reason = "manual" } = {}) {
      const summary = summarizeSamples(samples);
      const result = {
        ...summary, reason,
        reasonZh: GEO_STOP_ZH[reason] ?? reason,
        sourceZh: geoSourceZh(summary.lat == null ? "none" : summary.source),
        samples, durationMs: 0, error: null, plan: { ...st.plan },
      };
      result.warnings = geoWarnings(result, { plan: st.plan });
      st.geo = result.lat == null ? null : result;
      st.geoError = result.lat == null ? { code: "error", zh: "沒有有效讀數", hint: "請重試。" } : null;
      st.manual = null;
      st.samples = samples;
      setStatus(result.lat == null ? idleStatusText() : resultText(result), result.lat == null ? "bad" : "ok");
      renderWarnings(result.warnings);
      renderSamples();
      onLocationChanged();
      return result;
    },
  };
}
