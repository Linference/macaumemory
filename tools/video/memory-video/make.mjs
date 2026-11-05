// 途見建築介紹視頻生成：輸入「建築＋（可選）文字描述＋（可選）圖片」，輸出有出處、有旁白的介紹短片。
//
// 流程：
//   1 知識庫：從 public/data/building-dossiers.json 取出這棟建築所有有出處的說法，逐條編號（s0、t1、w0…）
//   2 使用者文字：先過記憶投稿檢查（不合理直接停止），通過後只能以「投稿者回憶」身份入片
//   3 分鏡：DeepSeek（可看圖）載入預設技能 SKILL.md＋知識庫＋照片，輸出 JSON 分鏡，每句旁白附說法編號
//   4 校驗：程式檢查編號、座標、字數；另一個模型逐句對照知識庫查核，有不支持的句子就退回重寫一次
//   5 旁白：騰訊雲語音合成，每個鏡頭一段
//   6 合成：Remotion（tools/video/portfolio 的 MemoryVideo），真實照片做鏡頭運動，片尾列出處與照片授權
//
// 用法（在專案根目錄）：
//   node tools/video/memory-video/make.mjs --building st-dominic [--persona student] [--text "..."] [--images a.jpg,b.jpg] [--job name] [--no-render]
// 說明：本檔由 AI 程式助手（Claude）協助撰寫。
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { callTencent } from "../../../server/tencent.js";
import { createDeepSeekChecker } from "../../../server/memory-check.mjs";
import { PERSONAS, personaPrompt, personaOf } from "../../../src/personas.js";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const PORTFOLIO = path.join(ROOT, "tools/video/portfolio");
process.loadEnvFile(path.join(ROOT, ".env.local"));
const KEY = process.env.DEEPSEEK_API_KEY;
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes("--" + k);

const buildingId = arg("building");
if (!buildingId) throw new Error("請用 --building 指定建築 id");
const persona = personaOf(arg("persona", "tourist"));
const userText = arg("text", "").trim();
const job = arg("job", `${buildingId}-${persona}`);
const jobDir = path.join(PORTFOLIO, "public/memory", job);
fs.mkdirSync(jobDir, { recursive: true });
const log = (...a) => console.log(`[${job}]`, ...a);

// ---------- 1 知識庫 ----------
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));
const attraction = read("public/data/attractions.json").attractions.find((a) => a.id === buildingId);
const dossier = read("public/data/building-dossiers.json").dossiers.find((d) => d.id === (attraction?.dossier ?? buildingId));
if (!attraction || !dossier) throw new Error(`知識庫沒有 ${buildingId} 的資料檔案`);
const pub = (keys) => [...new Set(keys.map((k) => dossier.sources[k]?.publisher.replace(/^澳門特區政府/, "")))].join("、");
const claims = [];
const add = (prefix, list, kind) => list.forEach((c, i) => claims.push({ id: `${prefix}${i}`, kind: c.kind === "inference" ? "推論" : kind, text: c.text, source: pub(c.sources) }));
add("s", [dossier.style], "風格");
add("t", dossier.timeline, "年表"); add("w", dossier.whyStyle, "風格成因"); add("f", dossier.features, "特徵"); add("n", dossier.names, "名稱由來");
add("o", dossier.oral ?? [], "口述歷史");
(dossier.conflicts ?? []).forEach((c, i) => claims.push({ id: `c${i}`, kind: "出處矛盾", text: `${c.topic}：` + c.values.map((v) => `${v.value}（${pub([v.source])}）`).join("；"), source: "多個出處" }));
if (userText) claims.push({ id: "u0", kind: "投稿者回憶（未核實）", text: userText, source: "投稿者" });
const claimIds = new Set(claims.map((c) => c.id));
log("知識庫說法", claims.length, "條");

// ---------- 2 使用者文字先過檢查 ----------
let userCheck = null;
if (userText) {
  userCheck = await createDeepSeekChecker()({ story: { title: "影片描述", text: userText, era: "" }, place: { name: attraction.zh, summary: attraction.brief }, facts: claims.filter((c) => c.id !== "u0").map((c) => ({ title: dossier.name, text: c.text, sourceTitle: c.source })) });
  log("投稿檢查", userCheck.decision, userCheck.reasons.join(" "));
  if (userCheck.decision === "reject") { fs.writeFileSync(path.join(jobDir, "report.json"), JSON.stringify({ job, rejected: userCheck }, null, 1)); throw new Error("文字描述未通過檢查：" + userCheck.reasons.join(" ")); }
}

