"""產生「離線可用的 90 秒現場演示頁」。

為什麼要生成而不是手寫：示範頁必須**完全離線**（展場網路不可靠），
所以要把真實的產線資料（photo-archive.json）與澳門邊界內嵌進單一 HTML，
用相對路徑引用 public/photos 的照片（file:// 下 <img> 可正常載入）。

用法：
    python tools/demo/build_demo.py
產出：
    tools/demo/index.html      ← 雙擊即可用瀏覽器開啟（file:// 也能跑）
    tools/demo/README.md       ← 操作與話術說明
"""
from __future__ import annotations

import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT_HTML = ROOT / "tools" / "demo" / "index.html"
PHOTO_BASE = "../../public/photos"

# 只看得到這幾個既有記憶點（示範用：先有兩棟，再讓評審看「新增」與「併入」兩種情況）
PRELOADED = ["MM-0001", "MM-0003"]

# 示範腳本：每一步的旁白與要展示的資料（數值全部取自 photo-archive.json 的真實輸出）
SCRIPT = [
    dict(
        key="intro", seconds=10, title="開場：澳門的建築，一棟一號",
        narr="地圖上已經有兩個記憶點——每一棟建築有一個永久編號，不是每張照片一個點。現在我們在街上再拍一張。",
        phone=None,
    ),
    dict(
        key="shot_a", place="MM-0001", photo=1, seconds=22,
        title="拍照 ①：同一棟的另一個角度",
        narr="手機拍一張大三巴，GPS 與時間自動寫進 EXIF。",
        steps=["exif", "face", "embed", "geo", "match", "file"],
    ),
    dict(
        key="shot_b", place="MM-0004", photo=0, seconds=22,
        title="拍照 ②：另一棟建築",
        narr="換一棟——澳門科學館。這次系統應該要建立新的記憶點。",
        steps=["exif", "face", "embed", "geo", "match", "file"],
    ),
    dict(
        key="why", seconds=16, title="為什麼閾值是 0.86？",
        narr="同棟換角度 0.90±0.04、不同棟 0.76±0.07，AUC 0.950；0.86 落在兩者之間的空隙。",
        phone=None,
    ),
    dict(
        key="gps", seconds=20, title="關鍵：地理先驗把誤判直接排除",
        narr="所有誤判都發生在路氹城三間相似的度假村之間——它們相距至少 296 公尺，90 公尺的 GPS 先驗一律排除。",
        phone=None,
    ),
]


def load_data():
    archive = json.loads((ROOT / "public" / "data" / "photo-archive.json").read_text(encoding="utf-8"))
    places = {p["id"]: p for p in archive["places"]}

    # 邊界：抽成純座標陣列，座標取到小數 4 位以縮小檔案
    boundary = json.loads((ROOT / "public" / "data" / "macau-boundary.geojson").read_text(encoding="utf-8"))
    polys = []
    for f in boundary.get("features", []):
        geom = f.get("geometry") or {}
        if geom.get("type") == "Polygon":
            rings = geom["coordinates"]
        elif geom.get("type") == "MultiPolygon":
            rings = [r for poly in geom["coordinates"] for r in poly]
        else:
            continue
        for ring in rings:
            if len(ring) < 4:
                continue
            polys.append([[round(c[0], 4), round(c[1], 4)] for c in ring])
    polys.sort(key=len, reverse=True)
    polys = polys[:24]

    # YOLO／隱私處理的實測結果（由 tools/photo-archive/verify_detector.py 產生）
    yolo_map = {}
    ycheck = ROOT / "tools" / "eval" / "out" / "yolo-check.json"
    if ycheck.exists():
        try:
            for r in json.loads(ycheck.read_text(encoding="utf-8")).get("results", []):
                key = r["file"].replace("public/", "")   # 對齊 photo-archive.json 的相對路徑
                yolo_map[key] = dict(
                    objects=r.get("objects") or {},
                    privacy_method=r.get("privacy_method", "?"),
                    blurred=r.get("blurred", 0),
                    faces=r.get("faces", 0),
                    persons=r.get("persons", 0),
                )
        except Exception as e:
            print(f"[warn] 讀不到 yolo-check.json：{e}")

    demo = dict(
        generated=archive.get("generated"),
        preloaded=PRELOADED,
        places=[places[i] for i in PRELOADED if i in places],
        all_places=[p for p in archive["places"]],
        boundary=polys,
        script=SCRIPT,
        yolo=yolo_map,
    )
    return demo


