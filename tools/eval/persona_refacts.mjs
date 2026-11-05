// 重新做事實查核（C 項）：給查核員與導覽員「完全相同」的資料（建築簡介＋資料檔案，含未核實清單），
// 並規定：回答中明確標為「未核實／官方未載／不要引用」的說法是提醒，不算錯誤；現場指引、建議、提問不算事實。
// 用法：node tools/eval/persona_refacts.mjs [out/persona-eval.json]
// 說明：本檔由 AI 程式助手（Claude）協助撰寫。
import fs from "node:fs";
process.loadEnvFile(".env.local");
const FILE = process.argv[2] || "tools/eval/out/persona-eval.json";
const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
const attractions = new Map(JSON.parse(fs.readFileSync("public/data/attractions.json", "utf8")).attractions.map((a) => [a.id, a]));
const dossiers = new Map(JSON.parse(fs.readFileSync("public/data/building-dossiers.json", "utf8")).dossiers.map((d) => [d.id, d]));
const ref = (id) => { const a = attractions.get(id), d = dossiers.get(id);
  return [`簡介：${a.brief}${a.detail}`, ...[d.style, ...d.timeline, ...d.whyStyle, ...d.features, ...d.names].map((c) => (c.kind === "inference" ? "［推論］" : "") + c.text),
    ...(d.conflicts ?? []).map((c) => `矛盾：${c.topic}：${c.values.map((v) => v.value).join(" / ")}`), ...(d.oral ?? []).map((c) => "口述：" + c.text),
    ...(d.unverified ?? []).map((u) => "未核實（只可作提醒）：" + u), d.stay ? `建議停留：${d.stay.min}–${d.stay.max} 分鐘` : ""].filter(Boolean).join("\n"); };
async function judge(a) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch("https://api.deepseek.com/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
        body: JSON.stringify({ model: "deepseek-v4-pro", temperature: 0, max_tokens: 1200, thinking: { type: "disabled" }, response_format: { type: "json_object" }, messages: [
          { role: "system", content: "你是事實查核員。對照「資料」逐句檢查「回答」中的具體事實說法（年份、名稱、數字、事件、因果、『唯一／最』等程度說法）。規則：1) 資料中有、或可由資料直接得出的，不算錯；2) 回答明確標示為未核實、官方未載、不要引用的內容是提醒，不算錯；3) 現場指引、拍攝建議、提問、比喻、邀請不算事實；4) 把資料沒有的細節、誇大程度（如把『獨一無二』說成『全世界唯一刻中文』）、自創稱呼算作不支持。只輸出 JSON：{\"unsupported\":[\"...\"],\"claims\":整數}" },
          { role: "user", content: `資料：\n${ref(a.b)}\n\n回答：\n${a.text}` }] }) });
      if (!r.ok) throw new Error(String(r.status));
      const t = (await r.json()).choices[0].message.content; return JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
    } catch (e) { if (i === 2) throw e; await new Promise((s) => setTimeout(s, 3000)); }
  }
}
let next = 0;
await Promise.all(Array.from({ length: 6 }, async () => { while (next < data.answers.length) { const a = data.answers[next++]; const j = await judge(a); a.unsupported2 = (j.unsupported ?? []).length; a.unsupportedList2 = j.unsupported ?? []; a.claims2 = Number(j.claims) || 0; } }));
const groups = {}; for (const a of data.answers) { const k = a.p === "generic" ? "generic" : a.p; (groups[k] ||= []).push(a); }
const rate = (xs) => xs.reduce((s, a) => s + a.unsupported2, 0) / Math.max(1, xs.reduce((s, a) => s + a.claims2, 0));
const own = data.answers.filter((a) => a.p !== "generic"), base = groups.generic;
// 成對置換檢定：同建築同問題下，身份化回答平均錯誤數 − 統一回答錯誤數
const diffs = []; for (const a of own) { const g = base.find((x) => x.b === a.b && x.q === a.q); diffs.push(a.unsupported2 - g.unsupported2); }
const obs = diffs.reduce((s, x) => s + x, 0) / diffs.length; let ge = 0; const N = 20000;
for (let i = 0; i < N; i++) { const m = diffs.reduce((s, x) => s + (Math.random() < 0.5 ? x : -x), 0) / diffs.length; if (Math.abs(m) >= Math.abs(obs)) ge++; }
data.report.facts2 = { method: "查核員與導覽員使用相同資料；未核實提醒、現場建議不算錯", ratePersona: rate(own), rateGeneric: rate(base), meanDiffUnsupported: obs, permutationP: ge / N,
  perPersona: Object.fromEntries(Object.entries(groups).map(([k, xs]) => [k, { rate: rate(xs), unsupported: xs.reduce((s, a) => s + a.unsupported2, 0), claims: xs.reduce((s, a) => s + a.claims2, 0) }])) };
fs.writeFileSync(FILE, JSON.stringify(data, null, 1));
console.log(JSON.stringify(data.report.facts2, null, 1));
for (const a of own) for (const u of a.unsupportedList2) console.log(`- [${a.p}] ${a.b}: ${u}`);
