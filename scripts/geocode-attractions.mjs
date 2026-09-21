// 用 Wikipedia / Wikidata 的權威座標重新定位景點（批次查詢，避免 429）
import fs from "node:fs";
import path from "node:path";
import { CACHE, ensureDir, writeJson, toMeters } from "./lib.mjs";
import { ATTRACTIONS, MUSEUMS } from "./attractions.data.mjs";

const CACHE_FILE = path.join(CACHE, "geocode.json");
ensureDir(CACHE);
const prev = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) : { attractions: {}, museums: {} };
// 只保留先前成功的結果，失敗者本次重試（避免把暫時性錯誤永久快取）
const cache = { attractions: {}, museums: {} };
for (const [k, v] of Object.entries(prev.attractions ?? {})) if (v?.coords) cache.attractions[k] = v;
for (const [k, v] of Object.entries(prev.museums ?? {})) if (v?.coords) cache.museums[k] = v;
if (Object.keys(cache.attractions).length) console.log(`沿用先前成功結果 ${Object.keys(cache.attractions).length} 筆`);

const UA = "macau-memory-3d/1.0 (educational open-data 3D map of Macau; contact: local build)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dist = (a, b) => Math.hypot(toMeters(a)[0] - toMeters(b)[0], toMeters(a)[1] - toMeters(b)[1]);
const inMacau = ([lon, lat]) => lon > 113.50 && lon < 113.63 && lat > 22.08 && lat < 22.25;

