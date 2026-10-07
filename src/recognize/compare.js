// 與記憶點嵌入庫比對、排序候選
//
// 兩邊向量都已 L2 正規化 → 相似度 = 點積。
// 分數取「該棟所有參考照片的最高分」而不是平均：實務上只要有一個角度對上就算命中，
// 取平均會把真正的命中稀釋掉（VPR 領域的常見作法）。

import { clsZh, simLabel, SIM_THRESHOLDS } from "./labels.js";
import { rankWithLocation } from "./geo-ranking.js";

/** @param {{buildings:Array}} lib @param {Float32Array} query 已正規化的查詢向量 */
export function rankCandidates(lib, query, { topK = 3, clsHint = null, thresholds = SIM_THRESHOLDS, geo = {} } = {}) {
  const rows = [];
  for (const b of lib.buildings) {
    let best = -Infinity, sum = 0, n = 0, bestIdx = -1;
    const vecs = b.vectors ?? [];
    for (let i = 0; i < vecs.length; i++) {
      const v = vecs[i];
      if (v.length !== query.length) continue;
      let s = 0;
      for (let k = 0; k < v.length; k++) s += v[k] * query[k];
      sum += s; n++;
      if (s > best) { best = s; bestIdx = i; }
    }
    if (!n) continue;
    rows.push({
      id: b.id, zh: b.zh, en: b.en, cls: b.cls, clsZh: clsZh(b.cls),
      spot: b.spot ?? null, model: b.model ?? null, count: vecs.length,
      coords: b.coords ?? null,
      sim: best, mean: sum / n,
      bestRef: bestIdx >= 0 ? (b.files?.[bestIdx] ?? null) : null,
      clsMatch: clsHint ? b.cls === clsHint : null,
      adjusted: best + (clsHint && b.cls === clsHint ? 0.02 : 0),
    });
  }
  const located = rankWithLocation(rows, geo);
  const visual = rankWithLocation(rows).rows;
  if (visual.length) visual[0].visualMargin = visual.length > 1
    ? visual[0].sim - Math.max(...visual.slice(1).map((r) => r.sim)) : 1;
  const ranked = located.rows.map((r) => ({ ...r, level: simLabel(r.sim, thresholds) }));
  if (ranked.length) ranked[0].visualMargin = ranked.length > 1
    ? ranked[0].sim - Math.max(...ranked.slice(1).map((r) => r.sim)) : 1;
  return { top: ranked.slice(0, topK), visualTop: visual.slice(0, topK), all: ranked, total: ranked.length,
    geo: located.geo, thresholds, comparison: {
      visualFirst: visual[0]?.id ?? null, locatedFirst: ranked[0]?.id ?? null,
      changed: visual[0]?.id !== ranked[0]?.id,
    } };
}

/** 第一名與第二名的差距：太小代表「這幾棟長得像」，不能只憑影像斷定。 */
export function marginOf(top) {
  if (top[0]?.visualMargin != null) return top[0].visualMargin;
  if (top.length < 2) return 1;
  return top[0].visualMargin ?? top[0].sim - Math.max(...top.slice(1).map((r) => r.sim));
}

/** 誠實的結論：分數不夠就說「可能不在資料庫裡」，不硬給答案。 */
export function verdict(top, margin, thresholds = SIM_THRESHOLDS) {
  if (!top?.length) return { key: "none", zh: "沒有可比對的記憶點", detail: "嵌入庫是空的" };
  const s = top[0].sim;
  margin = Math.min(margin, top[0].visualMargin ?? margin);
  if (top[0].geo?.conflict && s >= thresholds.maybe) return {
    key: "likely", zh: "影像與位置不一致，請確認", detail: "照片可能從遠處拍攝，或定位對應其他地點；請核對候選，必要時關閉位置輔助。",
  };
  if (s >= thresholds.hit) {
    return margin >= 0.04
      ? { key: "confident", zh: "很可能就是這一棟", detail: `相似度 ${s.toFixed(3)}，領先第二名 ${margin.toFixed(3)}` }
      : { key: "likely", zh: "最像這一棟，但候選很接近", detail: `相似度 ${s.toFixed(3)}，與第二名只差 ${margin.toFixed(3)}，建議比對下面的候選` };
  }
  if (s >= thresholds.maybe) {
    return { key: "likely", zh: "可能是這一棟", detail: `相似度 ${s.toFixed(3)} 落在「不同棟也可能出現」的區間（≥${thresholds.maybe}），請看候選一起判斷` };
  }
  if (s >= (thresholds.low ?? SIM_THRESHOLDS.low)) {
    return { key: "weak", zh: "影像相似度偏低", detail: `最高只有 ${s.toFixed(3)}，這個分數不同棟的建築也常出現，僅供參考` };
  }
  return {
    key: "unknown",
    zh: "可能不在記憶點庫裡",
    detail: `最高相似度只有 ${s.toFixed(3)}（門檻 ${thresholds.low ?? SIM_THRESHOLDS.low}）——這張照片的建築可能尚未建檔，或拍攝角度／遮蔽差異過大`,
  };
}
