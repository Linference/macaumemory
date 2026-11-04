// 身份化講解對比實驗：同一建築、同一問題，比較「按身份講解」與「統一講法（generic）」。
// 量三件事：
//   A 身份辨識：盲評者只看回答，猜它是寫給哪一類訪客（7 選 1，隨機猜中率 14.3%）。
//   B 適配度：盲評者按「該類訪客的需要」給 1–5 分；同一身份下，身份化回答 vs 統一回答成對比較。
//   C 事實：盲評者對照資料檔案，數出回答中「資料沒有支持」的說法；檢查身份化有沒有帶來更多錯誤。
// 生成用本機導覽後端（與網站完全相同的提示詞）；評分用另一個模型 deepseek-v4-pro，評分者看不到生成條件。
// 注意：這是以模型代替人做的初步評估，正式結論需要真人評估（須先取得 IRB 審批）。
// 用法：先啟動 guide-server（port 8787），再執行 node tools/eval/persona_eval.mjs
// 說明：本檔由 AI 程式助手（Claude）協助撰寫。
import fs from "node:fs";
import path from "node:path";
import { PERSONAS } from "../../src/personas.js";

process.loadEnvFile(".env.local");
const KEY = process.env.DEEPSEEK_API_KEY, JUDGE = "deepseek-v4-pro", GUIDE = "http://127.0.0.1:8787/api/guide/chat";
const OUT = path.resolve("tools/eval/out/persona-eval.json");
const BUILDINGS = ["ruins-st-paul", "st-dominic", "a-ma-temple", "fortress-monte", "moorish-barracks", "mandarins-house"];
const QUESTIONS = ["介紹一下這裡。", "這座建築為甚麼是這個樣子？有甚麼特別？"];
const IDS = Object.keys(PERSONAS);
// 給評分者看的「需要」——刻意和生成用的講解指令分開寫，避免評分者只是在對照指令。
const NEEDS = {
  tourist: "第一次來、時間有限的旅客：想知道最值得看的重點、在現場怎樣看，不想聽冗長歷史。",
  student: "中學生：需要易懂、有條理、能幫助理解和思考的解釋，專有名詞要有解釋。",
  teacher: "帶學生考察的老師：需要可教的知識點、可靠出處、可討論的問題或課堂活動。",
  resident: "本地居民：想從生活與社區記憶的角度重新認識熟悉的地方，願意分享自己的記憶。",
  creator: "網紅／內容創作者：需要吸引人的切入點、拍攝建議，以及可安心引用、不會傳播錯誤的事實。",
  researcher: "研究者：需要年表、明確出處、區分官方記載與推論，並指出資料矛盾。",
  family: "帶小朋友的家長：需要小朋友聽得懂、有趣、短小的講法。",
};
const dossiers = new Map(JSON.parse(fs.readFileSync("public/data/building-dossiers.json", "utf8")).dossiers.map((d) => [d.id, d]));

async function deepseek(messages, { json = false, retries = 3 } = {}) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch("https://api.deepseek.com/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ model: JUDGE, temperature: 0, max_tokens: 1200, thinking: { type: "disabled" }, ...(json ? { response_format: { type: "json_object" } } : {}), messages }), signal: AbortSignal.timeout(90000) });
      if (!r.ok) throw new Error("judge " + r.status);
      const t = (await r.json()).choices[0].message.content;
      return json ? JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)) : t;
    } catch (e) { if (i === retries - 1) throw e; await new Promise((s) => setTimeout(s, 2000 * (i + 1))); }
  }
}
async function generate(buildingId, text, persona) {
  // 遵守導覽後端每分鐘 24 次的限流：每次間隔 3 秒，遇到 429 就等 30 秒再試
  for (let i = 0; i < 12; i++) {
    await new Promise((s) => setTimeout(s, 3000));
    const r = await fetch(GUIDE, { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" }, body: JSON.stringify({ buildingId, text, persona }) });
    if (r.ok) return (await r.json()).text;
    await new Promise((s) => setTimeout(s, r.status === 429 ? 30000 : 3000));
  }
  throw new Error("guide failed");
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }));
  return out;
}
const factsOf = (id) => { const d = dossiers.get(id); return [d.style, ...d.timeline, ...d.whyStyle, ...d.features, ...d.names].map((c) => (c.kind === "inference" ? "［推論］" : "") + c.text).concat((d.conflicts ?? []).map((c) => `矛盾：${c.topic}：${c.values.map((v) => v.value).join(" / ")}`), (d.oral ?? []).map((c) => "口述：" + c.text)); };

const cache = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { answers: [] };
const jobs = [];
for (const b of BUILDINGS) for (const q of QUESTIONS) for (const p of [...IDS, "generic"]) jobs.push({ b, q, p });
console.log("generating", jobs.length);
const answers = await pool(jobs, 1, async (j) => cache.answers.find((a) => a.b === j.b && a.q === j.q && a.p === j.p) ?? { ...j, text: await generate(j.b, j.q, j.p) });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ answers }, null, 1));

