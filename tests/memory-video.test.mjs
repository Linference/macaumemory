import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { startMemoryServer } from '../server/memory.mjs';
import { createMiniMax, planPrompt } from '../server/memory-video.mjs';

const resp = (body, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body, arrayBuffer: async () => new TextEncoder().encode('fakeMP4').buffer });

test('MiniMax client: create, query, download, validation', async () => {
  const calls = [];
  const fetchImpl = async (u, o = {}) => {
    calls.push({ u, o });
    if (u.endsWith('/v1/video_generation')) return resp({ task_id: 'T1', base_resp: { status_code: 0 } });
    if (u.includes('/v1/query/')) return resp({ status: 'Success', file_id: 'F1', video_width: 1366, video_height: 768, base_resp: { status_code: 0 } });
    if (u.includes('/v1/files/retrieve')) return resp({ file: { download_url: 'https://cdn.example/v.mp4' }, base_resp: { status_code: 0 } });
    return resp({});
  };
  const mm = createMiniMax({ apiKey: 'k', fetchImpl });
  assert.equal(await mm.create({ prompt: '海邊 [推進]', duration: 6 }), 'T1');
  const sent = JSON.parse(calls[0].o.body);
  assert.equal(sent.model, 'MiniMax-Hailuo-2.3'); assert.equal(calls[0].o.headers.Authorization, 'Bearer k');
  await assert.rejects(mm.create({ prompt: 'x', duration: 10, resolution: '1080P' }), /768P/);
  await assert.rejects(mm.create({ prompt: 'x', duration: 8 }), /6 或 10/);
  assert.deepEqual(await mm.query('T1'), { status: 'Success', fileId: 'F1', width: 1366, height: 768 });
  const dest = path.resolve('output', 'test-mm.mp4'); fs.mkdirSync('output', { recursive: true });
  assert.equal(await mm.download('F1', dest), 7); fs.rmSync(dest);
  const err = createMiniMax({ apiKey: 'k', fetchImpl: async () => resp({ base_resp: { status_code: 1004, status_msg: 'auth failed' } }) });
  await assert.rejects(err.create({ prompt: 'x' }), /auth failed/);
  await assert.rejects(createMiniMax({ apiKey: '' }).create({ prompt: 'x' }), /MINIMAX_API_KEY/);
});

test('planPrompt sends verified facts and the memory to DeepSeek', async () => {
  let payload;
  const fetchImpl = async (u, o) => { payload = JSON.parse(o.body); return resp({ choices: [{ message: { content: '{"prompt":"1972年荔枝碗船廠 [推進]","basis":["船廠"],"camera":"[推進]"}' } }] }); };
  const r = await planPrompt({ place: { name: '荔枝碗船廠' }, facts: [{ text: '船廠片區' }], story: { title: '熱奶茶', era: '1972', text: '學徒送奶茶' } }, { apiKey: 'k', fetchImpl });
  assert.match(r.prompt, /推進/);
  const user = JSON.parse(payload.messages[1].content);
  assert.deepEqual(user.已核實資料, ['船廠片區']); assert.equal(user.記憶.內容, '學徒送奶茶');
  assert.match(payload.messages[0].content, /背影|剪影/);
});

test('HTTP video routes: plan, job, poll to stored media, daily limit, ownership', async t => {
  const base = path.resolve('output'); fs.mkdirSync(base, { recursive: true });
  const directory = fs.mkdtempSync(path.join(base, 'test-memory-video-'));
  let status = 'Processing';
  const video = { ready: () => true, create: async () => 'TASK', query: async () => ({ status, fileId: status === 'Success' ? 'F' : undefined, width: 1366, height: 768 }), download: async (_, dest) => { fs.writeFileSync(dest, 'mp4'); return 3; } };
  const planner = async ({ place, story }) => ({ prompt: `${place.name}：${story?.title ?? '描述'} [推進]`, basis: [], camera: '[推進]' });
  const { server } = startMemoryServer({ directory, port: 0, checker: async () => ({ decision: 'allow', claims: [], images: [], reasons: [] }), video, planner, dailyVideos: 2 });
  await once(server, 'listening');
  t.after(async () => { await new Promise(r => server.close(r)); fs.rmSync(directory, { recursive: true }); });
  const url = `http://127.0.0.1:${server.address().port}/api/memory`;
  const client = () => { let cookie = ''; return async (route, data) => { const r = await fetch(url + route, { method: data === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json', 'X-Memory-Client': 'tujian' }) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }); cookie = r.headers.get('set-cookie')?.split(';')[0] ?? cookie; return { status: r.status, data: await r.json().catch(() => null), cookie }; }; };
  const me = client(), other = client();
  await me('/bootstrap'); await other('/bootstrap');
  const story = await me('/stories', { placeId: 'lai-chi-vun', title: '熱奶茶', author: '匿名', text: '學徒清晨送熱奶茶到船排。', era: '1972', status: 'private', mediaIds: [] });
  assert.equal(story.status, 201);
  assert.equal((await other('/video/plan', { placeId: 'lai-chi-vun', storyId: story.data.id })).status, 403);
  assert.equal((await me('/video/plan', { placeId: 'lai-chi-vun', text: '太短' })).status, 400);
  const plan = await me('/video/plan', { placeId: 'lai-chi-vun', storyId: story.data.id });
  assert.equal(plan.status, 200); assert.match(plan.data.prompt, /熱奶茶/);
  const job = await me('/video/jobs', { placeId: 'lai-chi-vun', prompt: plan.data.prompt, duration: 6 });
  assert.equal(job.status, 201); assert.equal(job.data.taskId, 'TASK'); assert.match(job.data.label, /AI 生成/);
  assert.equal((await other('/video/jobs/' + job.data.id)).status, 404);
  const polled = await me('/video/jobs/' + job.data.id); assert.equal(polled.data.status, 'Processing', JSON.stringify(polled));
  status = 'Success';
  const done = await me('/video/jobs/' + job.data.id);
  assert.equal(done.data.status, 'Success'); assert.ok(done.data.src);
  const file = await fetch(url.replace('/api/memory', '') + done.data.src, { headers: { Cookie: done.cookie } });
  assert.equal(file.status, 200); assert.equal(file.headers.get('content-type'), 'video/mp4');
  assert.equal((await me('/videos?placeId=lai-chi-vun')).data.videos.length, 1);
  assert.equal((await other('/videos?placeId=lai-chi-vun')).data.videos.length, 0);
  assert.equal((await me('/video/jobs', { placeId: 'lai-chi-vun', prompt: 'p2' })).status, 201);
  assert.equal((await me('/video/jobs', { placeId: 'lai-chi-vun', prompt: 'p3' })).status, 429);
});
