// Deterministic acquisition rules. These scores are priorities, not probabilities.
export const METHODS = ['combined', 'uniform', 'random', 'visual', 'view'];
export const POLICY = Object.freeze({ version: 'acquisition-v1', view: .45, visual: .35, ambiguity: .2, cost: .12 });
export const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));

export function unitVector(value) {
  if (!value || !Number.isInteger(value.length) || value.length < 2 || value.length > 4096 || !Array.from(value).every(Number.isFinite)) return null;
  const norm = Math.hypot(...value);
  return norm > 1e-8 ? Array.from(value, n => n / norm) : null;
}
export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  return clamp(a.reduce((sum, n, i) => sum + n * b[i], 0), -1, 1);
}
export function safeFrameName(name) {
  return typeof name === 'string' && name.length <= 180 && !/[\\/\x00-\x1f]/.test(name)
    && !['.', '..'].includes(name) && /\.(jpe?g|png|webp)$/i.test(name);
}
export function readQualityReport(report) {
  if (report?.schemaVersion !== 1 || !/^scene-v1-[a-f0-9]{16}$/.test(report.sourceFingerprint ?? '')
    || !Array.isArray(report.frames) || !report.frames.length || report.frames.length > 10000) throw new Error('請選擇 MacauSplat 產生的 review-quality.json');
  const names = new Set();
  return report.frames.map(row => {
    if (!safeFrameName(row.frame) || names.has(row.frame) || !['candidate', 'review', 'reject'].includes(row.grade)
      || !Number.isInteger(row.viewBin) || row.viewBin < 0 || row.viewBin > 23
      || !Number.isInteger(row.projectedSupport) || row.projectedSupport < 0
      || !Number.isInteger(row.supportedCells) || row.supportedCells < 0 || row.supportedCells > 9
      || !Number.isFinite(row.pointSpanRatio) || row.pointSpanRatio < 0 || row.pointSpanRatio > 1
      || !Array.isArray(row.reasons) || !row.reasons.every(s => typeof s === 'string' && s.length < 2000)) throw new Error('品質報告包含無效或重複影格');
    names.add(row.frame);
    return { ...row, id: row.frame, reasons: [...row.reasons], sourceFingerprint: report.sourceFingerprint };
  });
}
export function geometryReliability(frame) {
  if (!frame.grade) return null;
  if (frame.grade === 'reject') return 0;
  const support = clamp(frame.projectedSupport / 40);
  const spread = clamp(frame.supportedCells / 9);
  const span = clamp(frame.pointSpanRatio / .5);
  return (.35 * support + .35 * spread + .3 * span) * (frame.grade === 'review' ? .7 : 1);
}
function random(seed) {
  let state = seed >>> 0;
  return () => { state = (1664525 * state + 1013904223) >>> 0; return state / 4294967296; };
}

