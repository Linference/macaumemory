// 路徑規畫：由 OSM/Overture 路網建立圖，Dijkstra 以「行車/步行時間」求最快路徑
// 同時輸出「搜尋過程」以便做探索動畫

const SPEED_CAR = {
  motorway: 65, trunk: 55, primary: 45, secondary: 40, tertiary: 35,
  unclassified: 30, residential: 25, living_street: 18, service: 15,
};
const SPEED_WALK = {
  footway: 4.8, path: 4.2, steps: 2.6, pedestrian: 4.8, cycleway: 8, bridleway: 4,
  residential: 4.8, living_street: 4.8, service: 4.6, unclassified: 4.6,
  tertiary: 4.6, secondary: 4.6, primary: 4.6, trunk: 4.4, track: 3.6,
};
const CAR_OK = new Set(Object.keys(SPEED_CAR));
const WALK_OK = new Set(Object.keys(SPEED_WALK));

const R = 6371000;
const hav = (a, b) => {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180, dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
};

/** 極簡二元堆 */
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(node, key) {
    const a = this.a; a.push({ node, key });
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].key <= a[i].key) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l].key < a[m].key) m = l;
        if (r < a.length && a[r].key < a[m].key) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

export class Router {
  constructor(roads) {
    this.roads = roads;
    this.graphs = {};
  }

