// 建築檔案頁：記憶點檔案（整理好的實拍相冊）＋ 我的普查檔案（本機 SQLite）。
// 普查檔案直接沿用辨識頁的 ledger.js / db.js，資料存在同一個瀏覽器儲存區，兩頁看到的是同一份；
// 這一頁不載入任何辨識模型，打開就能看。
import "../styles.css";
import "../recognize/recognize.css";
import "./archive.css";
import { escapeMemoryText as esc } from "../memory-photo.js";
import { openDb, onStorageChange, countBuildings } from "../recognize/db.js";
import { createLedger } from "../recognize/ledger.js";

const $ = (s) => document.querySelector(s);

function toast(msg, ms = 3600) {
  const el = $("#rc-toast");
  el.textContent = msg;
  el.classList.add("on");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("on"), ms);
}

// ---------------------------------------------------------------- 記憶點檔案
async function loadPlaces() {
  const cards = $("#archive-cards");
  try {
    const res = await fetch("./data/system-catalog.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const catalog = await res.json();
    $("#archive-place-count").textContent = catalog.places.length;
    const render = (query = "") => {
      const q = query.trim();
      const places = catalog.places.filter((p) => `${p.name} ${p.categoryName}`.includes(q));
      $("#archive-empty").hidden = places.length !== 0;
      cards.innerHTML = places.map((p) => `<a class="archive-card" href="./memory.html?place=${encodeURIComponent(p.id)}">
        <img src="${esc(p.cover)}" loading="lazy" alt="${esc(p.name)}實拍" />
        <span class="archive-card-body"><small>${esc(p.categoryName)} · ${p.photoCount} 張照片</small><strong>${esc(p.name)}</strong><span>${esc(p.summary)}</span></span>
      </a>`).join("");
    };
    render();
    $("#archive-search").addEventListener("input", (e) => render(e.target.value));
  } catch (e) {
    cards.innerHTML = `<p class="archive-empty">記憶點檔案載入失敗（${esc(e.message)}），請重新整理。</p>`;
  }
}

// ---------------------------------------------------------------- 我的普查檔案
const ledger = createLedger({ onNotice: toast });
const updateSurveyCount = () => {
  try { $("#archive-survey-count").textContent = countBuildings(); } catch { /* 資料庫未就緒時保留「—」 */ }
};

openDb()
  .then(() => { ledger.init(); updateSurveyCount(); })
  .catch((e) => {
    toast(`普查資料庫無法開啟：${e.message}`, 8000);
    ledger.init();
  });
onStorageChange(() => { ledger.refresh(); updateSurveyCount(); });

void loadPlaces();
