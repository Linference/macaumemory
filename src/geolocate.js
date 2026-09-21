// 個人定位：GPS 藍點（含精度圈、行進方向）＋ 距離計算
export class MyLocation {
  constructor(map, { onUpdate, onError, onStateChange } = {}) {
    this.map = map;
    this.onUpdate = onUpdate ?? (() => {});
    this.onError = onError ?? (() => {});
    this.onStateChange = onStateChange ?? (() => {});
    this.watchId = null;
    this.active = false;
    this.follow = false;
    this.position = null;
    this.lastMove = 0;

    this.el = document.createElement("div");
    this.el.className = "gps";
    this.el.innerHTML = `<div class="gps-halo"></div><div class="gps-dot"><i class="gps-heading"></i></div>`;
    this.halo = this.el.querySelector(".gps-halo");
    this.arrow = this.el.querySelector(".gps-heading");
    map.getCanvasContainer().appendChild(this.el);
    this.el.style.display = "none";

    map.on("render", () => this.updateScreen());
    map.on("move", () => this.updateScreen());
    map.on("rotate", () => this.updateHeading());
  }

  get available() {
    return typeof navigator !== "undefined" && !!navigator.geolocation;
  }

  toggle() {
    if (this.active) this.stop();
    else this.start();
  }

  start() {
    if (!this.available) {
      this.onError({ code: -1, message: "此瀏覽器不支援定位功能" });
      return;
    }
    if (!window.isSecureContext) {
      this.onError({ code: -2, message: "瀏覽器只在 HTTPS 或 localhost 下允許定位，請改用 https 或本機網址開啟" });
      return;
    }
    this.active = true;
    this.el.style.display = "";
    this.onStateChange(true, false);
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.handlePosition(pos),
      (err) => this.handleError(err),
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 20000 }
    );
  }

  stop() {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    this.active = false;
    this.follow = false;
    this.position = null;
    this.el.style.display = "none";
    this.onStateChange(false, false);
  }

  setFollow(on) {
    this.follow = on;
    this.onStateChange(this.active, on);
    if (on && this.position) this.map.easeTo({ center: this.position.coords, duration: 700 });
  }

  handlePosition(pos) {
    const c = pos.coords;
    const first = !this.position;
    this.position = {
      coords: [c.longitude, c.latitude],
      accuracy: c.accuracy ?? 0,
      heading: isFinite(c.heading) ? c.heading : null,
      speed: isFinite(c.speed) ? c.speed : null,
      time: pos.timestamp,
    };
    this.updateScreen();
    this.onUpdate(this.position, { first });
    if (this.follow && this.position) {
      const now = performance.now();
      if (now - this.lastMove > 1200) { this.lastMove = now; this.map.easeTo({ center: this.position.coords, duration: 900 }); }
    }
  }

  handleError(err) {
    const msg = err.code === 1
      ? "定位權限被拒絕：請在瀏覽器網址列左側允許「位置」權限"
      : err.code === 2 ? "目前無法取得定位（訊號不良或被系統限制）"
        : err.code === 3 ? "取得定位逾時，請稍後再試" : (err.message ?? "定位失敗");
    this.onError({ code: err.code, message: msg });
    if (err.code === 1) this.stop();
  }

  updateScreen() {
    if (!this.position) return;
    const p = this.map.project(this.position.coords);
    this.el.style.transform = `translate(-50%, -50%) translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
    const metersPerPx = (156543.03392 * Math.cos((this.position.coords[1] * Math.PI) / 180)) / Math.pow(2, this.map.getZoom());
    const r = Math.max(10, Math.min(320, (this.position.accuracy || 0) / metersPerPx));
    this.halo.style.width = `${r * 2}px`;
    this.halo.style.height = `${r * 2}px`;
  }

  updateHeading() {
    if (!this.position) return;
    const bearing = this.map.getBearing();
    const h = this.position.heading;
    if (h == null) { this.arrow.style.display = "none"; return; }
    this.arrow.style.display = "";
    this.arrow.style.transform = `rotate(${h - bearing}deg)`;
    this.arrow.style.transformOrigin = "50% 100%";
  }
}

// ---------------- 距離與方位 ----------------
const R = 6371000;
export function distanceMeters(a, b) {
  const [lon1, lat1] = a, [lon2, lat2] = b;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function bearingLabel(from, to) {
  const [lon1, lat1] = from, [lon2, lat2] = to;
  const φ1 = (lat1 * Math.PI) / 180, φ2 = (lat2 * Math.PI) / 180, Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  const dirs = ["北", "東北", "東", "東南", "南", "西南", "西", "西北"];
  return dirs[Math.round(((deg + 360) % 360) / 45) % 8];
}

export const formatDistance = (m) => (m < 950 ? `${Math.round(m / 10) * 10} 公尺` : `${(m / 1000).toFixed(m < 9500 ? 1 : 0)} 公里`);
