// 澳門記憶 · 建築普查：手動定位用的小地圖（MapLibre）
//
// 為什麼需要它：普查時最常見的情況是「筆電沒有 GPS 晶片」——座標可能偏掉幾十公尺，
// 甚至定到隔壁街區。這時候唯一可靠的補救就是讓人在圖上把點拖到正確位置。
// 這一張圖同時負責三件事：
//   ① 顯示座標點的位置（可點選、可拖曳）
//   ② 畫出 ±accuracy 公尺的精度圈（一眼看出這個座標有多可信）
//   ③ 讓使用者自己指定座標（geo_source = 'manual'）
//
// 這張圖是「示意圖」而不是街道圖：本頁不載入任何線上圖磚（全站都走離線資料），
// 只畫行政邊界 ＋ 61 個已記錄景點當定位參考，因此離線也能用、也不會有圖磚授權問題。
// 需要更精確時，UI 另外提供直接輸入經緯度的欄位。
//
// 載入策略：maplibre-gl 用**動態 import**，只有使用者真的打開「手動定位」才載入
// （recognize 頁的主流程不需要地圖，不該為它多付 800 KB 與一個 WebGL context）。
// 動態載入失敗時不影響建檔：onError 會讓上層顯示「改用輸入經緯度」的說明。

import "maplibre-gl/dist/maplibre-gl.css";
import { circlePolygon, haversineM } from "./geo-math.js";

const BASE = new URL("./", document.baseURI).href;
const MACAU_CENTER = [113.5515, 22.1862];

const EMPTY_FC = { type: "FeatureCollection", features: [] };

export class SurveyMiniMap {
  /**
   * @param {object} o
   * @param {HTMLElement} o.container
   * @param {(lat:number,lng:number,origin:string)=>void} [o.onPick]
   * @param {(msg:string)=>void} [o.onError]
   */
  constructor({ container, onPick = () => {}, onError = () => {}, onBuildingStatus = null }) {
    this.container = container;
    this.onPick = onPick;
    this.onError = onError;
    this.onBuildingStatus = onBuildingStatus;
    this.map = null;
    this.maplibregl = null;
    this.marker = null;
    this.point = null;          // {lat,lng,accuracyM}
    this.ready = false;
    this.starting = false;
    this.failed = null;
    this.labels = [];
    this.attractions = null;
    this.streetPool = null;
    this.buildingsState = "idle";
  }

