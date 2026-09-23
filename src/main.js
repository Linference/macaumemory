import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import { buildStyle, addContourLayers } from "./map-style.js";
import { LabelLayer } from "./labels.js";
import { PoiLayer, POI_GROUPS, POI_DEFAULT_OFF } from "./pois.js";
import { MyLocation, distanceMeters, bearingLabel, formatDistance } from "./geolocate.js";
import { NavigationController } from "./navigation.js";
import { AiChat } from "./chat.js";
import { PhotoLayer } from "./photos.js";
import { Speaker, Listener, speechSupported } from "./speech.js";
import { iconSvg } from "./icons.js";
import { MarkerLayer } from "./markers.js";
import { ModelViewer } from "./viewer.js";
import { setLang, getLang, T } from "./i18n.js";

// 明確指定 MapLibre worker 位址：使用 .js 版本（避免 .mjs 被伺服器給錯 MIME 而無法載入）
try {
  maplibregl.setWorkerUrl(new URL("assets/maplibre-gl-worker.js", document.baseURI).href);
} catch (e) {
  console.warn("setWorkerUrl:", e);
}

const $ = (sel) => document.querySelector(sel);
const HOME = { center: [113.5515, 22.1862], zoom: 13.5, pitch: 52, bearing: -14 };

const state = {
  data: null,
  manifest: null,
  filter: "all",
  query: "",
  selected: null,
  categories: {},
  nearMode: false,
};

// ---------------------------------------------------------------- 啟動
main().catch((err) => {
  console.error(err);
  boot("載入失敗：" + err.message, 100);
});

