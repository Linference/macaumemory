import fs from "node:fs";
let m = fs.readFileSync("src/main.js", "utf8");
m = m.replace(
  `import { AiChat } from "./chat.js";`,
  `import { AiChat } from "./chat.js";
import { Speaker, Listener, speechSupported } from "./speech.js";
import { DigitalHuman } from "./avatar.js";`
);
// 在 AI 區塊之前插入數位人與語音
m = m.replace(
  `// ---------------------------------------------------------------- AI 導覽助理`,
  `// ---------------------------------------------------------------- 數位人 + 語音
const dh = new DigitalHuman({ canvas: $("#dh-canvas"), bubbleEl: $("#dh-bubble") });
const speaker = new Speaker({
  onStart: () => { dh.setState("talking"); dh.say($("#dh-bubble").textContent || "…", { ms: 6000 }); },
  onProgress: (e) => { if (e.kind === "boundary") dh.talkTick(1); },
  onEnd: () => { if (dh.state === "talking") dh.setState("idle"); },
  onError: (msg) => toast(T(msg)),
});
let autoSpeak = localStorage.getItem("macau.ai.speak") === "1";
const listener = new Listener({
  onPartial: (t) => { $("#ai-text").value = t; },
  onFinal: (t) => { $("#ai-text").value = t; sendAi(t, { fromVoice: true }); },
  onError: (msg) => { toast(T(msg)); dh.setState("idle"); $("#ai-mic")?.classList.remove("on", "listening"); },
  onStateChange: (on) => {
    $("#ai-mic")?.classList.toggle("on", on);
    $("#dh-mic")?.classList.toggle("listening", on);
    dh.setState(on ? "listening" : "idle");
    if (on) dh.say(T("我在聽…請說"), { ms: 4000 });
  },
});
async function toggleVoiceInput() {
  if (!listener.supported) { toast(T("此瀏覽器不支援語音識別，建議用 Chrome 或 Edge；仍可直接打字")); return; }
  if (speaker.speaking) speaker.stop();
  if (listener.active) { listener.stop(); return; }
  if (!$("#ai-panel").classList.contains("on")) { $("#ai-fab").click(); }
  if (!ai.ready) { toast(T("請先設定 API Key 再使用語音對話")); return; }
  listener.start({ lang: "zh-TW" });
}
function updateSpeakBtn() {
  for (const sel of ["#dh-speak"]) $(sel)?.classList.toggle("on", autoSpeak);
}
$("#dh-mic").addEventListener("click", toggleVoiceInput);
$("#ai-mic").addEventListener("click", toggleVoiceInput);
$("#dh-speak").addEventListener("click", () => {
  autoSpeak = !autoSpeak;
  localStorage.setItem("macau.ai.speak", autoSpeak ? "1" : "0");
  updateSpeakBtn();
  if (!autoSpeak) speaker.stop();
  toast(autoSpeak ? T("已開啟自動朗讀") : T("已關閉自動朗讀"));
  dh.say(autoSpeak ? T("好的，我會把回答唸出來 🔊") : T("已關閉朗讀"), { ms: 2200 });
});
$("#dh-chat").addEventListener("click", () => $("#ai-fab").click());
$("#dh-card").addEventListener("click", (e) => { if (e.target.id === "dh-canvas") $("#ai-fab").click(); });
updateSpeakBtn();
dh.init().then(() => {
  dh.setState("idle");
  dh.say(T("你好，我是導覽員小澳 🧭 可以問我景點、路線或美食"), { ms: 5200 });
}).catch((e) => console.warn("avatar:", e));

// ---------------------------------------------------------------- AI 導覽助理`
);
// AI 回覆流程接上數位人與朗讀
m = m.replace(
  `async function sendAi(text) {
  const t = (text ?? $("#ai-text").value).trim();
  if (!t) return;`,
  `async function sendAi(text, { fromVoice = false } = {}) {
  const t = (text ?? $("#ai-text").value).trim();
  if (!t) return;
  if (speaker.speaking) speaker.stop();`
);
m = m.replace(
  `  const bubble = addAiMsg("ai", "");
  bubble.classList.add("typing");
  $("#ai-send").disabled = true;`,
  `  const bubble = addAiMsg("ai", "");
  bubble.classList.add("typing");
  $("#ai-send").disabled = true;
  dh.setState("thinking");
  dh.say(fromVoice ? T("收到，正在查資料…") : T("讓我想想…"), { ms: 3000 });`
);
m = m.replace(
  `  if (res.reasoning && !res.text) {
    bubble.innerHTML = \`<div class="ai-think-box"><b>思考過程（未產生最終回答）</b>\${renderAiText(res.reasoning)}</div>\`;
  }`,
  `  if (res.reasoning && !res.text) {
    bubble.innerHTML = \`<div class="ai-think-box"><b>思考過程（未產生最終回答）</b>\${renderAiText(res.reasoning)}</div>\`;
  }
  // 朗讀 + 數位人動畫
  const spoken = res.text || res.reasoning || "";
  if (spoken) {
    dh.say(spoken.replace(/\\s+/g, " ").slice(0, 120) + (spoken.length > 120 ? "…" : ""), { ms: Math.min(14000, 4200 + spoken.length * 90) });
    if (autoSpeak) speaker.speak(spoken);
    else { dh.setState("happy"); setTimeout(() => { if (dh.state === "happy") dh.setState("idle"); }, 1600); }
  } else {
    dh.setState("idle");
  }`
);
// 地圖指令 → 數位人揮手提示
m = m.replace(
  `  onCommand: (cmd) => {
    const target = byId.get(cmd.id);
    if (!target) return;`,
  `  onCommand: (cmd) => {
    const target = byId.get(cmd.id);
    if (!target) return;
    dh.setState("happy");
    dh.say(cmd.type === "route" ? \`\${T("帶你過去")} \${T(target.zh)} 🧭\` : \`\${T("找到了")}：\${T(target.zh)} 📍\`, { ms: 3400 });`
);
// 說明面板補上語音操作
m = m.replace(
  `      <p>\${T("· 快捷鍵：L 開關圖層面板`,
  `      <p>\${T("· 左下角數位人「小澳」：按 🎤 用說的問問題（語音識別），開啟 🔊 會把 AI 回答朗讀出來（語音合成）；點對話圖示可開啟 AI 對話。")}</p>
      <p>\${T("· 快捷鍵：L 開關圖層面板`
);
fs.writeFileSync("src/main.js", m);
console.log("main.js：已接上數位人與語音");
