// 全站語言與無障礙設定：套用導覽列「文A」面板的選擇，存在這台裝置的瀏覽器（localStorage）。
// 語言：切換導覽列文字與 <html lang>，並發出 "tujian:lang" 事件，讓各頁自行翻譯內文。
// 放大文字、減少動態：在 <html> 加 data 屬性，由 site-nav.css 套用。
const KEY = "tujian.prefs";
const LANGS = { "zh-Hant": "zh", "zh-Hans": "hans", en: "en", pt: "pt" };

function read() {
  try { return { lang: "zh-Hant", largeText: false, reduceMotion: false, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; }
  catch { return { lang: "zh-Hant", largeText: false, reduceMotion: false }; }
}
function save(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* 私密瀏覽等情況：只在本頁生效 */ } }

function apply(p) {
  const root = document.documentElement;
  const field = LANGS[p.lang] ? p.lang : "zh-Hant";
  root.lang = field === "pt" ? "pt" : field;
  root.toggleAttribute("data-large-text", !!p.largeText);
  root.toggleAttribute("data-reduce-motion", !!p.reduceMotion);
  for (const a of document.querySelectorAll(".site-links a[data-zh], .site-dock a[data-zh]")) a.textContent = a.dataset[LANGS[field]] || a.dataset.zh;
  for (const r of document.querySelectorAll('input[name="site-lang"]')) r.checked = r.value === field;
  for (const c of document.querySelectorAll("input[data-pref]")) c.checked = !!p[c.dataset.pref];
  window.dispatchEvent(new CustomEvent("tujian:lang", { detail: { lang: field } }));
}

const prefs = read();
apply(prefs);
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.name === "site-lang") prefs.lang = t.value;
  else if (t.dataset?.pref) prefs[t.dataset.pref] = t.checked;
  else return;
  save(prefs); apply(prefs);
});
// 點面板外面時收起
document.addEventListener("click", (e) => {
  for (const d of document.querySelectorAll("details.site-prefs[open]")) if (!d.contains(e.target)) d.open = false;
});

export const getPrefs = () => ({ ...prefs });