async function main() {
boot("正在載入地理資料…", 8);
const [data, manifest] = await Promise.all([
  fetch("data/attractions.json").then((r) => r.json()),
  fetch("models/manifest.json").then((r) => r.json()).catch(() => ({ models: {} })),
]);
state.data = data;
state.manifest = manifest;
state.categories = data.categories;
boot("正在建立三維地圖…", 26);

const map = new maplibregl.Map({
  container: "map",
  style: buildStyle(),
  center: HOME.center,
  zoom: HOME.zoom,
  pitch: HOME.pitch + 8,
  bearing: HOME.bearing,
  minZoom: 12.4, // 實際值會在 applyCameraLimits() 依視窗大小調整
  maxZoom: 19,
  maxPitch: 85,

  canvasContextAttributes: { antialias: true },
  attributionControl: false,
  dragRotate: true,
  pitchWithRotate: true,
});
map.touchZoomRotate.enableRotation();
window.__map = map;

map.on("error", (e) => console.warn("[map]", e?.error?.message ?? e));

// ---------------------------------------------------------------- 資料整理
// 位置校正：從 localStorage 讀取使用者手動修正的座標
const FIX_KEY = "macau.coordFixes.v1";
function loadFixes() {
  try { return JSON.parse(localStorage.getItem(FIX_KEY) ?? "{}"); } catch { return {}; }
}
let coordFixes = loadFixes();


const attractions = data.attractions.map((a) => {
  const museum = a.museumId ? data.museums.find((m) => m.id === a.museumId) : null;
  const artifactCount = museum ? museum.artifacts.filter((x) => x.model && state.manifest.models?.[x.model]).length : 0;
  const hasModel = !!(a.model && state.manifest.models?.[a.model]);
  // 重要度分層：0 = 一定顯示、1 = 中縮放、2 = 高縮放才顯示
  const tier = hasModel || museum || a.cat === "heritage" || a.cat === "landmark" || a.cat === "museum" ? 0
    : a.cat === "temple" || a.cat === "resort" ? 1 : 2;
  return { ...a, museum, artifactCount, hasModel, modelCount: artifactCount + (hasModel ? 1 : 0), tier };
});
for (const a of attractions) if (coordFixes[a.id]) { a.coords = coordFixes[a.id]; a.geoSource = "manual"; }
const byId = new Map(attractions.map((a) => [a.id, a]));

const markerLayer = new MarkerLayer(map, {
  categories: state.categories,
  onSelect: (a, o) => select(a, o),
  onFixChange: (id, coords) => {
    coordFixes[id] = coords;
    localStorage.setItem(FIX_KEY, JSON.stringify(coordFixes));
    updateEditBar();
    const a = byId.get(id);
    if (a) { a.coords = coords; a.geoSource = "manual"; if (state.selected?.id === id) openDetail(a); }
  },
});

// ---------------------------------------------------------------- 地圖載入完成
let appReady = false;
function onMapReady() {
  if (appReady) return;
  appReady = true;
  boot("正在設定地形與圖層…", 62);
  applyCameraLimits();
  try { map.setSky({ "sky-color": "#0a141f", "horizon-color": "#2b4557", "fog-color": "#0d1a25", "sky-horizon-blend": 0.55, "horizon-fog-blend": 0.5, "fog-ground-blend": 0.18 }); } catch (e) { console.warn(e); }
  try { map.setTerrain({ source: "dem", exaggeration: 1.5 }); } catch (e) { console.warn("terrain:", e); }
  markerLayer.setData(attractions);
  setupLabelsAndPois();
  renderChips();
  renderList();
  renderSidebarFoot();
  renderCredits();
  boot("準備就緒", 100);
  const restored = applyHash();
  setTimeout(() => {
    $("#boot").classList.add("gone");
    // 由網址還原時不再覆蓋鏡頭
    if (!restored) map.flyTo({ zoom: HOME.zoom, pitch: HOME.pitch, duration: 2200, essential: true });
  }, 420);
}
map.on("load", onMapReady);
map.on("idle", onMapReady);
setTimeout(onMapReady, 12000);

// ---------------------------------------------------------------- 介面：列表與篩選
function renderChips() {
  const cats = Object.entries(state.categories);
  const counts = new Map(cats.map(([k]) => [k, attractions.filter((a) => a.cat === k).length]));
  $("#chips").innerHTML =
    `<button class="chip ${state.filter === "all" ? "on" : ""}" data-cat="all">${T("全部")} ${attractions.length}</button>` +
    `<button class="chip near-chip ${state.nearMode ? "on" : ""}" data-near="1">📍 ${T("附近")}</button>` +
    cats.map(([k, v]) => `<button class="chip ${state.filter === k ? "on" : ""}" data-cat="${k}">${T(v.zh)} ${counts.get(k) ?? 0}</button>`).join("");
  for (const el of $("#chips").querySelectorAll(".chip")) {
    el.addEventListener("click", () => {
      if (el.dataset.near) {
        if (!myLocation.active) { myLocation.start(); toast(T("開啟定位後即可依距離排序")); }
        state.nearMode = !state.nearMode;
        renderChips(); renderList();
        return;
      }
      state.filter = el.dataset.cat; renderChips(); renderList();
    });
  }
}

function filtered() {
  const q = state.query.trim().toLowerCase();
  const list = attractions.filter((a) => {
    if (state.filter !== "all" && a.cat !== state.filter) return false;
    if (!q) return true;
    const hay = [a.zh, a.en, a.pt, a.brief, a.tag, a.museum?.name].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  });
  const pos = myLocation.position;
  if (state.nearMode && pos) {
    list.sort((x, y) => distanceMeters(pos.coords, x.coords) - distanceMeters(pos.coords, y.coords));
  }
  return list;
}

function renderList() {
  const list = filtered();
  $("#list").innerHTML = list.map((a) => {
    const cat = state.categories[a.cat] ?? state.categories.landmark;
    return `<button class="item ${state.selected?.id === a.id ? "on" : ""}" data-id="${a.id}">
      <span class="item-dot" style="background:${cat.color}">${iconSvg(cat.icon, 14)}</span>
      <span class="item-main">
        <span class="item-name">${T(a.zh)}${a.artifactCount ? `<span class="tag3d">3D 文物 ${a.artifactCount}</span>` : a.hasModel ? `<span class="tag3d">3D 模型</span>` : a.museumId ? `<span class="tag3d">博物館</span>` : ""}</span>
        <span class="item-brief">${T(a.brief)}${state.nearMode && myLocation.position ? ` <b class="item-dist">${formatDistance(distanceMeters(myLocation.position.coords, a.coords))}</b>` : ""}</span>
      </span>
    </button>`;
  }).join("") || `<p style="color:var(--ink-dim);font-size:12.5px;padding:14px">${T("沒有符合條件的景點")}</p>`;
  for (const el of $("#list").querySelectorAll(".item")) {
    el.addEventListener("click", () => select(byId.get(el.dataset.id), { fly: true }));
  }
}

function renderSidebarFoot() {
  const c = data.osmStats?.counts ?? {};
  const e = data.elevation?.stats ?? {};
  const attr = data.attractions?.length ?? 0;
  $("#sidebar-foot").innerHTML = T(
    `景點 ${attr} 處 · 建築 ${(c.buildings ?? 0).toLocaleString()} 棟（其中 ${(c.buildingsWithHeight ?? 0).toLocaleString()} 棟有實測高度）· 道路 ${(c.roads ?? 0).toLocaleString()} 條\n` +
    `海拔資料 Copernicus DEM GLO-30（30 公尺網格）：澳門陸域 ${e.landAreaKm2 ?? "—"} 平方公里，最高點 ${e.maxMeters ?? "—"} 公尺（疊石塘山）。`
  ).replace(/\n/g, "<br>");
}


const GEO_SRC_LABEL = {
  building: "OpenStreetMap 建築輪廓",
  area: "公園／沙灘圖資",
  "poi-exact": "OSM 地標點位",
  "poi-near": "OSM 鄰近地標",
  "poi-far": "OSM 地標點位",
  "wikipedia-zh": "維基百科座標",
  "wikipedia-en": "維基百科座標",
  "wikipedia-search": "維基百科座標",
  wikidata: "Wikidata 座標",
  "wikidata-search": "Wikidata 座標",
  curated: "人工標定",
};
const geoSourceLabel = (a) => GEO_SRC_LABEL[a.geoSource] ?? null;

// ---------------------------------------------------------------- 詳情面板
function select(a, { fly = false } = {}) {
  if (!a) return;
  state.selected = a;
  markerLayer.setActive(a.id);
  openDetail(a);
  if (fly) {
    map.flyTo({ center: a.coords, zoom: Math.max(map.getZoom(), 15.6), pitch: 58, duration: 1500, essential: true });
  }
  writeHash();
  renderList();
}

function openDetail(a) {
  const cat = state.categories[a.cat] ?? state.categories.landmark;
  const museum = a.museum;
  const artifacts = museum?.artifacts ?? [];
  const detail = T(a.detail ?? "");
  const paras = detail.split("\n").filter(Boolean).map((p) => `<p>${p}</p>`).join("");

  const nearPlaces = photosReady ? photoLayer.near(a.coords, 250) : [];
  const elev = state.data.elevation?.attractionElevations?.[a.id];
  const coordText = `${a.coords[1].toFixed(5)}°N, ${a.coords[0].toFixed(5)}°E${elev != null ? ` · ${T("海拔")} ${elev} m` : ""}${geoSourceLabel(a) ? ` · ${T("定位")}：${T(geoSourceLabel(a))}` : ""}`;
  const myPos = myLocation.position;
  const distText = myPos ? `${T("距離你")} ${formatDistance(distanceMeters(myPos.coords, a.coords))}（${T(bearingLabel(myPos.coords, a.coords))}）` : null;

  const actions = [];
  const hasModel = !!(a.model && state.manifest.models?.[a.model]);
  if (hasModel) actions.push(`<button class="btn" data-act="model">${T("🧊 查看三維模型")}</button>`);
  if (a.coords) actions.push(`<button class="btn" data-act="nav">${T("🧭 導航到這裡")}</button>`);
  actions.push(`<button class="btn sec" data-act="locate">${T("在地圖上定位")}</button>`);
  if (a.museumId && artifacts.length) actions.push(`<button class="btn" data-act="scroll-artifacts">${T("查看館藏文物")} (${artifacts.length})</button>`);
  if (a.website) actions.push(`<button class="btn sec" data-act="site">${T("官方網站")}</button>`);
  if (a.wiki || a.wikipedia) actions.push(`<button class="btn sec" data-act="wiki">${T("維基百科")}</button>`);

  const artifactsHtml = artifacts.length ? `
    <div class="d-section" id="artifact-section">
      <h3>${T("館藏文物 · 三維模型")}</h3>
      ${artifacts.map((x) => {
        const has = x.model && state.manifest.models?.[x.model];
        return `<div class="artifact" data-artifact="${x.id}">
          <span class="artifact-ico">${iconSvg("artifact", 22)}</span>
          <span class="artifact-main">
            <span class="artifact-name">${T(x.zh)}${has ? `<span class="pill on">3D</span>` : `<span class="pill off">${T("暫無模型")}</span>`}</span>
            <span class="artifact-era">${T(x.era ?? "")}</span>
            <span class="artifact-brief">${T(x.brief ?? "")}</span>
          </span>
        </div>`;
      }).join("")}
    </div>` : "";

  $("#detail-body").innerHTML = `
    <div class="d-hero" style="color:${cat.color}">${iconSvg(cat.icon, 46)}</div>
    <div class="d-cat">${T(cat.zh)}${a.tag ? ` · ${T(a.tag)}` : ""}</div>
    <h2 class="d-title">${T(a.zh)}</h2>
    <div class="d-sub">${[a.en, a.pt].filter(Boolean).join(" · ")}${museum?.address ? `<br>${T(museum.address)}` : ""}<br>${coordText}</div>
    <p class="d-brief">${T(a.brief ?? "")}</p>
    ${distText ? `<div class="dist-row"><span class="dist-dot"></span>${distText}</div>` : ""}
    ${hasModel ? `<div class="artifact" data-act="model-card">
      <span class="artifact-ico">${iconSvg("model", 22)}</span>
      <span class="artifact-main">
        <span class="artifact-name">${T("三維模型")}<span class="pill on">3D</span></span>
        <span class="artifact-brief">${T("拖曳旋轉、縮放觀察建築外觀")}</span>
      </span>
    </div>` : ""}
    <div class="d-detail">${paras}</div>
    ${museum ? `<div class="d-museum-note">${T("點擊下方文物卡片即可開啟三維模型檢視器，旋轉、縮放、觀察細節。所有模型皆為 1:1 尺度掃描檔。")}</div>` : ""}
    ${artifactsHtml}
    ${nearPlaces.length ? `<div class="d-section"><h3>${T("澳門記憶 · 記憶點")} · ${nearPlaces.length}</h3>
      <div class="d-photos">${nearPlaces.map((x) => `<img src="${x.p.coverThumb}" alt="${x.p.id}" title="${x.p.id} ${x.p.zh ?? ""}｜${x.p.photoCount} 張｜${Math.round(x.distM)}m" data-place="${x.p.id}" />`).join("")}</div>
    </div>` : ""}
    <div class="d-actions">${actions.join("")}</div>`;

  $("#detail").classList.add("open");
  $("#detail").setAttribute("aria-hidden", "false");

  for (const img of $("#detail-body").querySelectorAll("[data-place]")) {
    img.addEventListener("click", () => {
      const hit = photoLayer.places.find((f) => f.properties.id === img.dataset.place);
      if (hit) openLightbox(hit.properties, 0);
    });
  }
  $("#detail-body").querySelector('[data-act="model"]')?.addEventListener("click", () => openModelFor(a, a.model));
  $("#detail-body").querySelector('[data-act="nav"]')?.addEventListener("click", () => navStartFor(a));
  $("#detail-body").querySelector('[data-act="model-card"]')?.addEventListener("click", () => openModelFor(a, a.model));
  $("#detail-body").querySelector('[data-act="locate"]')?.addEventListener("click", () => {
    map.flyTo({ center: a.coords, zoom: 16.4, pitch: 62, duration: 1400, essential: true });
  });
  $("#detail-body").querySelector('[data-act="scroll-artifacts"]')?.addEventListener("click", () => {
    $("#artifact-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("#detail-body").querySelector('[data-act="site"]')?.addEventListener("click", () => window.open(a.website, "_blank", "noopener"));
  $("#detail-body").querySelector('[data-act="wiki"]')?.addEventListener("click", () => {
    const w = a.wiki ?? a.wikipedia;
    window.open(`https://zh.wikipedia.org/wiki/${encodeURIComponent(w)}`, "_blank", "noopener");
  });
  for (const el of $("#detail-body").querySelectorAll(".artifact")) {
    el.addEventListener("click", () => {
      const art = artifacts.find((x) => x.id === el.dataset.artifact);
      if (!art) return;
      const model = art.model ? state.manifest.models?.[art.model] : null;
      if (!model) {
        toast(`${T("《")}${T(art.zh)}${T("》尚未提供三維模型，歡迎依說明文件加入自己的掃描檔。")}`);
        return;
      }
      openModelFor(art, art.model, {
        title: T(art.zh),
        subtitle: `${T(art.era ?? "")}${art.material ? " · " + T(art.material) : ""}`,
        description: T(art.detail ?? ""),
        facts: art.facts ?? [],
      });
      state.selectedArtifact = art;
    });
  }
}

$("#detail-close").addEventListener("click", () => {
  $("#detail").classList.remove("open");
  $("#detail").setAttribute("aria-hidden", "true");
  markerLayer.setActive(null);
  state.selected = null;
  writeHash();
  renderList();
});

// ---------------------------------------------------------------- 三維模型開啟
function openModelFor(item, modelId, { title, subtitle, description, facts } = {}) {
  const model = state.manifest.models?.[modelId];
  if (!model) { toast(T("此模型尚未就緒")); return; }
  const isBuilding = model.kind === "building";
  viewer.open({
    title: title ?? T(item.zh),
    subtitle: subtitle ?? [item.en, item.pt].filter(Boolean).join(" · "),
    description: description ?? T(item.detail ?? ""),
    facts: (facts ?? []).map((f) => T(f)),
    dimensions: model.dimensionsMeters,
    triangles: model.full?.triangles,
    sizes: { full: model.full?.bytes },
    files: { full: `models/${model.full.file}`, lod: model.lod ? `models/${model.lod.file}` : null },
    kind: model.kind ?? "artifact",
    realWorldScale: model.realWorldScale !== false,
    source: isBuilding ? T("模型來源：使用者提供之 AI 三維生成檔（非實測比例）") : T("模型來源：高精度掃描檔（1:1 尺度）"),
  });
}

// ---------------------------------------------------------------- 三維檢視器
const viewer = new ModelViewer({
  root: $("#viewer"), canvas: $("#viewer-canvas"), loadingEl: $("#viewer-loading"),
  loadingTextEl: $("#viewer-loading-text"), barEl: $("#viewer-bar"), badgeEl: $("#viewer-badge"),
  nameEl: $("#viewer-name"), metaEl: $("#viewer-meta"), factsEl: $("#viewer-facts"),
});
$("#viewer-close").addEventListener("click", () => viewer.close());
$("#viewer").addEventListener("click", (e) => { if (e.target.id === "viewer") viewer.close(); });
$("#tool-rotate").addEventListener("click", (e) => {
  const on = !viewer.autoRotate;
  viewer.setAutoRotate(on);
  e.currentTarget.classList.toggle("on", on);
});
$("#tool-wire").addEventListener("click", (e) => {
  const on = !viewer.wireframe;
  viewer.setWireframe(on);
  e.currentTarget.classList.toggle("on", on);
});
$("#tool-reset").addEventListener("click", () => viewer.resetView());
$("#tool-full").addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $(".viewer-panel").requestFullscreen?.();
  } catch (e) { toast(T("無法切換全螢幕")); }
  setTimeout(() => viewer.resize(), 150);
});
$("#tool-rotate").classList.add("on");

// ---------------------------------------------------------------- 巴士站與即時報站
const BUS_URL_KEY = "macau.bus.api.url";
const BUS_KEY_KEY = "macau.bus.api.key";
function busApiConfig() {
  return { url: localStorage.getItem(BUS_URL_KEY) ?? "", key: localStorage.getItem(BUS_KEY_KEY) ?? "" };
}
function openBusSetup(on) {
  const el = $("#bus-setup");
  if (!el) return;
  el.classList.toggle("on", on);
  if (on) { $("#bus-api-url").value = busApiConfig().url; $("#bus-api-key").value = busApiConfig().key; }
}
/** 解析常見的報站回傳格式 → [{route, eta}] */
function parseArrivals(data) {
  const arr = Array.isArray(data) ? data : (data?.data ?? data?.arrivals ?? data?.list ?? []);
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 12).map((x) => {
    const route = x.route ?? x.routeNo ?? x.route_no ?? x.l ?? x.line ?? "?";
    let eta = x.eta ?? x.time ?? x.arrival ?? x.t ?? x.min ?? null;
    if (typeof eta === "number") eta = eta <= 0 ? "即將到站" : `${eta} 分鐘`;
    return { route: String(route), eta: eta == null ? "—" : String(eta) };
  });
}
async function loadArrivals(stop) {
  const { url, key } = busApiConfig();
  if (!url) return null;
  const target = url.replace("{stop}", encodeURIComponent(stop.properties.id ?? "")).replace("{name}", encodeURIComponent(stop.properties.n ?? ""));
  const headers = key ? { Authorization: `Bearer ${key}` } : {};
  const res = await fetch(target, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseArrivals(await res.json());
}
function showBusStop(stop) {
  const p = stop.properties;
  const routes = (p.r ?? "").split(",").filter(Boolean);
  const html = `<div style="font-size:13px;line-height:1.6;min-width:150px">
    <b>${p.n ?? "未命名站點"}</b>
    ${routes.length ? `<div style="margin-top:5px;font-size:11.5px;color:#9aa6b2">${T("路線")}</div><div style="margin-top:3px;display:flex;flex-wrap:wrap;gap:4px">${routes.map((r) => `<span style="background:rgba(126,231,135,.15);border:1px solid rgba(126,231,135,.35);color:#b7f0bd;border-radius:6px;padding:1px 6px;font-size:11.5px">${r}</span>`).join("")}</div>` : `<div style="margin-top:4px;font-size:11.5px;color:#7f8b98">${T("此站尚未對應路線資料")}</div>`}
    <div id="bus-live" style="margin-top:8px;font-size:11.5px;color:#9aa6b2">${busApiConfig().url ? T("載入即時到站…") : T("未設定即時報站 API")}</div>
  </div>`;
  const popup = new maplibregl.Popup({ closeButton: true, offset: 12, maxWidth: "260px" })
    .setLngLat(stop.geometry.coordinates).setHTML(html).addTo(map);
  if (busApiConfig().url) {
    loadArrivals(stop).then((list) => {
      const el = document.getElementById("bus-live");
      if (!el) return;
      if (!list || !list.length) { el.textContent = T("目前沒有到站資料"); return; }
      el.innerHTML = `<div style="color:#9aa6b2;font-size:11.5px;margin-bottom:3px">${T("即時到站")}</div>` +
        list.map((x) => `<div style="display:flex;justify-content:space-between;gap:10px"><b style="color:#b7f0bd">${x.route}</b><span>${x.eta}</span></div>`).join("");
    }).catch((e) => {
      const el = document.getElementById("bus-live");
      if (el) el.textContent = T("報站 API 失敗：") + e.message;
    });
  }
}

// ---------------------------------------------------------------- 圖層開關
const layerToggles = [
  ["#tg-buildings", ["buildings"]],
  ["#tg-hillshade", ["hillshade"]],
  ["#tg-roads", ["road", "road-casing", "rail"]],
  ["#tg-raster", ["water-fill", "landuse-fill"]],
  ["#tg-boundary", ["boundary-line", "boundary-fill"]],
];
for (const [sel, layers] of layerToggles) {
  $(sel).addEventListener("change", (e) => {
    const vis = e.target.checked ? "visible" : "none";
    for (const id of layers) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis);
  });
}
$("#tg-contours").checked = false;
// 等高線：第一次開啟才載入 4.3 MB 的資料
$("#tg-contours").addEventListener("change", async (e) => {
  if (e.target.checked) {
    if (!map.getSource("contours")) {
      toast(T("正在載入等高線資料…"));
      addContourLayers(map);
    } else {
      for (const id of ["contour", "contour-50"]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "visible");
    }
  } else {
    for (const id of ["contour", "contour-50"]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
  }
});

// 地名標籤開關
$("#tg-labels").addEventListener("change", (e) => labelLayer?.setEnabled(e.target.checked));
// 周邊設施開關
$("#tg-pois").addEventListener("change", async (e) => {
  const chips = $("#poi-chips");
  for (const el of chips.querySelectorAll(".poi-chip")) el.classList.toggle("off", !e.target.checked);
  if (poiLayer) { for (const g of POI_GROUPS) poiLayer.setGroup(g.id, e.target.checked); await poiLayer.setVisible(e.target.checked); }
});

$("#tg-bus").addEventListener("change", (e) => {
  if (map.getLayer("bus-stop")) map.setLayoutProperty("bus-stop", "visibility", e.target.checked ? "visible" : "none");
});
$("#btn-bus-api").addEventListener("click", () => openBusSetup(!$("#bus-setup").classList.contains("on")));
$("#bus-api-save").addEventListener("click", () => {
  const u = $("#bus-api-url").value.trim();
  localStorage.setItem(BUS_URL_KEY, u);
  localStorage.setItem(BUS_KEY_KEY, $("#bus-api-key").value.trim());
  openBusSetup(false);
  toast(u ? T("已儲存報站 API 設定") : T("已清除報站 API 設定"));
});
map.on("click", "bus-stop", (e) => { const f = e.features?.[0]; if (f) showBusStop(f); });
map.on("mouseenter", "bus-stop", () => { if (map.getLayer("bus-stop") && map.getLayoutProperty("bus-stop", "visibility") !== "none") map.getCanvas().style.cursor = "pointer"; });
map.on("mouseleave", "bus-stop", () => { map.getCanvas().style.cursor = ""; });

$("#tg-terrain").addEventListener("change", (e) => {
  map.setTerrain(e.target.checked ? { source: "dem", exaggeration: +$("#rg-exagg").value } : null);
});
$("#rg-exagg").addEventListener("input", (e) => {
  const v = +e.target.value;
  $("#out-exagg").textContent = `${v.toFixed(1)}×`;
  if ($("#tg-terrain").checked) map.setTerrain({ source: "dem", exaggeration: v });
});

$("#btn-reset-view").addEventListener("click", () => map.flyTo({ ...HOME, duration: 1500, essential: true }));
// 圖層面板開關（之前漏了按鈕）
function toggleControls(force) {
  const el = $("#controls");
  const on = force ?? !el.classList.contains("open");
  el.classList.toggle("open", on);
  $("#btn-layers")?.classList.toggle("active", on);
}
$("#btn-layers").addEventListener("click", () => toggleControls());
// 回到澳門：地圖中心離開澳門資料範圍時自動出現
const HOME_BOX = { west: 113.452, east: 113.668, south: 22.052, north: 22.278 };
function checkOutside() {
  const c = map.getCenter();
  const outside = c.lng < HOME_BOX.west || c.lng > HOME_BOX.east || c.lat < HOME_BOX.south || c.lat > HOME_BOX.north;
  $("#recenter-fab")?.classList.toggle("on", outside);
}
const goHome = () => map.flyTo({ ...HOME, duration: 1600, essential: true });
$("#recenter-fab").addEventListener("click", goHome);
$("#btn-recenter").addEventListener("click", goHome);
map.on("moveend", checkOutside);
map.on("load", checkOutside);
// 鍵盤快捷鍵：L 圖層、S 景點清單、Esc 關閉面板
window.addEventListener("keydown", (e) => {
  const tag = (e.target?.tagName ?? "").toLowerCase();
  if (tag === "input" || tag === "textarea" || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "l" || e.key === "L") { e.preventDefault(); toggleControls(); }
  if (e.key === "s" || e.key === "S") { e.preventDefault(); $("#sidebar").classList.toggle("open"); }
  if (e.key === "Escape") {
    if (viewer.isOpen) return;
    if (nav.route) { nav.stop(); return; }
    $("#detail").classList.remove("open");
    toggleControls(false);
  }
});
$("#btn-list").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
$("#btn-sidebar-close").addEventListener("click", () => $("#sidebar").classList.remove("open"));
$("#btn-help").addEventListener("click", () => showHelp());

// ---------------------------------------------------------------- 全螢幕
const FS_ENTER = "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5";
const FS_EXIT = "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5";
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
function syncFullscreenUI() {
  const on = !!fsElement();
  const path = $("#fs-path");
  if (path) path.setAttribute("d", on ? FS_EXIT : FS_ENTER);
  $("#btn-fullscreen")?.setAttribute("title", on ? T("退出全螢幕（F）") : T("全螢幕（F）"));
  setTimeout(() => map.resize(), 120);
}
async function toggleFullscreen() {
  try {
    if (!fsElement()) {
      const el = document.documentElement;
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: "hide" });
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      else toast(T("此瀏覽器不支援全螢幕，請按 F11"));
    } else {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }
  } catch (e) {
    console.warn("fullscreen:", e);
    toast(T("無法切換全螢幕，請按 F11"));
  }
  syncFullscreenUI();
}
$("#btn-fullscreen").addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", syncFullscreenUI);
document.addEventListener("webkitfullscreenchange", syncFullscreenUI);
window.addEventListener("keydown", (e) => {
  const tag = (e.target?.tagName ?? "").toLowerCase();
  if (tag === "input" || tag === "textarea" || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "f" || e.key === "F") { e.preventDefault(); toggleFullscreen(); }
});
window.__toggleFullscreen = toggleFullscreen;


