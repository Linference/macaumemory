// 全站語言與無障礙設定：套用導覽列「文A」面板的選擇，存在這台裝置的瀏覽器（localStorage）。
// 語言：切換導覽列文字與 <html lang>，並發出 "tujian:lang" 事件，讓各頁自行翻譯內文。
// 放大文字、減少動態：在 <html> 加 data 屬性，由 site-nav.css 套用。
import { PERSONAS, AGES, GENDERS } from "./personas.js";
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
  for (const r of document.querySelectorAll('input[name="site-persona"]')) r.checked = r.value === p.persona;
  for (const r of document.querySelectorAll('input[name="site-age"]')) r.checked = r.value === p.age;
  for (const r of document.querySelectorAll('input[name="site-gender"]')) r.checked = r.value === (p.gender || "unspecified");
  if (p.persona) root.dataset.persona = p.persona;
  window.dispatchEvent(new CustomEvent("tujian:lang", { detail: { lang: field } }));
}

const prefs = read();
apply(prefs);
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.name === "site-lang") prefs.lang = t.value;
  else if (t.name === "site-persona") prefs.persona = t.value;
  else if (t.name === "site-age") prefs.age = t.value;
  else if (t.name === "site-gender") prefs.gender = t.value;
  else if (t.dataset?.pref) prefs[t.dataset.pref] = t.checked;
  else return;
  save(prefs); apply(prefs);
});
// 點面板外面時收起
document.addEventListener("click", (e) => {
  for (const d of document.querySelectorAll("details.site-prefs[open]")) if (!d.contains(e.target)) d.open = false;
});

export const getPrefs = () => ({ ...prefs });

// 第一次進入網站：先選身份。可按「先隨便看看」略過（以旅客方式講解），之後在「文A」面板隨時更改。
function chooser() {
  if (prefs.persona || typeof document === "undefined" || !document.body || document.querySelector(".persona-gate")) return;
  const dlg = document.createElement("dialog");
  dlg.className = "persona-gate";
  dlg.setAttribute("aria-labelledby", "persona-gate-title");
  dlg.innerHTML = `<form method="dialog" class="pg-inner">
    <header class="pg-head"><p class="pg-kicker">途見 · TUJIAN</p><h2 id="persona-gate-title">你以誰的身份<br>走進澳門？</h2>
      <p class="pg-sub">導覽員「小澳」會按你的身份決定怎樣講。事實只來自有出處的資料，不因身份而改變。</p></header>
    <div class="pg-opts">
      <fieldset><legend>年齡（可選）</legend>${Object.entries(AGES).map(([v, a]) => `<label><input type="radio" name="pg-age" value="${v}"><span>${a.label}</span></label>`).join("")}</fieldset>
      <fieldset><legend>性別（可選，只用於稱呼，不改變內容）</legend>${Object.entries(GENDERS).map(([v, g]) => `<label><input type="radio" name="pg-gender" value="${v}"${v === "unspecified" ? " checked" : ""}><span>${g.label}</span></label>`).join("")}</fieldset>
      <p class="pg-privacy">年齡與性別只存在這部裝置的瀏覽器，提問時只傳送年齡段，不會保存。</p>
    </div>
    <ol class="pg-list">${Object.entries(PERSONAS).map(([v, p], i) => `<li><button value="${v}" type="submit"><span class="pg-no">${String(i + 1).padStart(2, "0")}</span><span class="pg-name"><b>${p.label}</b><i>${p.en}</i></span><span class="pg-gist">${p.gist}</span><span class="pg-arrow" aria-hidden="true">→</span></button></li>`).join("")}</ol>
    <footer class="pg-foot"><span>之後可在導覽列「文A」更改</span><button class="pg-skip" value="tourist" type="submit">略過，以旅客身份瀏覽</button></footer></form>`;
  // 直接處理按鈕提交（部分瀏覽器在背景分頁不觸發 dialog 的 close 事件）
  dlg.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = e.submitter?.value;
    prefs.persona = PERSONAS[v] ? v : "tourist";
    const age = dlg.querySelector('input[name="pg-age"]:checked')?.value, gender = dlg.querySelector('input[name="pg-gender"]:checked')?.value;
    if (AGES[age]) prefs.age = age; if (GENDERS[gender]) prefs.gender = gender;
    save(prefs); apply(prefs);
    try { dlg.close(); } catch { /* ignore */ }
    dlg.remove();
  });
  dlg.addEventListener("cancel", (e) => e.preventDefault());
  document.body.append(dlg);
  try { dlg.showModal(); } catch { dlg.setAttribute("open", ""); }
}
if (typeof document !== "undefined") { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", chooser); else chooser(); }