  /** 只有真的需要時才建立（第一次打開「手動定位」或第一次有座標要顯示） */
  async start() {
    if (this.ready || this.starting) return this.ready;
    this.starting = true;
    try {
      const mod = await import("maplibre-gl");
      const maplibregl = mod.default ?? mod;
      // 與主站相同的做法：明確指定 worker 位址（.js 版本，避免 .mjs 的 MIME 問題）
      try { maplibregl.setWorkerUrl(new URL("assets/maplibre-gl-worker.js", document.baseURI).href); } catch { /* 舊版沒這個 API */ }

      const attractions = await this.loadAttractions();
      this.attractions = attractions;
      const map = new maplibregl.Map({
        container: this.container,
        style: this.buildStyle(attractions),
        center: this.point ? [this.point.lng, this.point.lat] : MACAU_CENTER,
        zoom: this.point ? 16.5 : 13.4,
        maxZoom: 19,
        minZoom: 11,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
      });
      map.touchZoomRotate?.disableRotation?.();
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      // 比例尺：精度圈是「公尺」，有比例尺才能一眼判斷 ±45 公尺大概多大
      map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: "metric" }), "bottom-left");
      this.maplibregl = maplibregl;
      this.map = map;

      map.on("click", (e) => {
        if (e.originalEvent?.defaultPrevented) return;
        this.setPoint({ lat: e.lngLat.lat, lng: e.lngLat.lng, accuracyM: null });
        this.onPick(e.lngLat.lat, e.lngLat.lng, "map-click");
      });

      await new Promise((resolve) => {
        if (map.loaded()) return resolve();
        map.once("load", resolve);
        setTimeout(resolve, 8000);          // 圖磚／字型都沒有，理論上很快；保險起見給個上限
      });

      // 精度圈與中心點：用 GeoJSON 圖層（跟著縮放自動縮放，不需要重算像素半徑）
      map.addSource("acc", { type: "geojson", data: EMPTY_FC });
      map.addLayer({ id: "acc-fill", type: "fill", source: "acc", paint: { "fill-color": "#6fb2d2", "fill-opacity": 0.18 } });
      map.addLayer({ id: "acc-line", type: "line", source: "acc", paint: { "line-color": "#6fb2d2", "line-width": 1.4, "line-dasharray": [3, 2] } });
      map.addSource("pt", { type: "geojson", data: EMPTY_FC });
      map.addLayer({ id: "pt-dot", type: "circle", source: "pt", paint: { "circle-radius": 4.5, "circle-color": "#d8b45a", "circle-stroke-color": "#0b1117", "circle-stroke-width": 1.6 } });

      const el = document.createElement("div");
      el.className = "rc-mmap-pin";
      el.innerHTML = `<span></span>`;
      el.title = "拖曳我到建築的位置";
      this.marker = new maplibregl.Marker({ element: el, draggable: true, anchor: "center" })
        .setLngLat(this.point ? [this.point.lng, this.point.lat] : MACAU_CENTER);
      this.marker.on("dragend", () => {
        const ll = this.marker.getLngLat();
        this.setPoint({ lat: ll.lat, lng: ll.lng, accuracyM: null });
        this.onPick(ll.lat, ll.lng, "marker-drag");
      });

      // 行政區名（DOM 標記：本頁沒有字型伺服器，MapLibre 的文字圖層不能用中文）
      this.addRegionLabels(maplibregl, map);
      this.loadStreets(maplibregl);

      this.ready = true;
      this.renderPoint();
      // 地圖容器尺寸在隱藏時是 0，顯示後要重新量一次，否則會出現空白畫布
      setTimeout(() => { try { map.resize(); } catch { /* ignore */ } }, 60);
      return true;
    } catch (e) {
      this.failed = e?.message ?? String(e);
      this.onError(`手動定位地圖載入失敗：${this.failed}（仍可直接輸入經緯度，或用「取得定位」）`);
      return false;
    } finally {
      this.starting = false;
    }
  }

  buildStyle(attractions) {
    const sources = {
      boundary: { type: "geojson", data: `${BASE}data/macau-boundary.geojson` },
      facts: { type: "geojson", data: attractions },
    };
    return {
      version: 8,
      sources,
      layers: [
        { id: "bg", type: "background", paint: { "background-color": "#101922" } },
        { id: "boundary", type: "fill", source: "boundary", paint: { "fill-color": "#2f3d47", "fill-opacity": 0.95 } },
        { id: "boundary-line", type: "line", source: "boundary", paint: { "line-color": "#d8b45a", "line-width": 1, "line-opacity": 0.55, "line-dasharray": [3, 1.6] } },
        { id: "facts", type: "circle", source: "facts", paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 2.5, 17, 4.5],
          "circle-color": "#6fb2d2", "circle-opacity": 0.85,
          "circle-stroke-color": "#0b1117", "circle-stroke-width": 0.9,
        } },
      ],
    };
  }

  /**
   * 建築輪廓：**選用**圖層（7.8 MB）。
   * 手動定位最需要的就是「哪一棟」——只畫精度圈卻看不到建築，使用者無法對位。
   * 但這個檔案不小，所以做成勾選後才載入，並把載入狀態寫在 UI 上（不讓使用者空等）。
   */
  async loadBuildings() {
    if (this.buildingsState === "loading" || this.buildingsState === "ready") return this.buildingsState;
    this.buildingsState = "loading";
    this.onBuildingStatus?.("正在載入建築輪廓（約 7.8 MB，只有第一次需要）…", "loading");
    try {
      const res = await fetch(`${BASE}data/macau-buildings.geojson`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const fc = await res.json();
      const map = this.map;
      if (!map) throw new Error("地圖尚未就緒");
      map.addSource("footprints", { type: "geojson", data: fc });
      // 放在景點點位下面、邊界上面：建築是底圖，不該蓋住精度圈與標記
      map.addLayer({ id: "fp-fill", type: "fill", source: "footprints", paint: { "fill-color": "#7f8d99", "fill-opacity": 0.55 } }, map.getLayer("facts") ? "facts" : undefined);
      map.addLayer({ id: "fp-line", type: "line", source: "footprints", minzoom: 15, paint: { "line-color": "#0b1117", "line-width": 0.5, "line-opacity": 0.7 } }, map.getLayer("facts") ? "facts" : undefined);
      this.buildingsState = "ready";
      this.onBuildingStatus?.(`已載入 ${fc.features?.length ?? 0} 棟建築輪廓——可以對照實際建築拖曳標記了`, "ready");
      return "ready";
    } catch (e) {
      this.buildingsState = "failed";
      this.onBuildingStatus?.(`建築輪廓載入失敗：${e?.message ?? e}（仍可用景點與行政區名判斷位置）`, "failed");
      return "failed";
    }
  }

  /**
   * 名稱標籤（街道名＋最近的景點名）。
   *
   * 為什麼用「離中心最近」而不是「視野內」：全澳門的街道標記點只有 171 個（每條街一個代表點），
   * 放到 16 級以上時視野只有兩三百公尺，常常一個標記點都不在視野內（實測 inView=0），
   * 圖上就只剩幾個藍點，使用者根本無法判斷自己在哪。改成取「離中心最近的 25 條街 + 6 個景點」，
   * 超出視野的標籤會被容器裁掉，不影響畫面。
   */
  async loadStreets(maplibregl) {
    try {
      const res = await fetch(`${BASE}data/macau-labels.geojson`);
      if (!res.ok) return;
      const fc = await res.json();
      this.streetPool = fc.features
        .filter((f) => f.properties?.k === "street")
        .map((f) => {
          const el = document.createElement("div");
          el.className = "rc-mmap-label k-street";
          el.textContent = f.properties.t;
          return { el, coord: f.geometry.coordinates, marker: null };
        });
      this.landmarkPool = (this.attractions?.features ?? []).map((f) => {
        const el = document.createElement("div");
        el.className = "rc-mmap-label k-landmark";
        el.textContent = f.properties.zh;
        return { el, coord: f.geometry.coordinates, marker: null };
      });
      this.maplibregl = maplibregl;
      const sync = () => this.syncNameLabels(maplibregl);
      sync();
      this.map.on("moveend", sync);
    } catch { /* 名稱標籤只是輔助，失敗不影響定位 */ }
  }

  syncNameLabels(maplibregl) {
    if (!this.map) return;
    const c = this.map.getCenter();
    const near = (pool, n, minZoom) => {
      if (!pool) return;
      const show = this.map.getZoom() >= minZoom;
      const sorted = [...pool].sort((a, b) => haversineM(c.lat, c.lng, a.coord[1], a.coord[0]) - haversineM(c.lat, c.lng, b.coord[1], b.coord[0]));
      sorted.forEach((s, i) => {
        const want = show && i < n;
        if (want && !s.marker) s.marker = new maplibregl.Marker({ element: s.el, anchor: "center" }).setLngLat(s.coord).addTo(this.map);
        else if (!want && s.marker) { s.marker.remove(); s.marker = null; }
      });
    };
    near(this.streetPool, 25, 14.2);
    near(this.landmarkPool, 4, 0);   // 4 個就好：再多會互相重疊（實測 6 個時標籤會疊在一起）
  }

  async loadAttractions() {
    try {
      const res = await fetch(`${BASE}data/attractions.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
      const list = raw.attractions ?? [];
      return {
        type: "FeatureCollection",
        features: list
          .filter((a) => Array.isArray(a.coords) && a.coords.length === 2)
          .map((a) => ({ type: "Feature", properties: { id: a.id, zh: a.zh }, geometry: { type: "Point", coordinates: a.coords } })),
      };
    } catch (e) {
      this.onError(`讀取地標資料失敗（${e?.message ?? e}）：地圖上不會有地標點，仍可拖曳標記`);
      return EMPTY_FC;
    }
  }

  /** 行政區／區域名（8 個區 + 澳門半島、氹仔、路氹城、路環…） */
  addRegionLabels(maplibregl, map) {
    fetch(`${BASE}data/macau-labels.geojson`)
      .then((r) => (r.ok ? r.json() : null))
      .then((fc) => {
        if (!fc || !this.map) return;
        for (const f of fc.features) {
          const k = f.properties?.k;
          if (k !== "region" && k !== "district") continue;
          const el = document.createElement("div");
          el.className = `rc-mmap-label k-${k}`;
          el.textContent = f.properties.t;
          const [lng, lat] = f.geometry.coordinates;
          const m = new maplibregl.Marker({ element: el, anchor: "center" });
          m.setLngLat([lng, lat]).addTo(map);
          this.labels.push({ marker: m, z: f.properties.z ?? 12, el });
        }
        this.syncLabelVisibility();
        map.on("zoom", () => this.syncLabelVisibility());
      })
      .catch(() => { /* 標籤只是輔助，失敗不影響定位 */ });
  }

  /** 區域名只在對應縮放層級以上顯示（跟主站 labels.js 的規則一致） */
  syncLabelVisibility() {
    if (!this.map) return;
    const z = this.map.getZoom();
    for (const l of this.labels) l.el.style.display = z >= l.z - 0.6 ? "" : "none";
  }

  /** 更新點與精度圈（accuracyM 為 null＝只畫點、不畫圈） */
  setPoint({ lat, lng, accuracyM = null }) {
    this.point = { lat, lng, accuracyM };
    this.renderPoint();
  }

  renderPoint() {
    if (!this.ready || !this.map) return;
    const p = this.point;
    const src = this.map.getSource("pt");
    const acc = this.map.getSource("acc");
    if (src) {
      const fc = p ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [p.lng, p.lat] } }] } : EMPTY_FC;
      src.setData(fc);
      this._pt = { has: fc.features.length > 0, lat: p?.lat ?? null, lng: p?.lng ?? null };
    }
    if (acc) {
      const r = Number(p?.accuracyM);
      const draw = p && Number.isFinite(r) && r > 0;
      const fc = draw
        ? { type: "FeatureCollection", features: [{ type: "Feature", properties: { r }, geometry: { type: "Polygon", coordinates: [circlePolygon(p.lat, p.lng, r)] } }] }
        : EMPTY_FC;
      acc.setData(fc);
      this._acc = { has: draw, radiusM: draw ? r : null, ringPoints: draw ? fc.features[0].geometry.coordinates[0].length : 0 };
    }
    if (this.marker) {
      const el = this.marker.getElement();
      if (!p) { el.style.display = "none"; }
      else {
        el.style.display = "";
        const prev = this.marker.getLngLat();
        const moved = Math.abs(prev.lng - p.lng) > 1e-7 || Math.abs(prev.lat - p.lat) > 1e-7;
        this.marker.setLngLat([p.lng, p.lat]);
        if (!el.isConnected) this.marker.addTo(this.map);
        // 座標真的變了才把視角移過去；只是重畫（例如精度圈更新）不要動視角
        if (moved && typeof this.map.jumpTo === "function") {
          this.map.jumpTo({ center: [p.lng, p.lat], zoom: Math.max(this.map.getZoom?.() ?? 16, 16) });
        }
      }
    }
  }

  /** 讓地圖重新量測容器大小（面板從隱藏變顯示時一定要呼叫） */
  resize() {
    if (this.ready && this.map) setTimeout(() => { try { this.map.resize(); } catch { /* ignore */ } }, 60);
  }

  /** 測試／診斷用：一眼看出這張圖現在的狀態（精度圈有沒有畫、標記在哪） */
  debug() {
    const center = this.map?.getCenter?.();
    return {
      ready: this.ready,
      failed: this.failed,
      point: this.point,
      accuracyCircle: this._acc ?? { has: false },
      pointLayer: this._pt ?? { has: false },
      marker: this.marker ? { lat: this.marker.getLngLat().lat, lng: this.marker.getLngLat().lng } : null,
      center: center ? { lat: center.lat, lng: center.lng } : null,
      zoom: this.map?.getZoom?.() ?? null,
      regionLabels: this.labels.length,
      streetLabels: this.streetPool ? this.streetPool.filter((s) => s.marker).length : 0,
      landmarkLabels: this.landmarkPool ? this.landmarkPool.filter((s) => s.marker).length : 0,
      footprints: this.buildingsState,
      canvas: !!this.container?.querySelector("canvas"),
    };
  }

  destroy() {
    try { this.map?.remove(); } catch { /* ignore */ }
    this.map = null;
    this.marker = null;
    this.ready = false;
  }
}