const list = IDS.map((id, i) => `${i + 1}. ${id}：${NEEDS[id]}`).join("\n");
console.log("judging identification + facts");
const judged = await pool(answers, 6, async (a) => {
  if (a.guess && a.unsupported !== undefined) return a;
  const id = await deepseek([{ role: "system", content: "你是解說設計評審。只看一段建築導覽回答，判斷它最像是寫給哪一類訪客。只輸出 JSON：{\"audience\":\"代號\"}" }, { role: "user", content: `訪客類型：\n${list}\n\n回答：\n${a.text}` }], { json: true });
  const fx = await deepseek([{ role: "system", content: "你是事實查核員。對照「資料」逐句檢查「回答」，找出資料沒有支持的具體事實說法（年份、名稱、數字、事件、因果）。語氣、建議、提問、邀請不算事實。只輸出 JSON：{\"unsupported\":[\"...\"],\"claims\":整數（回答中具體事實說法的總數）}" }, { role: "user", content: `資料：\n${factsOf(a.b).join("\n")}\n\n回答：\n${a.text}` }], { json: true });
  return { ...a, guess: String(id.audience ?? "").trim(), unsupported: (fx.unsupported ?? []).length, unsupportedList: fx.unsupported ?? [], claims: Number(fx.claims) || 0 };
});
console.log("judging fit");
const pairs = [];
for (const b of BUILDINGS) for (const q of QUESTIONS) for (const p of IDS) pairs.push({ b, q, p, own: judged.find((a) => a.b === b && a.q === q && a.p === p), base: judged.find((a) => a.b === b && a.q === q && a.p === "generic") });
const fits = await pool(pairs, 6, async (x) => {
  // 兩個回答隨機排序，評審不知道哪個是身份化版本
  const swap = Math.random() < 0.5, [A, B] = swap ? [x.base, x.own] : [x.own, x.base];
  const j = await deepseek([{ role: "system", content: "你是解說設計評審。按指定訪客的需要，分別給兩段回答 1–5 分（5 最合適），考慮內容取捨、深淺、結構與語氣。只輸出 JSON：{\"A\":分數,\"B\":分數}" }, { role: "user", content: `訪客：${NEEDS[x.p]}\n\n回答 A：\n${A.text}\n\n回答 B：\n${B.text}` }], { json: true });
  const own = Number(swap ? j.B : j.A), base = Number(swap ? j.A : j.B);
  return { b: x.b, q: x.q, p: x.p, own, base };
});

// ---- 統計 ----
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
function bootCI(xs, f = mean, n = 4000) { const r = []; for (let i = 0; i < n; i++) { const s = xs.map(() => xs[Math.floor(Math.random() * xs.length)]); r.push(f(s)); } r.sort((a, b) => a - b); return [r[Math.floor(n * 0.025)], r[Math.floor(n * 0.975)]]; }
function signTest(diffs) { const pos = diffs.filter((d) => d > 0).length, neg = diffs.filter((d) => d < 0).length, n = pos + neg; let p = 0; const k = Math.min(pos, neg); const C = (n, k) => { let c = 1; for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1); return c; }; for (let i = 0; i <= k; i++) p += C(n, i); return { pos, neg, ties: diffs.length - n, p: Math.min(1, (2 * p) / 2 ** n) }; }
const own = judged.filter((a) => a.p !== "generic"), base = judged.filter((a) => a.p === "generic");
const idAcc = own.filter((a) => a.guess === a.p).length / own.length;
const perPersona = Object.fromEntries(IDS.map((id) => { const f = fits.filter((x) => x.p === id); const g = own.filter((a) => a.p === id); return [id, { fitOwn: mean(f.map((x) => x.own)), fitGeneric: mean(f.map((x) => x.base)), idAcc: g.filter((a) => a.guess === id).length / g.length }]; }));
const diffs = fits.map((x) => x.own - x.base);
const rate = (xs) => xs.reduce((s, a) => s + a.unsupported, 0) / Math.max(1, xs.reduce((s, a) => s + a.claims, 0));
const report = {
  setup: { buildings: BUILDINGS.length, questions: QUESTIONS.length, personas: IDS.length, generator: "本機導覽後端（" + (process.env.DEEPSEEK_MODEL || "deepseek-chat") + "）", judge: JUDGE, date: new Date().toISOString().slice(0, 10) },
  identification: { accuracy: idAcc, chance: 1 / IDS.length, n: own.length, ci95: bootCI(own.map((a) => (a.guess === a.p ? 1 : 0))), genericGuessedAs: Object.fromEntries(IDS.map((id) => [id, base.filter((a) => a.guess === id).length])) },
  fit: { meanOwn: mean(fits.map((x) => x.own)), meanGeneric: mean(fits.map((x) => x.base)), meanDiff: mean(diffs), ci95: bootCI(diffs), sign: signTest(diffs), n: fits.length, perPersona },
  facts: { unsupportedPerClaimPersona: rate(own), unsupportedPerClaimGeneric: rate(base), meanUnsupportedPersona: mean(own.map((a) => a.unsupported)), meanUnsupportedGeneric: mean(base.map((a) => a.unsupported)), meanLenPersona: mean(own.map((a) => a.text.length)), meanLenGeneric: mean(base.map((a) => a.text.length)) },
};
fs.writeFileSync(OUT, JSON.stringify({ report, answers: judged, fits }, null, 1));
console.log(JSON.stringify(report, null, 1));