// ---------- 3 照片 ----------
const attribution = new Map(fs.readFileSync(path.join(ROOT, "photos-src/cc/ATTRIBUTION.csv"), "utf8").replace(/^﻿/, "").split(/\r?\n/).slice(1).filter(Boolean).map((line) => {
  const cells = []; let cur = "", q = false;
  for (const ch of line) { if (ch === '"') q = !q; else if (ch === "," && !q) { cells.push(cur); cur = ""; } else cur += ch; }
  cells.push(cur);
  return [cells[3], { author: cells[5], license: cells[6], url: cells[9] }];
}));
const emb = read("public/data/memory-embeddings.json").buildings;
const folder = emb.find((b) => b.spot === buildingId || b.id === buildingId)?.id ?? buildingId;
let photoFiles = arg("images") ? arg("images").split(",").map((p) => path.resolve(p)) : [];
if (!photoFiles.length) {
  const dir = path.join(ROOT, "photos-src/cc", folder);
  const all = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).map((f) => path.join(dir, f)) : [];
  const meta = await Promise.all(all.map(async (f) => ({ f, m: await sharp(f).metadata() })));
  // 只用有授權記錄、橫向、夠大的照片
  photoFiles = meta.filter(({ f, m }) => attribution.has(path.relative(ROOT, f).replace(/\\/g, "/")) && m.width >= m.height * 1.15 && m.width >= 1000)
    .sort((a, b) => b.m.width * b.m.height - a.m.width * a.m.height).slice(0, 8).map((x) => x.f);
}
if (photoFiles.length < 2) throw new Error("可用照片不足 2 張（需要有授權記錄的橫向照片，或用 --images 提供）");
const photos = [];
for (const [i, f] of photoFiles.entries()) {
  const rel = path.relative(ROOT, f).replace(/\\/g, "/");
  const out = path.join(jobDir, `p${i}.jpg`);
  await sharp(f).rotate().resize(2400, 1600, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toFile(out);
  const thumb = (await sharp(f).rotate().resize(640, 640, { fit: "inside" }).jpeg({ quality: 75 }).toBuffer()).toString("base64");
  photos.push({ i, src: `memory/${job}/p${i}.jpg`, thumb, credit: attribution.get(rel) ?? { author: "投稿者提供", license: "使用者授權", url: "" } });
}
log("照片", photos.length, "張");

// ---------- 4 分鏡（預設技能＋知識庫＋照片）----------
const SKILL = fs.readFileSync(path.join(import.meta.dirname, "SKILL.md"), "utf8");
async function chat(model, messages, { json = true, max = 2500 } = {}) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch("https://api.deepseek.com/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(120000),
      body: JSON.stringify({ model, temperature: 0.3, max_tokens: max, thinking: { type: "disabled" }, ...(json ? { response_format: { type: "json_object" } } : {}), messages }) });
    if (r.ok) { const t = (await r.json()).choices[0].message.content; try { return json ? JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)) : t; } catch { /* 重試 */ } }
    await new Promise((s) => setTimeout(s, 3000));
  }
  throw new Error(model + " 呼叫失敗");
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, Number(v) || 0));
function validate(sb) {
  const errs = [];
  if (!Array.isArray(sb.shots) || sb.shots.length < 4 || sb.shots.length > 6) errs.push("鏡頭數須為 4–6 個");
  let chars = 0;
  for (const [k, s] of (sb.shots ?? []).entries()) {
    if (!Number.isInteger(s.image) || !photos[s.image]) errs.push(`鏡頭 ${k + 1} 的 image 編號無效`);
    if (!s.narration?.trim()) errs.push(`鏡頭 ${k + 1} 沒有旁白`);
    const bad = (s.claims ?? []).filter((c) => !claimIds.has(c));
    if (!s.claims?.length) errs.push(`鏡頭 ${k + 1} 沒有列出說法編號`);
    if (bad.length) errs.push(`鏡頭 ${k + 1} 引用了不存在的編號 ${bad.join(",")}`);
    chars += (s.narration ?? "").length;
    for (const key of ["from", "to"]) { s[key] = s[key] ?? {}; s[key].x = clamp(s[key].x ?? 0.5, 0, 1); s[key].y = clamp(s[key].y ?? 0.5, 0, 1); s[key].zoom = clamp(s[key].zoom ?? 1.15, 1.12, 1.6); }
  }
  if (chars > 230) errs.push(`旁白共 ${chars} 字，超過上限`);
  return errs;
}
const knowledge = claims.map((c) => `[${c.id}]（${c.kind}｜${c.source}）${c.text}`).join("\n");
const baseMessages = [
  { role: "system", content: `${SKILL}\n\n## 本片訪客身份\n${personaPrompt(persona)}` },
  { role: "user", content: [
    { type: "text", text: `建築：${attraction.zh}（${attraction.en}）\n\n知識庫（只能用這些說法，旁白必須附編號）：\n${knowledge}\n\n以下是可用照片，依序編號 0 到 ${photos.length - 1}。請看清楚每張照片拍到甚麼，再決定每個鏡頭用哪張、focus 對準哪裡。只輸出 JSON。` },
    ...photos.flatMap((p) => [{ type: "text", text: `照片 ${p.i}：` }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${p.thumb}` } }]),
  ] },
];
async function factCheck(sb) {
  const lines = sb.shots.map((s, k) => `${k + 1}. ${s.narration}（引用：${s.claims.join(",")}）`).join("\n");
  return chat("deepseek-v4-pro", [{ role: "system", content: "你是事實查核員。對照知識庫逐句檢查旁白：旁白中的具體事實（年份、名稱、數字、事件、因果、程度詞）必須能在它引用的說法中找到；口述、推論、矛盾須如實標示。只輸出 JSON：{\"unsupported\":[{\"shot\":序號,\"text\":\"有問題的句子\",\"why\":\"原因\"}]}" },
    { role: "user", content: `知識庫：\n${knowledge}\n\n旁白：\n${lines}` }]);
}
let storyboard, check, attempts = 0, feedback = "";
while (attempts++ < 3) {
  const msgs = feedback ? [...baseMessages, { role: "user", content: feedback }] : baseMessages;
  storyboard = await chat("deepseek-flash", msgs, { max: 3000 });
  const errs = validate(storyboard);
  if (errs.length) { feedback = "上一版分鏡有問題，請修正後重新輸出完整 JSON：\n" + errs.join("\n") + "\n上一版：" + JSON.stringify(storyboard); log("格式退回", errs.join("；")); continue; }
  check = await factCheck(storyboard);
  if (!(check.unsupported ?? []).length) break;
  feedback = "事實查核發現以下旁白沒有知識庫支持，請改寫（刪去或改為知識庫原有說法）後重新輸出完整 JSON：\n" + check.unsupported.map((u) => `鏡頭${u.shot}：${u.text}（${u.why}）`).join("\n") + "\n上一版：" + JSON.stringify(storyboard);
  log("查核退回", check.unsupported.length, "句");
}
if (validate(storyboard).length) throw new Error("分鏡三次都不合格");
log("分鏡完成，嘗試", attempts, "次；查核剩餘問題", (check?.unsupported ?? []).length);

// ---------- 5 旁白（騰訊雲語音合成）----------
const ffprobe = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", f]).toString().trim());
const shots = [];
for (const [k, s] of storyboard.shots.entries()) {
  const out = await callTencent("tts", "TextToVoice", "2019-08-23", { Text: s.narration, SessionId: randomUUID(), ModelType: 1, VoiceType: Number(process.env.TENCENT_VOICE_TYPE || 101001), Codec: "mp3", SampleRate: 16000, Speed: -1 });
  const file = path.join(jobDir, `v${k}.mp3`);
  fs.writeFileSync(file, Buffer.from(out.Audio, "base64"));
  const dur = ffprobe(file);
  shots.push({ ...s, src: photos[s.image].src, audio: `memory/${job}/v${k}.mp3`, seconds: Math.max(4.5, dur + 1.1), voiceSeconds: dur,
    sources: [...new Set(s.claims.map((id) => claims.find((c) => c.id === id)?.source).filter(Boolean))].join("、") });
}
log("旁白", shots.map((s) => s.voiceSeconds.toFixed(1)).join(" / "), "秒");

// ---------- 6 合成 ----------
const used = [...new Set(shots.map((s) => s.image))].map((i) => photos[i].credit);
const props = {
  title: storyboard.title || attraction.zh, building: attraction.zh, buildingEn: attraction.en, persona: PERSONAS[persona].label, shots,
  credits: { photos: used.map((c) => `${c.author}｜${c.license}`), sources: [...new Set(Object.values(dossier.sources).map((s) => s.publisher.replace(/^澳門特區政府/, "")))], voice: "旁白：騰訊雲語音合成（AI）", script: "分鏡與旁白：DeepSeek 依途見知識庫生成，經事實查核" },
};
const propsFile = path.join(jobDir, "props.json");
fs.writeFileSync(propsFile, JSON.stringify(props, null, 1));
fs.writeFileSync(path.join(jobDir, "report.json"), JSON.stringify({ job, building: buildingId, persona, userText, userCheck, attempts, factCheck: check, storyboard, claims, photos: photos.map(({ thumb, ...p }) => p) }, null, 1));
if (!flag("no-render")) {
  const outFile = path.join(ROOT, "output/videos", `${job}.mp4`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const r = spawnSync("npx", ["remotion", "render", "src/index.ts", "MemoryVideo", outFile, `--props=${propsFile}`], { cwd: PORTFOLIO, stdio: "inherit", shell: true });
  if (r.status) throw new Error("Remotion 合成失敗");
  log("完成", outFile);
}
