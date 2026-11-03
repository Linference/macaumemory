// 澳門記憶 · 建築記憶點圖層（一個記憶點一個點，可展開該建築的所有照片）
import { Popup } from "maplibre-gl";

export class PhotoLayer {
  constructor(map, { url = "data/places.geojson", onOpen } = {}) {
    this.map = map;
    this.url = url;
    this.onOpen = onOpen ?? (() => {});
    this.loaded = false;
    this.visible = false;
    this.places = [];
    this.taxonomy = {};
    this.filters = new Set();
    this.countIcons = new Set();
  }

  async load() {
    if (this.loaded) return this;
    const gj = await fetch(this.url).then((r) => r.json());
    this.places = gj.features ?? [];
    this.taxonomy = gj.taxonomy ?? {};
    this.count = this.places.length;
    const m = this.map;
    m.addSource("places", { type: "geojson", data: gj });

    m.addLayer({
      id: "place-dot",
      type: "circle",
      source: "places",
      minzoom: 11,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 11, 18, 17],
        "circle-color": ["get", "color"],
        "circle-stroke-color": "#0b1117",
        "circle-stroke-width": 2.5,
        "circle-opacity": 0.96,
      },
    });
    // 用 canvas 產生「照片張數」徽章圖示（MapLibre symbol 無字型伺服器時的做法）
    for (const f of this.places) {
      const n = f.properties.photoCount ?? 1;
      const key = `place-n-${n}`;
      if (this.countIcons.has(key)) continue;
      this.countIcons.add(key);
      m.addImage(key, this.makeBadge(n));
    }
    m.addLayer({
      id: "place-count",
      type: "symbol",
      source: "places",
      minzoom: 11,
      layout: { "icon-image": ["concat", "place-n-", ["to-string", ["get", "photoCount"]]], "icon-allow-overlap": true, "icon-size": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 18, 0.72] },
    });

    const open = (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const place = this.places.find((x) => x.properties.id === f.properties.id) ?? f;
      this.popup(place);
    };
    m.on("click", "place-dot", open);
    m.on("click", "place-count", open);
    for (const l of ["place-dot", "place-count"]) {
      m.on("mouseenter", l, () => { m.getCanvas().style.cursor = "pointer"; });
      m.on("mouseleave", l, () => { m.getCanvas().style.cursor = ""; });
    }
    this.loaded = true;
    this.applyFilter();
    return this;
  }

  /** 圓形徽章：白圈底 + 數字（照片張數） */
  makeBadge(n) {
    const s = 72;
    const c = document.createElement("canvas");
    c.width = c.height = s;
    const g = c.getContext("2d");
    g.beginPath();
    g.arc(s / 2, s / 2, s / 2 - 4, 0, Math.PI * 2);
    g.fillStyle = "#0b1117";
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = "rgba(255,255,255,.85)";
    g.stroke();
    g.fillStyle = "#fff";
    g.font = `bold ${n > 9 ? 30 : 38}px sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(String(n), s / 2, s / 2 + 2);
    const img = g.getImageData(0, 0, s, s);
    return { width: s, height: s, data: new Uint8Array(img.data) };
  }

  popup(place) {
    const p = place.properties;
    const clsZh = p.clsZh ?? this.taxonomy[p.cls]?.zh ?? p.cls;
    const html = `
      <div class="place-pop">
        <img src="${p.coverThumb}" alt="${p.id}" />
        <div class="place-pop-body">
          <div class="place-pop-id">${p.id}${p.needsReview ? ' <span class="place-warn">待複核</span>' : ""}</div>
          <div class="place-pop-name">${p.zh ?? "未命名建築"}</div>
          <div class="place-pop-cls" style="--c:${p.color}">${clsZh} · ${p.photoCount} 張照片</div>
          ${p.caption ? `<p>${p.caption.slice(0, 90)}${p.caption.length > 90 ? "…" : ""}</p>` : ""}
          <button class="btn sec place-more">查看 ${p.photoCount} 張照片與完整檔案</button>
        </div>
      </div>`;
    const popup = new Popup({ closeButton: true, offset: 18, maxWidth: "280px" })
      .setLngLat(place.geometry.coordinates).setHTML(html).addTo(this.map);
    setTimeout(() => {
      popup.getElement()?.querySelector(".place-more")?.addEventListener("click", () => this.onOpen(p, 0));
    }, 60);
    return popup;
  }

  setVisible(on) { this.visible = on; this.applyFilter(); }

  setFilter(cls) {
    if (cls) { if (this.filters.has(cls)) this.filters.delete(cls); else this.filters.add(cls); }
    this.applyFilter();
  }

  /** 已掛在景點標記上的記憶點（nearId 屬於這些景點）不再畫圓圈，避免與景點標記疊在同一點 */
  setLinked(attractionIds) { this.linked = new Set(attractionIds); this.applyFilter(); }

  /** 依類型篩選後應顯示的記憶點（含已掛在景點上的） */
  visiblePlaces() {
    return this.filters.size ? this.places.filter((f) => this.filters.has(f.properties.cls)) : this.places;
  }

  applyFilter() {
    if (!this.loaded) return;
    const parts = [];
    if (this.filters.size) parts.push(["in", ["get", "cls"], ["literal", [...this.filters]]]);
    if (this.linked?.size) parts.push(["!", ["in", ["coalesce", ["get", "nearId"], ""], ["literal", [...this.linked]]]]);
    const filter = parts.length ? ["all", ...parts] : null;
    for (const id of ["place-dot", "place-count"]) {
      if (!this.map.getLayer(id)) continue;
      this.map.setLayoutProperty(id, "visibility", this.visible ? "visible" : "none");
      this.map.setFilter(id, filter);
    }
  }

  /** 某座標附近的記憶點（景點面板用） */
  near(coord, maxM = 250) {
    const R = 6371000;
    const d = (a, b) => {
      const [lon1, lat1] = a, [lon2, lat2] = b;
      const dLat = ((lat2 - lat1) * Math.PI) / 180, dLon = ((lon2 - lon1) * Math.PI) / 180;
      const s = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
      return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
    };
    return this.places.map((f) => ({ p: f.properties, coords: f.geometry.coordinates, distM: d(coord, f.geometry.coordinates) }))
      .filter((x) => x.distM <= maxM).sort((a, b) => a.distM - b.distM);
  }
}
