// 記憶短片分頁：示範片（AI 生成 vs 程式繪製對比）＋我生成的短片＋生成視窗（MiniMax 海螺）。
// 說明：本檔由 AI 程式助手（Claude）協助撰寫。
const KIND = { ai: 'AI 生成畫面 · MiniMax 海螺', code: '程式繪製 · Remotion' };
const METRICS = [['motion', '畫面運動'], ['colour', '色彩豐富度'], ['detail', '細節'], ['contrast', '對比']];
const STATUS = { Preparing: '準備中', Queueing: '排隊中', Processing: '生成中', Success: '已完成', Fail: '生成失敗' };

import { memoriesFor } from './records.js';
let catalog, ctx, pollTimer, plan;

export function initFilms(helpers) {
  ctx = helpers;
  const { $ } = ctx;
  $('make-film').onclick = () => openDialog();
  $('close-film').onclick = () => $('film-dialog').close();
  $('film-dialog').addEventListener('close', () => clearTimeout(pollTimer));
  $('film-plan').onclick = ctx.act(makePlan);
  $('film-form').onsubmit = ctx.act(submitJob);
  $('film-duration').onchange = () => { const ten = $('film-duration').value === '10'; $('film-res').querySelector('[value="1080P"]').disabled = ten; if (ten) $('film-res').value = '768P'; };
}

async function loadCatalog() {
  if (!catalog) catalog = await fetch('/data/memory-films.json').then(r => r.json()).catch(() => ({ films: [] }));
  return catalog;
}

const bar = (v, max) => `<span class="fm-bar"><i style="width:${Math.max(3, Math.round((v / max) * 100))}%"></i></span>`;

function pairMarkup(films, esc) {
  const ai = films.find(f => f.kind === 'ai'), code = films.find(f => f.kind === 'code');
  const card = f => `<figure class="fm-film fm-${f.kind}"><video controls preload="metadata" playsinline poster="${esc(f.poster)}" src="${esc(f.src)}"></video><figcaption><span class="fm-badge fm-badge-${f.kind}">${KIND[f.kind]}</span><b>${esc(f.title)}</b><small>${esc(f.scope)} · ${f.seconds} 秒 · ${esc(f.tool)}</small></figcaption></figure>`;
  if (!ai || !code) return films.map(card).join('');
  const rows = METRICS.map(([k, name]) => { const max = Math.max(ai.metrics[k], code.metrics[k]); return `<tr><th>${name}</th><td>${bar(ai.metrics[k], max)}<em>${ai.metrics[k]}</em></td><td>${bar(code.metrics[k], max)}<em>${code.metrics[k]}</em></td><td class="fm-x">${(ai.metrics[k] / code.metrics[k]).toFixed(1)}×</td></tr>`; }).join('');
  return `<div class="fm-pair">${card(ai)}${card(code)}</div><table class="fm-metrics"><thead><tr><th></th><th>AI 生成</th><th>程式繪製</th><th>倍數</th></tr></thead><tbody>${rows}</tbody></table><p class="muted">同一段記憶：${esc(ai.source)}</p>`;
}

