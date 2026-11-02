// 全站共用導覽：純字串、不碰 DOM，讓 vite.config.js 在開發與建置時直接寫進每個 HTML
// （頁面打開就有導覽，不會先空白再由 JS 補上）。
// 各頁 HTML 用標記指定位置：
//   <site-nav current="memory">頁面專屬按鈕</site-nav>   → 頂部導覽列（內容會放在右側）
//   <site-nav current="gaussian" overlay></site-nav>      → 疊在全螢幕畫布上的導覽列
//   <site-dock current="map"></site-dock>                 → 地圖首頁底部的浮動入口

export const SITE_PAGES = [
  { id: "map", href: "./", file: "index.html", zh: "三維地圖", hans: "三维地图", en: "3D Map", pt: "Mapa 3D" },
  { id: "recognize", href: "./recognize.html", file: "recognize.html", zh: "拍照辨識", hans: "拍照辨识", en: "Recognize", pt: "Reconhecer" },
  { id: "archive", href: "./archive.html", file: "archive.html", zh: "建築檔案", hans: "建筑档案", en: "Archive", pt: "Arquivo" },
  { id: "memory", href: "./memory.html", file: "memory.html", zh: "共創記憶", hans: "共创记忆", en: "Memories", pt: "Memórias" },
  { id: "gaussian", href: "./gaussian.html", file: "gaussian.html", zh: "實景記憶", hans: "实景记忆", en: "3D Scene", pt: "Cena 3D" },
  { id: "explore", href: "./system.html", file: "system.html", zh: "文化探索", hans: "文化探索", en: "Explore", pt: "Explorar" },
  { id: "capture", href: "./capture.html", file: "capture.html", zh: "資料選圖", hans: "资料选图", en: "Capture", pt: "Recolha" },
];

export const BRAND = { zh: "途見", en: "TUJIAN" };

// 品牌標誌：蓮花 A（幾何五瓣＋中心點，docs/logo-test.png 實測 22px 仍可辨識）的向量版。
// 小尺寸時線條相對變細，所以依尺寸加粗筆畫。
const PETAL = "M16 11.4C10.6 9.6 10.9 4.6 16 1.6 21.1 4.6 21.4 9.6 16 11.4Z";
export function lotusSvg(size = 26, { cls = "site-mark", color = "currentColor" } = {}) {
  const stroke = size <= 24 ? 2.1 : size <= 48 ? 1.9 : 1.6;
  const petals = [0, 72, 144, 216, 288].map((a) => `<path d="${PETAL}"${a ? ` transform="rotate(${a} 16 16)"` : ""}/>`).join("");
  return `<svg class="${cls}" viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true">`
    + `<g fill="none" stroke="${color}" stroke-width="${stroke}" stroke-miterlimit="8">${petals}</g>`
    + `<circle cx="16" cy="16" r="2.3" fill="${color}"/></svg>`;
}
export const BRAND_MARK = lotusSvg(26);
export const FAVICON_LINK = `<link rel="icon" type="image/svg+xml" href="./brand/favicon.svg" />`;

const links = (current, pages) => pages.map((p) =>
  `<a href="${p.href}"${p.id === current ? ' aria-current="page"' : ""} data-zh="${p.zh}" data-hans="${p.hans}" data-en="${p.en}" data-pt="${p.pt}">${p.zh}</a>`).join("");

// 語言與無障礙設定（導覽列右側）：純 HTML，由 src/site-prefs.js 套用並記住選擇
const PREFS = `<details class="site-prefs"><summary aria-label="語言與無障礙設定 Language and accessibility">文A</summary><div class="site-prefs-panel">`
  + `<fieldset><legend>語言 Language</legend>`
  + [["zh-Hant", "繁體中文"], ["zh-Hans", "简体中文"], ["en", "English"], ["pt", "Português"]]
    .map(([v, l]) => `<label><input type="radio" name="site-lang" value="${v}"> ${l}</label>`).join("")
  + `</fieldset><fieldset><legend>閱讀 Reading</legend>`
  + `<label><input type="checkbox" data-pref="largeText"> 放大文字 Larger text</label>`
  + `<label><input type="checkbox" data-pref="reduceMotion"> 減少動態 Reduce motion</label>`
  + `</fieldset><p class="site-prefs-note">English／Português 目前翻譯導覽列，頁面內文翻譯進行中。</p></div></details>`;

export function siteNavHtml(current, { extra = "", overlay = false } = {}) {
  if (current && !SITE_PAGES.some((p) => p.id === current)) throw new Error(`Unknown site page: ${current}`);
  return `<header class="site-nav${overlay ? " site-nav--overlay" : ""}">`
    + `<a class="site-brand" href="./" aria-label="${BRAND.zh} ${BRAND.en}：回到三維地圖">${BRAND_MARK}<span><strong>${BRAND.zh}</strong><small>${BRAND.en}</small></span></a>`
    + `<nav class="site-links" aria-label="網站導覽">${links(current, SITE_PAGES)}</nav>`
    + (extra.trim() ? `<div class="site-nav-extra">${extra}</div>` : "")
    + PREFS
    + `</header>`
    + (current ? CENTER_CURRENT : "");
}

// 手機上連結會橫向捲動；把目前頁面捲到中間，否則排在後面的頁面一打開就看不到自己在哪
const CENTER_CURRENT = `<script>(function(){var h=document.currentScript.previousElementSibling,l=h&&h.querySelector(".site-links"),a=l&&l.querySelector("[aria-current]");if(a&&l.scrollWidth>l.clientWidth)l.scrollLeft=a.offsetLeft-l.offsetLeft-(l.clientWidth-a.offsetWidth)/2;})()</script>`;

// 首頁本身就是地圖，底部入口不再重複列出「三維地圖」；資料選圖是製作工具，留在其他頁的頂部導覽
export function siteDockHtml(current = "map") {
  const pages = SITE_PAGES.filter((p) => p.id !== current && p.id !== "capture");
  return `<nav class="site-dock" aria-label="網站導覽">${links(current, pages)}</nav>`;
}

/**
 * 把 HTML 裡的 <site-nav> / <site-dock> / <site-mark size="40"> 標記換成實際內容，
 * 並把各頁的網頁圖示統一成品牌圖示；沒有任何標記的 HTML 原樣回傳。
 */
export function injectSiteNav(html) {
  let found = false;
  const attr = (attrs, name) => new RegExp(`\\b${name}(?:="([^"]*)")?`).exec(attrs);
  let out = html.replace(/<site-nav\b([^>]*)>([\s\S]*?)<\/site-nav>/g, (_, attrs, extra) => {
    found = true;
    return siteNavHtml(attr(attrs, "current")?.[1], { extra, overlay: !!attr(attrs, "overlay") });
  });
  out = out.replace(/<site-dock\b([^>]*)><\/site-dock>/g, (_, attrs) => {
    found = true;
    return siteDockHtml(attr(attrs, "current")?.[1]);
  });
  out = out.replace(/<site-mark\b([^>]*)><\/site-mark>/g, (_, attrs) => lotusSvg(Number(attr(attrs, "size")?.[1]) || 26, { cls: "brand-lotus" }));
  if (!found) return out;
  if (!out.includes("/src/site-nav.css")) out = out.replace("</head>", `  <link rel="stylesheet" href="/src/site-nav.css" />\n  </head>`);
  if (!out.includes("/src/site-prefs.js")) out = out.replace("</head>", `  <script type="module" src="/src/site-prefs.js"></script>
  </head>`);
  out = out.replace(/\s*<link rel="icon"[^>]*>/g, "");
  return out.replace("</head>", `  ${FAVICON_LINK}\n  </head>`);
}