  /** 建立（或取用快取的）路網圖 */
  graph(mode = "car") {
    if (this.graphs[mode]) return this.graphs[mode];
    const ok = mode === "walk" ? WALK_OK : CAR_OK;
    const speedOf = mode === "walk" ? SPEED_WALK : SPEED_CAR;
    const key = new Map();          // 座標 -> 節點索引
    const grid = new Map();         // 空間索引（合併 6 公尺內的重複節點）
    const xs = [], ys = [];
    const CELL = 0.00008;           // 約 8 公尺
    const gkey = (x, y) => `${Math.round(x / CELL)},${Math.round(y / CELL)}`;
    const nodeAt = (lon, lat) => {
      const k = `${lon.toFixed(6)},${lat.toFixed(6)}`;
      let idx = key.get(k);
      if (idx != null) return idx;
      // 附近 6 公尺內已有節點 → 合併（讓交叉路口相連）
      const cx = Math.round(lon / CELL), cy = Math.round(lat / CELL);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const cands = grid.get(`${cx + dx},${cy + dy}`);
          if (!cands) continue;
          for (const c of cands) {
            if (hav([lon, lat], [xs[c], ys[c]]) <= 6) { key.set(k, c); return c; }
          }
        }
      }
      idx = xs.length;
      xs.push(lon); ys.push(lat);
      key.set(k, idx);
      const gk = gkey(lon, lat);
      if (!grid.has(gk)) grid.set(gk, []);
      grid.get(gk).push(idx);
      return idx;
    };

    const eu = [], ev = [], ew = [], ename = [], ecls = [], elen = [];
    for (const f of this.roads) {
      const p = f.properties ?? {};
      const cls = p.c;
      if (!ok.has(cls)) continue;
      const name = p.n ?? null;
      const spd = speedOf[cls] ?? (mode === "walk" ? 4.5 : 20);
      const coords = f.geometry?.coordinates;
      if (!coords || coords.length < 2) continue;
      for (let i = 1; i < coords.length; i++) {
        const a = coords[i - 1], b = coords[i];
        if (a[0] === b[0] && a[1] === b[1]) continue;
        const len = hav(a, b);
        if (len < 0.4) continue;
        const u = nodeAt(a[0], a[1]), v = nodeAt(b[0], b[1]);
        if (u === v) continue;
        eu.push(u); ev.push(v); ew.push(len / ((spd * 1000) / 3600)); elen.push(len); ename.push(name); ecls.push(cls);
      }
    }
    // CSR 鄰接表
    const N = xs.length, deg = new Int32Array(N + 1);
    for (let i = 0; i < eu.length; i++) { deg[eu[i] + 1]++; deg[ev[i] + 1]++; }
    for (let i = 0; i < N; i++) deg[i + 1] += deg[i];
    const off = deg, adjTo = new Int32Array(off[N]), adjW = new Float32Array(off[N]), adjE = new Int32Array(off[N]);
    const cursor = off.slice(0, N);
    for (let i = 0; i < eu.length; i++) {
      let p2 = cursor[eu[i]]; adjTo[p2] = ev[i]; adjW[p2] = ew[i]; adjE[p2] = i; cursor[eu[i]]++;
      p2 = cursor[ev[i]]; adjTo[p2] = eu[i]; adjW[p2] = ew[i]; adjE[p2] = i; cursor[ev[i]]++;
    }
    const g = { mode, N, xs, ys, off, adjTo, adjW, adjE, eu, ev, elen, ename, ecls, cell: CELL };
    // 最近節點查詢用的空間索引
    const idxGrid = new Map();
    const ICELL = 0.0012; // 約 120 公尺
    for (let i = 0; i < N; i++) {
      const k = `${Math.floor(xs[i] / ICELL)},${Math.floor(ys[i] / ICELL)}`;
      if (!idxGrid.has(k)) idxGrid.set(k, []);
      idxGrid.get(k).push(i);
    }
    g.idxGrid = idxGrid; g.ICELL = ICELL;
    // 連通分量（吸附時優先選主網路）
    const comp = new Int32Array(N).fill(-1);
    const sizes = [];
    const stack = [];
    let cid = 0;
    for (let i = 0; i < N; i++) {
      if (comp[i] >= 0) continue;
      let count = 0;
      stack.push(i); comp[i] = cid;
      while (stack.length) {
        const u = stack.pop(); count++;
        for (let e = off[u]; e < off[u + 1]; e++) {
          const v = adjTo[e];
          if (comp[v] < 0) { comp[v] = cid; stack.push(v); }
        }
      }
      sizes.push(count); cid++;
    }
    let mainComp = 0;
    for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[mainComp]) mainComp = i;
    g.comp = comp; g.compSizes = sizes; g.mainComp = mainComp;
    this.graphs[mode] = g;
    return g;
  }

  /** 找出座標附近的最近節點（回傳 [index, 距離]） */
  nearestNode(g, coord, maxDist = 400) {
    const { xs, ys, ICELL, idxGrid } = g;
    const cx = Math.floor(coord[0] / ICELL), cy = Math.floor(coord[1] / ICELL);
    let best = -1, bestD = Infinity, bestAny = -1, bestAnyD = Infinity;
    for (let r = 0; r <= 4; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const arr = idxGrid.get(`${cx + dx},${cy + dy}`);
          if (!arr) continue;
          for (const i of arr) {
            const d = hav(coord, [xs[i], ys[i]]);
            if (d < bestAnyD) { bestAnyD = d; bestAny = i; }
            if (g.comp[i] === g.mainComp && d < bestD) { bestD = d; best = i; }
          }
        }
      }
      if (best >= 0 && bestD <= r * ICELL * 102400 * 0.7) break;
    }
    if (best >= 0 && bestD <= maxDist) return [best, bestD];
    if (bestAny >= 0 && bestAnyD <= maxDist) return [bestAny, bestAnyD];
    return [-1, Math.min(bestD, bestAnyD)];
  }

  /** Dijkstra：以時間（秒）為權重，回傳 {path, timeS, distM, visited, steps} */
  route(fromCoord, toCoord, mode = "car", { maxVisited = 400000, snapDist = 500 } = {}) {
    const g = this.graph(mode);
    const [s] = this.nearestNode(g, fromCoord, snapDist);
    const [t] = this.nearestNode(g, toCoord, snapDist);
    if (s < 0 || t < 0) return null;
    const N = g.N;
    const dist = new Float32Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const prevEdge = new Int32Array(N).fill(-1);
    const done = new Uint8Array(N);
    const heap = new Heap();
    dist[s] = 0; heap.push(s, 0);
    const visited = [];
    let settled = 0;
    while (heap.size && settled < maxVisited) {
      const { node: u } = heap.pop();
      if (done[u]) continue;
      done[u] = 1; settled++;
      visited.push(u);
      if (u === t) break;
      for (let e = g.off[u]; e < g.off[u + 1]; e++) {
        const v = g.adjTo[e];
        if (done[v]) continue;
        const nd = dist[u] + g.adjW[e];
        if (nd < dist[v]) { dist[v] = nd; prev[v] = u; prevEdge[v] = g.adjE[e]; heap.push(v, nd); }
      }
    }
    if (!isFinite(dist[t])) return null;
    // 回溯路徑
    const nodes = [];
    for (let v = t; v !== -1; v = prev[v]) nodes.push(v);
    nodes.reverse();
    let distM = 0;
    const path = nodes.map((i) => [g.xs[i], g.ys[i]]);
    // 加上精確的起訖點（讓路線從實際位置開始）
    const legs = [];
    for (let i = 1; i < nodes.length; i++) {
      const e = prevEdge[nodes[i]];
      const len = g.elen[e] ?? hav(path[i - 1], path[i]);
      distM += len;
      legs.push({ name: g.ename[e], cls: g.ecls[e], len, from: nodes[i - 1], to: nodes[i] });
    }
    // 依街名合併成指引
    const steps = [];
    for (const leg of legs) {
      const last = steps[steps.length - 1];
      const nm = leg.name ?? "未命名道路";
      if (last && last.name === nm) { last.len += leg.len; last.to = leg.to; }
      else steps.push({ name: nm, len: leg.len, from: leg.from, to: leg.to, cls: leg.cls, turn: last ? turnOf(g, last, leg) : "start" });
    }
    for (const s2 of steps) {
      const a = [g.xs[s2.from], g.ys[s2.from]], b = [g.xs[s2.to], g.ys[s2.to]];
      s2.bearing = bearing(a, b);
      s2.fromCoord = a; s2.toCoord = b;
      s2.timeS = s2.len / ((((g.mode === "walk" ? SPEED_WALK : SPEED_CAR)[s2.cls] ?? 20) * 1000) / 3600);
    }
    return {
      mode,
      path: [[fromCoord[0], fromCoord[1]], ...path, [toCoord[0], toCoord[1]]],
      snapped: path,
      timeS: dist[t],
      distM,
      visited,
      steps,
      startNode: s,
      endNode: t,
    };
  }
}

const bearing = (a, b) => {
  const φ1 = (a[1] * Math.PI) / 180, φ2 = (b[1] * Math.PI) / 180, Δλ = ((b[0] - a[0]) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180) / Math.PI;
};
const turnOf = (g, last, leg) => {
  const a = [g.xs[last.from], g.ys[last.from]], b = [g.xs[last.to], g.ys[last.to]], c = [g.xs[leg.to], g.ys[leg.to]];
  let d = bearing(b, c) - bearing(a, b);
  d = ((d + 540) % 360) - 180;
  if (Math.abs(d) < 25) return "straight";
  return d > 0 ? "right" : "left";
};