// ---------------------------------------------------------------- 相機範圍限制
// 可平移範圍＝澳門特別行政區＋約 6 公里緩衝（與 DEM 圖磚覆蓋 113.455–113.665 / 22.055–22.275 一致）
const HOME_REGION = { center: [113.5600, 22.1650], lonSpan: 0.21, latSpan: 0.22 };
const M_PER_DEG_LON = 102400, M_PER_DEG_LAT = 110800;
function applyCameraLimits() {
  const canvas = map.getCanvas();
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  const cosLat = Math.cos((HOME_REGION.center[1] * Math.PI) / 180);
  const regionW = HOME_REGION.lonSpan * M_PER_DEG_LON;
  const regionH = HOME_REGION.latSpan * M_PER_DEG_LAT;
  const mppAtZ0 = 156543.03392 * cosLat;              // z=0 時每像素公尺數
  // 讓「最小縮放時的可視範圍」約為範圍的 72%，保留左右／上下平移的空間
  const zW = Math.log2((mppAtZ0 * w) / (0.72 * regionW));
  const zH = Math.log2((mppAtZ0 * h) / (0.72 * regionH));
  const zMin = Math.min(15, Math.max(12.2, Math.max(zW, zH)));
  map.setMinZoom(zMin);
  HOME.zoom = Math.max(13.4, Math.min(14.4, zMin + 0.12)); // 開場視角跟著微調
  map.setMaxBounds([
    [HOME_REGION.center[0] - HOME_REGION.lonSpan / 2, HOME_REGION.center[1] - HOME_REGION.latSpan / 2],
    [HOME_REGION.center[0] + HOME_REGION.lonSpan / 2, HOME_REGION.center[1] + HOME_REGION.latSpan / 2],
  ]);
  return zMin;
}
map.on("load", applyCameraLimits);
window.addEventListener("resize", () => { applyCameraLimits(); });

