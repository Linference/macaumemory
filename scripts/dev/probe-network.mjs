const targets = [
  ["terrarium12","https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/3341/1714.png"],
  ["terrarium11","https://s3.amazonaws.com/elevation-tiles-prod/terrarium/11/1670/857.png"],
  ["normal12","https://s3.amazonaws.com/elevation-tiles-prod/normal/12/3341/1714.png"],
  ["overpass-de","https://overpass-api.de/api/status"],
  ["overpass-kumi","https://overpass.kumi.systems/api/status"],
  ["overpass-ru","https://overpass.openstreetmap.ru/api/status"],
  ["unpkg","https://unpkg.com/three@0.160.0/build/three.module.js"],
  ["jsdelivr","https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"],
  ["npm","https://registry.npmjs.org/three"],
  ["osmdroid-tiles","https://tile.openstreetmap.org/12/3341/1714.png"],
];
for (const [n,u] of targets) {
  const t0 = Date.now();
  try {
    const r = await fetch(u, { method: "GET", headers: { "User-Agent": "macau-memory-build/1.0" } });
    const buf = await r.arrayBuffer();
    console.log(`${n.padEnd(16)} OK   ${r.status}  ${buf.byteLength}B  ${Date.now()-t0}ms  ${r.headers.get("content-type")||""}`);
  } catch (e) {
    console.log(`${n.padEnd(16)} FAIL ${e.message}  ${Date.now()-t0}ms`);
  }
}
