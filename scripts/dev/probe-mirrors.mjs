// 測試各 Overpass 鏡像的可用性與延遲
const EPS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.osm.jp/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.osm.rambler.ru/cgi/interpreter",
];
const q = `[out:json][timeout:60];way["building"](22.196,113.538,22.200,113.543);out count;`;
await Promise.all(EPS.map(async (ep) => {
  const t0 = Date.now();
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 45_000);
    const res = await fetch(ep, { method: "POST", signal: ac.signal, headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "macau-memory-3d/1.0" }, body: new URLSearchParams({ data: q }) });
    clearTimeout(timer);
    const text = await res.text();
    let info = `HTTP ${res.status}`;
    try { const j = JSON.parse(text); info = j.elements?.[0]?.tags ? `buildings=${j.elements[0].tags.ways}` : JSON.stringify(j).slice(0, 80); }
    catch { info = /too busy|error/i.test(text) ? "HTML error" : text.slice(0, 60).replace(/\s+/g, " "); }
    console.log(`${String(Date.now() - t0).padStart(6)}ms  ${ep.padEnd(60)} ${info}`);
  } catch (e) {
    console.log(`${String(Date.now() - t0).padStart(6)}ms  ${ep.padEnd(60)} FAIL ${e.message}`);
  }
}));
