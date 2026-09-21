// 地圖文字標籤層：DOM 標籤 + 螢幕碰撞剔除（不需字型伺服器，離線可用）
export class LabelLayer {
  constructor(map, { onClick } = {}) {
    this.map = map;
    this.onClick = onClick ?? (() => {});
    this.labels = [];
    this.enabled = true;
    this.container = document.createElement("div");
    this.container.className = "label-layer";
    map.getCanvasContainer().appendChild(this.container);
    this.lastCollide = 0;
    map.on("move", () => this.updatePositions());
    map.on("render", () => this.updatePositions());
    map.on("moveend", () => this.collide());
    map.on("zoomend", () => this.collide());
    this.updatePositions();
  }

  setData(features) {
    this.container.innerHTML = "";
    this.labels = features.map((f) => {
      const p = f.properties ?? {};
      const el = document.createElement("span");
      el.className = `map-label map-label-${p.k}`;
      el.textContent = p.t;
      el.dataset.kind = p.k;
      el.addEventListener("click", (e) => { e.stopPropagation(); this.onClick(p, f.geometry.coordinates); });
      this.container.appendChild(el);
      return { el, coords: f.geometry.coordinates, text: p.t, kind: p.k, minZoom: p.z ?? 14, priority: p.p ?? 1, shown: true, w: 0, h: 0, x: 0, y: 0 };
    });
    this.collide();
  }

  setEnabled(on) {
    this.enabled = on;
    this.container.style.display = on ? "" : "none";
    if (on) this.collide();
  }

  updatePositions() {
    if (!this.enabled) return;
    const zoom = this.map.getZoom();
    for (const L of this.labels) {
      const vis = zoom >= L.minZoom;
      if (vis !== L.shown) { L.shown = vis; L.el.style.display = vis ? "" : "none"; }
      if (!vis) continue;
      const p = this.map.project(L.coords);
      L.x = p.x; L.y = p.y;
      L.el.style.transform = `translate(-50%, -50%) translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
    }
    // 碰撞剔除：最多每 220ms 重算一次（拖曳時只更新位置）
    const now = performance.now();
    if (now - this.lastCollide > 220) { this.lastCollide = now; this.collide(); }
  }

  collide() {
    if (!this.enabled) return;
    const zoom = this.map.getZoom();
    for (const L of this.labels) {
      if (!L.shown) continue;
      L.w = L.el.offsetWidth || L.text.length * 12;
      L.h = L.el.offsetHeight || 16;
      L.placed = false;
    }
    const visible = this.labels.filter((L) => L.shown).sort((a, b) => (b.priority - a.priority) || (b.minZoom - a.minZoom));
    const boxes = [];
    for (const L of visible) {
      const pad = L.kind === "region" ? 4 : 3;
      const box = { x1: L.x - L.w / 2 - pad, x2: L.x + L.w / 2 + pad, y1: L.y - L.h / 2 - pad, y2: L.y + L.h / 2 + pad };
      let hit = false;
      for (const b of boxes) {
        if (box.x1 < b.x2 && box.x2 > b.x1 && box.y1 < b.y2 && box.y2 > b.y1) { hit = true; break; }
      }
      if (!hit) { boxes.push(box); L.placed = true; }
      L.el.classList.toggle("hidden", !L.placed);
    }
    this.container.classList.toggle("labels-off", zoom < 11);
  }
}
