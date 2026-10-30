// Same ranking/verdict code as the browser; no test-set threshold fitting.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { rankCandidates, marginOf, verdict } from "../../src/recognize/compare.js";
import { dedupThresholds } from "../../src/recognize/dedup.js";
import { compareViews } from "../../src/recognize/multi-view.js";

export function proportion(successes, total) {
  if (!total) return { successes, total, value: null, interval95: null };
  const z = 1.96, p = successes / total, den = 1 + z * z / total;
  const middle = (p + z * z / (2 * total)) / den;
  const half = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / den;
  return { successes, total, value: p, interval95: [Math.max(0, middle - half), Math.min(1, middle + half)] };
}

/** Exact two-sided McNemar test for paired yes/no outcomes; b = only arm A succeeded, c = only arm B. */
export function mcnemar(b, c) {
  const n = b + c;
  if (!n) return { b, c, p: null };
  // Binomial(n, 0.5) lower tail in log space so large n does not overflow.
  let logCoef = 0, tail = 0;
  for (let k = 0; k <= Math.min(b, c); k++) {
    tail += Math.exp(logCoef - n * Math.LN2);
    logCoef += Math.log(n - k) - Math.log(k + 1);
  }
  return { b, c, p: Math.min(1, 2 * tail) };
}

// outcome = { known, correct, accepted, top3 } for one photo, or for one multi-photo group
function summarize(outcomes) {
  const known = outcomes.filter((o) => o.known), unknown = outcomes.filter((o) => !o.known);
  const accepted = outcomes.filter((o) => o.accepted);
  return {
    top1: proportion(known.filter((o) => o.correct).length, known.length),
    top3: proportion(known.filter((o) => o.top3).length, known.length),
    confidentPrecision: proportion(accepted.filter((o) => o.known && o.correct).length, accepted.length),
    knownCorrectAcceptance: proportion(known.filter((o) => o.accepted && o.correct).length, known.length),
    unknownFalseAcceptance: proportion(unknown.filter((o) => o.accepted).length, unknown.length),
    reviewRate: proportion(outcomes.length - accepted.length, outcomes.length),
  };
}

function decideSingle(library, q, thresholds, ids, geo = {}) {
  const result = rankCandidates(library, q.vector, { thresholds, geo });
  const decision = verdict(result.top, marginOf(result.top), thresholds);
  return { result, decision, known: ids.has(q.buildingId), correct: result.top[0]?.id === q.buildingId,
    top3: result.top.some((c) => c.id === q.buildingId), accepted: decision.key === "confident" };
}

export function evaluateQueries(library, queries, { useLocation = false } = {}) {
  const thresholds = dedupThresholds(library);
  const ids = new Set(library.buildings.map((b) => b.id));
  const outcomes = [], rows = [];
  for (const q of queries.filter((q) => q.split === "test")) {
    const o = decideSingle(library, q, thresholds, ids, {
      enabled: useLocation && q.confirmedPhotoLocation === true,
      // Frozen photo location; simulated "now" is the capture time, not evaluation wall time.
      location: q.location, now: Date.parse(q.location?.capturedAt),
    });
    outcomes.push(o);
    rows.push({ id: q.id, expected: q.buildingId, known: o.known, candidate: o.result.top[0]?.id ?? null,
      similarity: o.result.top[0]?.sim ?? null, decision: o.decision.key, locationUsed: o.result.geo.used,
      candidates: o.result.top.map((c) => ({ id: c.id, similarity: c.sim, distanceM: c.geo?.distanceM })) });
  }
  const known = outcomes.filter((o) => o.known).length;
  return { counts: { test: rows.length, known, unknown: rows.length - known, locationUsed: rows.filter((r) => r.locationUsed).length },
    thresholds, ...summarize(outcomes), rows };
}

/**
 * Multi-photo ablation on the same test groups (viewGroup = 2–3 photos of one building from one visit).
 * "first": the earliest photo alone under the single-photo rule; "multi": the browser's compareViews rule,
 * which accepts only when every photo is strong and all agree. Both arms are image-only, so the difference
 * isolates the multi-photo rule; paired McNemar tests compare the arms group by group.
 */