// ---------------------------------------------------------------- 澳門記憶 · 記憶點
const photoLayer = new PhotoLayer(map, { onOpen: (p, i) => openLightbox(p, i) });
let photosReady = false;
async function ensurePhotos() {
  if (photosReady) return photoLayer;
  try {
    await photoLayer.load();
    photosReady = true;
    $("#lb-photos").textContent = `記憶點 (${photoLayer.count})`;
    renderPhotoChips();
    // 把記憶點掛到對應的景點標記上（DOM 標記會蓋住地圖點，這是主要入口）
    const byNear = new Map();
    for (const f of photoLayer.places) {
      const nid = f.properties?.nearId;
      if (nid) byNear.set(nid, (byNear.get(nid) ?? 0) + 1);
    }
    for (const a of attractions) a.photoCount = byNear.get(a.id) ?? 0;
    markerLayer.setData(attractions);
    markerLayer.setActive(state.selected?.id ?? null);
  } catch (e) {
    console.warn("places:", e);
    toast(T("目前沒有記憶點（請用 tools/photo-archive 產線加入照片）"));
  }
  return photoLayer;
}
function renderPhotoChips() {
  const box = $("#photo-chips");
  if (!box) return;
  const used = new Map();
  for (const f of photoLayer.places) used.set(f.properties.cls, (used.get(f.properties.cls) ?? 0) + 1);
  box.innerHTML = [...used.entries()].map(([cls, n]) => {
    const t = photoLayer.taxonomy[cls] ?? { zh: cls, color: "#d8b45a" };
    return `<button class="poi-chip" data-cls="${cls}"><span class="poi-dot" style="background:${t.color}"></span>${T(t.zh)} ${n}</button>`;
  }).join("");
  for (const el of box.querySelectorAll(".poi-chip")) {
    el.addEventListener("click", () => { el.classList.toggle("off"); photoLayer.setFilter(el.dataset.cls); });
  }
}
/** 記憶點卡片：大圖 + 照片時間軸 + 建築解讀 + 完整檔案 */
function openLightbox(p, idx = 0) {
  const photos = p.photos ?? [];
  const cur = photos[idx] ?? photos[0] ?? {};
  const clsZh = p.clsZh ?? photoLayer.taxonomy[p.cls]?.zh ?? p.cls;
  $("#lb-img").src = cur.file ?? p.cover;
  const strip = photos.length > 1 ? `
    <h4 style="margin:16px 0 7px;font-size:11.5px;letter-spacing:.12em;color:var(--gold)">${T("這棟建築的")}${photos.length}${T("張照片")}</h4>
    <div class="d-photos lb-strip">${photos.map((ph, i) => `<img src="${ph.thumb}" data-i="${i}" class="${i === idx ? "on" : ""}" title="${ph.taken ? new Date(ph.taken).toLocaleString("zh-TW") : ""}${ph.similarity ? " · 相似度 " + ph.similarity : ""}" />`).join("")}</div>` : "";
  $("#lb-info").innerHTML = `
    <div class="lb-id">${p.id}${p.needsReview ? ` <span class="place-warn">${T("待複核")}</span>` : ""}</div>
    <h3>${p.zh ?? T("未命名建築")}</h3>
    <div class="lb-cls">${T(clsZh)}${p.conf ? ` · 信心 ${Math.round(p.conf * 100)}%` : ""}${p.clsSource === "manual" ? T(" · 手動標註") : ""}</div>
    ${p.caption ? `<p>${p.caption}</p>` : `<p style="color:var(--ink-dim)">${T("尚未產生建築解讀")}</p>`}
    ${(p.tags ?? []).length ? `<div class="photo-tags">${p.tags.map((t) => `<span>${t}</span>`).join("")}</div>` : ""}
    ${strip}
    <dl>
      <dt>座標</dt><dd>${p.lon != null ? `${p.lon.toFixed(5)}, ${p.lat.toFixed(5)}` : ""}</dd>
      ${p.firstSeen ? `<dt>首次</dt><dd>${new Date(p.firstSeen).toLocaleString("zh-TW")}</dd>` : ""}
      ${p.lastSeen && p.lastSeen !== p.firstSeen ? `<dt>最近</dt><dd>${new Date(p.lastSeen).toLocaleString("zh-TW")}</dd>` : ""}
      ${cur.taken ? `<dt>本張</dt><dd>${new Date(cur.taken).toLocaleString("zh-TW")}${cur.similarity ? ` · 相似度 ${cur.similarity}` : ""}</dd>` : ""}
      ${cur.device ? `<dt>裝置</dt><dd>${cur.device}</dd>` : ""}
      ${p.nearZh ? `<dt>鄰近</dt><dd>${p.nearZh}</dd>` : ""}
      ${p.building ? `<dt>建築</dt><dd>${p.building}</dd>` : ""}
      ${p.style ? `<dt>風格</dt><dd>${p.style}</dd>` : ""}
      ${p.clsWhy ? `<dt>分類依據</dt><dd>${p.clsWhy}</dd>` : ""}
      ${cur.credit ? `<dt>來源</dt><dd>${cur.credit}</dd>` : ""}
    </dl>`;
  $("#lightbox").classList.add("on");
  $("#lightbox").setAttribute("aria-hidden", "false");
  for (const img of $("#lb-info").querySelectorAll(".lb-strip img")) {
    img.addEventListener("click", () => openLightbox(p, +img.dataset.i));
  }
}
$("#lb-close").addEventListener("click", () => { $("#lightbox").classList.remove("on"); $("#lightbox").setAttribute("aria-hidden", "true"); });
$("#lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox") $("#lb-close").click(); });
window.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#lightbox").classList.contains("on")) $("#lb-close").click(); });
$("#tg-photos").addEventListener("change", async (e) => {
  if (e.target.checked) await ensurePhotos();
  photoLayer.setVisible(e.target.checked);
});

