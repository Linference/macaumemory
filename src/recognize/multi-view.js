import { rankCandidates, marginOf } from './compare.js';
import { unitVector, cosine } from '../collection/selection.js';

// Conservative agreement rule, pending independent multi-photo calibration.
export function compareViews(library, shots, thresholds) {
  if (!shots.length) return { state: 'empty', rows: [], reason: '先加入一張已辨識的照片。' };
  if (shots.length > 3) throw new Error('同一建築最多加入三張照片');
  const hashes = new Set();
  const analyzed = shots.map(shot => {
    const vector = unitVector(shot.vector);
    if (!vector || !/^[a-f0-9]{64}$/.test(shot.sha256 ?? '') || hashes.has(shot.sha256)) throw new Error('照片重複或影像向量無效');
    hashes.add(shot.sha256);
    const ranked = rankCandidates(library, vector, { topK: library.buildings.length, thresholds });
    if (!ranked.all.length) throw new Error('沒有可用的參考建築');
    return { ...shot, vector, ranked, margin: marginOf(ranked.top) };
  });
  if (new Set(analyzed.map(s => s.vector.length)).size !== 1) throw new Error('照片向量維度不一致');
  const rows = analyzed[0].ranked.all.map(candidate => {
    const scores = analyzed.map(s => s.ranked.all.find(row => row.id === candidate.id)?.sim);
    if (!scores.every(Number.isFinite)) throw new Error('參考庫在拍攝過程中改變，請重新開始');
    return { ...candidate, sim: scores.reduce((sum, n) => sum + n, 0) / scores.length, perPhoto: scores };
  }).sort((a, b) => b.sim - a.sim || a.id.localeCompare(b.id));
  const firsts = analyzed.map(s => s.ranked.top[0].id);
  const disagreement = new Set(firsts).size > 1;
  const strong = analyzed.every(s => s.ranked.top[0].sim >= thresholds.hit && s.margin >= .04);
  const verySimilar = analyzed.some((s, i) => analyzed.slice(0, i).some(previous => cosine(s.vector, previous.vector) > .995));
  const state = analyzed.length === 1 ? 'one' : disagreement ? 'conflict' : verySimilar ? 'similar' : strong ? 'agreement' : 'review';
  const reason = { one: '已加入一張照片，請補拍不同角度。', conflict: '不同照片的首位候選不一致，請核對是否拍攝同一棟建築。',
    similar: '影像特徵非常接近，可能沒有增加足夠新資訊；請補拍不同角度。',
    agreement: '不同照片共同支持同一候選，請確認地點後建檔。', review: '候選一致，但影像分數或分差仍不足，請人工確認。' }[state];
  return { state, reason, rows: rows.slice(0, 3), shots: analyzed.map(s => ({ name: s.name, top: s.ranked.top[0].zh, score: s.ranked.top[0].sim, margin: s.margin })),
    verySimilar, scope: '純影像分數平均＋逐張一致性檢查；相似度不是正確機率，規則尚待独立實拍校準' };
}