export function evaluateViewGroups(library, queries) {
  const thresholds = dedupThresholds(library);
  const ids = new Set(library.buildings.map((b) => b.id));
  const groups = new Map();
  for (const q of queries) {
    if (q.split !== "test" || !q.viewGroup) continue;
    if (!groups.has(q.viewGroup)) groups.set(q.viewGroup, []);
    groups.get(q.viewGroup).push(q);
  }
  const first = [], multi = [], rows = [];
  for (const [group, shots] of groups) {
    shots.sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt) || a.id.localeCompare(b.id));
    if (shots.length < 2 || shots.length > 3 || new Set(shots.map((q) => q.buildingId)).size !== 1) {
      throw new Error(`viewGroup ${group} must hold 2–3 photos of one building; re-run the audit.`);
    }
    const expected = shots[0].buildingId, known = ids.has(expected);
    const single = decideSingle(library, shots[0], thresholds, ids);
    const views = compareViews(library, shots.map((q) => ({ name: q.id, vector: q.vector, sha256: q.sha256 })), thresholds);
    const candidate = views.rows[0]?.id ?? null;
    first.push(single);
    multi.push({ known, correct: candidate === expected, accepted: views.state === "agreement",
      top3: views.rows.some((r) => r.id === expected) });
    rows.push({ viewGroup: group, expected, known, photos: shots.map((q) => q.id),
      first: { candidate: single.result.top[0]?.id ?? null, decision: single.decision.key },
      multi: { candidate, state: views.state } });
  }
  const paired = (pick, include) => {
    let b = 0, c = 0;
    first.forEach((f, i) => {
      if (!include(f)) return;
      const x = pick(f), y = pick(multi[i]);
      b += Number(x && !y); c += Number(!x && y);
    });
    return mcnemar(b, c);
  };
  const known = first.filter((o) => o.known).length;
  return { counts: { groups: rows.length, known, unknown: rows.length - known, photos: rows.reduce((n, r) => n + r.photos.length, 0) },
    thresholds, first: summarize(first), multi: summarize(multi),
    paired: {
      knownCorrectAcceptance: paired((o) => o.accepted && o.correct, (o) => o.known),
      unknownFalseAcceptance: paired((o) => o.accepted, (o) => !o.known),
    }, rows };
}