// ---------------------------------------------------------------- 語音（朗讀與語音輸入）
const speaker = new Speaker({
  onError: (msg) => toast(T(msg)),
});
let autoSpeak = localStorage.getItem("macau.ai.speak") === "1";
const listener = new Listener({
  onPartial: (t) => { $("#ai-text").value = t; },
  onFinal: (t) => { $("#ai-text").value = t; sendAi(t, { fromVoice: true }); },
  onError: (msg) => { toast(T(msg)); $("#ai-mic")?.classList.remove("on"); },
  onStateChange: (on) => $("#ai-mic")?.classList.toggle("on", on),
});
async function toggleVoiceInput() {
  if (!listener.supported) { toast(T("此瀏覽器不支援語音識別，建議用 Chrome 或 Edge；仍可直接打字")); return; }
  if (speaker.speaking) speaker.stop();
  if (listener.active) { listener.stop(); return; }
  if (!$("#ai-panel").classList.contains("on")) $("#ai-fab").click();
  if (!ai.ready) { toast(T("請先設定 API Key 再使用語音對話")); return; }
  listener.start({ lang: "zh-TW" });
}
function updateSpeakBtn() { $("#ai-speak")?.classList.toggle("on", autoSpeak); $("#ai-speak")?.setAttribute("title", T(autoSpeak ? "自動朗讀：開" : "自動朗讀：關")); }
$("#ai-mic").addEventListener("click", toggleVoiceInput);
$("#ai-speak").addEventListener("click", () => {
  autoSpeak = !autoSpeak;
  localStorage.setItem("macau.ai.speak", autoSpeak ? "1" : "0");
  updateSpeakBtn();
  if (!autoSpeak) speaker.stop();
  toast(autoSpeak ? T("已開啟自動朗讀（會把回答唸出來）") : T("已關閉自動朗讀"));
});
updateSpeakBtn();

