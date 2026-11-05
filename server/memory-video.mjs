// 記憶短片：把一段記憶變成 AI 短片（MiniMax 海螺視頻 API）。
// 1 plan：DeepSeek 依「途見預設技能」把記憶與該地點已核實的資料寫成 MiniMax 提示詞（只用資料裏有的事、帶運鏡指令、人物只拍背影）。
// 2 create：送 MiniMax 建立任務（文生視頻，或以照片作首幀的圖生視頻）。
// 3 poll：查詢狀態；成功後取得下載網址並把影片存回本機媒體庫。
// 金鑰只放在後端 .env.local（MINIMAX_API_KEY），瀏覽器永遠拿不到。
// API 依 MiniMax 開放平台文件（platform.minimax.cn，2026-11-05 查閱）：
//   POST /v1/video_generation、GET /v1/query/video_generation?task_id=、GET /v1/files/retrieve?file_id=
// 說明：本檔由 AI 程式助手（Claude）協助撰寫。
import fs from 'node:fs';
import sharp from 'sharp';

export const MODELS = ['MiniMax-Hailuo-2.3', 'MiniMax-Hailuo-02'];
const BASE = () => (process.env.MINIMAX_BASE || 'https://api.minimax.cn').replace(/\/$/, '');

const RULES = `你為「途見」把一段澳門記憶寫成 MiniMax 海螺視頻模型的提示詞（簡體中文，150–400 字）。規則：
1. 只寫資料或記憶中有的場景與年代；資料沒有的細節（人物長相、對白、事件原因）不要編造，用遠景、剪影、光影帶過。
2. 人物一律只拍背影、剪影或手部，看不清面孔；不出現任何文字、字幕或招牌字。
3. 寫清楚：年代與地點、主體、環境動態（雲、海浪、樹葉、炊煙）、光線色調、寫實電影質感。
4. 用 MiniMax 運鏡指令控制鏡頭，例如 [推進]、[拉遠]、[左搖]、[上升]、[固定]，一段最多兩個指令。
5. 若有建築，加上「建築結構與比例保持不變，不變形」。
只輸出 JSON：{"prompt":"…","basis":["提示詞依據的資料或記憶句子"],"camera":"所用運鏡"}`;

/** DeepSeek：記憶＋已核實資料 → MiniMax 提示詞 */
export async function planPrompt({ place, facts = [], story, text }, { apiKey = process.env.DEEPSEEK_API_KEY, fetchImpl = fetch } = {}) {
  if (!apiKey) throw Object.assign(new Error('DeepSeek 尚未設定，無法生成提示詞；可直接手寫提示詞。'), { status: 503 });
  const payload = {
    地點: place.name,
    已核實資料: facts.slice(0, 20).map((f) => f.text),
    記憶: story ? { 標題: story.title, 年代: story.era, 內容: story.text } : { 內容: text },
  };
  const r = await fetchImpl('https://api.deepseek.com/chat/completions', { method: 'POST', signal: AbortSignal.timeout(60000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'deepseek-flash', temperature: 0.4, max_tokens: 1200, thinking: { type: 'disabled' }, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: RULES }, { role: 'user', content: JSON.stringify(payload) }] }) });
  if (!r.ok) throw Object.assign(new Error('提示詞服務暫時不可用。'), { status: 502 });
  const t = (await r.json()).choices?.[0]?.message?.content ?? '';
  const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
  if (!j.prompt) throw Object.assign(new Error('沒有產生提示詞，請重試。'), { status: 502 });
  return { prompt: String(j.prompt).slice(0, 2000), basis: (j.basis ?? []).map(String).slice(0, 8), camera: String(j.camera ?? '') };
}

async function call(path, { method = 'GET', body, apiKey, fetchImpl }) {
  const r = await fetchImpl(BASE() + path, { method, signal: AbortSignal.timeout(60000),
    headers: { Authorization: `Bearer ${apiKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const j = await r.json().catch(() => ({}));
  const code = j.base_resp?.status_code;
  if (!r.ok || (code != null && code !== 0)) throw Object.assign(new Error(`MiniMax：${j.base_resp?.status_msg || r.status}`), { status: 502 });
  return j;
}

/** 照片檔 → 首幀 data URL（短邊 ≥ 300、最長 1280，JPEG） */
export async function firstFrame(file) {
  const buf = await sharp(file).rotate().resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  const m = await sharp(buf).metadata();
  if (Math.min(m.width, m.height) < 300) throw Object.assign(new Error('首幀照片太小（短邊需大於 300 像素）。'), { status: 400 });
  const r = m.width / m.height; if (r < 0.4 || r > 2.5) throw Object.assign(new Error('首幀照片長寬比需在 2:5 與 5:2 之間。'), { status: 400 });
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

export function createMiniMax({ apiKey = process.env.MINIMAX_API_KEY, fetchImpl = fetch } = {}) {
  const need = () => { if (!apiKey) throw Object.assign(new Error('MiniMax 尚未設定：請在 .env.local 加入 MINIMAX_API_KEY 後重啟記憶服務。'), { status: 503 }); };
  return {
    ready: () => !!apiKey,
    async create({ prompt, image, duration = 6, resolution = '768P', model = MODELS[0] }) {
      need();
      if (!MODELS.includes(model)) throw Object.assign(new Error('不支援的模型。'), { status: 400 });
      if (![6, 10].includes(Number(duration))) throw Object.assign(new Error('時長只可 6 或 10 秒。'), { status: 400 });
      if (Number(duration) === 10 && resolution === '1080P') throw Object.assign(new Error('10 秒影片只支援 768P。'), { status: 400 });
      const j = await call('/v1/video_generation', { method: 'POST', apiKey, fetchImpl, body: { model, prompt, duration: Number(duration), resolution, ...(image ? { first_frame_image: image } : {}) } });
      if (!j.task_id) throw Object.assign(new Error('MiniMax 沒有回傳任務編號。'), { status: 502 });
      return j.task_id;
    },
    async query(taskId) {
      need();
      const j = await call(`/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`, { apiKey, fetchImpl });
      return { status: j.status, fileId: j.file_id, width: j.video_width, height: j.video_height };
    },
    async download(fileId, dest) {
      need();
      const j = await call(`/v1/files/retrieve?file_id=${encodeURIComponent(fileId)}`, { apiKey, fetchImpl });
      const url = j.file?.download_url; if (!url) throw Object.assign(new Error('MiniMax 沒有回傳下載網址。'), { status: 502 });
      const r = await fetchImpl(url.startsWith('http') ? url : `https://${url}`, { signal: AbortSignal.timeout(180000) });
      if (!r.ok) throw Object.assign(new Error('影片下載失敗。'), { status: 502 });
      const buf = Buffer.from(await r.arrayBuffer());
      fs.writeFileSync(dest, buf);
      return buf.length;
    },
  };
}
