// 澳門記憶 · 建築普查：建檔表單（建檔，這一頁的主流程）
//
// 流程（每一次辨識完都會出現，不再是「查重 <0.48 才出現」的次要分支）：
//   ① 拍一棟建築 → YOLO 判類型
//   ② GPS 精準定位（多次取樣＋精度加權，見 geolocate.js）
//   ③ 配一個編號 MM-YYYY-NNNN
//   ④ 錄入 SQLite（同時更新 R-Tree）
//   ⑤ 顯示成功與目前總筆數
//
// 這個模組只做 UI 與流程；定位在 geolocate.js、資料庫在 db.js、地圖在 minimap.js。
// 三件與「筆電沒有 GPS」直接相關的事在這裡落實：
//   · 一定顯示 accuracy（最終精度、最佳精度、樣本離散、來源）
//   · 精度差／讀數跳動過大就跳警示，並**自動展開**手動定位地圖
//   · 手動座標會蓋掉 GPS 座標，geo_source 記成 manual（原 GPS 讀數留在 geo_note）

import { insertBuilding, findNearby, peekNextCode, dbState, persistenceStatus, flushPersistence, fmtLatLng, countBuildings } from "./db.js";
import { createGeoSession, GEO_PLANS, DEFAULT_PLAN, progressText, GEO_STOP_ZH, geoWarnings } from "./geolocate.js";
import { SurveyMiniMap } from "./minimap.js";
import { appendMirror, mirrorCodes, MIRROR_KEY } from "./ledger.js";
import { CLASS_ZH, clsZh } from "./labels.js";
import { geoSourceZh, round5, summarizeSamples } from "./geo-math.js";

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
          <label>記錄建築位置 <em>自動定位或手動標記</em></label>
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

          <details class="rc-manual" id="rc-nd-manual">
            <summary>手動定位（在地圖上拖曳標記）</summary>
            <div class="rc-mmap-wrap">
              <div class="rc-mmap" id="rc-nd-minimap"></div>
              <div class="rc-mmap-tag">示意圖 · 離線資料（行政邊界／行政區名／61 個景點）</div>
            </div>
            <div class="rc-mmap-opts">
              <label><input type="checkbox" id="rc-mmap-buildings" /> 顯示建築輪廓（約 7.8 MB，第一次較慢）</label>
              <span class="rc-mmap-status" id="rc-mmap-status"></span>
            </div>
            <p class="rc-manual-hint">點地圖、或拖曳金色標記，就能把這棟建築的座標放在那裡（來源會記成「手動標記」）。
              本頁不連線圖磚，圖上是離線的行政邊界、行政區名與 61 個已記錄景點；放大到 14 級以上會出現街道名，
              勾選「顯示建築輪廓」就能對照實際建築的位置（精度不足自動展開時會直接幫你載入）。也可以用手機地圖查好座標再貼上：</p>
            <div class="rc-manual-row">
              <input type="number" step="0.00001" id="rc-nd-lat" placeholder="緯度 22.19745" />
              <input type="number" step="0.00001" id="rc-nd-lng" placeholder="經度 113.54084" />
              <button type="button" class="btn sec sm" id="rc-nd-apply">套用這個座標</button>
              <button type="button" class="btn sec sm" id="rc-nd-use-gps" hidden>改回 GPS 座標</button>
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
    return "尚未取得定位。按「取得定位」開始多次取樣（預設每秒 1 次、最多 30 次，達到目標精度會自動停）；也可以直接在下方地圖拖曳標記。";
  }
  function resultText(g) {
    const reasonZh = g.reasonZh ?? GEO_STOP_ZH[g.reason] ?? g.reason ?? "—";
    return `完成：最終座標 ${fmtLatLng(g.lat, g.lng)} · 最終精度 ±${g.accuracyM?.toFixed(1)} 公尺`
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
          <span class="a">±${(s.accuracyM ?? 0).toFixed(1)} m</span></li>`).join("");
  }

  function setProgress(pct) {
    const el = $("#rc-nd-geo-bar");
    if (el) el.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }

  // ---------------------------------------------------------------- 座標
  function effectiveLocation() {
    if (st.manual) {
      return {
        source: "manual", lat: st.manual.lat, lng: st.manual.lng, accuracyM: null, sampleCount: 0,
        bestAccuracyM: null, spreadM: null, stopReason: "manual", capturedAt: new Date().toISOString(),
        gpsNote: st.geo?.lat != null
          ? `GPS 原讀數 ${fmtLatLng(st.geo.lat, st.geo.lng)} ±${st.geo.accuracyM?.toFixed(1)}m（${geoSourceZh(st.geo.source)}，${st.geo.sampleCount} 次，${st.geo.reasonZh}），使用者手動修正為目前座標`
          : "使用者在地圖上手動標記（這一輪沒有 GPS 讀數）",
        unavailableReason: null,
      };
    }
    if (st.geo?.lat != null) {
      return {
        source: st.geo.source, lat: st.geo.lat, lng: st.geo.lng,
        accuracyM: st.geo.accuracyM, sampleCount: st.geo.sampleCount,
        bestAccuracyM: st.geo.bestAccuracyM, spreadM: st.geo.spreadM,
        stopReason: st.geo.reason, capturedAt: st.geo.samples?.at(-1)?.at ?? new Date().toISOString(),
        gpsNote: null, unavailableReason: null,
      };
    }
    if (st.geoError) {
      return { source: "unavailable", lat: null, lng: null, accuracyM: null, sampleCount: 0, unavailableReason: `${st.geoError.zh}——${st.geoError.hint}`, gpsNote: null };
    }
    return { source: "none", lat: null, lng: null, accuracyM: null, sampleCount: 0, unavailableReason: "尚未取得定位，也沒有手動標記", gpsNote: null };
  }

  /** 座標變了 → 更新地圖、精度圈、R-Tree 查重提示。 */
  function onLocationChanged() {
    const loc = effectiveLocation();
    if (st.minimap?.ready) st.minimap.setPoint({ lat: loc.lat, lng: loc.lng, accuracyM: st.manual ? null : loc.accuracyM });
    checkNearby(loc);
    onLocationChange(loc);
    const useGps = $("#rc-nd-use-gps");
    if (useGps) useGps.hidden = !(st.manual && st.geo?.lat != null);
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
      el.innerHTML = `<span>⚠ 這一筆沒有座標：不會出現在地圖上，也無法做空間查重。建議先「取得定位」，或用「手動定位」在圖上標記。</span>`;
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
    st.manual = null;
    st.geo = null;
    st.geoError = null;
    st.geoLive = null;
    st.samples = [];
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
        if (st.minimap?.ready) st.minimap.setPoint({ lat: live.lat, lng: live.lng, accuracyM: live.accuracyM });
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
        onPick: (lat, lng, origin) => {
          st.manual = { lat: round5(lat), lng: round5(lng), origin };
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
      const loc = effectiveLocation();
      st.minimap.setPoint({ lat: loc.lat, lng: loc.lng, accuracyM: st.manual ? null : loc.accuracyM });
      st.minimap.resize();
      if (reason === "accuracy") {
        onNotice("精度不足：已自動展開手動定位，請把標記拖到建築的位置");
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
    const lat = Number($("#rc-nd-lat")?.value);
    const lng = Number($("#rc-nd-lng")?.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      showErr("請輸入有效的經緯度（例如 22.19745 / 113.54084）");
      return;
    }
    st.manual = { lat: round5(lat), lng: round5(lng), origin: "typed" };
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
      photo: { name: photo.name ?? null, bytes: photo.bytes ?? null, width: photo.width ?? null, height: photo.height ?? null },
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
    $("#rc-nd-geo-done")?.addEventListener("click", () => { stopSampling(); onNotice("已停止取樣，使用目前結果"); });
    $("#rc-nd-geo-plan")?.addEventListener("change", (e) => {
      st.plan = planById(e.target.value);
      onNotice(`取樣計畫改為「${st.plan.zh}」：${st.plan.text}`);
      if (st.session?.active) startSampling();
    });
    $("#rc-nd-manual")?.addEventListener("toggle", (e) => { if (e.target.open) openManual(); });
    $("#rc-mmap-buildings")?.addEventListener("change", async (e) => {
      if (!e.target.checked) return;
      if (!st.minimap) await openManual();
      const state = await st.minimap?.loadBuildings();
      if (state !== "ready") e.target.checked = false;
    });
    $("#rc-nd-apply")?.addEventListener("click", applyTypedCoords);
    $("#rc-nd-use-gps")?.addEventListener("click", () => {
      st.manual = null;
      setStatus(st.geo ? resultText(st.geo) : idleStatusText(), st.geo ? "ok" : "");
      onLocationChanged();
      onNotice("已改回 GPS 座標");
    });
    $("#rc-nd-cancel")?.addEventListener("click", () => {
      for (const id of ["#rc-nd-name", "#rc-nd-note", "#rc-nd-lat", "#rc-nd-lng"]) { const el = $(id); if (el) el.value = ""; }
      clearErr();
      onNotice("已清除表單內容（座標保留）");
    });
  }

  // ---------------------------------------------------------------- 對外
  function setContext({ r, dd, thresholds, key }) {
    const first = !st.ctx;
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
      if (first && !st.geo && !st.manual) startSampling({ auto: true });
      else if (st.geo || st.manual) {
        setStatus(`${st.manual ? manualText() : resultText(st.geo)}｜座標沿用上一次取樣（同一地點可直接建檔；按「重新取樣」可重測）`, st.manual ? "manual" : "ok");
        onLocationChanged();
      }
    } else {
      onLocationChanged();
    }
    updateDbState();
  }

  return {
    mount, setContext, save,
    refreshCode, updateDbState, openManual,
    get state() { return st; },
    get plan() { return st.plan; },
    get location() { return effectiveLocation(); },
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