function main() {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const queryPath = process.argv[2];
  if (!queryPath) throw new Error("Usage: node tools/recognize/independent-eval.mjs path/to/queries.json");
  const bytes = fs.readFileSync(path.join(root, "public/data/memory-embeddings.json"));
  const library = JSON.parse(bytes);
  const prepared = JSON.parse(fs.readFileSync(queryPath));
  if (!prepared.audit?.ok || prepared.protocol !== "full_image_three_crops_flip_tta") throw new Error("Independent query audit/protocol missing; run independent_queries.py first.");
  if (prepared.librarySha256 !== crypto.createHash("sha256").update(bytes).digest("hex")) throw new Error("Frozen library hash mismatch.");
  if (prepared.encoderSha256 !== library.encoder.onnx_sha256) throw new Error("Frozen encoder hash mismatch.");
  const selected = new Set(prepared.referenceKeys);
  const available = new Set(library.buildings.flatMap((b) => b.files.map((f) => `${b.id}/${f}`)));
  if (!selected.size || selected.size !== prepared.referenceKeys.length || [...selected].some((key) => !available.has(key))) throw new Error("Invalid frozen reference selection.");
  library.buildings = library.buildings.map((b) => {
    const indexes = b.files.map((f, i) => selected.has(`${b.id}/${f}`) ? i : -1).filter((i) => i >= 0);
    return { ...b, files: indexes.map((i) => b.files[i]), vectors: indexes.map((i) => b.vectors[i]) };
  }).filter((b) => b.vectors.length);
  const locations = new Map(JSON.parse(fs.readFileSync(path.join(root, "public/data/attractions.json"))).attractions.map((a) => [a.id, a.coords]));
  library.buildings.forEach((b) => { b.coords ??= locations.get(b.spot) ?? null; });
  for (const q of prepared.queries) {
    const v = q.vector;
    if (!Array.isArray(v) || v.length !== library.encoder.dim || !v.every(Number.isFinite) || Math.abs(Math.hypot(...v) - 1) > 0.01) throw new Error(`Invalid query vector: ${q.id}`);
  }
  const visual = evaluateQueries(library, prepared.queries);
  if (!visual.counts.test) throw new Error("No independent test queries; metrics remain pending.");
  const located = evaluateQueries(library, prepared.queries, { useLocation: true });
  const views = evaluateViewGroups(library, prepared.queries);
  const report = { generated: new Date().toISOString(), scope: "Independent full-image retrieval (YOLO not evaluated; browser timing not measured)",
    librarySha256: prepared.librarySha256, encoderSha256: prepared.encoderSha256,
    audit: prepared.audit, visual, located, views };
  const out = path.dirname(path.resolve(queryPath));
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  const format = (m) => m.value == null ? "待補樣本" : `${(100 * m.value).toFixed(1)}% (${m.successes}/${m.total}); Wilson 95% ${(100 * m.interval95[0]).toFixed(1)}–${(100 * m.interval95[1]).toFixed(1)}%`;
  const metrics = [["Top-1（庫內建築）", "top1"], ["Top-3（庫內建築）", "top3"], ["高信心判定精確率", "confidentPrecision"], ["庫內正確接受率", "knownCorrectAcceptance"], ["庫外誤接受率", "unknownFalseAcceptance"], ["需人工確認比例", "reviewRate"]];
  const md = `# 獨立實拍檢索評估\n\n${report.scope}\n\n測試 ${visual.counts.test} 張：庫內 ${visual.counts.known}、庫外 ${visual.counts.unknown}；位置輔助實際使用 ${located.counts.locationUsed} 張。\n\n門檻固定於凍結參考庫；未用 test 調參。capture group／攝影者隔離依採集者填寫的來源紀錄；已檢查檔案 SHA-256 重複，近重複照片仍需人工複核。\n\n| 指標 | 純影像 | 位置輔助 |\n|---|---|---|\n${metrics.map(([label, key]) => `| ${label} | ${format(visual[key])} | ${format(located[key])} |`).join("\n")}\n\n位置樣本不足時不宣稱改進；render、LOO、獨立實拍與端到端結果須分開。Wilson 區間按照片計算，同組照片有相關性，不能視為跨建築泛化的完整不確定性。\n\n${viewsMarkdown(views, format)}`;
  fs.writeFileSync(path.join(out, "report.md"), md);
  console.log(`Wrote ${path.join(out, "report.md")}`);
}

function viewsMarkdown(views, format) {
  if (!views.counts.groups) return "## 多照片消融\n\n未提供 `viewGroup`（同一次到訪、同一棟的 2–3 張照片），多照片結果待補樣本。\n";
  const paired = (t) => t.p == null ? "兩組規則結論完全相同" : `只有首張接受 ${t.b} 組、只有多照片接受 ${t.c} 組；McNemar 精確雙尾 p = ${t.p.toFixed(4)}`;
  const metrics = [["Top-1（庫內建築）", "top1"], ["高信心判定精確率", "confidentPrecision"], ["庫內正確接受率", "knownCorrectAcceptance"], ["庫外誤接受率", "unknownFalseAcceptance"], ["需人工確認比例", "reviewRate"]];
  return `## 多照片消融\n\n${views.counts.groups} 組（庫內 ${views.counts.known}、庫外 ${views.counts.unknown}），共 ${views.counts.photos} 張。單位是「組」：首張單拍與多照片一致規則用同一批組比較，兩者都不使用位置。\n\n| 指標 | 首張單拍 | 多照片一致 |\n|---|---|---|\n${metrics.map(([label, key]) => `| ${label} | ${format(views.first[key])} | ${format(views.multi[key])} |`).join("\n")}\n\n- 庫內正確接受：${paired(views.paired.knownCorrectAcceptance)}\n- 庫外誤接受：${paired(views.paired.unknownFalseAcceptance)}\n\n多照片規則要求每張都高信心且首位一致，只會減少自動接受；要回答的是「誤接受減少多少、代價是多少正確接受改為人工確認」。\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
