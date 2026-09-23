// 實景照片圖層：地圖標記 + 彈窗 + 大圖檢視（lightbox）
import { Popup } from "maplibre-gl";

const DEFAULT_COLOR = "#d8b45a";

export class PhotoLayer {
  constructor(map, { url = "data/photos.geojson", onOpen } = {}) {
    this.map = map;
    this.url = url;
    this.onOpen = onOpen ?? (() => {});
    this.loaded = false;
    this.visible = false;
    this.photos = [];
    this.taxonomy = {};
    this.iconReady = false;
    this.filters = new Set();   // 空集合＝全部顯示
  }

  async load() {
    if (this.loaded) return this;
    const gj = await fetch(this.url).then((r) => r.json());
    this.photos = gj.features ?? [];
    this.taxonomy = gj.taxonomy ?? {};
    this.count = this.photos.length;

    const m = this.map;
    this.sourceId = "photos";
    m.addSource(this.sourceId, { type: "geojson", data: gj });

    // 圓點（依類別上色）+ 相機圖示
    m.addLayer({
      id: "photo-dot",
      type: "circle",
      source: this.sourceId,
      minzoom: 11.5,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 7, 18, 13],
        "circle-color": ["get", "color"],
        "circle-stroke-color": "#0b1117",
        "circle-stroke-width": 2,
        "circle-opacity": 0.95,
      },
    });
    this.addCameraIcon();
    m.addLayer({
      id: "photo-icon",
      type: "symbol",
      source: this.sourceId,
      minzoom: 11.5,
      layout: { "icon-image": "photo-cam", "icon-size": ["interpolate", ["linear"], ["zoom"], 12, 0.42, 18, 0.6], "icon-allow-overlap": true },
    });

    // 互動
    m.on("click", "photo-dot", (e) => this.openFromEvent(e));
    m.on("click", "photo-icon", (e) => this.openFromEvent(e));
    for (const layer of ["photo-dot", "photo-icon"]) {
      m.on("mouseenter", layer, () => { m.getCanvas().style.cursor = "pointer"; });
      m.on("mouseleave", layer, () => { m.getCanvas().style.cursor = ""; });
    }
    this.loaded = true;
    this.applyFilter();
    return this;
  }

  addCameraIcon() {
    if (this.iconReady) return;
    const size = 64;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    g.fillStyle = "#0b1117";
    // 相機機身
    g.beginPath();
    g.roundRect ? g.roundRect(12, 20, 40, 28, 6) : g.rect(12, 20, 40, 28);
    g.fill();
    // 鏡頭
    g.beginPath();
    g.arc(32, 34, 9, 0, Math.PI * 2);
    g.fillStyle = "#fff";
    g.fill();
    g.beginPath();
    g.arc(32, 34, 4.5, 0, Math.PI * 2);
    g.fillStyle = "#0b1117";
    g.fill();
    // 觀景窗
    g.fillStyle = "#fff";
    g.fillRect(36, 13, 10, 6);
    const data = g.getImageData(0, 0, size, size);
    this.map.addImage("photo-cam", { width: size, height: size, data: new Uint8Array(data.data) });
    this.iconReady = true;
  }

  openFromEvent(e) {
    const f = e.features?.[0];
    if (!f) return;
    const p = f.properties;
    const clsZh = p.clsZh ?? this.taxonomy[p.cls]?.zh ?? p.cls;
    const html = `
      <div class="photo-pop">
        <img src="${p.thumb}" alt="${p.id}" loading="lazy" />
        <div class="photo-pop-body">
          <div class="photo-pop-cls" style="--c:${p.color ?? DEFAULT_COLOR}">${clsZh}${p.conf ? ` · ${Math.round(p.conf * 100)}%` : ""}${p.manual ? " · 手動" : ""}</div>
          ${p.caption ? `<p>${p.caption}</p>` : `<p class="dim">${p.nearZh ? `拍攝於 ${p.nearZh} 附近` : "尚未產生解讀"}</p>`}
          ${(p.tags ?? []).length ? `<div class="photo-tags">${p.tags.map((t) => `<span>${t}</span>`).join("")}</div>` : ""}
          <div class="photo-meta">${p.taken ? new Date(p.taken).toLocaleString("zh-TW") : ""}${p.nearZh ? ` · 距 ${p.nearZh} ${p.nearDist}m` : ""}</div>
          <button class="btn sec photo-more">看大圖與完整檔案</button>
        </div>
      </div>`;
    new Popup({ closeButton: true, offset: 16, maxWidth: "270px" })
      .setLngLat(f.geometry.coordinates)
      .setHTML(html)
      .addTo(this.map);
    setTimeout(() => {
      document.querySelector(".photo-more")?.addEventListener("click", () => this.onOpen(p));
    }, 60);
  }

  setVisible(on) {
    this.visible = on;
    this.applyFilter();
  }

  setFilter(cls) {
    if (cls) {
      if (this.filters.has(cls)) this.filters.delete(cls); else this.filters.add(cls);
    }
    this.applyFilter();
  }

  applyFilter() {
    if (!this.loaded) return;
    const show = this.visible;
    const filter = this.filters.size ? ["in", ["get", "cls"], ["literal", [...this.filters]]] : null;
    for (const id of ["photo-dot", "photo-icon"]) {
      if (!this.map.getLayer(id)) continue;
      this.map.setLayoutProperty(id, "visibility", show ? "visible" : "none");
      this.map.setFilter(id, filter);
    }
  }

  /** 找出某座標附近的照片（給景點詳情面板用） */
  near(coord, maxM = 200) {
    const R = 6371000;
    const d = (a, b) => {
      const [lon1, lat1] = a, [lon2, lat2] = b;
      const dLat = ((lat2 - lat1) * Math.PI) / 180, dLon = ((lon2 - lon1) * Math.PI) / 180;
      const s = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
      return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
    };
    return this.photos
      .map((f) => ({ p: f.properties, coords: f.geometry.coordinates, distM: d(coord, f.geometry.coordinates) }))
      .filter((x) => x.distM <= maxM)
      .sort((a, b) => a.distM - b.distM);
  }
}