HTML = """<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<title>建築記憶點 · 90 秒現場演示（離線）</title>
<style>
  :root{
    --ink:#0f2033; --ink2:#16324d; --gold:#c8a24a; --teal:#2a7f8f; --red:#c0392b;
    --paper:#f6f4ef; --panel:#ffffff; --line:#d9d3c7; --grey:#5c6670;
  }
  *{box-sizing:border-box}
  html,body{margin:0;height:100%;background:#0b1622;color:#eef2f6;
    font-family:"Microsoft JhengHei","Microsoft YaHei",system-ui,sans-serif;overflow:hidden}
  #app{display:flex;flex-direction:column;height:100%}
  header{display:flex;align-items:center;gap:18px;padding:14px 24px;background:var(--ink);
    border-bottom:3px solid var(--gold)}
  header h1{margin:0;font-size:26px;letter-spacing:1px}
  header .sub{font-size:14px;color:#9fb0c0}
  header .badge{margin-left:auto;background:var(--teal);padding:6px 12px;border-radius:4px;font-size:13px;font-weight:700}
  header .badge.warn{background:#7a5c12}
  main{flex:1;display:grid;grid-template-columns:340px 440px 1fr;gap:14px;padding:14px;min-height:0}
  .card{background:var(--ink2);border:1px solid #24405c;border-radius:10px;padding:14px;min-height:0;display:flex;flex-direction:column}
  .card h2{margin:0 0 10px;font-size:15px;color:var(--gold);letter-spacing:1px;font-weight:700}
  /* 流程 */
  ol.steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
  ol.steps li{display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:8px;
    background:#0e2438;border:1px solid #1d3a55;font-size:14px;color:#93a6b8;transition:.25s}
  ol.steps li .dot{width:18px;height:18px;border-radius:50%;background:#26425e;flex:0 0 auto;
    display:flex;align-items:center;justify-content:center;font-size:11px;color:#0b1622;font-weight:700}
  ol.steps li.active{background:#12374d;border-color:var(--teal);color:#eaf6ff;transform:translateX(4px)}
  ol.steps li.active .dot{background:var(--teal);color:#fff}
  ol.steps li.done .dot{background:#2f9e6b;color:#fff}
  ol.steps li small{display:block;color:#7d92a5;font-size:12px;margin-top:2px}
  /* 手機 */
  .phone{background:#fbfaf7;border-radius:16px;padding:12px;color:#1b2b3a;overflow:auto;flex:1}
  .phone .shot{width:100%;border-radius:10px;display:block;background:#e8e5df;aspect-ratio:4/3;object-fit:cover}
  .phone .exif{font-size:12.5px;color:#5c6670;margin:8px 0 10px;line-height:1.5;font-family:Consolas,monospace}
  .phone .row{display:flex;gap:8px;align-items:flex-start;padding:8px 10px;border-radius:8px;background:#fff;
    border:1px solid var(--line);margin-bottom:7px;font-size:13.5px;animation:in .28s ease}
  .phone .row b{color:#0f2033}
  .phone .row .ico{flex:0 0 auto;width:20px;text-align:center}
  .phone .row.hit{background:#eaf6ef;border-color:#9fd3b4}
  .phone .row.new{background:#fff6e6;border-color:#e6cf9a}
  .phone .id{font-family:Consolas,monospace;font-weight:700;color:var(--red)}
  .phone .cap{font-size:13px;line-height:1.6;color:#2b3a48;background:#fff;border:1px solid var(--line);
    border-radius:8px;padding:9px 11px}
  .phone .tl{display:flex;gap:6px;margin-top:8px}
  .phone .tl img{width:31%;border-radius:6px;border:1px solid var(--line)}
  @keyframes in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
  /* 地圖 */
  .mapwrap{position:relative;flex:1;min-height:0}
  svg.map{width:100%;height:100%;display:block;background:#0d1c2b;border-radius:10px}
  .mk{cursor:pointer}
  .mk circle.halo{fill:rgba(42,127,143,.18);stroke:#2a7f8f;stroke-width:.6}
  .mk circle.core{fill:#c0392b;stroke:#fff;stroke-width:1}
  .mk text{fill:#e9eef4;font-size:3.4px;font-weight:700}
  .mk.dim circle.core{fill:#516273}
  .ring{fill:none;stroke:#c8a24a;stroke-width:.8;stroke-dasharray:2 1.6}
  .resort{fill:#31465c;stroke:#5d7793;stroke-width:.4}
  .resort-label{fill:#8fa3b8;font-size:3px}
  .pulse{animation:pulse 1.6s ease-out 3}
  @keyframes pulse{0%{r:2;opacity:1}100%{r:12;opacity:0}}
  .legend{position:absolute;left:10px;bottom:10px;background:rgba(11,22,34,.86);border:1px solid #24405c;
    border-radius:8px;padding:8px 10px;font-size:12px;color:#a9bccd;line-height:1.6}
  .narr{position:absolute;right:10px;top:10px;max-width:62%;background:rgba(200,162,74,.94);color:#20160a;
    border-radius:8px;padding:10px 13px;font-size:15px;font-weight:700;line-height:1.5;box-shadow:0 4px 14px rgba(0,0,0,.3)}
  .narr.hide{display:none}
  /* 控制列 */
  .ctrl{margin-top:10px;display:flex;gap:10px;align-items:center}
  button{flex:1;padding:12px 10px;border-radius:8px;border:1px solid #2b4a68;background:#16324d;color:#eaf2f8;
    font-size:15px;font-weight:700;cursor:pointer;font-family:inherit}
  button:hover{background:#1d4062}
  button.primary{background:var(--gold);color:#20160a;border-color:var(--gold)}
  button.primary:hover{background:#d8b45f}
  .hint{font-size:12px;color:#7d92a5;margin-top:6px;text-align:center}
  .detail{display:none}
  body.detail .detail{display:block}
  .kpis{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}
  .kpi{background:#0e2438;border:1px solid #1d3a55;border-radius:8px;padding:7px 9px;font-size:12px;color:#9fb3c6}
  .kpi b{display:block;font-size:16px;color:#eaf6ff}
  .hidden{display:none}
</style>
</head>
<body>
<div id="app">
  <header>
    <h1>建築記憶點 <span class="sub">Building Face-ID · 90 秒現場演示</span></h1>
    <span class="badge" id="mode">示範重播 · 產線實際輸出</span>
    <span class="badge warn" id="prov">測試素材為 3D 模型截圖（非實拍）</span>
  </header>
  <main>
    <section class="card">
      <h2>① 歸戶流程</h2>
      <ol class="steps" id="steps"></ol>
      <div class="ctrl" style="margin-top:auto">
        <button id="btnDetail">答辯細節</button>
      </div>
      <div class="kpis detail" id="kpis"></div>
    </section>

    <section class="card">
      <h2>② 手機（拍照現場）</h2>
      <div class="phone" id="phone">
        <div class="cap">按下方「開始 90 秒示範」，或按空白鍵逐步前進。</div>
      </div>
    </section>

    <section class="card">
      <h2>③ 記憶點地圖（澳門）</h2>
      <div class="mapwrap">
        <svg class="map" id="map" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet"></svg>
        <div class="narr hide" id="narr"></div>
        <div class="legend">
          <div><span style="color:#c0392b">●</span> 記憶點（一棟一號）　
               <span style="color:#c8a24a">◌</span> 90 m 地理先驗範圍</div>
          <div><span style="color:#5d7793">▬</span> 路氹城相似度假村群（誤判來源）</div>
        </div>
      </div>
      <div class="ctrl">
        <button class="primary" id="btnRun">▶ 開始 90 秒示範</button>
        <button id="btnNext">下一步</button>
        <button id="btnReset">重播</button>
      </div>
      <div class="hint">空白鍵＝下一步　R＝重播　D＝答辯細節　F＝全螢幕</div>
    </section>
  </main>
</div>

<script type="application/json" id="data">__DATA__</script>
<script>
const DATA = JSON.parse(document.getElementById('data').textContent);
const PLACES = Object.fromEntries(DATA.all_places.map(p => [p.id, p]));
const state = { created: new Set(DATA.preloaded), photos: {}, step: 0, timer: null };

/* ---------- 地理投影 ---------- */
const BBOX = { lon0: 113.525, lon1: 113.600, lat0: 22.103, lat1: 22.222 };
const W = 100, H = 100 * ((BBOX.lat1 - BBOX.lat0) / ((BBOX.lon1 - BBOX.lon0) * Math.cos(22.16 * Math.PI / 180)));
function proj(lon, lat) {
  const x = (lon - BBOX.lon0) / (BBOX.lon1 - BBOX.lon0) * W;
  const y = (BBOX.lat1 - lat) / (BBOX.lat1 - BBOX.lat0) * H;
  return [x, y];
}
const METER_PER_DEG_LON = 111320 * Math.cos(22.16 * Math.PI / 180);
function ringRadiusMeters(m) { return m / METER_PER_DEG_LON / (BBOX.lon1 - BBOX.lon0) * W; }

/* ---------- 地圖繪製 ---------- */
const RESORTS = [
  { zh: '澳門銀河', lon: 113.5543, lat: 22.1466 },
  { zh: '澳門倫敦人', lon: 113.5571, lat: 22.1460 },
  { zh: '澳門巴黎人', lon: 113.5607, lat: 22.1437 },
];
function drawMap() {
  const svg = document.getElementById('map');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const paths = DATA.boundary.map(ring => {
    const d = ring.map((c, i) => (i ? 'L' : 'M') + proj(c[0], c[1]).map(v => v.toFixed(2)).join(' ')).join(' ') + ' Z';
    return `<path d="${d}" fill="#16293c" stroke="#3c5876" stroke-width=".35"/>`;
  }).join('');
  const resorts = RESORTS.map(r => {
    const [x, y] = proj(r.lon, r.lat);
    return `<g class="resort-g"><rect class="resort" x="${x - 1.5}" y="${y - 1.1}" width="3" height="2.2" rx=".4"/>
      <text class="resort-label" x="${x + 2}" y="${y + .9}">${r.zh}</text></g>`;
  }).join('');
  svg.innerHTML = `<g id="layerBase">${paths}${resorts}</g><g id="layerPts"></g>`;
  renderPoints();
}
function renderPoints() {
  const layer = document.getElementById('layerPts');
  layer.innerHTML = DATA.all_places.map(p => {
    const on = state.created.has(p.id);
    const [x, y] = proj(p.coords[0], p.coords[1]);
    const n = (state.photos[p.id] || (on ? 1 : 0));
    if (!on) return '';
    return `<g class="mk" data-id="${p.id}" transform="translate(${x} ${y})">
      <circle class="core" r="1.5"></circle>
      <text x="2.6" y="1.2">${p.id} ${p.zh}${n > 1 ? ' ×' + n : ''}</text>
    </g>`;
  }).join('');
}
function showRing(place, meters) {
  const layer = document.getElementById('layerPts');
  const [x, y] = proj(place.coords[0], place.coords[1]);
  const r = ringRadiusMeters(meters);
  layer.insertAdjacentHTML('beforeend',
    `<circle class="ring" cx="${x}" cy="${y}" r="${r}"/>`);
}
function pulse(place) {
  const layer = document.getElementById('layerPts');
  const [x, y] = proj(place.coords[0], place.coords[1]);
  layer.insertAdjacentHTML('beforeend',
    `<circle class="pulse" cx="${x}" cy="${y}" r="2" fill="none" stroke="#c0392b" stroke-width=".7"/>`);
}

/* ---------- 流程清單 ---------- */
const FLOW = [
  ['exif', '① EXIF 讀取', 'GPS 與拍攝時間'],
  ['face', '② YOLO 物件偵測', '隱私模糊（Haar 不可用 → yolo-person）'],
  ['embed', '③ CLIP 視覺嵌入', '512 維影像向量'],
  ['geo', '④ 地理先驗', '90 m 內既有記憶點作為候選'],
  ['match', '⑤ 相似度驗證', '餘弦相似度比對'],
  ['file', '⑥ 建檔／歸戶', '永久編號 + DeepSeek 解讀'],
];
function renderSteps(active) {
  const last = active.length ? active[active.length - 1] : null;
  document.getElementById('steps').innerHTML = FLOW.map(([k, t, s], i) => {
    const on = active.includes(k);
    const cls = on ? (k === last ? 'active' : 'done') : '';
    const dot = on && k !== last ? '✓' : (i + 1);
    return `<li class="${cls}"><span class="dot">${dot}</span><span>${t}<small>${s}</small></span></li>`;
  }).join('');
}

/* ---------- 手機卡片 ---------- */
function phoneIdle(text) {
  document.getElementById('phone').innerHTML = `<div class="cap">${text}</div>`;
}
function phoneShot(place, photoIdx, extra = '') {
  const ph = place.photos[photoIdx];
  const img = `__PHOTO_BASE__/${ph.file.replace('photos/', '')}`;
  document.getElementById('phone').innerHTML =
    `<img class="shot" src="${img}" alt="${place.zh}">
     <div class="exif">EXIF  GPS ${place.coords[1].toFixed(6)}, ${place.coords[0].toFixed(6)}
時間 ${place.firstSeen.replace('T', ' ').slice(0, 19)}
檔案 ${ph.file.split('/').pop()}</div>
     <div id="rows">${extra}</div>`;
}
function addRow(html, cls = '') {
  const rows = document.getElementById('rows');
  if (!rows) return;
  rows.insertAdjacentHTML('beforeend', `<div class="row ${cls}">${html}</div>`);
}
function phoneResult(place, photoIdx) {
  const ph = place.photos[photoIdx];
  const sim = ph.similarity;
  const merge = ph.decision === 'merge';
  addRow(`<span class="ico">${merge ? '🔗' : '🆕'}</span><span><b>${merge ? '併入既有記憶點' : '建立新記憶點'}</b>
    <span class="id">${place.id}</span> ${place.zh}` +
    (sim ? `<br>餘弦相似度 <b>${sim.toFixed(3)}</b> ≥ 0.86 → 同一棟` : '<br>90 m 內沒有既有記憶點 → 新建') + `</span>`,
    merge ? 'hit' : 'new');
  addRow(`<span class="ico">🧠</span><span><b>${place.cls}</b>（${(place.conf * 100).toFixed(0)}%，來源：${place.clsSource}）
    <br><span style="color:#5c6670">${place.clsWhy}</span></span>`);
  addRow(`<span class="ico">📝</span><span>${place.caption.slice(0, 120)}…</span>`);
  const tl = place.photos.map(p => `<img src="__PHOTO_BASE__/${p.file.replace('photos/', '')}">`).join('');
  addRow(`<span class="ico">🗂️</span><span><b>這棟建築的時間軸</b>（共 ${place.photos.length} 張）<div class="tl">${tl}</div></span>`);
}

/* ---------- 示範排程 ---------- */
function narration(text) {
  const n = document.getElementById('narr');
  if (!text) { n.classList.add('hide'); return; }
  n.textContent = text; n.classList.remove('hide');
}
function reset() {
  stop(); state.created = new Set(DATA.preloaded); state.photos = {}; state.step = 0;
  renderSteps([]); renderPoints(); phoneIdle('按下方「開始 90 秒示範」，或按空白鍵逐步前進。');
  narration('');
  document.getElementById('btnRun').textContent = '▶ 開始 90 秒示範';
  runStep(0);
}
function nextStep() { state.step = Math.min(state.step + 1, DATA.script.length); runStep(state.step); }
function runStep(i) {
  if (i >= DATA.script.length) { narration('示範結束——觀眾可以自己拍一張試試（現場實機）。'); return; }
  const sc = DATA.script[i];
  narration(sc.narr);
  if (sc.key === 'intro') { renderSteps([]); renderPoints();
    phoneIdle(`地圖上已有 <b>${DATA.preloaded.join('、')}</b> 兩個記憶點。<br>接下來拍兩張照片，看系統怎麼判斷「新的一棟」或「同一棟」。`);
    return; }
  if (sc.key === 'why') { renderSteps([]); phoneIdle('同棟換角度 <b>0.90 ± 0.04</b>、不同棟 <b>0.76 ± 0.07</b>，AUC <b>0.950</b>；0.86 落在兩者的空隙。');
    return; }
  if (sc.key === 'gps') { renderSteps([]);
    RESORTS.forEach(r => showRing({ coords: [r.lon, r.lat] }, 90));
    phoneIdle('三間相似的度假村相距 <b>≥ 296 m</b>；90 m 的地理先驗把它們全部排除，視覺比對只需判斷同一棟的不同角度。');
    return; }
  // 拍照步驟：依序揭示六個步驟（每一步都對應真實資料欄位）
  const place = PLACES[sc.place];
  const ph = place.photos[sc.photo];
  state.created.add(place.id);
  state.photos[place.id] = (state.photos[place.id] || 0) + 1;
  phoneShot(place, sc.photo);
  renderSteps(['exif']);

  const candidate = ph.similarity ? `1 個（${place.id} ${place.zh}）` : '0 個';
  const y = (DATA.yolo || {})[ph.file] || null;
  const objTxt = y ? (Object.keys(y.objects || {}).length
      ? Object.entries(y.objects).map(([k, v]) => `${k}×${v}`).join('、')
      : '未偵測到物件') : '未實測';
  const privTxt = y ? `${y.privacy_method}，模糊 ${y.blurred} 處` : '未實測';
  const marks = [
    ['face', `<span class="ico">🧑‍💻</span><span>YOLO 物件偵測（實測）：<b>${objTxt}</b>
      <br><span style="color:#5c6670">隱私處理：${privTxt}；測試圖為 3D 渲染，對 YOLO 屬分布外</span></span>`],
    ['embed', `<span class="ico">🧮</span><span>CLIP ViT-B/32 → <b>512 維</b>影像向量</span>`],
    ['geo', `<span class="ico">📍</span><span>地理先驗：90 m 內候選 <b>${candidate}</b></span>`],
    ['match', `<span class="ico">📐</span><span>相似度比對：${ph.similarity ? '<b>' + ph.similarity.toFixed(3) + '</b>' : '無候選可比對'}</span>`],
  ];
  marks.forEach(([key, html], i) => {
    setTimeout(() => {
      addRow(html);
      renderSteps(FLOW.slice(0, FLOW.findIndex(f => f[0] === key) + 1).map(f => f[0]));
    }, 900 + i * 1200);
  });
  setTimeout(() => {
    renderSteps(['exif', 'face', 'embed', 'geo', 'match', 'file']);
    phoneResult(place, sc.photo);
    pulse(place); renderPoints();
    if (ph.similarity) showRing(place, 90);
  }, 900 + marks.length * 1200 + 400);
}
function stop() { if (state.timer) { clearTimeout(state.timer); clearInterval(state.timer); state.timer = null; } }
function runAuto() {
  stop(); reset(); state.step = 0;
  const advance = () => {
    const sc = DATA.script[state.step];
    if (!sc) { document.getElementById('btnRun').textContent = '▶ 重播示範'; return; }
    runStep(state.step);
    state.timer = setTimeout(() => {
      state.step += 1;
      if (state.step >= DATA.script.length) {
        narration('示範結束——歡迎到攤位自己拍一張，現場實機再跑一次。');
        document.getElementById('btnRun').textContent = '▶ 重播示範';
        return;
      }
      advance();
    }, (sc.seconds || 12) * 1000);
  };
  document.getElementById('btnRun').textContent = '⏸ 進行中…';
  advance();
}

/* ---------- 控制 ---------- */
document.getElementById('btnRun').addEventListener('click', runAuto);
document.getElementById('btnNext').addEventListener('click', () => { stop(); nextStep(); });
document.getElementById('btnReset').addEventListener('click', reset);
document.getElementById('btnDetail').addEventListener('click', () => document.body.classList.toggle('detail'));
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); stop(); nextStep(); }
  if (e.key === 'r' || e.key === 'R') reset();
  if (e.key === 'd' || e.key === 'D') document.body.classList.toggle('detail');
  if (e.key === 'f' || e.key === 'F') {
    if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen();
  }
});

/* ---------- 答辯細節 KPI ---------- */
document.getElementById('kpis').innerHTML = `
  <div class="kpi"><b>AUC 0.950</b>受控多視角重辨識</div>
  <div class="kpi"><b>86.1% / 12.2%</b>閾值 0.86 認出率／誤判率</div>
  <div class="kpi"><b>0.901 / 0.758</b>同棟／不同棟平均相似度</div>
  <div class="kpi"><b>0%</b>度假村群以外的誤判率</div>
  <div class="kpi"><b>140 張</b>受控渲染資料集（7 模型 × 20 視角）</div>
  <div class="kpi"><b>0.66</b>渲染↔地圖截圖跨域相似度</div>`;

drawMap();
reset();
</script>
</body>
</html>
"""


def main():
    data = load_data()
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    html_out = (HTML
                .replace("__DATA__", payload)
                .replace("__PHOTO_BASE__", PHOTO_BASE))
    OUT_HTML.parent.mkdir(parents=True, exist_ok=True)
    OUT_HTML.write_text(html_out, encoding="utf-8")
    kb = OUT_HTML.stat().st_size / 1024
    print(f"[demo] {OUT_HTML.relative_to(ROOT)}  ({kb:.0f} KB, 內嵌 {len(data['all_places'])} 個記憶點、"
          f"{len(data['boundary'])} 個邊界環、{len(data['script'])} 幕腳本)")
    print("[demo] 直接用瀏覽器開啟即可（file:// 可離線執行）")


if __name__ == "__main__":
    main()