async function getJson(url) {
  for (let i = 0; i < 5; i++) {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") ?? 0) * 1000 || 3000 * (i + 1);
      console.warn(`    ⏳ 429，等待 ${(wait / 1000).toFixed(1)}s 後重試`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  }
  throw new Error("HTTP 429（重試多次仍失敗）");
}

const chunk = (arr, n) => arr.reduce((acc, x, i) => (i % n ? acc[acc.length - 1].push(x) : acc.push([x]), acc), []);

// ---------------------------------------------------------------- 批次查詢維基百科座標
async function wikipediaBatch(names, lang = "zh") {
  const found = new Map(); // name -> {coords, title, wikibase}
  for (const part of chunk(names, 45)) {
    const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=coordinates|pageprops&titles=${encodeURIComponent(part.join("|"))}`;
    let j;
    try { j = await getJson(url); } catch (e) { console.warn(`  ⚠ ${lang}.wikipedia 批次失敗：${e.message}`); continue; }
    const norm = new Map((j?.query?.normalized ?? []).map((n) => [n.from, n.to]));
    const redir = new Map((j?.query?.redirects ?? []).map((n) => [n.from, n.to]));
    const byTitle = new Map((j?.query?.pages ?? []).map((p) => [p.title, p]));
    for (const name of part) {
      const t = redir.get(norm.get(name) ?? name) ?? norm.get(name) ?? name;
      const page = byTitle.get(t);
      if (!page) continue;
      const c = page.coordinates?.[0];
      found.set(name, { coords: c ? [c.lon, c.lat] : null, title: page.title, wikibase: page.pageprops?.wikibase_item ?? null });
    }
    await sleep(400);
  }
  return found;
}

// ---------------------------------------------------------------- 批次查詢 Wikidata P625
async function wikidataClaims(qids) {
  const out = new Map();
  for (const part of chunk([...new Set(qids)], 45)) {
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=${part.join("|")}`;
    let j;
    try { j = await getJson(url); } catch (e) { console.warn(`  ⚠ wikidata 批次失敗：${e.message}`); continue; }
    for (const qid of part) {
      const v = j?.entities?.[qid]?.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
      if (v) out.set(qid, [v.longitude, v.latitude]);
    }
    await sleep(400);
  }
  return out;
}

// ---------------------------------------------------------------- 搜尋備援（單筆，較慢）
async function wikipediaSearch(name, lang = "zh") {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&list=search&srlimit=1&srsearch=${encodeURIComponent(name)}`;
  const j = await getJson(url);
  const hit = j?.query?.search?.[0];
  if (!hit) return null;
  const r = await wikipediaBatch([hit.title], lang);
  return r.get(hit.title) ?? null;
}

// ---------------------------------------------------------------- 準備候選名稱
const targets = [
  ...ATTRACTIONS.map((a) => ({ key: a.id, kind: "attraction", item: a, aliases: [] })),
  ...MUSEUMS.map((m) => ({ key: `museum-${m.id}`, kind: "museum", item: { id: `museum-${m.id}`, zh: m.name, en: m.en }, aliases: m.id === "poly-mgm" ? ["澳門美高梅", "MGM Macau", "美高梅金殿"] : ["澳門博物館"] })),
];
for (const t of targets) t.names = [...new Set([...t.aliases, t.item.zh, t.item.en].filter(Boolean))];

const pending = targets.filter((t) => !(t.kind === "attraction" ? cache.attractions[t.key] : cache.museums[t.item.id.replace("museum-", "")]));
console.log(`待查詢 ${pending.length} 筆（已快取 ${targets.length - pending.length} 筆）`);

// ---------------------------------------------------------------- 1. 中文維基批次
const zhNames = [...new Set(pending.flatMap((t) => t.names))];
console.log(`\n[1/4] 中文維基百科批次查詢（${zhNames.length} 個名稱）…`);
const zhFound = await wikipediaBatch(zhNames, "zh");

// ---------------------------------------------------------------- 2. Wikidata P625（針對已有 wikibase_item 但無座標者）
const needQid = [...zhFound.values()].filter((v) => !v.coords && v.wikibase).map((v) => v.wikibase);
console.log(`[2/4] Wikidata 座標批次查詢（${needQid.length} 個實體）…`);
const wdCoords = await wikidataClaims(needQid);

// ---------------------------------------------------------------- 3. 英文維基批次（補中文查不到者）
const unresolvedNames = [...new Set(pending.flatMap((t) => t.names).filter((n) => !zhFound.get(n)?.coords))];
const enNames = unresolvedNames.filter((n) => /^[\x00-\x7f]+$/.test(n));
console.log(`[3/4] 英文維基百科批次查詢（${enNames.length} 個名稱）…`);
const enFound = await wikipediaBatch(enNames, "en");

// ---------------------------------------------------------------- 4. 逐筆搜尋備援
console.log("[4/4] 搜尋備援…");
const resolved = {};
for (const t of pending) {
  let hit = null, source = null;
  for (const n of t.names) {
    const v = zhFound.get(n);
    if (v?.coords && inMacau(v.coords)) { hit = { coords: v.coords, ref: v.title, wikibase: v.wikibase }; source = "wikipedia-zh"; break; }
    if (v?.wikibase && wdCoords.get(v.wikibase) && inMacau(wdCoords.get(v.wikibase))) { hit = { coords: wdCoords.get(v.wikibase), ref: v.title, wikibase: v.wikibase }; source = "wikidata"; break; }
  }
  if (!hit) {
    for (const n of t.names) {
      const v = enFound.get(n);
      if (v?.coords && inMacau(v.coords)) { hit = { coords: v.coords, ref: v.title, wikibase: v.wikibase }; source = "wikipedia-en"; break; }
    }
  }
  if (!hit) {
    for (const n of t.names.slice(0, 2)) {
      try {
        const r = await wikipediaSearch(n, "zh");
        if (r?.coords && inMacau(r.coords)) { hit = { coords: r.coords, ref: r.title, wikibase: r.wikibase }; source = "wikipedia-search"; break; }
        if (r?.wikibase && wdCoords.get(r.wikibase) && inMacau(wdCoords.get(r.wikibase))) { hit = { coords: wdCoords.get(r.wikibase), ref: r.title, wikibase: r.wikibase }; source = "wikidata-search"; break; }
      } catch (e) { /* 忽略，改用人工座標 */ }
      await sleep(600);
    }
  }
  const record = hit
    ? { coords: hit.coords.map((v) => +v.toFixed(6)), source, ref: hit.ref ?? null, wikibase: hit.wikibase ?? null }
    : { coords: null, source: "none" };
  if (t.kind === "attraction") cache.attractions[t.key] = record;
  else cache.museums[t.item.id.replace("museum-", "")] = record;
  const moved = record.coords ? dist(record.coords, t.item.coords ?? [0, 0]) : null;
  console.log(`  ${String(t.item.zh).padEnd(20)} ${record.source.padEnd(17)} ${record.coords ? record.coords.join(", ") : "（保留人工座標）"}`);
  await sleep(250);
}

writeJson(CACHE_FILE, { generated: new Date().toISOString(), ...cache });
const okA = Object.values(cache.attractions).filter((r) => r.coords).length;
const okM = Object.values(cache.museums).filter((r) => r.coords).length;
console.log(`\n✅ 景點 ${okA}/${ATTRACTIONS.length}、博物館 ${okM}/${MUSEUMS.length} 取得權威座標`);
