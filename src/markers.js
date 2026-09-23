// 建立地圖上的景點標記（DOM Marker）
import * as maplibregl from "maplibre-gl";
import { iconSvg } from "./icons.js";
import { T } from "./i18n.js";

export class MarkerLayer {
  constructor(map, { categories, onSelect, onFixChange }) {
    this.map = map;
    this.categories = categories;
    this.onSelect = onSelect;
    this.onFixChange = onFixChange ?? (() => {});
    this.markers = new Map();
    this.activeId = null;
    this.editable = false;
    this.dragging = null;
    this.onMove = (e) => this.onDragMove(e);
    this.onUp = () => this.endDrag();
  }

  /** 進入／離開位置校正模式 */
  setEditable(on) {
    this.editable = on;
    for (const { el } of this.markers.values()) {
      el.style.cursor = on ? "grab" : "pointer";
      el.classList.toggle("editable", on);
    }
  }

  startDrag(id, ev) {
    if (!this.editable) return;
    const entry = this.markers.get(id);
    if (!entry) return;
    ev.preventDefault();
    ev.stopPropagation();
    this.dragging = id;
    entry.el.style.cursor = "grabbing";
    entry.el.style.zIndex = 999;
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
  }

  onDragMove(ev) {
    if (!this.dragging) return;
    const entry = this.markers.get(this.dragging);
    if (!entry) return;
    const rect = this.map.getCanvas().getBoundingClientRect();
    const lngLat = this.map.unproject([ev.clientX - rect.left, ev.clientY - rect.top]);
    const coords = [+lngLat.lng.toFixed(6), +lngLat.lat.toFixed(6)];
    entry.marker.setLngLat(coords);
    entry.data.coords = coords;
    entry.data.geoSource = "manual";
    entry.el.classList.add("moved");
    this.onFixChange(this.dragging, coords);
  }

  endDrag() {
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    if (!this.dragging) return;
    const entry = this.markers.get(this.dragging);
    if (entry) { entry.el.style.cursor = this.editable ? "grab" : "pointer"; entry.el.style.zIndex = ""; }
    this.dragging = null;
    document.body.style.userSelect = "";
  }

  /** 依目前座標重建標記（用於套用外部修正後） */
  refreshPositions() {
    for (const { marker, data } of this.markers.values()) marker.setLngLat(data.coords);
  }

  setData(attractions) {
    for (const m of this.markers.values()) m.marker.remove();
    this.markers.clear();
    for (const a of attractions) {
      const cat = this.categories[a.cat] ?? this.categories.landmark;
      const el = document.createElement("button");
      el.className = "marker" + ((a.modelCount ?? a.artifactCount) ? " has-model" : "");
      el.type = "button";
      el.style.setProperty("--c", cat.color);
      el.setAttribute("aria-label", a.zh);
      el.innerHTML = `
        <span class="marker-pin">${iconSvg(cat.icon, 14)}</span>
        <span class="marker-label">${T(a.zh)}</span>
        ${(a.modelCount ?? a.artifactCount) ? `<span class="marker-badge">3D</span>` : ""}
        ${a.photoCount ? `<span class="marker-photo">📷${a.photoCount}</span>` : ""}`;
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.dragging) return;
        if (this.editable) { this.onSelect(a, { fly: false }); return; }
        this.onSelect(a, { fly: true });
      });
      el.addEventListener("pointerdown", (e) => this.startDrag(a.id, e));
      const marker = new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, 2] })
        .setLngLat(a.coords)
        .addTo(this.map);
      this.markers.set(a.id, { marker, el, data: a });
    }
    this.refreshLabels();
  }

  /** 依縮放決定是否常駐顯示名稱，並依「重要度分層」隱藏次要標記（去雜亂） */
  refreshLabels() {
    const zoom = this.map.getZoom();
    const show = zoom >= 14.2;
    const tierZoom = [11.1, 12.9, 13.7];
    for (const [id, { el, data }] of this.markers) {
      el.classList.toggle("show-label", show);
      const minZ = tierZoom[data.tier ?? 1] ?? 12.9;
      const hide = zoom < minZ && id !== this.activeId;
      el.classList.toggle("hidden", hide);
    }
  }

  setActive(id) {
    this.activeId = id;
    for (const [key, { el }] of this.markers) el.classList.toggle("on", key === id);
  }

  get(id) { return this.markers.get(id)?.data; }
}
