import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const fault = (message, status = 400) => Object.assign(new Error(message), { status });
export function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw fault(`文字內容須為${required ? '非空' : ''}字串，最多 ${max} 字。`);
  return value.trim();
}
export function coordinates(value) {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isFinite) || value[0] < 113.4 || value[0] > 113.7 || value[1] < 22.05 || value[1] > 22.25) throw fault('請確認澳門範圍內的建築經緯度。');
  return value;
}
export function validPose(value) {
  if (!value || !['position', 'target', 'up'].every(k => Array.isArray(value[k]) && value[k].length === 3 && value[k].every(Number.isFinite)) || !Number.isFinite(value.fov) || value.fov < 10 || value.fov > 120) throw fault('模型觀察視角格式不正確。');
  const distance = Math.hypot(...value.position.map((v, i) => v - value.target[i]));
  if (distance < .00001 || Math.hypot(...value.up) < .00001) throw fault('模型相機方向無效。');
  const d = value.position.map((v,i)=>v-value.target[i]), u=value.up, cross=Math.hypot(d[1]*u[2]-d[2]*u[1],d[2]*u[0]-d[0]*u[2],d[0]*u[1]-d[1]*u[0]);
  if(cross/(distance*Math.hypot(...u))<.00001) throw fault('相機上方向不能與觀察方向平行。');
  return value;
}
export function createMemoryStore(directory, catalog, sceneCatalog, attractions = []) {
  fs.mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, 'memory.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS objects(kind TEXT NOT NULL,id TEXT NOT NULL,owner TEXT NOT NULL,data TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,updated TEXT NOT NULL,PRIMARY KEY(kind,id));
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS revisions(kind TEXT,id TEXT,version INTEGER,data TEXT,updated TEXT);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,id TEXT NOT NULL);
  `);
  const decode = r => r ? { ...JSON.parse(r.data), id: r.id, owner: r.owner, version: r.version, updated: r.updated } : null;
  const get = (kind, id) => decode(db.prepare('SELECT * FROM objects WHERE kind=? AND id=?').get(kind, id));
  const list = kind => db.prepare('SELECT * FROM objects WHERE kind=? ORDER BY updated DESC,id').all(kind).map(decode);
  function put(kind, id, owner, data, expected) {
    const old = get(kind, id);
    if (old && expected !== old.version) throw fault('內容已更新，請重新載入再修改。', 409);
    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      if (old) db.prepare('INSERT INTO revisions VALUES(?,?,?,?,?)').run(kind, id, old.version, JSON.stringify(old), old.updated);
      db.prepare('INSERT INTO objects VALUES(?,?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data,version=excluded.version,updated=excluded.updated').run(kind, id, owner, JSON.stringify(data), (old?.version ?? 0) + 1, now);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return get(kind, id);
  }
  const settings = key => db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value;
  function session(token) {
    let row = token && db.prepare('SELECT id FROM sessions WHERE token=?').get(token);
    if (!row) {
      token = randomUUID() + randomUUID(); row = { id: randomUUID() };
      db.prepare('INSERT INTO sessions VALUES(?,?)').run(token, row.id);
      db.prepare('INSERT OR IGNORE INTO settings VALUES(?,?)').run('curator', row.id);
    }
    return { token, id: row.id, curator: settings('curator') === row.id };
  }
  for (const p of catalog.places) if (!get('place', p.id)) put('place', p.id, 'catalog', { ...p, provenance: '既有實拍建築名錄' });
  for (const a of attractions) {
    if (!list('place').some(p => p.spotId === a.id) && !get('place', a.id)) put('place', a.id, 'catalog', { name: a.zh, spotId: a.id, memoryId: null, categoryName: a.tag || '景點', coordinates: a.coords, summary: a.brief, gallery: [], cover: null, mapPath: `./?spot=${encodeURIComponent(a.id)}`, provenance: '既有景點名錄' });
  }
  for (const s of sceneCatalog.scenes) if (!get('scene', s.id)) put('scene', s.id, 'catalog', { ...s, placeId: list('place').find(p => p.spotId === s.id)?.id ?? s.id, capturedAt: null, versionLabel: '現有重建版本（採集日期未登記）', sha256: s.id === 'ruins-st-paul' ? 'd5955f72eaa5072f50fb71348a2cda47319defb0e27e732996fd8fa99b971f09' : null, hotspots: [] });
  const place = id => list('place').find(p => [p.id, p.spotId, p.memoryId].includes(id));
  const own = (record, user) => { if (!record) throw fault('記錄不存在。', 404); if (record.owner !== user.id) throw fault('只能修改自己的記錄。', 403); return record; };
  function createPlace(body, user) {
    const name = text(body.name, 100, true), coords = coordinates(body.coordinates);
    const near = coords && list('place').find(p => p.coordinates && Math.hypot((p.coordinates[0] - coords[0]) * 103000, (p.coordinates[1] - coords[1]) * 111000) < 8);
    if (near && !body.confirmNearby) throw fault(`附近已有「${near.name}」，請確認是否為不同建築後再建立。`, 409);
    const id = 'local-' + randomUUID();
    return put('place', id, user.id, { name, memoryId: 'TJ-' + randomUUID().slice(0, 8).toUpperCase(), categoryName: '社區建築', coordinates: coords, summary: text(body.summary ?? '', 1500), cover: null, gallery: [], provenance: coords ? '使用者手動確認建築位置' : '位置待確認', mapPath: coords ? `./#17/${coords[1]}/${coords[0]}` : './' });
  }
  function mediaIds(body, user, old) {
    const ids = body.mediaIds ?? [];
    if (!Array.isArray(ids) || ids.length > 6 || new Set(ids).size !== ids.length) throw fault('每則記憶最多六份不重複媒體。');
    for (const id of ids) if (get('media', id)?.owner !== user.id && !old?.mediaIds?.includes(id)) throw fault('媒體不屬於目前使用者。', 403);
    return ids;
  }
  function saveStory(body, user, id) {
    const old = id ? own(get('story', id), user) : null;
    const p = place(body.placeId); if (!p) throw fault('請先選擇或建立地點。');
    const content = text(body.text ?? '', 10000), ids = mediaIds(body, user, old);
    if (!content && !ids.length) throw fault('請填寫故事或加入照片／錄音。');
    if (!['private', 'pending'].includes(body.status)) throw fault('請選擇私人保存或提交審核。');
    if (body.status === 'pending' && body.consent !== true) throw fault('公開投稿須確認素材使用權及被錄音者同意。');
    return put('story', old?.id ?? randomUUID(), user.id, { placeId: p.id, title: text(body.title, 120, true), text: content, author: text(body.author ?? '匿名', 80, true), era: text(body.era ?? '年代不詳', 80), tags: text(body.tags ?? '', 300), status: body.status, consent: body.consent === true, mediaIds: ids, relationNote: text(body.relationNote ?? '', 1500) }, body.version);
  }
  function review(id, body, user) {
    if (!user.curator) throw fault('本機管理員才能審核。', 403);
    const s = get('story', id); if (!s || s.status !== 'pending') throw fault('只可審核待公開記憶。');
    if (!['approved', 'rejected'].includes(body.status)) throw fault('審核狀態不正確。');
    return put('story', id, s.owner, { ...s, status: body.status, reviewNote: text(body.note ?? '', 1000), reviewer: user.id }, body.version);
  }
  function savePuzzle(body, user, id) {
    const old = id ? own(get('puzzle', id), user) : null, p = place(body.placeId);
    if (!p) throw fault('地點不存在。');
    if (!Array.isArray(body.cards) || body.cards.length > 20) throw fault('拼圖最多二十張卡片。');
    const cards = body.cards.map(c => {
      if (!['story', 'knowledge', 'note'].includes(c.kind)) throw fault('拼圖卡片類型不正確。');
      if (c.kind === 'story') { const s = get('story', c.refId); if (!s || (s.status !== 'approved' && s.owner !== user.id)) throw fault('故事不可讀取。', 403); }
      if (c.kind === 'knowledge' && !get('knowledge', c.refId)) throw fault('線索已不存在。');
      return { kind: c.kind, refId: c.kind === 'note' ? null : c.refId, note: text(c.note ?? '', 2000), confirmed: c.confirmed === true };
    });
    return put('puzzle', old?.id ?? randomUUID(), user.id, { placeId: p.id, title: text(body.title, 120, true), interpretation: text(body.interpretation ?? '', 6000), cards }, body.version);
  }
  function saveKnowledge(body, user, id) {
    if (!user.curator) throw fault('本機管理員才能整理歷史資料。', 403);
    const source = text(body.sourceUrl, 1000, true); let u; try { u = new URL(source); } catch { throw fault('請填寫有效來源網址。'); }
    if (!['https:', 'http:'].includes(u.protocol)) throw fault('來源須為 HTTP/HTTPS 網址。');
    if (!['place', 'event', 'person', 'theme'].includes(body.type)) throw fault('資料類型不正確。');
    const places = body.placeIds ?? []; if (!Array.isArray(places) || places.length > 20 || places.some(id => !place(id))) throw fault('關聯地點無效。');
    const old = id ? get('knowledge', id) : null;
    return put('knowledge', old?.id ?? randomUUID(), user.id, { title: text(body.title, 160, true), text: text(body.text, 8000, true), type: body.type, era: text(body.era ?? '', 80), keywords: text(body.keywords ?? '', 500), sourceUrl: source, sourceTitle: text(body.sourceTitle, 200, true), placeIds: places.map(id => place(id).id) }, body.version);
  }
  function suggestions(query, placeId) {
    const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])];
    return list('knowledge').map(k => {
      const hay = `${k.title} ${k.text} ${k.keywords}`.toLowerCase();
      const matched = terms.filter(t => hay.includes(t));
      const keywords = k.keywords.split(/[，,、\s]+/).filter(t => t.length >= 2 && query.includes(t));
      const samePlace = k.placeIds.includes(placeId);
      return { ...k, score: matched.length + keywords.length + (samePlace ? 2 : 0), reason: samePlace ? '資料已人工關聯至此地點' : `主題詞相關：${[...new Set([...matched, ...keywords])].slice(0, 4).join('、')}`, relationStatus: '待使用者確認' };
    }).filter(k => k.score > 0).sort((a, b) => b.score - a.score).slice(0, 6);
  }
  function createClass(body, user) {
    const ids = body.placeIds; if (!Array.isArray(ids) || ids.length < 1 || ids.length > 6 || ids.some(id => !place(id))) throw fault('請選擇一至六個探究地點。');
    let code; do { code = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase(); } while (list('class').some(c => c.code === code));
    return put('class', randomUUID(), user.id, { title: text(body.title, 120, true), question: text(body.question, 2000, true), placeIds: ids.map(id => place(id).id), code });
  }
  function joinClass(code, user) {
    const room = list('class').find(c => c.code === code.toUpperCase()); if (!room) throw fault('班級碼不存在。', 404);
    if (!get('membership', `${room.id}:${user.id}`)) put('membership', `${room.id}:${user.id}`, user.id, { classId: room.id });
    return room;
  }
  function member(room, user) { return room.owner === user.id || !!get('membership', `${room.id}:${user.id}`); }
  function submit(body, user) {
    const room = get('class', body.classId); if (!room || !member(room, user)) throw fault('請先加入班級。', 403);
    if (!['before', 'during', 'after'].includes(body.stage)) throw fault('探究階段不正確。');
    if (body.stage === 'during' && !room.placeIds.includes(body.placeId)) throw fault('請選擇路線中的地點。');
    if (body.puzzleId && get('puzzle', body.puzzleId)?.owner !== user.id) throw fault('只能提交自己的拼圖。', 403);
    const id = `${room.id}:${user.id}:${body.stage}:${body.placeId ?? ''}`, old = get('submission', id);
    const attached = body.puzzleId ? get('puzzle', body.puzzleId) : null;
    const puzzleSnapshot = attached ? { ...attached, cards: attached.cards.map(c => { const source = c.kind === 'knowledge' ? get('knowledge', c.refId) : c.kind === 'story' ? get('story', c.refId) : null; if (source && c.kind === 'story' && source.owner !== user.id && source.status !== 'approved') throw fault('拼圖包含已不可讀取的故事，請先更新。'); return { ...c, source: source ? { title: source.title, text: source.text, author: source.author, era: source.era, sourceUrl: source.sourceUrl, sourceTitle: source.sourceTitle } : null }; }) } : null;
    return put('submission', id, user.id, { classId: room.id, name: text(body.name, 80, true), stage: body.stage, placeId: body.placeId ?? null, text: text(body.text, 10000, true), puzzleId: body.puzzleId ?? null, puzzleSnapshot }, old?.version);
  }
  function saveScene(body, user) {
    const p = place(body.placeId), model = get('media', body.modelId);
    if (!p || !model || model.owner !== user.id || model.mime !== 'application/x-ply') throw fault('請選擇地點並上傳原始高斯 PLY。');
    const date = text(body.capturedAt ?? '', 30); if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date)) throw fault('採集日期須為有效的 YYYY-MM-DD。');
    return put('scene', randomUUID(), user.id, { placeId: p.id, title: text(body.title, 120, true), versionLabel: text(body.versionLabel, 120, true), description: text(body.description ?? '', 2000), camera: validPose(body.camera), capturedAt: date || null, file: model.url, fileSize: model.bytes, sha256: model.sha256, splatCount: model.splatCount, source: text(body.source ?? '', 1000), hotspots: [] });
  }
  function saveHotspot(id, body, user) {
    const s = get('scene', id); if (!s) throw fault('場景不存在。', 404);
    if (s.owner !== user.id && !user.curator) throw fault('只能為自己的場景建立視角。', 403);
    const story = body.storyId ? get('story', body.storyId) : null;
    if (body.storyId && (!story || story.placeId !== s.placeId || (story.owner !== user.id && story.status !== 'approved'))) throw fault('請選擇此地點可讀取的記憶。');
    const hotspots = [...s.hotspots, { id: randomUUID(), title: text(body.title, 100, true), camera: validPose(body.camera), storyId: story?.id ?? null }];
    if (hotspots.length > 30) throw fault('每個版本最多三十個故事視角。');
    return put('scene', id, s.owner, { ...s, hotspots }, body.version);
  }
  function feedback(roomId, body, user) {
    const room = get('class', roomId), submission = get('submission', body.submissionId);
    if (!room || room.owner !== user.id || !submission || submission.classId !== roomId) throw fault('只有本活動教師可回饋記錄。', 403);
    return put('submission', submission.id, submission.owner, { ...submission, teacherFeedback: text(body.text, 3000, true) }, body.version);
  }
  return { db, get, list, put, session, place, own, member, createPlace, saveStory, review, savePuzzle, saveKnowledge, suggestions, createClass, joinClass, submit, saveScene, saveHotspot, feedback,
    close: () => db.close(), media: id => get('media', id), hash: bytes => createHash('sha256').update(bytes).digest('hex') };
}
