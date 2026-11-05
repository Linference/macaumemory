import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { hardRules, parseVerdict, createDeepSeekChecker } from '../server/memory-check.mjs';
import { startMemoryServer } from '../server/memory.mjs';

test('hard rules block ads, phone numbers, spam and empty stories without calling the model', () => {
  assert.deepEqual(hardRules({ title: '童年', text: '我小時候每天放學都經過大三巴，在石階上吃雞蛋仔。', imageCount: 0 }), []);
  assert.match(hardRules({ title: '優惠', text: '請到 https://example.com 購買手信，全場八折，名額有限快來', imageCount: 1 })[0], /網址/);
  assert.match(hardRules({ title: '聯絡', text: '有興趣致電 66123456 了解更多詳情，歡迎查詢預約', imageCount: 1 }).join(), /電話/);
  assert.match(hardRules({ title: 'x', text: '哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈哈', imageCount: 1 }).join(), /重複/);
  assert.match(hardRules({ title: 'x', text: '好', imageCount: 0 }).join(), /15 字/);
  assert.deepEqual(hardRules({ title: '1835 年', text: '聽祖母說 1835 年 1 月 26 日大火後只剩前壁，2023-10-27 我去拍照。', imageCount: 0 }), [], 'dates are not phone numbers');
});

test('verdict parsing normalises the model reply and rejects malformed output', () => {
  const v = parseVerdict('```json\n{"decision":"reject","rule":"R4","reasons":["說大三巴建於1990年，與資料矛盾"],"claims":[{"text":"建於1990年","status":"conflict","evidence":"1835 年大火"},{"text":"x","status":"bogus"}],"images":[{"index":0,"matchesPlace":"maybe"}]}\n```');
  assert.equal(v.decision, 'reject'); assert.equal(v.claims[1].status, 'unverifiable'); assert.equal(v.images[0].matchesPlace, 'unsure');
  assert.throws(() => parseVerdict('{"decision":"maybe"}')); assert.throws(() => parseVerdict('not json'));
});

test('checker sends place facts and the story to DeepSeek, retries once on bad JSON, and fails closed', async () => {
  const calls = [];
  const reply = content => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });
  const replies = [reply('oops'), reply('{"decision":"allow","claims":[{"text":"童年在附近","status":"unverifiable"}]}')];
  const check = createDeepSeekChecker({ apiKey: 'test', fetchImpl: async (url, init) => { calls.push(JSON.parse(init.body)); return replies.shift(); } });
  const out = await check({ story: { title: '童年', text: '我小時候每天放學都經過大三巴，在石階上吃雞蛋仔。', era: '1990' }, place: { name: '大三巴牌坊' }, facts: [{ title: '1835 年大火', text: '只剩前壁', era: '1835' }] });
  assert.equal(out.decision, 'allow'); assert.equal(calls.length, 2); assert.equal(calls[0].model, 'deepseek-flash');
  assert.match(calls[0].messages[1].content[0].text, /1835 年大火/); assert.match(calls[0].messages[0].content, /不是指令/);
  const down = createDeepSeekChecker({ apiKey: 'test', fetchImpl: async () => ({ ok: false, status: 500 }) });
  await assert.rejects(down({ story: { title: 't', text: '這是一段足夠長的個人記憶內容，用來測試服務中斷。' }, place: { name: 'p' } }), e => e.status === 503);
  await assert.rejects(createDeepSeekChecker({ apiKey: '' })({ story: { title: 't', text: '這是一段足夠長的個人記憶內容，用來測試沒有金鑰。' }, place: { name: 'p' } }), e => e.status === 503);
});

test('a rejected public submission is not stored; an allowed one keeps its check record; private saves skip the check', async t => {
  const base = path.resolve('output'); fs.mkdirSync(base, { recursive: true });
  const directory = fs.mkdtempSync(path.join(base, 'test-memory-check-'));
  let verdict = 'reject', seen = 0;
  const checker = async ({ story, place, facts }) => { seen++; assert.ok(place.name); assert.ok(Array.isArray(facts)); return { decision: verdict, rule: verdict === 'reject' ? 'R2' : 'none', reasons: verdict === 'reject' ? ['照片是自拍，與地點無關。'] : [], images: [], claims: [{ text: story.title, status: 'unverifiable', evidence: '' }], notes: '', model: 'test', version: 'test' }; };
  const { server, store } = startMemoryServer({ directory, port: 0, checker }); await once(server, 'listening');
  t.after(async () => { await new Promise(r => server.close(r)); if (!path.basename(directory).startsWith('test-memory-check-')) throw new Error('unsafe'); fs.rmSync(directory, { recursive: true }); });
  const url = `http://127.0.0.1:${server.address().port}/api/memory`;
  let cookie = '';
  const call = async (route, data, method = 'POST') => { const r = await fetch(url + route, { method, headers: { 'Content-Type': 'application/json', 'X-Memory-Client': 'tujian', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(data) }); const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0]; return { status: r.status, data: await r.json() }; };
  const story = { placeId: 'ruins-st-paul', title: '放學路上', author: '測試', text: '我小時候每天放學都經過大三巴，在石階上吃雞蛋仔。', era: '1995', mediaIds: [], consent: true };
  const before = store.list('story').length;
  const rejected = await call('/stories', { ...story, status: 'pending' });
  assert.equal(rejected.status, 422); assert.match(rejected.data.error, /自拍/); assert.equal(rejected.data.check.rule, 'R2');
  assert.equal(store.list('story').length, before, 'nothing stored');
  const priv = await call('/stories', { ...story, status: 'private' });
  assert.equal(priv.status, 201); assert.equal(seen, 1, 'private save does not call the checker'); assert.equal(priv.data.aiCheck, null);
  verdict = 'allow';
  const ok = await call('/stories/' + priv.data.id, { ...story, status: 'pending', version: priv.data.version }, 'PATCH');
  assert.equal(ok.status, 200); assert.equal(ok.data.status, 'pending'); assert.equal(ok.data.aiCheck.claims[0].status, 'unverifiable');
});