// ---------------------------------------------------------------- AI 導覽助理
const ai = new AiChat({
  getContext: () => ({
    attractions: attractions.map((a) => ({ id: a.id, zh: T(a.zh), cat: T(state.categories[a.cat]?.zh ?? a.cat), tag: a.tag ? T(a.tag) : null, brief: a.brief })),
    selected: state.selected ? { id: state.selected.id, zh: T(state.selected.zh) } : null,
    position: myLocation.position?.coords ?? null,
  }),
  onCommand: (cmd) => {
    const target = byId.get(cmd.id);
    if (!target) return;
    if (cmd.type === "route") { navStartFor(target); }
    else { select(target, { fly: true }); }
  },
  onError: (e) => {
    if (e.code === "nokey") { openAiSetup(true); toast(T("請先設定 DeepSeek API Key")); }
    else toast(T("AI 錯誤：") + e.message);
  },
});
const AI_CHIPS = [
  "大三巴有什麼必看？",
  "推薦一條世界遺產步行路線",
  "半日遊怎麼安排？",
  "附近有什麼美食？",
  "帶小朋友可以去哪？",
];
function renderAiChips() {
  $("#ai-chips").innerHTML = AI_CHIPS.map((c) => `<button class="ai-chip">${T(c)}</button>`).join("");
  for (const el of $("#ai-chips").querySelectorAll(".ai-chip")) {
    el.addEventListener("click", () => sendAi(el.textContent));
  }
}
function addAiMsg(role, text) {
  const el = document.createElement("div");
  el.className = `ai-msg ${role}`;
  el.innerHTML = renderAiText(text);
  $("#ai-msgs").appendChild(el);
  $("#ai-msgs").scrollTop = $("#ai-msgs").scrollHeight;
  return el;
}
// 極簡 Markdown：粗體、換行、條列
function renderAiText(text) {
  const esc = String(text).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
  return esc
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/^- (.+)$/gm, "・$1")
    .replace(/\n/g, "<br>");
}
function openAiSetup(on) {
  $("#ai-setup").classList.toggle("on", on);
  if (on) {
    $("#ai-key").value = "";
    $("#ai-key").placeholder = ai.ready && ai.source === "user" ? "（已儲存，留空即沿用）" : "sk-...";
    $("#ai-model").value = ai.model;
    if ($("#ai-think")) $("#ai-think").checked = ai.thinking;
    $("#ai-key").focus();
  }
}
async function sendAi(text, { fromVoice = false } = {}) {
  const t = (text ?? $("#ai-text").value).trim();
  if (!t) return;
  if (speaker.speaking) speaker.stop();
  if (!ai.ready) { openAiSetup(true); toast(T("請先設定 DeepSeek API Key")); return; }
  $("#ai-text").value = "";
  $("#ai-text").style.height = "auto";
  addAiMsg("user", t);
  const bubble = addAiMsg("ai", "");
  bubble.classList.add("typing");
  $("#ai-send").disabled = true;
  const res = await ai.send(t, ({ content, reasoning }) => {
    bubble.innerHTML =
      (reasoning ? `<div class="ai-think-box"><b>思考過程</b>${renderAiText(reasoning)}</div>` : "") +
      `<div class="ai-answer">${renderAiText(content)}</div>`;
    $("#ai-msgs").scrollTop = $("#ai-msgs").scrollHeight;
  });
  bubble.classList.remove("typing");
  $("#ai-send").disabled = false;
  if (!res) {
    bubble.classList.remove("typing");
    bubble.innerHTML = `<div class="ai-answer">${renderAiText(T("（沒有回覆）請在設定中確認 API Key 與模型名稱是否正確。"))}</div>`;
    return;
  }
  if (res.reasoning && !res.text) {
    bubble.innerHTML = `<div class="ai-think-box"><b>思考過程（未產生最終回答）</b>${renderAiText(res.reasoning)}</div>`;
  }
  // 自動朗讀
  const spoken = res.text || res.reasoning || "";
  if (autoSpeak && spoken) speaker.speak(spoken);
  if (res.commands.length) {
    const cmd = res.commands[0];
    const target = byId.get(cmd.id);
    if (target) bubble.insertAdjacentHTML("beforeend", `<br><span class="ai-cmd">${cmd.type === "route" ? T("🧭 已為你規劃路線：") : T("📍 已在地圖上標出：")}${T(target.zh)}</span>`);
  }
}
$("#ai-fab").addEventListener("click", async () => {
  const on = !$("#ai-panel").classList.contains("on");
  $("#ai-panel").classList.toggle("on", on);
  $("#ai-panel").setAttribute("aria-hidden", String(!on));
  if (on) {
    if (!ai.ready) await ai.init();
    if (ai.ready) {
      const models = await ai.listModels();
      const sel = $("#ai-model");
      if (sel && models.length) {
        sel.innerHTML = models.map((id) => `<option value="${id}">${id}</option>`).join("");
        sel.value = ai.model;
      }
    }
    $("#ai-sub").textContent = ai.ready
      ? `DeepSeek · ${ai.model}${ai.thinking ? "（深度思考）" : ""}${ai.source === "local" ? " · 本機金鑰" : ""}`
      : T("尚未設定 API Key");
    if (!ai.ready) openAiSetup(true);
    else if (!$("#ai-msgs").children.length) addAiMsg("ai", T("你好！我是澳門導覽助理 🧭\n可以問我景點介紹、步行路線、美食或行程安排；如果我推薦某個景點，還會直接在地圖上標出來。"));
    $("#ai-text").focus();
  }
});
$("#ai-close").addEventListener("click", () => { $("#ai-panel").classList.remove("on"); $("#ai-panel").setAttribute("aria-hidden", "true"); });
$("#ai-settings").addEventListener("click", () => openAiSetup(true));
$("#ai-save").addEventListener("click", async () => {
  const k = $("#ai-key").value.trim();
  if (!k && !ai.ready) { toast(T("請輸入 API Key")); return; }
  if (k) ai.setKey(k, { remember: true });   // 留空＝沿用已儲存的金鑰
  ai.setModel($("#ai-model").value);
  ai.setThinking($("#ai-think")?.checked ?? false);
  openAiSetup(false);
  if (ai.ready) await ai.listModels();       // 重新取得此帳號可用的模型
  const sel = $("#ai-model");
  if (sel && ai.availableModels?.length) {
    sel.innerHTML = ai.availableModels.map((id) => `<option value="${id}">${id}</option>`).join("");
    sel.value = ai.model;
  }
  $("#ai-sub").textContent = `DeepSeek · ${ai.model}${ai.thinking ? "（深度思考）" : ""}${ai.source === "local" ? " · 本機金鑰" : ""}`;
  toast(k ? T("已儲存設定（金鑰只存在此瀏覽器）") : T("已更新模型設定"));
});
$("#ai-send").addEventListener("click", () => sendAi());
$("#ai-text").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAi(); }
});
$("#ai-text").addEventListener("input", (e) => {
  e.target.style.height = "auto";
  e.target.style.height = Math.min(108, e.target.scrollHeight) + "px";
});
renderAiChips();

