// 「已有的記載與記憶」：在使用者投稿之前，先以文字列出這個地點已知的歷史記載（官方出處）與口述記憶。
// 資料：building-dossiers.json、cold-facts.json、oral-memories.json。說明：本檔由 AI 程式助手（Claude）協助撰寫。
let data;
const load = () => data ??= Promise.all(['building-dossiers', 'cold-facts', 'oral-memories', 'attractions'].map(f => fetch(`/data/${f}.json`).then(r => r.json()).catch(() => null)))
  .then(([d, c, o, a]) => ({ dossiers: d?.dossiers ?? [], cold: c?.items ?? [], oral: o ?? { memories: [] }, attractions: a?.attractions ?? [] }));

const ids = place => [place.spotId, place.id, place.memoryId].filter(Boolean);

export async function memoriesFor(place) {
  const { oral } = await load(), own = ids(place);
  return { note: oral.note, list: oral.memories.filter(m => m.places.some(id => own.includes(id))) };
}

export async function renderRecords(place, esc) {
  const { dossiers, cold, attractions } = await load(), own = ids(place);
  const dossierId = own.map(id => attractions.find(a => a.id === id)?.dossier ?? id).find(id => dossiers.some(d => d.id === id));
  const d = dossiers.find(x => x.id === dossierId);
  const link = s => s?.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.publisher)}</a>` : esc(s?.publisher ?? '');
  const cite = c => (c.sources ?? []).map(k => link(d.sources[k])).join('、');
  const item = (c, tag = '') => `<li>${tag}${esc(c.text)}${c.kind === 'inference' ? '<em class="rc-flag">推論</em>' : ''}<small>${cite(c)}</small></li>`;
  const group = (title, rows) => rows.length ? `<h4>${title}</h4><ul>${rows.join('')}</ul>` : '';
  let history = '';
  if (d) {
    history = group('建築風格', d.style?.text && !/未標明/.test(d.style.text) ? [item(d.style)] : [])
      + group('年代', d.timeline.map(c => item(c)))
      + group('為什麼是這個樣子', d.whyStyle.map(c => item(c)))
      + group('特徵', d.features.map(c => item(c)))
      + group('名稱由來', d.names.map(c => item(c)))
      + group('出處說法不一', (d.conflicts ?? []).map(cf => `<li><b>${esc(cf.topic)}</b>：${cf.values.map(v => `${esc(v.value)}（${link(d.sources[v.source])}）`).join('；')}</li>`))
      + (d.correction ? group('常見誤解', [`<li>${esc(d.correction)}</li>`]) : '')
      + group('流傳但未核實', (d.unverified ?? []).map(u => `<li class="rc-unverified">${esc(u)}</li>`));
  }
  const facts = cold.filter(c => own.includes(c.placeId) || c.placeId === dossierId);
  history += group('冷知識', facts.map(c => `<li>${esc(c.text)}${c.status === 'partly' ? '<em class="rc-flag">部分核實</em>' : ''}<small>${c.sources.map(link).join('、')}</small></li>`));
  const oralDossier = d?.oral ?? [];
  const { note, list } = await memoriesFor(place);
  const memories = list.map(m => `<article class="rc-memory"><h4>${esc(m.title)}</h4><p class="muted">${esc(m.who)} · ${esc(m.era)}</p><ol>${m.points.map(p => `<li>${esc(p)}</li>`).join('')}</ol>${m.placeNote ? `<p class="muted">${esc(m.placeNote)}</p>` : ''}<p class="muted">出處：${link(m.source)}〈${esc(m.source.title)}〉${m.films?.length ? ' · <button class="text-button" data-tab="films">看這段記憶的短片</button>' : ''}</p></article>`).join('')
    || (oralDossier.length ? `<ul>${oralDossier.map(c => item(c)).join('')}</ul>` : '');
  return `<div class="rc-grid"><section class="rc-col"><p class="eyebrow">歷史記載</p><h3>官方與文獻怎麼說</h3>${history || '<p class="muted">這個地點還沒有整理好的官方記載。</p>'}</section>`
    + `<section class="rc-col"><p class="eyebrow">口述記憶</p><h3>在這裏生活過的人怎麼說</h3>${memories || '<p class="muted">還沒有收錄口述記憶，歡迎在下方留下你的記憶。</p>'}${memories ? `<p class="rc-note">${esc(note)}</p>` : ''}</section></div>`;
}
