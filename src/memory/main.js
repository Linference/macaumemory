import './memory.css';
import { encodeWav, base64Audio } from '../guide-audio.js';
import { timelineOf } from './timeline.js';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const safeLink = value => { try { const u = new URL(value, location.href); return ['http:', 'https:'].includes(u.protocol) ? u.href : '#'; } catch { return '#'; } };
let bootstrap, current, tab = 'stories', loadVersion = 0, editedStory, media = [], pendingFiles = [], recorder, recordingStream, recordingParts, recordingStarted, recordingTimer, audioBlob, localUrls = [], recordGeneration = 0;
let puzzle = { cards: [] }, clues = [], activity, importedBundle;
const claimNames = { supported: '有出處支持', conflict: '與資料矛盾', unverifiable: '個人記憶，未核實' };
const checkMarkup = c => { if (!c) return ''; const n = k => c.claims.filter(x => x.status === k).length; return `<details class="ai-check"><summary>AI 內容檢查：已通過 · 有出處 ${n('supported')} 條 · 未核實 ${n('unverifiable')} 條</summary><ul>${c.claims.map(x => `<li><b>${claimNames[x.status]}</b>：${esc(x.text)}${x.evidence ? `（依據：${esc(x.evidence)}）` : ''}</li>`).join('')}${c.images.map(i => `<li><b>照片 ${i.index + 1}</b>：${esc(i.description)}</li>`).join('')}</ul><p class="muted">由 ${esc(c.model)} 依本站規則檢查，僅供參考，最終由人工審核。</p></details>`; };
const statusNames = { private: '私人記憶', pending: '等待審核', approved: '已公開', rejected: '待作者修改' };
const stages = { before: '游前 · 預習', during: '游中 · 觀察', after: '游後 · 反思' };
function message(value) { $('status').textContent = value; }
async function api(route, data, method = 'POST') {
  const response = await fetch('/api/memory' + route, { method: data === undefined ? 'GET' : method, headers: data === undefined ? {} : { 'Content-Type': 'application/json', 'X-Memory-Client': 'tujian' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  let out; try { out = await response.json(); } catch { throw new Error('本機記憶服務尚未連接，請先啟動服務。'); }
  if (!response.ok) throw Object.assign(new Error(out.error || '操作未完成。'), { status: response.status }); return out;
}
function act(fn) { return async event => { if (event?.type === 'submit') event.preventDefault(); const button = event?.submitter ?? (event?.currentTarget?.tagName === 'BUTTON' ? event.currentTarget : null); if (button) button.disabled = true; try { await fn(event); } catch (e) { message(e.message); const d = document.querySelector('dialog[open]'); if (d) { let node = d.querySelector('.dialog-status'); if (!node) { node = document.createElement('p'); node.className = 'dialog-status'; node.setAttribute('role', 'status'); d.append(node); } node.textContent = e.message; } } finally { if (button) button.disabled = false; } }; }
function download(name, value, mime = 'application/json') { const url = URL.createObjectURL(new Blob([mime === 'application/json' ? JSON.stringify(value, null, 2) : value], { type: mime })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
function renderPlaces() {
  const query = $('place-search').value.trim().toLowerCase();
  $('place-list').innerHTML = bootstrap.places.filter(p => `${p.name} ${p.memoryId ?? ''} ${p.categoryName}`.toLowerCase().includes(query)).sort((a,b) => Number(!!b.cover) - Number(!!a.cover) || a.name.localeCompare(b.name,'zh-Hant')).map(p => `<button class="place-row ${current?.place.id === p.id ? 'selected' : ''}" data-place="${esc(p.id)}">${p.cover ? `<img src="${esc(p.cover)}" alt="" loading="lazy">` : '<span class="place-placeholder">憶</span>'}<span><b>${esc(p.name)}</b><small>${esc(p.memoryId || p.categoryName)}</small></span></button>`).join('');
}
async function selectPlace(id) {
  const ticket = ++loadVersion, data = await api('/place/' + encodeURIComponent(id)); if (ticket !== loadVersion) return;
  current = data; puzzle = { cards: [] }; clues = []; editedStory = null;
  const u = new URL(location.href); u.searchParams.set('place', data.place.id); history.replaceState({}, '', u); renderPlaces(); renderCurrent(); message('');
}
function mediaMarkup(items) { return items.map(m => m.mime.startsWith('audio/') ? `<audio controls preload="none" src="${esc(m.url)}"></audio>` : m.mime.startsWith('image/') ? `<a href="${esc(m.url)}" target="_blank" rel="noopener"><img class="story-image" src="${esc(m.url)}" loading="lazy" alt="使用者提供的記憶照片"></a>` : '').join(''); }
function renderCurrent() {
  const p = current.place;
  $('place-heading').innerHTML = `<div class="place-title"><div><p class="eyebrow">${esc(p.memoryId || '地點記憶檔案')} · ${esc(p.categoryName || '城市記憶')}</p><h2>${esc(p.name)}</h2><p>${esc(p.summary || '這個地點的故事，等待你來補上。')}</p><div class="button-row"><a class="text-link" href="${esc(p.mapPath || './')}">在地圖中查看</a><span class="muted">${esc(p.provenance || '')}</span></div></div>${p.cover ? `<img src="${esc(p.cover)}" alt="${esc(p.name)}實拍">` : ''}</div>`;
  $('story-list').innerHTML = current.stories.length ? current.stories.map(s => `<article class="story-card" id="story-${esc(s.id)}"><span class="badge">${statusNames[s.status]}</span><h3>${esc(s.title)}</h3><p class="meta">${esc(s.author)} · ${esc(s.era)}</p><p class="story-text">${esc(s.text)}</p>${mediaMarkup(s.media)}${s.reviewNote ? `<p class="muted">審核意見：${esc(s.reviewNote)}</p>` : ''}${checkMarkup(s.aiCheck)}<div class="button-row"><button class="secondary" data-story-card="${esc(s.id)}">加入拼圖</button>${s.owner === bootstrap.user.id ? `<button class="secondary" data-edit-story="${esc(s.id)}">編輯／撤回公開</button>` : ''}</div></article>`).join('') : '<div class="empty-state"><b>第一段記憶，可以從你開始。</b><p>照片、原聲和親身經歷，都能成為這個地點的一部分。</p></div>';
  // 按拍攝年份排列，呈現同一地點跨年代的變化（無日期者排在最後）
  const tl = timelineOf(p.gallery ?? []);
  $('photo-span').textContent = tl.dated >= 2 && tl.span > 0 ? `${tl.first}–${tl.last} · 跨 ${tl.span} 年 · ${tl.dated} 張有拍攝日期` : '';
  $('photo-list').innerHTML = tl.photos.map(ph => `<article><a href="${esc(ph.file)}" target="_blank" rel="noopener"><img src="${esc(ph.thumb || ph.file)}" loading="lazy" alt="${esc(p.name)}真實照片${ph.year ? `（${ph.year} 年）` : ''}"></a>${ph.year ? `<span class="photo-year">${ph.year}</span>` : ''}<p>${esc(ph.taken || '拍攝日期未記錄')}</p><small>${esc(ph.credit)}</small>${ph.sourcePage ? `<a href="${esc(safeLink(ph.sourcePage))}" target="_blank" rel="noopener">原始來源</a>` : ''}</article>`).join('') || '<p class="empty-state">尚未有既有相冊；可先透過記憶投稿保存照片。</p>';
  $('puzzle-select').innerHTML = '<option value="">建立新拼圖</option>' + current.puzzles.map(p => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join('');
  $('story-tray').innerHTML = current.stories.map(s => `<button class="clue-card" data-story-card="${esc(s.id)}"><b>${esc(s.title)}</b><small>${esc(s.author)} · ${esc(s.era)}</small><span>加入拼圖</span></button>`).join('') || '<p class="muted">先保存自己的故事，或閱讀已公開記憶。</p>';
  renderPuzzle(); renderClues(current.knowledge); renderScenes();
  const options = bootstrap.places.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join(''); $('class-places').innerHTML = options;
  for (const id of ['a-ma-temple','mandarins-house','senado-square','ruins-st-paul']) { const p = bootstrap.places.find(p => p.id === id || p.spotId === id); const o = [...$('class-places').options].find(o => o.value === p?.id); if (o) o.selected = true; }
  $('submission-puzzle').innerHTML = '<option value="">不附拼圖</option>' + current.puzzles.map(p => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join('');
  showTab(tab);
}
function showTab(value) {
  tab = value; document.querySelectorAll('.tab-panel').forEach(p => p.hidden = p.id !== 'panel-' + value);
  document.querySelectorAll('[data-tab]').forEach(b => { b.classList.toggle('active', b.dataset.tab === value); b.setAttribute('aria-pressed', String(b.dataset.tab === value)); });
  if (value === 'review' && bootstrap?.user.curator) renderReview().catch(e => message(e.message));
}
function renderClues(items) {
  clues = items ?? []; $('clue-list').innerHTML = clues.map(k => `<article class="clue-card"><span class="badge">${{ person:'人物', event:'事件', theme:'主題', place:'地點' }[k.type]}</span><h4>${esc(k.title)}</h4><p>${esc(k.text)}</p>${k.reason ? `<small>${esc(k.reason)} · 關聯待確認</small>` : ''}<a href="${esc(safeLink(k.sourceUrl))}" target="_blank" rel="noopener">${esc(k.sourceTitle)}</a><button class="secondary" data-clue="${esc(k.id)}">加入拼圖</button></article>`).join('') || '<p class="muted">尚無線索。可搜尋主題，或由本機管理員補充有出處的資料。</p>';
}
function cardTitle(c) { return c.kind === 'story' ? current.stories.find(s => s.id === c.refId)?.title || '故事已不可讀取' : c.kind === 'knowledge' ? bootstrap.knowledge.find(k => k.id === c.refId)?.title || '資料已不可讀取' : '我的筆記'; }
function renderPuzzle() {
  $('puzzle-title').value = puzzle.title || ''; $('puzzle-interpretation').value = puzzle.interpretation || '';
  $('puzzle-cards').innerHTML = puzzle.cards.length ? puzzle.cards.map((c, i) => `<li draggable="true" data-index="${i}"><span class="badge">${{ story:'個人記憶', knowledge:'來源資料', note:'我的解讀' }[c.kind]}</span><h4>${esc(cardTitle(c))}</h4><label>這張卡與故事的關係<textarea data-card-note="${i}" maxlength="2000">${esc(c.note)}</textarea></label>${c.kind !== 'note' ? `<label class="check"><input type="checkbox" data-card-confirm="${i}" ${c.confirmed ? 'checked' : ''}>我已核對這條關聯</label>` : ''}<div class="button-row"><button class="secondary" data-move="${i}" data-direction="-1" ${i === 0 ? 'disabled' : ''} aria-label="向上移動${esc(cardTitle(c))}">上移</button><button class="secondary" data-move="${i}" data-direction="1" ${i === puzzle.cards.length - 1 ? 'disabled' : ''}>下移</button><button class="secondary" data-remove="${i}">移除</button></div></li>`).join('') : '<li class="empty-state">從左邊加入故事與線索，或寫一張自己的筆記。</li>';
}
function syncPuzzle() { puzzle.title = $('puzzle-title').value; puzzle.interpretation = $('puzzle-interpretation').value; }
function addCard(kind, id) { syncPuzzle(); if (kind !== 'note' && puzzle.cards.some(c => c.kind === kind && c.refId === id)) return message('這張卡已在拼圖中。'); if (puzzle.cards.length >= 20) return message('拼圖最多二十張卡片。'); puzzle.cards.push({ kind, refId: id, note: '', confirmed: false }); showTab('puzzle'); renderPuzzle(); if(kind==='story'){const story=current.stories.find(s=>s.id===id),placeId=current.place.id;if(story){$('clue-query').value=(story.title+' '+story.text).slice(0,5000);api('/suggest',{placeId,text:$('clue-query').value,ai:false}).then(result=>{if(current.place.id!==placeId)return;$('clue-explanation').textContent=result.explanation;renderClues(result.cards);}).catch(e=>message(e.message));}} }
async function upload(file, mime = file.type) {
  if (!mime) mime = /\.ply$/i.test(file.name) ? 'application/x-ply' : '';
  const response = await fetch('/api/memory/upload', { method: 'POST', headers: { 'Content-Type': mime, 'X-Memory-Client': 'tujian' }, body: file });
  const out = await response.json(); if (!response.ok) throw new Error(out.error); return out;
}
function stopRecording() { if (recorder?.state === 'recording') recorder.stop(); clearTimeout(recordingTimer); recordingStream?.getTracks().forEach(t => t.stop()); recordingStream = null; $('record').textContent = '開始錄音'; }
function clearStoryMedia() { recordGeneration++; stopRecording(); localUrls.forEach(u => URL.revokeObjectURL(u)); localUrls = []; pendingFiles = []; media = []; audioBlob = null; $('transcribe').disabled = true; $('record-status').textContent = ''; }
function renderStoryMedia() {
  $('story-media').innerHTML = media.map(m => `<div class="media-item">${mediaMarkup([m])}<button type="button" class="secondary" data-remove-media="${esc(m.id)}">移除附件</button></div>`).join('') + pendingFiles.map((f, i) => `<div class="media-item"><small>${esc(f.name || '居民原聲')}</small>${f.type.startsWith('audio/') ? `<audio controls src="${esc(localUrls[i])}"></audio>` : `<img class="story-image" src="${esc(localUrls[i])}" alt="待保存的記憶照片">`}<button type="button" class="secondary" data-remove-file="${i}">移除附件</button></div>`).join('');
}
function openStory(s) {
  clearStoryMedia(); $('story-form').reset(); editedStory = s || null;
  if (s) { for (const key of ['title','author','era','text','tags']) $('story-form').elements[key].value = s[key] || ''; $('story-form').elements.status.value = s.status === 'approved' || s.status === 'pending' ? 'pending' : 'private'; $('story-form').elements.consent.checked = s.consent; media = s.media; }
  $('story-dialog').querySelector('.dialog-status')?.remove(); renderStoryMedia(); $('story-dialog').showModal();
}
function renderScenes() {
  $('scene-list').innerHTML = current.scenes.map(s => `<article class="story-card"><span class="badge">3DGS · ${esc(s.versionLabel || '實景版本')}</span><h3>${esc(s.title)}</h3><p>採集日期：${esc(s.capturedAt || '未登記')}</p><p class="muted">${esc(s.source || '')}</p><p>${Number(s.splatCount || 0).toLocaleString()} 個高斯 · ${(s.fileSize / 1048576).toFixed(1)} MB</p><small class="checksum">SHA-256 ${esc(s.sha256 || '未記錄')}</small><a class="button-link" href="./gaussian.html?memoryScene=${encodeURIComponent(s.id)}">打開此版本</a></article>`).join('') || '<div class="empty-state">這個地點尚未有三維實景。可導入 MacauSplat 記憶工程，照片與故事仍可先保存。</div>';
}
function report(title, sections) {
  const html = `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title><style>body{max-width:850px;margin:40px auto;padding:0 24px;font:16px/1.8 system-ui;color:#20303a}h1{border-bottom:3px solid #aa8638}article{break-inside:avoid;padding:15px 0;border-bottom:1px solid #ddd}p{white-space:pre-wrap}small{color:#64737c}@media print{body{margin:0}}</style><h1>${esc(title)}</h1><small>途見 · 匯出時間 ${esc(new Date().toLocaleString())}</small>${sections}</html>`;
  download('途見記憶報告.html', html, 'text/html');
}
function puzzleReport(p) {
  return `<h2>${esc(p.title)}</h2><p>${esc(p.interpretation)}</p>${p.cards.map(c => { const k = c.kind === 'knowledge' ? bootstrap.knowledge.find(k => k.id === c.refId) : null; const s = c.kind === 'story' ? current.stories.find(s => s.id === c.refId) : null; return `<article><h3>${esc(k?.title || s?.title || '我的筆記')}</h3><small>${c.kind === 'knowledge' ? '來源資料' : c.kind === 'story' ? '個人記憶' : '作者解讀'} · ${c.confirmed ? '作者已核對關聯' : '關聯尚待確認'}</small><p>${esc(k?.text || s?.text || '')}</p><p>${esc(c.note)}</p>${k ? `<a href="${esc(safeLink(k.sourceUrl))}">${esc(k.sourceTitle)}</a>` : ''}</article>`; }).join('')}`;
}
function renderActivities() { $('class-select').innerHTML = '<option value="">選擇活動</option>' + bootstrap.classes.map(c => `<option value="${esc(c.id)}">${esc(c.title)}</option>`).join(''); }
async function loadActivity(id) {
  if (!id) { activity = null; $('class-detail').innerHTML = ''; $('class-submissions').innerHTML = ''; $('submission-form').hidden = true; $('class-report').hidden = true; return; }
  activity = await api('/class/' + id); const c = activity.room;
  $('class-detail').innerHTML = `<article class="activity-card"><span class="badge">${activity.teacher ? '教師工作台' : '學生探究'}</span><h3>${esc(c.title)}</h3><p>${esc(c.question)}</p>${activity.teacher ? `<p>班級碼：<strong class="class-code">${esc(c.code)}</strong></p>` : ''}<ol>${c.placeIds.map(id => `<li>${esc(bootstrap.places.find(p => p.id === id)?.name)}</li>`).join('')}</ol><button class="secondary" id="refresh-class">重新整理提交記錄</button></article>`;
  $('refresh-class').onclick = act(() => loadActivity(c.id));
  $('submission-place').innerHTML = c.placeIds.map(id => `<option value="${esc(id)}">${esc(bootstrap.places.find(p => p.id === id)?.name)}</option>`).join(''); $('submission-form').hidden = false; $('class-report').hidden = false;
  $('class-submissions').innerHTML = activity.submissions.length ? activity.submissions.map(s => `<article class="story-card"><span class="badge">${stages[s.stage]}</span><h3>${esc(s.name)}</h3><p class="story-text">${esc(s.text)}</p>${s.puzzle ? `<p>已提交拼圖：${esc(s.puzzle.title)}</p><p>${esc(s.puzzle.interpretation)}</p>${s.puzzle.cards.map(c=>`<details><summary>${esc(c.source?.title || '作者筆記')}</summary><p>${esc(c.source?.text || '')}</p><p>${esc(c.note)}</p>${c.source?.sourceUrl?`<a href="${esc(safeLink(c.source.sourceUrl))}" target="_blank" rel="noopener">${esc(c.source.sourceTitle)}</a>`:''}</details>`).join('')}` : ''}${s.teacherFeedback ? `<p>教師回饋：${esc(s.teacherFeedback)}</p>` : ''}${activity.teacher ? `<label>回饋<textarea data-feedback-text="${esc(s.id)}" maxlength="3000">${esc(s.teacherFeedback || '')}</textarea></label><button class="secondary" data-feedback="${esc(s.id)}" data-version="${s.version}">保存回饋</button>` : ''}</article>`).join('') : '<p class="muted">尚未有提交記錄。</p>';
}
async function renderReview() {
  const rows = await api('/review'); $('review-list').innerHTML = rows.map(s => `<article class="story-card"><span class="badge">${esc(bootstrap.places.find(p => p.id === s.placeId)?.name)}</span><h3>${esc(s.title)}</h3><p>${esc(s.author)} · ${esc(s.era)}</p><p class="story-text">${esc(s.text)}</p><div data-review-media="${esc(s.id)}"></div><label>審核意見<input data-review-note="${esc(s.id)}" maxlength="1000"></label><div class="button-row"><button data-review="${esc(s.id)}" data-version="${s.version}" data-state="approved">同意公開</button><button class="secondary" data-review="${esc(s.id)}" data-version="${s.version}" data-state="rejected">退回補充</button></div></article>`).join('') || '<p class="empty-state">目前沒有待審核的記憶。</p>';
  // Reviewers see attachments only through the guarded review API.
  for (const s of rows) { const data = await api('/review-media/' + s.id); $('review-list').querySelector(`[data-review-media="${s.id}"]`).innerHTML = mediaMarkup(data); }
}
async function connect() {
  try { bootstrap = await api('/bootstrap'); $('service-error').hidden = true; $('review-tab').hidden = !bootstrap.user.curator; renderActivities(); renderPlaces(); await selectPlace(new URLSearchParams(location.search).get('place') || 'ruins-st-paul'); }
  catch (e) { if(bootstrap && e.status===404){$('service-error').hidden=true;await selectPlace('ruins-st-paul');message('此建築尚未有共創檔案。可點「記錄一棟普通建築」，或从左側選擇地點。');}else{$('service-error').hidden = false; message(e.message);} }
}
$('retry').onclick = connect; $('place-search').oninput = () => bootstrap && renderPlaces();
document.addEventListener('click', act(async e => {
  const target = e.target.closest('button'); if (!target) return;
  if (target.dataset.place) return selectPlace(target.dataset.place);
  if (target.dataset.tab) return showTab(target.dataset.tab);
  if (target.dataset.editStory) return openStory(current.stories.find(s => s.id === target.dataset.editStory));
  if (target.dataset.storyCard) return addCard('story', target.dataset.storyCard);
  if (target.dataset.clue) return addCard('knowledge', target.dataset.clue);
  if (target.dataset.move) { syncPuzzle(); const i = Number(target.dataset.move), j = i + Number(target.dataset.direction); [puzzle.cards[i],puzzle.cards[j]] = [puzzle.cards[j],puzzle.cards[i]]; return renderPuzzle(); }
  if (target.dataset.remove) { syncPuzzle(); puzzle.cards.splice(Number(target.dataset.remove), 1); return renderPuzzle(); }
  if (target.dataset.removeMedia) { media = media.filter(m => m.id !== target.dataset.removeMedia); return renderStoryMedia(); }
  if (target.dataset.removeFile) { const i = Number(target.dataset.removeFile); if (pendingFiles[i] === audioBlob) { audioBlob = null; $('transcribe').disabled = true; } pendingFiles.splice(i, 1); URL.revokeObjectURL(localUrls.splice(i,1)[0]); return renderStoryMedia(); }
  if (target.dataset.review) { const id = target.dataset.review; await api('/review/' + id, { status: target.dataset.state, note: $('review-list').querySelector(`[data-review-note="${id}"]`).value, version: Number(target.dataset.version) }); current = await api('/place/' + current.place.id); renderCurrent(); message('審核結果已保存。'); }
  if (target.dataset.feedback) { const id = target.dataset.feedback; await api('/class/' + activity.room.id + '/feedback', { submissionId: id, version: Number(target.dataset.version), text: $('class-submissions').querySelector(`[data-feedback-text="${id}"]`).value }); await loadActivity(activity.room.id); message('教師回饋已保存。'); }
}));
$('write-story').onclick = () => current && openStory(); $('close-story').onclick = () => { stopRecording(); $('story-dialog').close(); };
$('story-dialog').addEventListener('cancel', stopRecording);
$('story-files').onchange = e => { for (const f of e.target.files) { if (media.length + pendingFiles.length >= 6) { message('每則記憶最多六份附件。'); break; } if (f.size > 20 * 1024 ** 2) { message('單份照片／錄音最多 20 MB。'); continue; } pendingFiles.push(f); localUrls.push(URL.createObjectURL(f)); if (f.type.startsWith('audio/')) { audioBlob = f; $('transcribe').disabled = false; } } renderStoryMedia(); e.target.value = ''; };
$('record').onclick = act(async () => {
  if (recorder?.state === 'recording') return stopRecording();
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('此瀏覽器無法錄音，請用 HTTPS 或本機 Chrome／Edge，亦可上傳錄音檔。');
  if (media.length + pendingFiles.length >= 6) throw new Error('請先移除一份附件。');
  const generation = recordGeneration;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  if (generation !== recordGeneration || !$('story-dialog').open) { stream.getTracks().forEach(t => t.stop()); return; }
  recordingStream = stream;
  const mime = ['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(m => MediaRecorder.isTypeSupported(m));
  try { recorder = new MediaRecorder(recordingStream, mime ? { mimeType: mime } : {}); recordingParts = []; recordingStarted = Date.now();
    recorder.ondataavailable = e => { if (e.data.size) recordingParts.push(e.data); };
    recorder.onstop = () => { if (generation !== recordGeneration || !$('story-dialog').open) return; const type = recorder.mimeType.split(';')[0]; audioBlob = new File(recordingParts, '我的原聲.' + (type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'), { type }); pendingFiles.push(audioBlob); localUrls.push(URL.createObjectURL(audioBlob)); $('transcribe').disabled = false; $('record-status').textContent = `原聲已準備，約 ${Math.round((Date.now() - recordingStarted) / 1000)} 秒`; renderStoryMedia(); };
    recorder.start(); $('record').textContent = '結束錄音'; $('record-status').textContent = '正在錄音…'; recordingTimer = setTimeout(stopRecording, 180000);
  } catch (e) { recordingStream.getTracks().forEach(t => t.stop()); throw e; }
});
$('transcribe').onclick = act(async () => {
  if (!audioBlob) throw new Error('請先錄音或選擇錄音檔。');
  const context = new AudioContext();
  try { const decoded = await context.decodeAudioData(await audioBlob.arrayBuffer()); if (decoded.duration > 180) throw new Error('轉寫最多三分鐘。');
    const mono = new Float32Array(decoded.length); for (let c = 0; c < decoded.numberOfChannels; c++) { const channel = decoded.getChannelData(c); for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / decoded.numberOfChannels; }
    const parts = [];
    for (let start = 0; start < mono.length; start += decoded.sampleRate * 20) { $('record-status').textContent = `正在轉寫 ${Math.floor(start / decoded.sampleRate)} 秒以後的錄音…`; const audio = base64Audio(encodeWav(mono.subarray(start, start + decoded.sampleRate * 20), decoded.sampleRate)); const r = await fetch('/api/guide/asr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audio }) }); const out = await r.json(); if (!r.ok) throw new Error(out.error || '請先啟動並設定騰訊雲語音服務。'); parts.push(out.text); }
    const old = $('story-form').elements.text.value; $('story-form').elements.text.value = [old, parts.join('')].filter(Boolean).join('\n'); $('record-status').textContent = '轉寫完成，請修改確認後保存。';
  } finally { await context.close(); }
});
$('story-form').onsubmit = act(async e => {
  if (recorder?.state === 'recording') throw new Error('請先結束錄音。');
  const values = Object.fromEntries(new FormData(e.target)); values.consent = e.target.elements.consent.checked;
  message('正在保存附件…');
  while (pendingFiles.length) { const m = await upload(pendingFiles[0]); media.push(m); pendingFiles.shift(); URL.revokeObjectURL(localUrls.shift()); }
  if (values.status === 'pending') message('正在由 AI 檢查文字與照片是否合理…');
  const saved = await api(editedStory ? '/stories/' + editedStory.id : '/stories', { ...values, placeId: current.place.id, mediaIds: media.map(m => m.id), version: editedStory?.version }, editedStory ? 'PATCH' : 'POST');
  $('story-dialog').close(); clearStoryMedia(); await selectPlace(current.place.id); message(saved.status === 'pending' ? '已通過 AI 內容檢查，等待本機人工審核。' : '私人記憶已保存。');
});
$('puzzle-cards').addEventListener('input', e => { if (e.target.dataset.cardNote !== undefined) puzzle.cards[Number(e.target.dataset.cardNote)].note = e.target.value; });
$('puzzle-cards').addEventListener('change', e => { if (e.target.dataset.cardConfirm !== undefined) puzzle.cards[Number(e.target.dataset.cardConfirm)].confirmed = e.target.checked; });
let dragged;
$('puzzle-cards').ondragstart = e => { dragged = Number(e.target.closest('[data-index]')?.dataset.index); };
$('puzzle-cards').ondragover = e => e.preventDefault();
$('puzzle-cards').ondrop = e => { e.preventDefault(); const destination = Number(e.target.closest('[data-index]')?.dataset.index); if (!Number.isInteger(dragged) || !Number.isInteger(destination)) return; syncPuzzle(); const [card] = puzzle.cards.splice(dragged,1); puzzle.cards.splice(destination,0,card); dragged = undefined; renderPuzzle(); };
$('add-note').onclick = () => addCard('note', null);
$('puzzle-select').onchange = e => { puzzle = structuredClone(current.puzzles.find(p => p.id === e.target.value) || { cards: [] }); renderPuzzle(); };
$('save-puzzle').onclick = act(async () => { syncPuzzle(); puzzle = await api(puzzle.id ? '/puzzles/' + puzzle.id : '/puzzles', { ...puzzle, placeId: current.place.id }, puzzle.id ? 'PATCH' : 'POST'); current.puzzles = (await api('/place/' + current.place.id)).puzzles; $('puzzle-select').innerHTML = '<option value="">建立新拼圖</option>' + current.puzzles.map(p => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join(''); $('puzzle-select').value = puzzle.id; $('submission-puzzle').innerHTML = '<option value="">不附拼圖</option>' + current.puzzles.map(p => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join(''); message('拼圖已保存，可稍後重新開啟。'); });
$('puzzle-report').onclick = () => { syncPuzzle(); report(puzzle.title || '我的記憶拼圖', `<p>地點：${esc(current.place.name)}</p>` + puzzleReport(puzzle)); };
for (const [id, ai] of [['find-clues',false],['ai-clues',true]]) $(id).onclick = act(async () => { const result = await api('/suggest', { placeId: current.place.id, text: $('clue-query').value, ai }); $('clue-explanation').textContent = `${result.mode}：${result.explanation}`; renderClues(result.cards); });
$('new-place').onclick = () => { if (!bootstrap) return message('請先連接本機服務。'); $('place-form').reset(); $('capture-reference').textContent = ''; $('place-dialog').showModal(); };
$('close-place').onclick = () => $('place-dialog').close();
$('capture-location').onclick = () => navigator.geolocation?.getCurrentPosition(p => { $('capture-reference').textContent = `拍攝者位置參考：${p.coords.longitude.toFixed(6)}, ${p.coords.latitude.toFixed(6)}；裝置回報範圍約 ${Math.round(p.coords.accuracy)} 公尺。請另行確認建築座標。`; }, e => { $('capture-reference').textContent = e.message; }, { enableHighAccuracy: true, timeout: 15000 });
$('place-form').onsubmit = act(async e => { const b = Object.fromEntries(new FormData(e.target)); if (!!b.lon !== !!b.lat) throw new Error('請同時填寫經度與緯度，或同時留空。'); const p = await api('/places', { ...b, coordinates: b.lon && b.lat ? [Number(b.lon), Number(b.lat)] : null, confirmNearby: e.target.elements.confirmNearby.checked }); bootstrap.places.push(p); $('place-dialog').close(); await selectPlace(p.id); message('普通建築已建立永久編號。'); });
$('export').onclick = act(async () => download('途見我的記憶資料.json', await api('/export')));
$('knowledge-form').onsubmit = act(async e => { const b = Object.fromEntries(new FormData(e.target)); const k = await api('/knowledge', { ...b, placeIds: e.target.elements.samePlace.checked ? [current.place.id] : [] }); bootstrap.knowledge.push(k); e.target.reset(); message('來源資料已保存，可在拼圖中檢索。'); });
$('create-class').onsubmit = act(async e => { const b = Object.fromEntries(new FormData(e.target)); const c = await api('/classes', { ...b, placeIds: [...$('class-places').selectedOptions].map(o => o.value) }); bootstrap.classes.push(c); renderActivities(); $('class-select').value = c.id; await loadActivity(c.id); });
$('join-class').onsubmit = act(async e => { const c = await api('/classes/join', Object.fromEntries(new FormData(e.target))); if (!bootstrap.classes.some(x => x.id === c.id)) bootstrap.classes.push(c); renderActivities(); $('class-select').value = c.id; await loadActivity(c.id); });
$('class-select').onchange = act(e => loadActivity(e.target.value));
$('submission-form').onsubmit = act(async e => { if (!activity) throw new Error('請先選擇活動。'); const b = Object.fromEntries(new FormData(e.target)); await api('/submissions', { ...b, classId: activity.room.id, placeId: b.stage === 'during' ? b.placeId : null, puzzleId: b.puzzleId || null }); await loadActivity(activity.room.id); message('探究記錄已保存。'); });
$('class-report').onclick = () => { if (activity) report(activity.room.title, `<p>探究問題：${esc(activity.room.question)}</p>` + activity.submissions.map(s => `<article><h2>${esc(s.name)} · ${stages[s.stage]}</h2><p>${esc(s.text)}</p>${s.puzzle ? `<h3>${esc(s.puzzle.title)}</h3><p>${esc(s.puzzle.interpretation)}</p>${s.puzzle.cards.map(c=>`<h4>${esc(c.source?.title || '作者筆記')}</h4><p>${esc(c.source?.text || '')}</p><p>${esc(c.note)}</p>${c.source?.sourceUrl?`<a href="${esc(safeLink(c.source.sourceUrl))}">${esc(c.source.sourceTitle)}</a>`:''}`).join('')}` : ''}${s.teacherFeedback ? `<p>教師回饋：${esc(s.teacherFeedback)}</p>` : ''}</article>`).join('')); };
$('import-scene').onclick = () => $('scene-bundle').click();
$('scene-bundle').onchange = act(async e => {
  const file = e.target.files[0]; if (!file) return; if (file.size > 500000) throw new Error('工程清單過大。');
  const b = JSON.parse(await file.text()); if (b.schemaVersion !== 1 || b.kind !== 'tujian-memory-scene' || !b.scene?.camera || !b.place?.id || !/^[a-f0-9]{64}$/.test(b.scene.sha256)) throw new Error('請選擇 MacauSplat 記憶工程 manifest.json。');
  if (![current.place.id,current.place.spotId,current.place.memoryId].includes(b.place.id)) throw new Error('工程的建築編號與目前地點不同，請先選擇正確地點。');
  importedBundle = b; $('scene-form').hidden = false; $('scene-form').elements.versionLabel.value = b.scene.versionLabel; $('scene-form').elements.capturedAt.value = b.scene.capturedAt || ''; $('scene-import-info').textContent = `請選擇 ${b.scene.file}；網站會核對原始模型 SHA-256。`;
});
$('scene-form').onsubmit = act(async e => { const f = e.target.elements.model.files[0]; if (!importedBundle || !f) throw new Error('請先選擇工程清單及 PLY。'); message('正在保存原始高斯模型…'); const m = await upload(f, 'application/x-ply'); if (m.sha256 !== importedBundle.scene.sha256) throw new Error('模型 SHA-256 與工程清單不一致，尚未建立實景版本。'); await api('/scenes', { ...importedBundle.scene, title: importedBundle.scene.title || current.place.name, placeId: current.place.id, modelId: m.id, versionLabel: e.target.elements.versionLabel.value, capturedAt: e.target.elements.capturedAt.value }); $('scene-form').hidden = true; current = await api('/place/' + current.place.id); renderScenes(); message('實景版本已導入，原始模型字節已核對。'); });
window.addEventListener('pagehide', () => { stopRecording(); localUrls.forEach(u => URL.revokeObjectURL(u)); });
connect();
