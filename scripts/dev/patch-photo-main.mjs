import fs from "node:fs";
let m = fs.readFileSync("src/main.js", "utf8");
m = m.replace(
  `import { AiChat } from "./chat.js";`,
  `import { AiChat } from "./chat.js";
import { PhotoLayer } from "./photos.js";`
);
// 建立照片圖層 + lightbox（放在 AI 區塊前）
m = m.replace(
  `// ---------------------------------------------------------------- 語音（朗讀與語音輸入）`,
  `// ---------------------------------------------------------------- 實景照片
const photoLayer = new PhotoLayer(map, { onOpen: (p) => openLightbox(p) });
let photosReady = false;
async function ensurePhotos() {
  if (photosReady) return photoLayer;
  try {
    await photoLayer.load();
    photosReady = true;
    $("#lb-photos").textContent = \`實景照片 (\${photoLayer.count})\`;
    renderPhotoChips();
  } catch (e) {
    console.warn("photos:", e);
    toast(T("目前沒有實景照片（請用 tools/photo-archive 產線加入）"));
  }
  return photoLayer;
}
function renderPhotoChips() {
  const box = $("#photo-chips");
  if (!box || !photoLayer.taxonomy) return;
  const used = new Map();
  for (const f of photoLayer.photos) used.set(f.properties.cls, (used.get(f.properties.cls) ?? 0) + 1);
  box.innerHTML = [...used.entries()].map(([cls, n]) => {
    const t = photoLayer.taxonomy[cls] ?? { zh: cls, color: "#d8b45a" };
    return \`<button class="poi-chip" data-cls="\${cls}"><span class="poi-dot" style="background:\${t.color}"></span>\${T(t.zh)} \${n}</button>\`;
  }).join("");
  for (const el of box.querySelectorAll(".poi-chip")) {
    el.addEventListener("click", () => {
      el.classList.toggle("off");
      photoLayer.setFilter(el.dataset.cls);
    });
  }
}
function openLightbox(p) {
  const clsZh = p.clsZh ?? photoLayer.taxonomy[p.cls]?.zh ?? p.cls;
  $("#lb-img").src = p.file;
  $("#lb-info").innerHTML = \`
    <h3>\${p.nearZh ? T(p.nearZh) : T("實景照片")}</h3>
    <div class="lb-cls">\${T(clsZh)}\${p.conf ? \` · 信心 \${Math.round(p.conf * 100)}%\` : ""}\${p.manual ? T(" · 手動標註") : ""}</div>
    \${p.caption ? \`<p>\${p.caption}</p>\` : \`<p style="color:var(--ink-dim)">\${T("尚未產生建築解讀（可執行 tools/photo-archive 產線或手動填寫 labels.csv）")}</p>\`}
    \${(p.tags ?? []).length ? \`<div class="photo-tags">\${p.tags.map((t) => \`<span>\${t}</span>\`).join("")}</div>\` : ""}
    <dl>
      \${p.taken ? \`<dt>拍攝</dt><dd>\${new Date(p.taken).toLocaleString("zh-TW")}</dd>\` : ""}
      \${p.device ? \`<dt>裝置</dt><dd>\${p.device}</dd>\` : ""}
      <dt>座標</dt><dd>\${p.lat?.toFixed(5) ?? ""}, \${p.lon?.toFixed(5) ?? ""}</dd>
      \${p.nearZh ? \`<dt>位置</dt><dd>距 \${p.nearZh} \${p.nearDist} 公尺</dd>\` : ""}
      \${p.building ? \`<dt>建築</dt><dd>\${p.building}</dd>\` : ""}
      \${p.style ? \`<dt>風格</dt><dd>\${p.style}</dd>\` : ""}
      \${p.clsWhy ? \`<dt>分類依據</dt><dd>\${p.clsWhy}</dd>\` : ""}
      \${p.credit ? \`<dt>來源</dt><dd>\${p.credit}</dd>\` : ""}
    </dl>\`;
  $("#lightbox").classList.add("on");
  $("#lightbox").setAttribute("aria-hidden", "false");
}
$("#lb-close").addEventListener("click", () => { $("#lightbox").classList.remove("on"); $("#lightbox").setAttribute("aria-hidden", "true"); });
$("#lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox") $("#lb-close").click(); });
window.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#lightbox").classList.contains("on")) $("#lb-close").click(); });
$("#tg-photos").addEventListener("change", async (e) => {
  if (e.target.checked) await ensurePhotos();
  photoLayer.setVisible(e.target.checked);
});

// ---------------------------------------------------------------- 語音（朗讀與語音輸入）`
);
// 景點詳情面板：加入「實景照片」相簿
m = m.replace(
  `    <div class="d-actions">\${actions.join("")}</div>\`;`,
  `    \${nearPhotos.length ? \`<div class="d-section"><h3>\${T("實景照片")} · \${nearPhotos.length}</h3>
      <div class="d-photos">\${nearPhotos.map((x) => \`<img src="\${x.p.thumb}" alt="\${T(x.p.clsZh ?? "")}" title="\${T(x.p.clsZh ?? "")}｜\${Math.round(x.distM)}m" data-photo="\${x.p.id}" />\`).join("")}</div>
    </div>\` : ""}
    <div class="d-actions">\${actions.join("")}</div>\`;`
);
m = m.replace(
  `  const elev = state.data.elevation?.attractionElevations?.[a.id];`,
  `  const nearPhotos = photosReady ? photoLayer.near(a.coords, 250) : [];
  const elev = state.data.elevation?.attractionElevations?.[a.id];`
);
m = m.replace(
  `  $("#detail-body").querySelector('[data-act="model"]')?.addEventListener("click", () => openModelFor(a, a.model));`,
  `  for (const img of $("#detail-body").querySelectorAll("[data-photo]")) {
    img.addEventListener("click", () => {
      const hit = photoLayer.photos.find((f) => f.properties.id === img.dataset.photo);
      if (hit) openLightbox(hit.properties);
    });
  }
  $("#detail-body").querySelector('[data-act="model"]')?.addEventListener("click", () => openModelFor(a, a.model));`
);
// 有照片時，出發前先確保載入
m = m.replace(
  `async function select(a, { fly = false } = {}) {
  if (!a) return;`,
  `async function select(a, { fly = false } = {}) {
  if (!a) return;
  if (!photosReady) { try { await ensurePhotos(); } catch { /* 沒有照片也沒關係 */ } }`
);
fs.writeFileSync("src/main.js", m);
console.log("main.js：已接上實景照片圖層、相簿與大圖檢視");
