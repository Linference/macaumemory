// 導航：路線顯示 + 「搜尋最快道路」動畫 + 車流動畫
import { Popup } from "maplibre-gl";

const COLOR = { route: "#ffd166", glow: "#ffb020", scan: "#6fd7ff", start: "#3d8bfd", end: "#7ee787" };

export class NavigationController {
  constructor(map, { onState, onStatus } = {}) {
    this.map = map;
    this.onState = onState ?? (() => {});
    this.onStatus = onStatus ?? (() => {});
    this.router = null;
    this.route = null;
    this.mode = "walk";
    this.destination = null;
    this.startCoord = null;
    this.anim = null;
    this.flow = null;
    this.layersReady = false;
  }

  async ensureRouter() {
    if (this.router) return this.router;
    this.onStatus("正在建立路網（約 2 萬條道路）…");
    const [{ Router }, roads] = await Promise.all([
      import("./routing.js"),
      fetch("data/macau-roads.geojson").then((r) => r.json()),
    ]);
    this.router = new Router(roads.features ?? []);
    this.router.graph(this.mode);
    return this.router;
  }

  ensureLayers() {
    if (this.layersReady) return;
    const m = this.map;
    m.addSource("nav-explore", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    m.addSource("nav-scan", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    m.addSource("nav-route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    m.addSource("nav-flow", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    m.addSource("nav-ends", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

    m.addLayer({
      id: "nav-explore", type: "circle", source: "nav-explore",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 1.6, 15, 3, 18, 5],
        "circle-color": ["interpolate", ["linear"], ["get", "t"], 0, COLOR.scan, 0.55, "#8fd0e8", 0.85, "#ffd166", 1, "#fff0c2"],
        "circle-opacity": 0,
        "circle-blur": 0.35,
      },
    });
    m.addLayer({
      id: "nav-scan", type: "circle", source: "nav-scan",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 14, 16, 30],
        "circle-color": "rgba(111,215,255,0)",
        "circle-stroke-color": COLOR.scan, "circle-stroke-width": 1.6, "circle-stroke-opacity": 0.85,
        "circle-blur": 0.6,
      },
    });
    m.addLayer({
      id: "nav-route-glow", type: "line", source: "nav-route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": COLOR.glow, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 14, 16, 34], "line-opacity": 0.34, "line-blur": 12 },
    });
    m.addLayer({
      id: "nav-route-casing", type: "line", source: "nav-route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "rgba(12,8,2,.8)", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 5, 16, 12], "line-opacity": 0.75 },
    }, "nav-route-glow");
    m.addLayer({
      id: "nav-route", type: "line", source: "nav-route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": COLOR.route, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 3.4, 16, 8.5], "line-opacity": 1 },
    });
    m.addLayer({
      id: "nav-route-core", type: "line", source: "nav-route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#fff8e2", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1.3, 16, 3.2], "line-opacity": 0.9 },
    });
    m.addSource("nav-pulse", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    m.addLayer({
      id: "nav-pulse", type: "circle", source: "nav-pulse",
      paint: { "circle-radius": 8, "circle-color": "rgba(255,209,102,0)", "circle-stroke-color": COLOR.route, "circle-stroke-width": 2.5 },
    });
    m.addLayer({
      id: "nav-flow", type: "circle", source: "nav-flow",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 2.4, 16, 5.5],
        "circle-color": "#fff6d8", "circle-opacity": 0.92,
        "circle-stroke-color": COLOR.glow, "circle-stroke-width": 1,
      },
    });
    m.addLayer({
      id: "nav-ends", type: "circle", source: "nav-ends",
      paint: {
        "circle-radius": ["match", ["get", "k"], "start", 7, "end", 8, 6],
        "circle-color": ["match", ["get", "k"], "start", COLOR.start, "end", COLOR.end, "#fff"],
        "circle-stroke-color": "#0b1117", "circle-stroke-width": 2.5,
      },
    });
    this.layersReady = true;
  }

  setVisible(on) {
    if (!this.layersReady) return;
    for (const id of ["nav-explore", "nav-scan", "nav-route", "nav-route-glow", "nav-route-casing", "nav-route-core", "nav-flow", "nav-ends", "nav-pulse"]) {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    }
  }

  /** 開始導航：dest = { name, coords }, from = 使用者座標（可選） */
  async start(dest, fromCoord, mode, { autoMode = true } = {}) {
    const m = this.map;
    this.ensureLayers();
    this.setVisible(true);
    this.destination = dest;
    this.startCoord = fromCoord;
    this.stopAnimation();

    const router = await this.ensureRouter();
    // 自動選擇交通方式：直線距離較遠時用開車
    const straight = Math.hypot((dest.coords[0] - fromCoord[0]) * 102400, (dest.coords[1] - fromCoord[1]) * 110800);
    if (mode) this.mode = mode;
    else if (autoMode && straight > 2500) {
      if (this.mode !== "car") { this.mode = "car"; this.onStatus("距離較遠，已改用開車模式"); }
    } else if (autoMode && straight <= 2500 && this.mode !== "walk") {
      this.mode = "walk"; this.onStatus("距離不遠，已改用步行模式");
    }

    this.onStatus("正在計算最快路線…");
    await new Promise((r) => setTimeout(r, 30));
    let route = router.route(fromCoord, dest.coords, this.mode, { snapDist: 600 });
    if (!route) {
      // 換另一種交通方式重試，再放寬吸附距離
      const other = this.mode === "walk" ? "car" : "walk";
      route = router.route(fromCoord, dest.coords, other, { snapDist: 900 });
      if (route) { this.mode = other; this.onStatus(`已改用${other === "car" ? "開車" : "步行"}模式`); }
    }
    if (!route) route = router.route(fromCoord, dest.coords, this.mode, { snapDist: 1500 });
    if (!route) { this.onStatus("找不到可行路線，請試著把起點移到較近的道路旁"); return null; }
    this.route = route;
    this.onState({ active: true, route, destination: dest, mode: this.mode, phase: "searching" });

    // 起訖點
    m.getSource("nav-ends").setData({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { k: "start" }, geometry: { type: "Point", coordinates: fromCoord } },
        { type: "Feature", properties: { k: "end" }, geometry: { type: "Point", coordinates: dest.coords } },
      ],
    });
    m.getSource("nav-pulse")?.setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: dest.coords } }] });
    // 鏡頭帶到整條路線
    const lons = route.path.map((p) => p[0]), lats = route.path.map((p) => p[1]);
    m.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], {
      padding: { top: 120, bottom: 210, left: 120, right: 120 }, pitch: 45, duration: 1100, maxZoom: 16.5,
    });

    await this.animateSearch(route);
    await this.animateRoute(route);
    this.startFlow();
    this.onState({ active: true, route, destination: dest, mode: this.mode, phase: "ready" });
    this.onStatus(null);
    return route;
  }

  /** ① 搜尋動畫：依 Dijkstra 拜訪順序逐一亮起（波前擴散） */
  animateSearch(route) {
    const m = this.map;
    // 只取樣最多 4000 個點做動畫（保持波前效果又不會拖慢）
    const raw = route.visited;
    const MAXP = 4000;
    const vis = raw.length <= MAXP ? raw : Array.from({ length: MAXP }, (_, i) => raw[Math.floor((i / (MAXP - 1)) * (raw.length - 1))]);
    const features = vis.map((nodeIdx, i) => ({
      type: "Feature",
      properties: { t: vis.length > 1 ? i / (vis.length - 1) : 1, i },
      geometry: { type: "Point", coordinates: [this.router.graph(this.mode).xs[nodeIdx], this.router.graph(this.mode).ys[nodeIdx]] },
    }));
    m.getSource("nav-explore").setData({ type: "FeatureCollection", features });
    m.setPaintProperty("nav-explore", "circle-opacity", ["case", ["<=", ["get", "t"], 0], 0.9, 0]);
    m.setPaintProperty("nav-scan", "circle-stroke-opacity", 0.9);

    const g = this.router.graph(this.mode);
    const dur = Math.min(2600, Math.max(1100, vis.length * 0.12));
    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - t0) / dur);
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; // easeInOutQuad
        m.setPaintProperty("nav-explore", "circle-opacity", ["case", ["<=", ["get", "t"], e], 0.9, 0]);
        const idx = Math.min(vis.length - 1, Math.floor(e * (vis.length - 1)));
        const node = vis[idx];
        m.getSource("nav-scan").setData({
          type: "FeatureCollection",
          features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [g.xs[node], g.ys[node]] } }],
        });
        if (p < 1) this.anim = requestAnimationFrame(step);
        else resolve();
      };
      this.anim = requestAnimationFrame(step);
    });
  }

  /** ② 定案：探索淡出、路線由起點長出來 */
  animateRoute(route) {
    const m = this.map;
    const path = route.path;
    const dur = Math.min(1600, Math.max(700, route.distM * 0.06));
    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - p, 3);
        const end = Math.max(2, Math.floor(e * path.length));
        m.getSource("nav-route").setData({
          type: "FeatureCollection",
          features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: path.slice(0, end) } }],
        });
        const fade = Math.max(0, 1 - p * 1.5);
        m.setPaintProperty("nav-explore", "circle-opacity", ["case", ["<=", ["get", "t"], 1], 0.9 * fade, 0]);
        m.setPaintProperty("nav-scan", "circle-stroke-opacity", 0.9 * fade);
        if (p < 1) this.anim = requestAnimationFrame(step);
        else {
          m.getSource("nav-explore").setData({ type: "FeatureCollection", features: [] });
          m.getSource("nav-scan").setData({ type: "FeatureCollection", features: [] });
          m.getSource("nav-route").setData({
            type: "FeatureCollection",
            features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: path } }],
          });
          resolve();
        }
      };
      this.anim = requestAnimationFrame(step);
    });
  }

  /** ③ 車流動畫：沿路線流動的光點 */
  startFlow() {
    const m = this.map;
    const path = this.route.path;
    const segs = [];
    let total = 0;
    for (let i = 1; i < path.length; i++) {
      const len = Math.hypot((path[i][0] - path[i - 1][0]) * 102400, (path[i][1] - path[i - 1][1]) * 110800);
      segs.push({ a: path[i - 1], b: path[i], len, start: total });
      total += len;
    }
    if (!total) return;
    const N = 26;
    const at = (d) => {
      d = ((d % total) + total) % total;
      let lo = 0, hi = segs.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (segs[mid].start + segs[mid].len < d) lo = mid + 1; else hi = mid; }
      const s = segs[lo], t = s.len ? (d - s.start) / s.len : 0;
      return [s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t];
    };
    const speed = Math.max(60, total / 14); // 每秒移動距離
    let last = performance.now();
    let offset = 0;
    const tick = (now) => {
      const dt = (now - last) / 1000; last = now;
      offset += speed * dt;
      const features = [];
      for (let i = 0; i < N; i++) {
        const d = (i / N) * total + offset;
        features.push({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: at(d) } });
      }
      m.getSource("nav-flow").setData({ type: "FeatureCollection", features });
      // 終點脈衝
      const pulse = (Math.sin(now / 500) + 1) / 2;
      m.setPaintProperty("nav-pulse", "circle-radius", 9 + pulse * 16);
      m.setPaintProperty("nav-pulse", "circle-stroke-opacity", 0.75 - pulse * 0.55);
      this.flow = requestAnimationFrame(tick);
    };
    this.flow = requestAnimationFrame(tick);
  }

  stopAnimation() {
    if (this.anim) cancelAnimationFrame(this.anim);
    if (this.flow) cancelAnimationFrame(this.flow);
    this.anim = this.flow = null;
  }

  stop() {
    this.stopAnimation();
    this.setVisible(false);
    this.route = null;
    this.destination = null;
    this.onState({ active: false });
    this.onStatus(null);
  }
}