// ---------------------------------------------------------------- 導航
const nav = new NavigationController(map, {
  onStatus: (msg) => { if (msg) toast(T(msg)); },
  onState: (s) => renderNav(s),
});
function navStartFor(a) {
  const from = myLocation.position?.coords ?? [map.getCenter().lng, map.getCenter().lat];
  if (!myLocation.position) toast(T("未開啟定位，將以目前地圖中心作為起點"));
  nav.start({ name: T(a.zh), coords: a.coords }, from).then((r) => {
    if (r) $("#detail").classList.remove("open");
  });
}
function renderNav(s) {
  const bar = $("#navbar");
  if (!s.active) { bar.classList.remove("on"); bar.setAttribute("aria-hidden", "true"); return; }
  bar.classList.add("on");
  bar.setAttribute("aria-hidden", "false");
  const r = s.route;
  const mins = Math.max(1, Math.round(r.timeS / 60));
  $("#nav-dest").textContent = `${T("前往")} ${s.destination.name}`;
  $("#nav-eta").innerHTML = s.phase === "searching"
    ? `<span style="color:var(--accent)">${T("正在搜尋最快道路…")}</span>`
    : `${formatDistance(r.distM)} · ${s.mode === "walk" ? T("步行") : T("開車")} ${T("約")} ${mins} ${T("分鐘")} · ${T("即時路況不計")}`;
  for (const el of $("#nav-modes").querySelectorAll(".nav-mode")) el.classList.toggle("on", el.dataset.mode === s.mode);
  if (s.phase !== "searching") {
    const ico = { left: "↰", right: "↱", straight: "↑", start: "◎" };
    $("#nav-steps").innerHTML = r.steps.map((st, i) => `<div class="nav-step ${i === 0 ? "hi" : ""}">
      <span class="st-ico">${ico[st.turn] ?? "↑"}</span>
      <span class="st-name">${st.name}</span>
      <span class="st-len">${formatDistance(st.len)}</span></div>`).join("");
  }
}
$("#nav-stop").addEventListener("click", () => { nav.stop(); toast(T("已結束導航")); });
$("#nav-steps-btn").addEventListener("click", () => $("#nav-steps").classList.toggle("on"));
for (const el of $("#nav-modes").querySelectorAll(".nav-mode")) {
  el.addEventListener("click", () => {
    if (!nav.destination) return;
    nav.mode = el.dataset.mode;
    nav.start(nav.destination, nav.startCoord, el.dataset.mode);
  });
}

// ---------------------------------------------------------------- 個人定位
const myLocation = new MyLocation(map, {
  onStateChange: (active, following) => {
    const btn = $("#btn-locate");
    btn?.classList.toggle("on", active);
    btn?.classList.toggle("following", !!following);
    btn?.setAttribute("title", T(!active ? "我的位置（點一下開始定位）" : following ? "跟隨中（點一下停止定位）" : "定位中（點一下進入跟隨模式）"));
    $("#hud-gps-row").style.display = active ? "" : "none";
  },
  onUpdate: (pos, { first }) => {
    const acc = Math.round(pos.accuracy);
    $("#hud-gps").textContent = `±${acc} m`;
    if (first) {
      const dist = distanceMeters(pos.coords, HOME.center);
      if (dist > 30000) {
        toast(T(`已取得你的位置，但距離澳門約 ${Math.round(dist / 1000)} 公里（展示仍以澳門為主）`));
      } else {
        map.flyTo({ center: pos.coords, zoom: 16, pitch: 55, duration: 1600, essential: true });
        toast(T("已定位到你的位置"));
      }
    }
    if (state.selected) openDetail(state.selected);
    if (state.nearMode) renderList();
  },
  onError: (e) => { toast(T(e.message)); },
});
// 三段式：未定位 → 定位中 → 跟隨中 → 停止
$("#btn-locate").addEventListener("click", () => {
  if (!myLocation.active) { myLocation.start(); return; }
  if (!myLocation.follow) { myLocation.setFollow(true); toast(T("跟隨模式：地圖會跟著你移動（再點一下停止定位）")); return; }
  myLocation.setFollow(false);
  myLocation.stop();
  toast(T("已停止定位"));
});
map.on("click", () => { if (myLocation.follow) myLocation.setFollow(false); });
$("#btn-lang").addEventListener("click", async () => {
  const next = getLang() === "zh-Hant" ? "zh-Hans" : "zh-Hant";
  await setLang(next);
  $("#btn-lang").textContent = next === "zh-Hant" ? "繁" : "简";
  refreshStaticText();
  renderChips(); renderList(); renderSidebarFoot(); renderCredits();
  if (state.selected) openDetail(state.selected);
  markerLayer.setData(attractions);
  markerLayer.setActive(state.selected?.id ?? null);
  toast(next === "zh-Hant" ? "已切換為繁體中文" : "已切换为简体中文");
});

$("#search").addEventListener("input", (e) => { state.query = e.target.value; renderList(); });

// ---------------------------------------------------------------- 位置校正模式
let editMode = false;
function updateEditBar() {
  const n = Object.keys(coordFixes).length;
  $("#editbar-count").textContent = T(`已修正 ${n} 處`);
  $("#editbar").classList.toggle("on", editMode);
  if (editMode) $("#btn-edit-mode")?.classList.add("on");
  else $("#btn-edit-mode")?.classList.remove("on");
}
function setEditMode(on) {
  editMode = on;
  markerLayer.setEditable(on);
  updateEditBar();
  toast(on ? T("校正模式：拖曳標記到正確位置") : T("已結束校正模式"));
}
$("#btn-edit-mode").addEventListener("click", () => {
  setEditMode(!editMode);
  if (editMode && !$("#sidebar").classList.contains("open")) $("#sidebar").classList.add("open");
});
$("#btn-exit-edit").addEventListener("click", () => setEditMode(false));
$("#btn-clear-fixes").addEventListener("click", () => {
  coordFixes = {};
  localStorage.removeItem(FIX_KEY);
  markerLayer.refreshPositions();
  updateEditBar();
  renderList();
  toast(T("已清除全部手動修正"));
});
$("#btn-export-fixes").addEventListener("click", async () => {
  const payload = {
    note: "澳門立體誌 · 手動位置校正",
    generated: new Date().toISOString(),
    fixes: Object.fromEntries(Object.entries(coordFixes).map(([id, coords]) => [id, { coords, zh: byId.get(id)?.zh ?? null }])),
  };
  const text = JSON.stringify(payload, null, 2);
  try { await navigator.clipboard.writeText(text); } catch { /* 忽略 */ }
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "macau-coord-fixes.json";
  a.click();
  URL.revokeObjectURL(a.href);
  toast(T(`已匯出 ${Object.keys(coordFixes).length} 筆校正座標（並複製到剪貼簿）`));
});
$("#credits-toggle").addEventListener("click", () => $(".credits").classList.toggle("open"));

// 側欄預設展開（桌機）
if (window.innerWidth > 1180) $("#sidebar").classList.add("open");

// ---------------------------------------------------------------- 地名標籤 / 周邊設施
let labelLayer = null;
let poiLayer = null;
async function setupLabelsAndPois() {
  labelLayer = new LabelLayer(map, {
    onClick: (p, coords) => {
      map.flyTo({ center: coords, zoom: Math.max(map.getZoom(), p.k === "region" ? 12.5 : 15.2), duration: 1200 });
    },
  });
  try {
    const labels = await fetch("data/macau-labels.geojson").then((r) => r.json());
    labelLayer.setData(labels.features ?? []);
  } catch (e) { console.warn("labels:", e); }

  poiLayer = new PoiLayer(map, {});
  // 周邊設施：預設開啟，但延後載入以免拖慢首次顯示
  setTimeout(() => poiLayer.setVisible(true).catch((e) => console.warn("poi:", e)), 1600);
  renderPoiChips();
}

