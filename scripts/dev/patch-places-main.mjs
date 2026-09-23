import fs from "node:fs";
// main.js：改為記憶點（含照片時間軸的大圖檢視）
let m = fs.readFileSync("src/main.js", "utf8");
const start = m.indexOf("// ---------------------------------------------------------------- 實景照片");
const end = m.indexOf("// ---------------------------------------------------------------- 語音（朗讀與語音輸入）");
if (start < 0 || end <= start) throw new Error("找不到實景照片區塊");

const block = `// ---------------------------------------------------------------- 澳門記憶 · 記憶點
const photoLayer = new PhotoLayer(map, { onOpen: (p, i) => openLightbox(p, i) });
let photosReady = false;
async function ensurePhotos() {
  if (photosReady) return photoLayer;
  try {
    await photoLayer.load();
    photosReady = true;
    $("#lb-photos").textContent = \`記憶點 (\${photoLayer.count})\`;
    renderPhotoChips();
    // 把記憶點掛到對應的景點標記上（DOM 標記會蓋住地圖點，這是主要入口）
    const byNear = new Map();
    for (const f of photoLayer.places) {
      const nid = f.properties?.nearId;
      if (nid) byNear.set(nid, (byNear.get(nid) ?? 0) + 1);
    }
    for (const a of attractions) a.photoCount = byNear.get(a.id) ?? 0;
    markerLayer.setData(attractions);
    markerLayer.setActive(state.selected?.id ?? null);
  } catch (e) {
    console.warn("places:", e);
    toast(T("目前沒有記憶點（請用 tools/photo-archive 產線加入照片）"));
  }
  return photoLayer;
}
function renderPhotoChips() {
  const box = $("#photo-chips");
  if (!box) return;
  const used = new Map();
  for (const f of photoLayer.places) used.set(f.properties.cls, (used.get(f.properties.cls) ?? 0) + 1);
  box.innerHTML = [...used.entries()].map(([cls, n]) => {
    const t = photoLayer.taxonomy[cls] ?? { zh: cls, color: "#d8b45a" };
    return \`<button class="poi-chip" data-cls="\${cls}"><span class="poi-dot" style="background:\${t.color}"></span>\${T(t.zh)} \${n}</button>\`;
  }).join("");
  for (const el of box.querySelectorAll(".poi-chip")) {
    el.addEventListener("click", () => { el.classList.toggle("off"); photoLayer.setFilter(el.dataset.cls); });
  }
}
/** 記憶點卡片：大圖 + 照片時間軸 + 建築解讀 + 完整檔案 */
function openLightbox(p, idx = 0) {
  const photos = p.photos ?? [];
  const cur = photos[idx] ?? photos[0] ?? {};
  const clsZh = p.clsZh ?? photoLayer.taxonomy[p.cls]?.zh ?? p.cls;
  $("#lb-img").src = cur.file ?? p.cover;
  const strip = photos.length > 1 ? \`
    <h4 style="margin:16px 0 7px;font-size:11.5px;letter-spacing:.12em;color:var(--gold)">\${T("這棟建築的")}\${photos.length}\${T("張照片")}</h4>
    <div class="d-photos lb-strip">\${photos.map((ph, i) => \`<img src="\${ph.thumb}" data-i="\${i}" class="\${i === idx ? "on" : ""}" title="\${ph.taken ? new Date(ph.taken).toLocaleString("zh-TW") : ""}\${ph.similarity ? " · 相似度 " + ph.similarity : ""}" />\`).join("")}</div>\` : "";
  $("#lb-info").innerHTML = \`
    <div class="lb-id">\${p.id}\${p.needsReview ? \` <span class="place-warn">\${T("待複核")}</span>\` : ""}</div>
    <h3>\${p.zh ?? T("未命名建築")}</h3>
    <div class="lb-cls">\${T(clsZh)}\${p.conf ? \` · 信心 \${Math.round(p.conf * 100)}%\` : ""}\${p.clsSource === "manual" ? T(" · 手動標註") : ""}</div>
    \${p.caption ? \`<p>\${p.caption}</p>\` : \`<p style="color:var(--ink-dim)">\${T("尚未產生建築解讀")}</p>\`}
    \${(p.tags ?? []).length ? \`<div class="photo-tags">\${p.tags.map((t) => \`<span>\${t}</span>\`).join("")}</div>\` : ""}
    \${strip}
    <dl>
      <dt>座標</dt><dd>\${p.lon != null ? \`\${p.lon.toFixed(5)}, \${p.lat.toFixed(5)}\` : ""}</dd>
      \${p.firstSeen ? \`<dt>首次</dt><dd>\${new Date(p.firstSeen).toLocaleString("zh-TW")}</dd>\` : ""}
      \${p.lastSeen && p.lastSeen !== p.firstSeen ? \`<dt>最近</dt><dd>\${new Date(p.lastSeen).toLocaleString("zh-TW")}</dd>\` : ""}
      \${cur.taken ? \`<dt>本張</dt><dd>\${new Date(cur.taken).toLocaleString("zh-TW")}\${cur.similarity ? \` · 相似度 \${cur.similarity}\` : ""}</dd>\` : ""}
      \${cur.device ? \`<dt>裝置</dt><dd>\${cur.device}</dd>\` : ""}
      \${p.nearZh ? \`<dt>鄰近</dt><dd>\${p.nearZh}</dd>\` : ""}
      \${p.building ? \`<dt>建築</dt><dd>\${p.building}</dd>\` : ""}
      \${p.style ? \`<dt>風格</dt><dd>\${p.style}</dd>\` : ""}
      \${p.clsWhy ? \`<dt>分類依據</dt><dd>\${p.clsWhy}</dd>\` : ""}
      \${cur.credit ? \`<dt>來源</dt><dd>\${cur.credit}</dd>\` : ""}
    </dl>\`;
  $("#lightbox").classList.add("on");
  $("#lightbox").setAttribute("aria-hidden", "false");
  for (const img of $("#lb-info").querySelectorAll(".lb-strip img")) {
    img.addEventListener("click", () => openLightbox(p, +img.dataset.i));
  }
}
$("#lb-close").addEventListener("click", () => { $("#lightbox").classList.remove("on"); $("#lightbox").setAttribute("aria-hidden", "true"); });
$("#lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox") $("#lb-close").click(); });
window.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#lightbox").classList.contains("on")) $("#lb-close").click(); });
$("#tg-photos").addEventListener("change", async (e) => {
  if (e.target.checked) await ensurePhotos();
  photoLayer.setVisible(e.target.checked);
});

`;
m = m.slice(0, start) + block + m.slice(end);
// 景點面板：記憶點相簿（含編號）
m = m.replace(
  `  const nearPhotos = photosReady ? photoLayer.near(a.coords, 250) : [];`,
  `  const nearPlaces = photosReady ? photoLayer.near(a.coords, 250) : [];`
);
m = m.replace(
  `    \${nearPhotos.length ? \`<div class="d-section"><h3>\${T("實景照片")} · \${nearPhotos.length}</h3>
      <div class="d-photos">\${nearPhotos.map((x) => \`<img src="\${x.p.thumb}" alt="\${T(x.p.clsZh ?? "")}" title="\${T(x.p.clsZh ?? "")}｜\${Math.round(x.distM)}m" data-photo="\${x.p.id}" />\`).join("")}</div>
    </div>\` : ""}`,
  `    \${nearPlaces.length ? \`<div class="d-section"><h3>\${T("澳門記憶 · 記憶點")} · \${nearPlaces.length}</h3>
      <div class="d-photos">\${nearPlaces.map((x) => \`<img src="\${x.p.coverThumb}" alt="\${x.p.id}" title="\${x.p.id} \${x.p.zh ?? ""}｜\${x.p.photoCount} 張｜\${Math.round(x.distM)}m" data-place="\${x.p.id}" />\`).join("")}</div>
    </div>\` : ""}`
);
m = m.replace(
  `  for (const img of $("#detail-body").querySelectorAll("[data-photo]")) {
    img.addEventListener("click", () => {
      const hit = photoLayer.photos.find((f) => f.properties.id === img.dataset.photo);
      if (hit) openLightbox(hit.properties);
    });
  }`,
  `  for (const img of $("#detail-body").querySelectorAll("[data-place]")) {
    img.addEventListener("click", () => {
      const hit = photoLayer.places.find((f) => f.properties.id === img.dataset.place);
      if (hit) openLightbox(hit.properties, 0);
    });
  }`
);
fs.writeFileSync("src/main.js", m);
console.log("main.js：已改為記憶點版本");