export function selectFrames(frames, { budget = 5, method = 'combined', seed = 42, policy = POLICY } = {}) {
  if (!Number.isInteger(budget) || budget < 1 || budget > 100 || !METHODS.includes(method)
    || !Number.isInteger(seed) || seed < 0 || seed > 4294967295
    || !['view','visual','ambiguity','cost'].every(k => Number.isFinite(policy[k]) && policy[k] >= 0)) throw new Error('選圖參數無效');
  const ids = new Set(), hashes = new Set();
  const pool = frames.map(frame => {
    if (typeof frame.id !== 'string' || !frame.id || ids.has(frame.id)) throw new Error('影格編號必須唯一');
    ids.add(frame.id);
    const duplicate = frame.sha256 && hashes.has(frame.sha256);
    if (frame.sha256) hashes.add(frame.sha256);
    const vector = unitVector(frame.vector);
    if (frame.vector != null && !vector) throw new Error('影格包含無效向量');
    const geometry = geometryReliability(frame);
    const image = Number.isFinite(frame.imageQuality) ? clamp(frame.imageQuality) : null;
    const quality = geometry == null ? (image ?? .5) : image == null ? geometry : Math.sqrt(geometry * image);
    return { ...frame, vector, quality, duplicate, viewBin: Number.isInteger(frame.viewBin) && frame.viewBin >= 0 && frame.viewBin < 24 ? frame.viewBin : null };
  }).filter(f => !f.duplicate && f.grade !== 'reject' && f.available !== false && f.quality > 0);
  const dimensions = new Set(pool.filter(f => f.vector).map(f => f.vector.length));
  if (dimensions.size > 1) throw new Error('影格向量使用了不同編碼器維度');
  const limit = Math.min(budget, pool.length), selected = [];
  const ordered = pool.slice().sort((a, b) => a.id.localeCompare(b.id, 'en'));
  let scheduled = null;
  if (method === 'random') {
    const rng = random(seed); scheduled = [...ordered];
    for (let i = scheduled.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [scheduled[i], scheduled[j]] = [scheduled[j], scheduled[i]]; }
  } else if (method === 'uniform') {
    scheduled = Array.from({ length: limit }, (_, i) => ordered[Math.floor((i + .5) * ordered.length / limit)]);
  }
  while (selected.length < limit) {
    const usedViews = new Set(selected.map(f => f.viewBin).filter(v => v != null));
    const remaining = ordered.filter(f => !selected.some(s => s.id === f.id)).map(frame => {
      const viewGain = frame.viewBin != null && !usedViews.has(frame.viewBin) ? 1 : 0;
      const previous = selected.filter(f => f.vector);
      const novelty = frame.vector ? previous.length ? clamp((1 - Math.max(...previous.map(f => cosine(frame.vector, f.vector)))) / 2) : 1 : 0;
      const ambiguity = Number.isFinite(frame.ambiguity) ? clamp(frame.ambiguity) : 0;
      const cost = Number.isFinite(frame.reviewCostSeconds) ? clamp(frame.reviewCostSeconds / 60) : frame.grade === 'review' ? clamp((frame.reasons ?? []).length / 8) : 0;
      const score = method === 'view' ? viewGain + .01 * frame.quality
        : method === 'visual' ? novelty + .01 * frame.quality
        : frame.quality * (.05 + policy.view * viewGain + policy.visual * novelty + policy.ambiguity * ambiguity) - policy.cost * cost;
      const reasons = [viewGain ? `補充視角組 ${frame.viewBin + 1}` : frame.viewBin == null ? '未提供三維姿態' : '已選取相同視角組'];
      if (frame.vector) reasons.push(`影像差異指標 ${novelty.toFixed(3)}`);
      if (frame.ambiguity != null) reasons.push(`候選接近指標 ${ambiguity.toFixed(3)}`);
      if (frame.grade === 'review') reasons.push('目標框需要人工複核');
      return { ...frame, score, viewGain, novelty, ambiguity, cost, selectionReasons: reasons };
    });
    remaining.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id, 'en'));
    const next = scheduled ? remaining.find(f => f.id === scheduled[selected.length].id) : remaining[0];
    selected.push(next);
  }
  return { policyVersion: policy.version, method, seed, requested: budget, eligible: pool.length,
    excluded: frames.length - pool.length, selected, viewGroups: new Set(selected.map(f => f.viewBin).filter(v => v != null)).size,
    missingGeometry: selected.filter(f => f.viewBin == null).length, missingVectors: selected.filter(f => !f.vector).length };
}

export function makeReviewedBundle({ selection, building, reviews, encoder = null, captureGroup, source }) {
  if (!building?.id || !building?.name || !captureGroup?.trim() || !source?.trim()) throw new Error('請填寫建築、拍攝批次及照片來源／使用權說明');
  const frames = selection.selected.filter(frame => reviews.get(frame.id)?.status === 'approved').map(frame => {
    const review = reviews.get(frame.id);
    if (!/^[a-f0-9]{64}$/.test(frame.sha256 ?? '') || !safeFrameName(frame.id)) throw new Error('照片尚未完成檔案校驗');
    if (frame.vector && (!encoder || !/^[a-f0-9]{64}$/.test(encoder.onnx_sha256 ?? '') || frame.vector.length !== encoder.dim)) throw new Error('向量編碼器來源未確認');
    return { frame: frame.id, sha256: frame.sha256, buildingId: building.id, captureGroup: captureGroup.trim(),
      viewBin: frame.viewBin, sourceFingerprint: frame.sourceFingerprint ?? null, vector: frame.vector,
      review: { status: 'approved', reviewedAt: review.reviewedAt, activeSeconds: review.activeSeconds ?? null },
      sourcePhoto: frame.sourcePhoto ?? null, selection: { score: frame.score, reasons: frame.selectionReasons } };
  });
  if (!frames.length) throw new Error('請先逐張確認至少一張選取照片');
  return { schemaVersion: 1, kind: 'macau-memory-capture', policyVersion: selection.policyVersion,
    generated: new Date().toISOString(), building, captureGroup: captureGroup.trim(), source: source.trim(),
    method: selection.method, budget: selection.requested, encoder, protocol: 'full_image_three_crops_flip_tta',
    frames, scope: '人工確認的參考照片清單；不含圖片本體，不是獨立評測真值' };
}
