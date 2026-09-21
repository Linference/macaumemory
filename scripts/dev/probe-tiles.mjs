const eps = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const bboxes = {
  "quarter (0.0125x0.022)": "22.186,113.538,22.208,113.560",
  "eighth (0.006x0.011)": "22.196,113.540,22.202,113.551",
  "tiny (0.003x0.005)": "22.197,113.540,22.200,113.545",
};
for (const [name, bbox] of Object.entries(bboxes)) {
  const q = `[out:json][timeout:120];way["building"](${bbox});out count;`;
  for (const ep of eps) {
    const t0 = Date.now();
    try {
      const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 90_000);
      const res = await fetch(ep, { method: "POST", signal: ac.signal, headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "macau-memory-3d/1.0" }, body: new URLSearchParams({ data: q }) });
      clearTimeout(timer);
      const text = await res.text();
      let info = `HTTP ${res.status}`;
      try { const j = JSON.parse(text); info = `ways=${j.elements[0].tags.ways}`; } catch { info = text.replace(/\s+/g," ").slice(0, 70); }
      console.log(`${name.padEnd(24)} ${ep.split("/")[2].padEnd(22)} ${String(Date.now()-t0).padStart(6)}ms  ${info}`);
    } catch (e) { console.log(`${name.padEnd(24)} ${ep.split("/")[2].padEnd(22)} ${String(Date.now()-t0).padStart(6)}ms  FAIL ${e.message.slice(0,60)}`); }
  }
}