export async function renderFilms() {
  const { $, esc, api, current } = ctx, place = current().place;
  const cat = await loadCatalog(), here = cat.films.filter(f => f.places.some(id => id === place.spotId || id === place.id));
  const stories = [...new Set((here.length ? here : cat.films).map(f => f.story))];
  $('film-compare-title').textContent = here.length ? '這個地點的記憶短片' : '示範：同一段記憶，兩種做法';
  const mems = (await memoriesFor(place)).list;
  const memo = s => { const m = mems.find(x => x.id === s); return m ? `<details class="fm-memo" open><summary>短片依據的記憶：〈${esc(m.title)}〉</summary><ol>${m.points.map(p => `<li>${esc(p)}</li>`).join('')}</ol></details>` : ''; };
  $('film-compare').innerHTML = stories.map(s => `<section class="fm-story">${memo(s)}${pairMarkup(cat.films.filter(f => f.story === s), esc)}</section>`).join('')
    + `<details class="fm-note"><summary>這些數值怎麼算</summary><p>${esc(cat.metricsNote)}</p><p>結論：AI 生成的畫面運動約為程式繪製的 5–7 倍、細節約 4 倍、色彩約 2 倍，明顯更生動；但它會自行補上面孔與細節，可能與口述內容不符，因此每段 AI 畫面都標示「AI 生成」，並保留記憶原文供核對。</p></details>`;
  let mine = { videos: [], ready: false, daily: 0 };
  try { mine = await api('/videos?placeId=' + encodeURIComponent(place.id)); } catch (e) { ctx.message(e.message); }
  $('film-ready').textContent = mine.ready ? `每日最多生成 ${mine.daily} 段；畫面由 MiniMax 生成並自動標示。` : '尚未設定 MiniMax：在 .env.local 加入 MINIMAX_API_KEY 後重啟記憶服務，即可在這裡生成。';
  $('film-mine').innerHTML = mine.videos.length ? mine.videos.map(v => `<figure class="fm-film fm-ai">${v.src ? `<video controls preload="metadata" playsinline src="${esc(v.src)}"></video>` : `<div class="fm-wait">${STATUS[v.status] ?? v.status}…</div>`}<figcaption><span class="fm-badge fm-badge-ai">${esc(v.label)}</span><small>${v.duration} 秒 · ${esc(v.resolution)} · ${new Date(v.createdAt).toLocaleString('zh-Hant')}</small><details><summary>提示詞</summary><p>${esc(v.prompt)}</p></details></figcaption></figure>`).join('') : '<p class="muted">還沒有生成過短片。</p>';
  const pending = mine.videos.filter(v => !['Success', 'Fail'].includes(v.status));
  if (pending.length) { clearTimeout(pollTimer); pollTimer = setTimeout(() => Promise.all(pending.map(v => api('/video/jobs/' + v.id).catch(() => null))).then(() => { if (ctx.tab() === 'films') renderFilms(); }), 10000); }
}

function openDialog() {
  const { $, esc, current } = ctx, c = current();
  plan = null;
  $('film-story').innerHTML = '<option value="">不選，改用下面的文字</option>' + c.stories.map(s => `<option value="${esc(s.id)}">${esc(s.title)}（${esc(s.era)}）</option>`).join('');
  $('film-text').value = ''; $('film-prompt').value = ''; $('film-basis').innerHTML = ''; $('film-progress').textContent = '';
  const photos = c.stories.flatMap(s => s.media).filter(m => m.mime.startsWith('image/') && m.owner === ctx.user().id);
  $('film-frame').innerHTML = '<option value="">不用照片（文生視頻）</option>' + photos.map((m, i) => `<option value="${esc(m.id)}">我上傳的照片 ${i + 1}</option>`).join('');
  $('film-place').textContent = c.place.name;
  $('film-dialog').querySelector('.dialog-status')?.remove();
  $('film-dialog').showModal();
}

async function makePlan() {
  const { $, api, current } = ctx;
  $('film-progress').textContent = '正在依記憶與已核實資料撰寫提示詞…';
  plan = await api('/video/plan', { placeId: current().place.id, storyId: $('film-story').value || undefined, text: $('film-text').value });
  $('film-prompt').value = plan.prompt;
  $('film-basis').innerHTML = plan.basis.length ? '<b>提示詞依據：</b><ul>' + plan.basis.map(b => `<li>${ctx.esc(b)}</li>`).join('') + '</ul>' : '';
  $('film-progress').textContent = '提示詞已生成，可以先修改再送出。';
}

async function submitJob() {
  const { $, api, current } = ctx;
  if (!$('film-prompt').value.trim()) throw new Error('請先生成或填寫提示詞。');
  $('film-progress').textContent = '正在送出到 MiniMax…';
  const v = await api('/video/jobs', { placeId: current().place.id, storyId: $('film-story').value || null, prompt: $('film-prompt').value.trim(), mediaId: $('film-frame').value || null, duration: Number($('film-duration').value), resolution: $('film-res').value });
  $('film-progress').textContent = '已排隊。生成約需 1–5 分鐘，完成後會出現在「我生成的短片」。';
  setTimeout(() => { $('film-dialog').close(); ctx.message('短片生成中，完成後會自動顯示。'); renderFilms(); }, 1200);
  return v;
}
