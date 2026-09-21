import fs from "node:fs";
// ---------- index.html：圖層按鈕 + 回到澳門浮動鈕 ----------
let h = fs.readFileSync("index.html", "utf8");
if (!h.includes("btn-layers")) {
  h = h.replace(
    `        <button class="icon-btn" id="btn-locate"`,
    `        <button class="icon-btn" id="btn-layers" title="圖層與地形（L）">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M12 3 2.8 7.6 12 12.2l9.2-4.6z" fill="currentColor"/>
            <path d="M4.6 11.4 12 15.1l7.4-3.7 2.2 1.1L12 17.3 2.4 12.5z" fill="currentColor" opacity=".6"/>
            <path d="M4.6 15.6 12 19.3l7.4-3.7 2.2 1.1L12 21.5 2.4 16.7z" fill="currentColor" opacity=".35"/>
          </svg>
        </button>
        <button class="icon-btn" id="btn-locate"`
  );
  h = h.replace(
    `      <button class="ghost-btn" id="btn-reset-view">重設視角</button>`,
    `      <button class="ghost-btn" id="btn-recenter">回到澳門</button>
      <button class="ghost-btn" id="btn-reset-view">重設視角</button>`
  );
  h = h.replace(
    `    <div class="toast" id="toast"></div>`,
    `    <button class="recenter-fab" id="recenter-fab" title="回到澳門">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/><circle cx="12" cy="12" r="5" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/></svg>
      <span>回到澳門</span>
    </button>
    <div class="toast" id="toast"></div>`
  );
  fs.writeFileSync("index.html", h);
  console.log("index.html：已加入圖層按鈕與回到澳門");
}

// ---------- styles.css ----------
let c = fs.readFileSync("src/styles.css", "utf8");
if (!c.includes(".recenter-fab")) {
  c = c.replace(`.controls { position: fixed; top: 62px; right: 16px; z-index: 25; width: 194px;`,
                `.controls { position: fixed; top: 62px; right: 16px; z-index: 25; width: 186px;`);
  c = c.replace(`.sidebar { position: fixed; top: 62px; left: 16px; bottom: 74px; z-index: 26; width: 316px;`,
                `.sidebar { position: fixed; top: 62px; left: 16px; bottom: 74px; z-index: 26; width: 296px;`);
  c = c.replace(`.detail { position: fixed; top: 62px; right: 16px; bottom: 74px; z-index: 28; width: min(398px, calc(100vw - 32px));`,
                `.detail { position: fixed; top: 62px; right: 16px; bottom: 74px; z-index: 28; width: min(378px, calc(100vw - 32px));`);
  c += `
/* ---------------- 回到澳門浮動鈕 ---------------- */
.recenter-fab { position: fixed; left: 50%; bottom: 26px; transform: translate(-50%, 24px); z-index: 27; display: none; align-items: center; gap: 7px;
  padding: 9px 15px; border-radius: 999px; background: rgba(13,18,24,.94); border: 1px solid var(--gold); color: var(--gold);
  font-size: 12.5px; font-family: var(--sans); letter-spacing: .06em; cursor: pointer; backdrop-filter: blur(14px); box-shadow: var(--shadow);
  transition: opacity .25s, transform .25s; opacity: 0; }
.recenter-fab.on { display: inline-flex; opacity: 1; transform: translate(-50%, 0); }
.recenter-fab:hover { background: rgba(216,180,90,.16); }
.icon-btn.active { border-color: var(--gold); color: var(--gold); }
`;
  fs.writeFileSync("src/styles.css", c);
  console.log("styles.css：已加入浮動鈕與面板寬度調整");
}

// ---------- main.js ----------
let m = fs.readFileSync("src/main.js", "utf8");
// 1) 放寬邊界、提高最低縮放（讓左右平移可用）
m = m.replace(
  `  minZoom: 10.4,`,
  `  minZoom: 11.6,`
);
m = m.replace(
  `  maxBounds: [[113.495, 22.075], [113.635, 22.253]],`,
  `  // 只做「軟限制」：範圍放大到珠江口一帶，避免低縮放時被鎖住無法左右平移
  maxBounds: [[112.95, 21.65], [114.25, 22.85]],`
);
// 2) 圖層面板開關 + 回到澳門 + 鍵盤快捷鍵
m = m.replace(
  `$("#btn-reset-view").addEventListener("click", () => map.flyTo({ ...HOME, duration: 1500, essential: true }));`,
  `$("#btn-reset-view").addEventListener("click", () => map.flyTo({ ...HOME, duration: 1500, essential: true }));
// 圖層面板開關（之前漏了按鈕）
function toggleControls(force) {
  const el = $("#controls");
  const on = force ?? !el.classList.contains("open");
  el.classList.toggle("open", on);
  $("#btn-layers")?.classList.toggle("active", on);
}
$("#btn-layers").addEventListener("click", () => toggleControls());
// 回到澳門：地圖中心離開澳門資料範圍時自動出現
const HOME_BOX = { west: 113.46, east: 113.69, south: 22.04, north: 22.30 };
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
    $("#detail").classList.remove("open");
    toggleControls(false);
  }
});`
);
// 3) 側欄預設只在夠寬的螢幕打開
m = m.replace(
  `if (window.innerWidth > 900) $("#sidebar").classList.add("open");`,
  `if (window.innerWidth > 1320) { $("#sidebar").classList.add("open"); toggleControls(true); }`
);
// 4) 說明面板補上快捷鍵與平移說明
m = m.replace(
  `      <p>\${T("· 拖曳可平移地圖`,
  `      <p>\${T("· 快捷鍵：L 開關圖層面板、S 開關景點清單、F 全螢幕、Esc 關閉面板。地圖可自由平移，離開澳門範圍時左下會出現「回到澳門」。")}</p>
      <p>\${T("· 拖曳可平移地圖`
);
fs.writeFileSync("src/main.js", m);
console.log("main.js：已放寬邊界、加入圖層開關/回到澳門/快捷鍵");
