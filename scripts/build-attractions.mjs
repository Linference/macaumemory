// 合併人工整理景點資料與外部圖資，產出 public/data/attractions.json
// 座標解析：以「名稱相似度 + 多來源共識」決定，優先吸附到同名建築物
import fs from "node:fs";
import path from "node:path";
import { DATA, writeJson, toMeters } from "./lib.mjs";
import { ATTRACTIONS, MUSEUMS, ARTIFACTS, CATEGORIES } from "./attractions.data.mjs";

const dist = (a, b) => Math.hypot(toMeters(a)[0] - toMeters(b)[0], toMeters(a)[1] - toMeters(b)[1]);
const clean = (o) => { const r = {}; for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") r[k] = v; return r; };
const norm = (s) => (s ?? "").toString().toLowerCase().replace(/[\s（）()【】・·．.,，、\-—_/&'"：:；;！!？?]/g, "");
/** 去掉地名前綴，讓「路環譚公廟」可以與「譚公廟」比對 */
const strip = (s) => norm(s).replace(/^(澳門|路環|氹仔|路氹|九澳|黑沙|macau|macao|taipa|coloane|lai chi vun|hac sa)/, "");

/** 名稱相似度：0（不相關）～ 1（完全相同） */
function nameSim(poiName, candNames) {
  let best = 0;
  const p = strip(poiName);
  if (!p || p.length < 2) return 0;
  const cjkTokens = (str) => (String(str).match(/[\u3400-\u9fff]{2,}/g) ?? []);
  const pCjk = cjkTokens(poiName);
  for (const cand of candNames) {
    const c = strip(cand);
    if (!c || c.length < 2) continue;
    if (p === c) { best = Math.max(best, 1); continue; }
    const cCjk = cjkTokens(cand);
    // ① 中文詞級比對：任一方以「完整詞」出現於另一方（例如「譚公廟」對「譚僊聖廟 (譚公廟) …」）
    let tokenHit = 0;
    for (const t of pCjk) if (t.length >= 3 && cCjk.includes(t)) tokenHit = Math.max(tokenHit, t.length);
    for (const t of cCjk) if (t.length >= 3 && pCjk.includes(t)) tokenHit = Math.max(tokenHit, t.length);
    if (tokenHit) { best = Math.max(best, 0.92); continue; }
    // ② 整串中文包含（需達一定比例，避免「博物館」誤配「海事博物館行政大樓」）
    const pj = pCjk.join(""), cj = cCjk.join("");
    if (pj.length >= 2 && cj.length >= 2) {
      if (pj === cj) { best = Math.max(best, 1); continue; }
      const sC = pj.length <= cj.length ? pj : cj;
      const lC = pj.length <= cj.length ? cj : pj;
      if (lC.includes(sC)) {
        const ratio = sC.length / lC.length;
        best = Math.max(best, ratio >= 0.5 ? 0.85 : 0.3);
        continue;
      }
    }
    // ③ 一般字串比對（中英混合或純拉丁名稱）
    const short = p.length <= c.length ? p : c;
    const long = p.length <= c.length ? c : p;
    if (long.includes(short)) {
      if (short.length < 3) continue;
      const ratio = short.length / long.length;
      const isPrefix = long.startsWith(short);
      best = Math.max(best, isPrefix ? (ratio >= 0.5 ? 0.78 : 0.3) : ratio >= 0.4 ? 0.8 : 0.4);
      continue;
    }
    const A = new Set(p), B = new Set(c);
    let common = 0;
    for (const ch of A) if (B.has(ch)) common++;
    const jac = common / (A.size + B.size - common);
    best = Math.max(best, jac >= 0.85 ? 0.65 : jac * 0.4);
  }
  return best;
}

// ---------------- 外部圖資 ----------------
const readJson = (f, fb) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : fb);
const POI_FULL = path.join(DATA, "macau-pois.geojson");
const POI_FULL_CACHE = path.join(process.cwd(), ".cache", "macau-pois-full.geojson");
if (!fs.existsSync(POI_FULL) && fs.existsSync(POI_FULL_CACHE)) fs.copyFileSync(POI_FULL_CACHE, POI_FULL);
const pois = readJson(fs.existsSync(POI_FULL) ? POI_FULL : POI_FULL_CACHE, { features: [] }).features ?? [];
const buildings = readJson(path.join(DATA, "macau-buildings.geojson"), { features: [] }).features ?? [];
const geocode = readJson(path.join(process.cwd(), ".cache", "geocode.json"), { attractions: {}, museums: {} });

const landuse = readJson(path.join(DATA, "macau-landuse.geojson"), { features: [] }).features ?? [];
const boundaries = readJson(path.join(DATA, "macau-boundary.geojson"), { features: [] }).features ?? [];
const roads = readJson(path.join(DATA, "macau-roads.geojson"), { features: [] }).features ?? [];

const PARISH_FIX = { "花地瑪堂區": "花地瑪堂區", "花王堂區": "花王堂區", "望德堂區": "望德堂區", "大堂區": "大堂區", "風順堂區": "風順堂區", "嘉模堂區": "氹仔（嘉模堂區）", "聖方濟各堂區": "路環（聖方濟各堂區）", "路氹填海區": "路氹填海區" };

// 澳門堂區範圍（用來過濾掉珠海／橫琴的標籤）
const parishRings = [];
for (const f of boundaries) {
  if (f.properties.k !== "parish") continue;
  const name = f.properties.n ?? "";
  if (!Object.keys(PARISH_FIX).some((k) => name.includes(k))) continue;
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) for (const ring of poly) parishRings.push(ring);
}
const inMacauPoly = (lon, lat) => {
  let hit = false;
  for (const ring of parishRings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
};

const AREA_OK = /^(park|garden|national_park|nature_reserve|beach|sand|forest|wood|grass|grassland|recreation_ground|playground|pitch|wetland|bare_rock|mountain)$/i;
const areaList = [];
for (const f of landuse) {
  const n = f.properties?.n;
  const cls = f.properties?.c ?? "";
  if (!n || !f.geometry || !AREA_OK.test(cls)) continue;
  areaList.push({ name: n, ring: f.geometry.coordinates[0], cls, coords: null });
}
console.log(`有名稱的公園／沙灘多邊形 ${areaList.length} 個`);

/** 點是否在多邊形內（射線法） */
function inPoly(ring, lon, lat) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
/** 多邊形質心（外環頂點平均） */
function centroid(ring) {
  let cx = 0, cy = 0;
  for (const p of ring) { cx += p[0]; cy += p[1]; }
  return [cx / ring.length, cy / ring.length];
}
/** 取多邊形內「離參考點最近」的位置：參考點在多邊形內時即為參考點，否則取邊界最近點 */
function nearestInPoly(ring, ref) {
  if (inPoly(ring, ref[0], ref[1])) return ref.slice();
  let best = null, bestD = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((ref[0] - a[0]) * dx + (ref[1] - a[1]) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = a[0] + t * dx, py = a[1] + t * dy;
    const dd = dist([px, py], ref);
    if (dd < bestD) { bestD = dd; best = [px, py]; }
  }
  return best;
}

const bldList = [], poiList = [], poiAllList = [];
const UTILITY = /公廁|廁所|變電站|開關站|泵站|垃圾|污水|雨水|停車場|停車|巴士站|候車|sanitário|substação|toilet|pump station|car ?park/i;
for (const f of buildings) {
  const n = f.properties?.n;
  if (!n || !f.geometry) continue;
  if (UTILITY.test(n)) continue;
  bldList.push({ name: n, ring: f.geometry.coordinates[0], h: f.properties.h });
}
const POI_OK = /landmark|museum|attraction|tour|park|garden|beach|church|temple|cathedral|chapel|monument|mountain|lake|casino|hotel|resort|theatre|cinema|library|univers|college|school|hospital|government|structure|ferry|bus_station|airport|station|square|plaza|market|bridge|stadium|heritage|historic|viewpoint|memorial|fountain|tower|observatory|ruins/i;
for (const f of pois) {
  if (f.geometry?.type !== "Point") continue;
  const cls = f.properties?.c ?? "";
  poiAllList.push({ coords: f.geometry.coordinates });
  poiList.push({ name: f.properties?.n ?? f.properties?.zh, cname: f.properties?.zh, coords: f.geometry.coordinates, c: cls, ok: POI_OK.test(cls), conf: f.properties?.conf ?? null });
}
console.log(`讀入 POI ${poiList.length}、有名稱建築 ${bldList.length}、權威座標 ${Object.values(geocode.attractions ?? {}).filter((r) => r?.coords).length}`);

// ---------------- 座標解析 ----------------
function resolve(item, geoRecord) {
  const names = [item.zh, item.en, item.pt, item.wiki].filter(Boolean);
  const curated = item.coords;
  const cands = [];
  const near = (c, maxD) => dist(c, curated) <= maxD;

  for (const b of bldList) {
    const s = nameSim(b.name, names);
    if (s < 0.7) continue;
    const c = b.center ?? (b.center = centroid(b.ring));
    if (!c || dist(c, curated) > 2000) continue;
    cands.push({ src: "building", coords: c, ref: b.name, w: s >= 0.98 ? 9.6 : s >= 0.9 ? 9.2 : 8 * s, s, d: dist(c, curated) });
  }
  for (const ar of areaList) {
    const s = nameSim(ar.name, names);
    if (s < 0.75) continue;
    const c = ar.center ?? (ar.center = centroid(ar.ring));
    if (!c || dist(c, curated) > 2500) continue;
    cands.push({ src: "area", coords: c, ref: ar.name, w: s >= 0.9 ? 9.3 : 8.5 * s, s, d: dist(c, curated) });
  }
  for (const p of poiList) {
    if (!near(p.coords, 700)) continue;
    const s = Math.max(nameSim(p.name ?? "", names), nameSim(p.cname ?? "", names));
    if (!p.ok && s < 0.95) continue; // 非地標類別僅接受「完全同名」
    const d = dist(p.coords, curated);
    // 距離人工座標較遠的 POI 必須獲得其他來源佐證才會勝出（商家點位常有偏差）
    if (s >= 0.95) cands.push({ src: "poi-exact", coords: p.coords, ref: p.name ?? p.cname, w: 8.5, s, d });
    else if (s >= 0.75) cands.push({ src: d <= 200 ? "poi-exact" : "poi-far", coords: p.coords, ref: p.name ?? p.cname, w: d <= 200 ? 6 : 1.5, s, d });
    else if (s >= 0.6 && d <= 120) cands.push({ src: "poi-near", coords: p.coords, ref: p.name ?? p.cname, w: 3.2, s, d });
  }
  if (geoRecord?.coords) {
    const dGeo = dist(geoRecord.coords, curated);
    const agreeWithCand = cands.some((c) => dist(c.coords, geoRecord.coords) <= 220);
    // 附近若有 2 個以上 POI（不分類別）也視為佐證，例如度假村內的商店群
    const poiSupport = poiAllList.filter((p) => dist(p.coords, geoRecord.coords) <= 200).length >= 2;
    const agree = dGeo <= 200 || agreeWithCand || poiSupport;
    cands.push({ src: geoRecord.source, coords: geoRecord.coords, ref: geoRecord.ref, w: agree ? 4.5 : 1.2, s: agree ? 1 : 0.3, d: dGeo, poiSupport });
  }
  // 與權威座標位置相符的候選額外加權（權威座標本身可信度見上）
  if (geoRecord?.coords) {
    for (const c of cands) {
      if (c.src === geoRecord.source) continue;
      if (dist(c.coords, geoRecord.coords) <= 150) c.w += 2;
    }
  }
  cands.push({ src: "curated", coords: curated, ref: null, w: 2, s: 0, d: 0 });

  // 加權：來源權重 + 與其他來源的共識票數
  for (const c of cands) {
    let votes = 0;
    for (const o of cands) if (o !== c && dist(o.coords, c.coords) <= 150) votes += 1;
    c.votes = votes;
    c.total = c.w + votes * 1.6;
  }
  if (process.env.DEBUG_ATTRACTION && (item.id === process.env.DEBUG_ATTRACTION || item.zh === process.env.DEBUG_ATTRACTION)) {
    console.log("\n[debug]", item.zh);
    for (const c of cands) console.log("   ", c.src.padEnd(18), c.ref ? String(c.ref).slice(0, 30).padEnd(32) : "-".padEnd(32), c.coords.map((v) => v.toFixed(5)).join(", "), "w=" + c.w.toFixed(1), "votes=" + (c.votes ?? 0), "total=" + (c.total ?? 0).toFixed(1));
  }
  cands.sort((a, b) => b.total - a.total);
  let win = cands[0];
  // 防呆：與人工座標差距超過 350 公尺又無其他來源佐證時，退回人工座標（同名建築除外）
  const trusted = win.src === "building" || win.src === "area" ? win.s >= 0.75 : (win.votes > 0 || win.poiSupport === true);
  if (win.src !== "curated" && win.d > 250 && !trusted) {
    win = cands.find((c) => c.src === "curated") ?? win;
  }
  return {
    coords: win.coords.map((v) => +v.toFixed(6)),
    geoSource: win.src,
    geoRef: win.ref ?? null,
    wikidata: geoRecord?.wikibase ?? null,
    coordMovedMeters: win.src === "curated" ? 0 : Math.round(win.d),
    geoEvidence: cands.slice(0, 3).map((c) => `${c.src}${c.ref ? ":" + String(c.ref).slice(0, 14) : ""}(${c.total.toFixed(1)})`).join(" > "),
  };
}

const report = [];
const attractions = ATTRACTIONS.map((a) => {
  const r = resolve(a, geocode.attractions?.[a.id]);
  report.push({ id: a.id, zh: a.zh, ...r });
  return { ...a, coords: r.coords, geoSource: r.geoSource, geoRef: r.geoRef, wikidata: r.wikidata, coordMovedMeters: r.coordMovedMeters, geoEvidence: r.geoEvidence };
});

const museums = MUSEUMS.map((m) => {
  const r = resolve({ ...m, zh: m.name, coords: m.coords }, geocode.museums?.[m.id]);
  report.push({ id: `museum-${m.id}`, zh: m.name, ...r });
  const artifacts = m.artifactIds.map((id) => ARTIFACTS.find((x) => x.id === id)).filter(Boolean);
  return { ...m, coords: r.coords, artifacts, geoSource: r.geoSource, geoRef: r.geoRef, coordMovedMeters: r.coordMovedMeters, geoEvidence: r.geoEvidence };
});

const museumAttractions = museums.map((m) => ({
  id: `museum-${m.id}`, cat: "museum", coords: m.coords, zh: m.name, en: m.en, pt: m.namePt, museumId: m.id,
  tag: "博物館文物", brief: m.brief, detail: m.detail, website: m.website,
  geoSource: m.geoSource, geoRef: m.geoRef, coordMovedMeters: m.coordMovedMeters, geoEvidence: m.geoEvidence,
}));
const seenIds = new Set(museumAttractions.map((a) => a.id));
const dedup = attractions.filter((a) => !(a.museumId && seenIds.has(`museum-${a.museumId}`)));

const out = {
  generated: new Date().toISOString(),
  attribution: [
    "地圖資料 © OpenStreetMap 貢獻者（ODbL 1.0）· Overture Maps Foundation",
    "海拔資料 Copernicus DEM GLO-30 © DLR e.V. / Airbus DS，經 OpenTopography 提供",
    "地形圖磚 Terrain Tiles（AWS Open Data / Mapzen，terrarium 編碼）",
    "景點座標參考 Wikipedia / Wikidata（CC0）與 OpenStreetMap 建築圖資交叉比對",
    "文物三維模型由使用者提供，僅供學習研究使用",
  ],
  categories: CATEGORIES,
  attractions: [...dedup, ...museumAttractions],
  museums,
  elevation: readJson(path.join(DATA, "macau-elevation.json"), null),
  osmStats: readJson(path.join(DATA, "macau-stats.json"), null),
};
// ---------------- 周邊設施（POI）精簡版：只留名稱與分組，縮小檔案 ----------------
const POI_GROUP = [
  ["eat", /restaurant|fast_food|food|cafe|coffee|bakery|dessert|ice_cream|bar\b|pub|bistro|diner|tea_room|noodle|snack|bbq|hotpot|buffet|steakhouse|pizzeria|sushi|dim_sum|dessert_shop|juice|bubble_tea|patisserie/i],
  ["stay", /hotel|hostel|motel|resort|guest_house|guesthouse|apartment_hotel|accommodation|pousada/i],
  ["shop", /shop|store|mall|supermarket|market|boutique|department|convenience|bakery_shop|pharmacy_shop|shopping_center|shopping_mall|bookstore|jewelry|clothing|electronics|souvenir|gift/i],
  ["culture", /museum|library|theatre|theater|cinema|art_gallery|art_museum|landmark|monument|memorial|historic|heritage|temple|church|cathedral|chapel|mosque|shrine|gallery|science_museum|history_museum|attraction|tourist/i],
  ["medical", /hospital|clinic|pharmac|doctor|dental|health|medical|emergency/i],
  ["school", /school|univers|college|kindergarten|library_school|educat|institute|academy|training/i],
  ["gov", /government|police|fire_station|post_office|townhall|public_service|courthouse|embassy|immigration|customs|consulate/i],
  ["transport", /bus|ferry|airport|station|parking|taxi|port\b|pier|terminal|tram|metro|light_rail|helipad/i],
  ["fun", /casino|entertainment|karaoke|nightclub|spa\b|gym|fitness|sport|bowling|betting|gambling|theme_park|zoo|beach_resort|marina|golf/i],
];
const groupOf = (c) => {
  const cls = String(c ?? "");
  if (cls.length <= 2) return "other"; // 單字母/簡碼類別無意義，一律略過
  return (POI_GROUP.find(([, re]) => re.test(cls)) ?? ["other"])[0];
};
const poiLite = { type: "FeatureCollection", name: "澳門周邊設施 (Overture/OSM)", features: [] };
let poiSkipped = 0, poiNoClass = 0;
for (const f of pois) {
  const p = f.properties ?? {};
  const n = p.n;
  if (!n || !f.geometry) continue;
  const [plon, plat] = f.geometry.coordinates;
  if (!inMacauPoly(plon, plat)) { poiSkipped++; continue; } // 只保留澳門境內
  const grp = groupOf(p.c);
  if (grp === "other") { poiNoClass++; continue; }          // 無法歸類者不顯示
  poiLite.features.push({
    type: "Feature",
    properties: { n, g: grp, k: p.c ?? "", h: p.h === 1 ? 1 : undefined },
    geometry: { type: "Point", coordinates: f.geometry.coordinates.map((v) => +v.toFixed(5)) },
  });
}
console.log(`周邊設施：保留 ${poiLite.features.length} 筆（排除澳門境外 ${poiSkipped}、無法歸類 ${poiNoClass}）`);
writeJson(path.join(DATA, "macau-pois-lite.geojson"), poiLite);
// 完整 POI 檔只留在 .cache（體積 2 MB 且含境外資料），避免打進 dist
if (fs.existsSync(POI_FULL)) { fs.copyFileSync(POI_FULL, POI_FULL_CACHE); fs.rmSync(POI_FULL); console.log("已將完整 POI 檔移出 public（保留於 .cache/macau-pois-full.geojson）"); }

// ---------------- 地圖文字標籤：堂區／區域／公園／主要街道 ----------------
const REGIONS = [
  { t: "澳門半島", c: [113.5455, 22.1995], z: 11.4, p: 10 },
  { t: "氹仔", c: [113.5575, 22.1590], z: 11.8, p: 9 },
  { t: "路氹城", c: [113.5630, 22.1450], z: 12.2, p: 8 },
  { t: "路環", c: [113.5545, 22.1180], z: 11.8, p: 9 },
  { t: "珠海市", c: [113.5450, 22.2225], z: 11.4, p: 5 },
  { t: "橫琴", c: [113.5230, 22.1150], z: 11.8, p: 5 },
];
const cjkOnly = (str) => {
  const cjk = String(str).match(/[\u3400-\u9fff]+/g) ?? [];
  const joined = cjk.join("");
  return joined.length >= 2 ? joined.slice(0, 14) : String(str).slice(0, 16);
};
const labelFeats = [];
for (const r of REGIONS) labelFeats.push({ type: "Feature", properties: { t: r.t, k: "region", z: r.z, p: r.p }, geometry: { type: "Point", coordinates: r.c } });
for (const f of boundaries) {
  if (f.properties.k !== "parish") continue;
  const name = f.properties.n ?? "";
  const key = Object.keys(PARISH_FIX).find((k) => name.includes(k));
  if (!key) continue;
  const poly = f.geometry.type === "Polygon" ? f.geometry.coordinates : f.geometry.coordinates[0];
  const ring = poly[0];
  let cx = 0, cy = 0;
  for (const p of ring) { cx += p[0]; cy += p[1]; }
  labelFeats.push({ type: "Feature", properties: { t: PARISH_FIX[key], k: "district", z: 12.4, p: 6 }, geometry: { type: "Point", coordinates: [+(cx / ring.length).toFixed(5), +(cy / ring.length).toFixed(5)] } });
}
const ringArea = (ring) => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(a / 2);
};
const parkCandidates = [];
for (const f of landuse) {
  const n = f.properties?.n;
  const cls = f.properties?.c ?? "";
  if (!n || !/^(park|garden|national_park|nature_reserve|beach)$/i.test(cls)) continue;
  const poly = f.geometry.type === "Polygon" ? f.geometry.coordinates : f.geometry.coordinates[0];
  const ring = poly[0];
  let cx = 0, cy = 0;
  for (const p of ring) { cx += p[0]; cy += p[1]; }
  const c = [+(cx / ring.length).toFixed(5), +(cy / ring.length).toFixed(5)];
  if (!inMacauPoly(c[0], c[1])) continue;
  const areaKm2 = ringArea(ring) * 111.32 * 110.57 * Math.cos(22.16 * Math.PI / 180);
  const short = String(n).split(/[（(]/)[0].trim();
  if (!/海灘|沙灘|郊野|公園|花園|市政|圓形地|水塘|濕地/i.test(short) && areaKm2 < 0.02) continue;
  if (/休憩區|自由波地|兒童遊樂|公廁/.test(short) && areaKm2 < 0.05) continue;
  parkCandidates.push({ name: short, c, cls, areaKm2 });
}
parkCandidates.sort((a, b) => b.areaKm2 - a.areaKm2);
for (const p of parkCandidates.slice(0, 80)) {
  labelFeats.push({ type: "Feature", properties: { t: cjkOnly(p.name), k: /beach/i.test(p.cls) ? "beach" : "park", z: 13.8, p: 4 }, geometry: { type: "Point", coordinates: p.c } });
}
// 主要街道：同名的取最長一段，且落在澳門範圍
const byName = new Map();
for (const f of roads) {
  const { c, n } = f.properties ?? {};
  if (!n || !["motorway", "trunk", "primary", "secondary"].includes(c)) continue;
  const coords = f.geometry.coordinates;
  const mid = coords[Math.floor(coords.length / 2)];
  if (!inMacauPoly(mid[0], mid[1])) continue;
  const len = coords.length;
  const prev = byName.get(n);
  if (!prev || len > prev.len) byName.set(n, { n, len, mid, c });
}
const streetRank = { motorway: 3, trunk: 3, primary: 2, secondary: 1 };
for (const { n, mid, c } of byName.values()) {
  labelFeats.push({ type: "Feature", properties: { t: cjkOnly(n), k: "street", z: c === "secondary" ? 15.2 : 14.4, p: streetRank[c] ?? 1 }, geometry: { type: "Point", coordinates: [+mid[0].toFixed(5), +mid[1].toFixed(5)] } });
}
writeJson(path.join(DATA, "macau-labels.geojson"), { type: "FeatureCollection", name: "澳門地圖標籤", features: labelFeats });
console.log(`標籤：區域 ${REGIONS.length}、堂區/公園/街道共 ${labelFeats.length} 個`);

writeJson(path.join(DATA, "attractions.json"), out, { pretty: true });

console.log(`\n景點 ${out.attractions.length}、博物館 ${museums.length}、文物 ${ARTIFACTS.length}`);
const bySource = {};
for (const a of out.attractions) bySource[a.geoSource] = (bySource[a.geoSource] ?? 0) + 1;
console.log("座標來源：" + Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("、"));
console.log("\n位移最大的 20 個景點：");
for (const r of report.slice().sort((a, b) => b.coordMovedMeters - a.coordMovedMeters).slice(0, 20)) {
  console.log(`  ${r.zh.padEnd(20)} ${String(r.coordMovedMeters).padStart(4)}m  ${r.coords.join(", ").padEnd(22)} ${r.geoSource.padEnd(16)} ← ${r.geoEvidence}`);
}
fs.writeFileSync(path.join(DATA, "coord-report.json"), JSON.stringify(report, null, 1));
