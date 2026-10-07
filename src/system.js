import './system.css';
import { escapeMemoryText as esc } from './memory-photo.js';
const catalog = await fetch('./data/system-catalog.json').then(r => { if (!r.ok) throw new Error('記憶檔案載入失敗'); return r.json(); });
document.querySelector('#places').textContent = catalog.counts.places;
document.querySelector('#photos').textContent = catalog.counts.photos;
document.querySelector('#hero-photo').src = catalog.places.find(p => p.id === 'taipa-houses')?.cover ?? catalog.places[0]?.cover;
function render(query = '') {
  const places = catalog.places.filter(p => `${p.name} ${p.categoryName}`.includes(query.trim()));
  document.querySelector('#empty').hidden = places.length !== 0;
  document.querySelector('#cards').innerHTML = places.map(p => `<a class="place-card" href="${esc(p.mapPath)}"><img src="${esc(p.cover)}" loading="lazy" alt="${esc(p.name)}實拍"><div><span>${esc(p.categoryName)} · ${p.photoCount} 張照片</span><h3>${esc(p.name)}</h3><p>${esc(p.summary)}</p><small>探索記憶 ↗</small></div></a>`).join('');
}
render();
document.querySelector('#search').addEventListener('input', e => render(e.target.value));
document.querySelector('#audit-file').addEventListener('change', async e => {
  const file = e.target.files[0], result = document.querySelector('#audit-result');
  if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error('報告檔案過大，請選擇 audit.json');
    const r = JSON.parse(await file.text());
    if (r.schemaVersion !== 1 || !Number.isInteger(r.frames) || !Number.isInteger(r.accepted) || r.accepted < 0 || r.accepted > r.frames) throw new Error('報告格式不正確');
    const reviewed = r.manualComparison, percent = v => Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '未測量';
    result.textContent = `工程：${r.buildingId}\n場景：${r.sceneKind}\n影格：${r.frames} · 接受：${r.accepted} · 接受率：${percent(r.acceptanceRate)}\n` + (reviewed?.reviewedFrames ? `人工複核：${reviewed.reviewedFrames} 張（${reviewed.reviewMode}）\n平均 IoU：${percent(reviewed.meanIoUIncludingMisses)}\nIoU≥0.5 召回率：${percent(reviewed.recallAtIoU50)}\n範圍：已複核樣本的標註品質。` : '人工標註對照尚未完成，不能推算標註準確率或識別提升。');
  } catch (error) { result.textContent = error.message; }
});