function renderPoiChips() {
  const box = $("#poi-chips");
  if (!box) return;
  box.innerHTML = POI_GROUPS.filter((g) => g.id !== "other")
    .map((g) => `<button class="poi-chip" data-g="${g.id}"><span class="poi-dot" style="background:${g.color}"></span>${T(g.zh)}</button>`)
    .join("");
  for (const el of box.querySelectorAll(".poi-chip")) {
    if (POI_DEFAULT_OFF.has(el.dataset.g)) el.classList.add("off");
    el.addEventListener("click", () => {
      const id = el.dataset.g;
      const on = !el.classList.contains("off");
      el.classList.toggle("off", on);
      if (on) el.classList.remove("on"); else el.classList.add("on");
      poiLayer?.setGroup(id, !on);
      poiLayer?.setVisible(true);
      const vis = [...box.querySelectorAll(".poi-chip")].some((x) => !x.classList.contains("off"));
      if (!vis) $("#tg-pois").checked = false;
      else $("#tg-pois").checked = true;
      poiLayer?.setVisible(vis);
    });
    el.classList.add("on");
  }
}

// ---------------------------------------------------------------- 網址狀態（可分享深連結）
let hashLock = false;
function writeHash() {
  if (hashLock) return;
  const c = map.getCenter();
  const z = map.getZoom().toFixed(2);
  const sel = state.selected?.id ? `/spot/${state.selected.id}` : "";
  const next = `#${z}/${c.lat.toFixed(5)}/${c.lng.toFixed(5)}${sel}`;
  if (location.hash !== next) history.replaceState(null, "", next);
}
function readHash() {
  const h = location.hash.replace(/^#/, "");
  if (!h) return null;
  const [nav, spot] = h.split("/spot/");
  const [z, lat, lng] = nav.split("/").map(Number);
  return { z: isFinite(z) ? z : null, lat: isFinite(lat) ? lat : null, lng: isFinite(lng) ? lng : null, spot: spot || null };
}
function applyHash() {
  const s = readHash();
  if (!s) return false;
  hashLock = true;
  if (s.lat != null && s.lng != null) {
    map.jumpTo({ center: [s.lng, s.lat], zoom: s.z ?? HOME.zoom, pitch: HOME.pitch, bearing: HOME.bearing });
  }
  if (s.spot) {
    const a = byId.get(s.spot);
    if (a) setTimeout(() => select(a, { fly: false }), 600);
  }
  setTimeout(() => { hashLock = false; }, 1400);
  return true;
}

// ---------------------------------------------------------------- 說明
function showHelp() {
  state.selected = null;
  markerLayer.setActive(null);
  const c = state.data.osmStats?.counts ?? {};
  const e = state.data.elevation?.stats ?? {};
  $("#detail-body").innerHTML = `
    <div class="d-hero">${iconSvg("model", 46)}</div>
    <div class="d-cat">${T("操作說明 · 關於本圖")}</div>
    <h2 class="d-title">${T("澳門立體誌")}</h2>
    <div class="d-sub">${T("以開放資料建構的 3D 立體澳門地圖")}</div>
    <div class="d-detail">
      <p>${T("· AI 對話框中：按 🎤 用說的問問題（語音識別），按 🔊 開啟自動朗讀（語音合成），回答會逐句唸出。")}</p>
      <p>${T("· 快捷鍵：L 開關圖層面板、S 開關景點清單、F 全螢幕、Esc 關閉面板。地圖可自由平移，離開澳門範圍時左下會出現「回到澳門」。")}</p>
      <p>${T("· 拖曳可平移地圖，右鍵拖曳（或兩指）可旋轉與傾斜視角，滾輪縮放。")}</p>
      <p>${T("· 點擊地圖上的金色標記，可查看該景點的介紹與三維模型。標記右上角有「3D」者代表設有文物模型。")}</p>
      <p>${T("· 博物館類景點（保利美高梅博物館、澳門博物館）在介紹下方列出館藏文物，點擊卡片即可開啟三維檢視器，以滑鼠或手指旋轉、縮放文物。")}</p>
      <p>${T("· 右上角可切換三維建築、地勢起伏、等高線、道路與底圖，並調整地形起伏倍率。")}</p>
      <p>${T("· 按右上角的全螢幕圖示（或鍵盤 F 鍵）可切換全站全螢幕，按 Esc 或再按一次 F 返回。")}</p>
      <p>${T("· 右上角定位圖示可開啟個人定位（需在瀏覽器允許位置權限）：藍點代表你的位置、外圈是 GPS 精度範圍；再點一次進入「跟隨模式」，地圖會跟著你移動；雙擊圖示可停止定位。")}</p>
      <p>${T("· 側欄的「📍 附近」可依距離排序景點；景點詳情會顯示「距離你 X 公尺（方位）」。")}</p>
      <p>${T("· 有「3D 模型」標籤的景點（澳門旅遊塔、科學館、巴黎人、倫敦人、銀河、兩間博物館）點進去即可開啟三維檢視器：左邊是模型，右邊是介紹文字。")}</p>
    </div>
    <div class="d-museum-note">
      ${T("本圖資料：OpenStreetMap 建築物 " + (c.buildings ?? 0).toLocaleString() + " 棟、道路 " + (c.roads ?? 0).toLocaleString() + " 條、景點 " + (state.data.attractions?.length ?? 0) + " 處；")}
      ${T("海拔資料 Copernicus DEM GLO-30（30 公尺網格），澳門陸域最高點約 " + (e.maxMeters ?? "—") + " 公尺。")}
    </div>`;
  $("#detail").classList.add("open");
  $("#detail").setAttribute("aria-hidden", "false");
}

// ---------------------------------------------------------------- 版權
function renderCredits() {
  $("#credits-body").innerHTML = `
    <div><b>${T("地圖與建築資料")}</b>：© OpenStreetMap contributors（ODbL 1.0），經 Overpass API 取得</div>
    <div><b>${T("海拔資料")}</b>：Copernicus DEM GLO-30 © DLR e.V. 2010-2014 / © Airbus Defence and Space GmbH 2014-2018，經 OpenTopography 提供</div>
    <div><b>${T("地形圖磚")}</b>：Terrain Tiles（AWS Open Data / Mapzen，terrarium 編碼）</div>
    <div><b>${T("文物三維模型")}</b>：${T("由使用者提供之高精度掃描檔，經簡化與壓縮處理，僅供學習與研究使用")}</div>
    <div style="margin-top:6px;color:#6f7c89">${T("本圖以 MapLibre GL JS、three.js 建構；資料下載與模型處理流程見專案說明文件。")}</div>`;
}

// ---------------------------------------------------------------- HUD
let lastMove = 0;
map.on("mousemove", (e) => {
  const now = performance.now();
  if (now - lastMove < 90) return;
  lastMove = now;
  const { lng, lat } = e.lngLat;
  $("#hud-coord").textContent = `${lat.toFixed(5)}°N, ${lng.toFixed(5)}°E`;
  let elev = null;
  try { elev = map.queryTerrainElevation(e.lngLat); } catch { /* ignore */ }
  const exagger = +$("#rg-exagg").value;
  $("#hud-elev").textContent = elev == null ? "—" : `${(elev / (map.getTerrain() ? exagger : 1)).toFixed(1)} m`;
  const mPerPx = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, map.getZoom());
  const m = mPerPx * 100;
  $("#hud-scale").textContent = m > 1000 ? `${(m / 1000).toFixed(2)} km / 100px` : `${m.toFixed(0)} m / 100px`;
});
map.on("zoom", () => markerLayer.refreshLabels());
map.on("moveend", () => { writeHash(); markerLayer.refreshLabels(); });

// 靜態文字（含 data-t 屬性者）隨語言切換更新
function refreshStaticText() {
  for (const el of document.querySelectorAll("[data-t]")) el.textContent = T(el.dataset.t);
}
refreshStaticText();

// ---------------------------------------------------------------- 小工具
let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("on"), 3200);
}
function boot(text, pct) {
  const s = $("#boot-status"), b = $(".boot-bar i");
  if (s) s.textContent = text;
  if (b) b.style.width = `${pct}%`;
}
}
