// 周邊設施（POI）圖層：延遲載入 + 分組過濾 + 點擊彈出小卡
import { Popup } from "maplibre-gl";
// 預設關閉的類別（小店數量龐大，改為使用者主動開啟）
export const POI_DEFAULT_OFF = new Set(["eat", "shop"]);

export const POI_GROUPS = [
  { id: "eat", zh: "餐飲", color: "#d98c5f" },
  { id: "stay", zh: "住宿", color: "#8f7fd0" },
  { id: "shop", zh: "購物", color: "#c2a35a" },
  { id: "culture", zh: "文化", color: "#6fb2d2" },
  { id: "medical", zh: "醫療", color: "#d9707a" },
  { id: "school", zh: "學校", color: "#7fae6f" },
  { id: "gov", zh: "政府", color: "#8f9aa6" },
  { id: "transport", zh: "交通", color: "#5fc7b0" },
  { id: "fun", zh: "娛樂", color: "#c07fd0" },
  { id: "other", zh: "其他", color: "#7c8894" },
];

export class PoiLayer {
  constructor(map, { url = "data/macau-pois-lite.geojson" } = {}) {
    this.map = map;
    this.url = url;
    this.loaded = false;
    this.visible = false;
    this.enabled = new Set(POI_GROUPS.filter((g) => !POI_DEFAULT_OFF.has(g.id)).map((g) => g.id));
    this.popup = null;
  }

  async load() {
    if (this.loaded) return;
    const data = await fetch(this.url).then((r) => r.json());
    this.sourceId = "pois";
    this.map.addSource(this.sourceId, { type: "geojson", data, promoteId: undefined });
    // 低縮放只顯示重點類別，避免雜亂
    const major = ["culture", "transport", "gov", "medical", "school", "stay", "fun"];
    this.map.addLayer({
      id: "poi-halo",
      type: "circle",
      source: this.sourceId,
      minzoom: 12.5,
      filter: this.buildFilter(major, true),
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 4, 17, 9], "circle-color": "rgba(10,14,19,0.55)" },
    });
    this.map.addLayer({
      id: "poi",
      type: "circle",
      source: this.sourceId,
      minzoom: 12.5,
      filter: this.buildFilter(major, false),
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 2.2, 15, 3.6, 17, 6],
        "circle-color": ["match", ["get", "g"], ...POI_GROUPS.flatMap((g) => [g.id, g.color]), "#7c8894"],
        "circle-stroke-width": 0.6,
        "circle-stroke-color": "rgba(8,11,15,.75)",
        "circle-opacity": 0.92,
      },
    });
    this.map.on("zoomend", () => this.applyZoomFilter());
    this.map.on("click", "poi", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties;
      const g = POI_GROUPS.find((x) => x.id === p.g);
      if (this.popup) this.popup.remove();
      this.popup = new Popup({ closeButton: false, offset: 10, maxWidth: "240px" })
        .setLngLat(e.lngLat)
        .setHTML(`<div style="font-size:12.5px;line-height:1.5"><b>${p.n}</b>${g ? `<div style="color:#9aa6b2;font-size:11px;margin-top:2px">${g.zh}</div>` : ""}</div>`)
        .addTo(this.map);
    });
    this.map.on("mouseenter", "poi", () => { this.map.getCanvas().style.cursor = "pointer"; });
    this.map.on("mouseleave", "poi", () => { this.map.getCanvas().style.cursor = ""; });
    this.map.triggerRepaint();
    this.loaded = true;
    this.applyZoomFilter();
  }

  buildFilter(groups, halo) {
    const parts = [["in", ["get", "g"], ["literal", [...groups]]]];
    return parts.length === 1 ? parts[0] : ["all", ...parts];
  }

  applyZoomFilter() {
    if (!this.loaded) return;
    const z = this.map.getZoom();
    const core = ["culture", "transport", "gov", "medical", "stay"];
    const mid = [...core, "school", "fun", "shop"];
    let allowed;
    if (z >= 15.2) allowed = [...this.enabled];
    else if (z >= 13.8) allowed = mid.filter((g) => this.enabled.has(g));
    else allowed = core.filter((g) => this.enabled.has(g));
    const groups = allowed;
    const filter = this.buildFilter(groups, false);
    this.map.setFilter("poi", filter);
    this.map.setFilter("poi-halo", filter);
    const vis = this.visible && groups.length > 0 ? "visible" : "none";
    this.map.setLayoutProperty("poi", "visibility", vis);
    this.map.setLayoutProperty("poi-halo", "visibility", vis);
  }

  setGroup(id, on) {
    if (on) this.enabled.add(id); else this.enabled.delete(id);
    this.applyZoomFilter();
  }

  async setVisible(on) {
    this.visible = on;
    if (on && !this.loaded) await this.load();
    this.applyZoomFilter();
  }
}
