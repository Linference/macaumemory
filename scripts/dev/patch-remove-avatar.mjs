import fs from "node:fs";

// ---------- 1) index.html：移除數位人卡片，朗讀鈕移到對話框標題列 ----------
let h = fs.readFileSync("index.html", "utf8");
const cardStart = h.indexOf("    <!-- 數位人導覽員 -->");
const cardEnd = h.indexOf("    <!-- AI 導覽助理 -->");
if (cardStart >= 0 && cardEnd > cardStart) {
  h = h.slice(0, cardStart) + h.slice(cardEnd);
  console.log("已移除數位人卡片");
}
h = h.replace(
  `        <button class="icon-btn sm" id="ai-settings" title="設定 API Key">`,
  `        <button class="icon-btn sm" id="ai-speak" title="自動朗讀回覆（語音合成）">
          <svg viewBox="0 0 24 24" width="16" height="16"><path d="M4 9.5h3l4-3.2v11.4l-4-3.2H4z" fill="currentColor"/><path d="M15 8.5a5 5 0 0 1 0 7M17.6 6a8.4 8.4 0 0 1 0 12" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/></svg>
        </button>
        <button class="icon-btn sm" id="ai-settings" title="設定 API Key">`
);
fs.writeFileSync("index.html", h);
console.log("index.html：已加入對話框朗讀鈕");

// ---------- 2) styles.css：移除數位人樣式 ----------
let c = fs.readFileSync("src/styles.css", "utf8");
const dhStart = c.indexOf("/* ---------------- 數位人導覽員 ---------------- */");
if (dhStart >= 0) {
  const dhEnd = c.indexOf("/* ---------------- AI 導覽助理 ---------------- */");
  c = c.slice(0, dhStart) + (dhEnd > dhStart ? c.slice(dhEnd) : "");
  console.log("已移除數位人樣式");
}
if (!c.includes(".ai-speak.on")) c += `\n.ai-speak.on, #ai-speak.on { color: var(--gold); border-color: var(--gold); }\n`;
fs.writeFileSync("src/styles.css", c);

// ---------- 3) main.js：移除數位人，保留語音 ----------
let m = fs.readFileSync("src/main.js", "utf8");
m = m.replace(`import { DigitalHuman } from "./avatar.js";\n`, "");
// 移除整個「數位人 + 語音」區塊，改成純語音區塊
const blockStart = m.indexOf("// ---------------------------------------------------------------- 數位人 + 語音");
const blockEnd = m.indexOf("// ---------------------------------------------------------------- AI 導覽助理");
if (blockStart >= 0 && blockEnd > blockStart) {
  const replacement = `// ---------------------------------------------------------------- 語音（朗讀與語音輸入）
const speaker = new Speaker({
  onError: (msg) => toast(T(msg)),
});
let autoSpeak = localStorage.getItem("macau.ai.speak") === "1";
const listener = new Listener({
  onPartial: (t) => { $("#ai-text").value = t; },
  onFinal: (t) => { $("#ai-text").value = t; sendAi(t, { fromVoice: true }); },
  onError: (msg) => { toast(T(msg)); $("#ai-mic")?.classList.remove("on"); },
  onStateChange: (on) => $("#ai-mic")?.classList.toggle("on", on),
});
async function toggleVoiceInput() {
  if (!listener.supported) { toast(T("此瀏覽器不支援語音識別，建議用 Chrome 或 Edge；仍可直接打字")); return; }
  if (speaker.speaking) speaker.stop();
  if (listener.active) { listener.stop(); return; }
  if (!$("#ai-panel").classList.contains("on")) $("#ai-fab").click();
  if (!ai.ready) { toast(T("請先設定 API Key 再使用語音對話")); return; }
  listener.start({ lang: "zh-TW" });
}
function updateSpeakBtn() { $("#ai-speak")?.classList.toggle("on", autoSpeak); $("#ai-speak")?.setAttribute("title", T(autoSpeak ? "自動朗讀：開" : "自動朗讀：關")); }
$("#ai-mic").addEventListener("click", toggleVoiceInput);
$("#ai-speak").addEventListener("click", () => {
  autoSpeak = !autoSpeak;
  localStorage.setItem("macau.ai.speak", autoSpeak ? "1" : "0");
  updateSpeakBtn();
  if (!autoSpeak) speaker.stop();
  toast(autoSpeak ? T("已開啟自動朗讀（會把回答唸出來）") : T("已關閉自動朗讀"));
});
updateSpeakBtn();

`;
  m = m.slice(0, blockStart) + replacement + m.slice(blockEnd);
  console.log("main.js：已改為純語音區塊");
}
// sendAi 內移除數位人呼叫
m = m.replace(`  dh.setState("thinking");
  dh.say(fromVoice ? T("收到，正在查資料…") : T("讓我想想…"), { ms: 3000 });
`, "");
m = m.replace(`  // 朗讀 + 數位人動畫
  const spoken = res.text || res.reasoning || "";
  if (spoken) {
    dh.say(spoken.replace(/\\s+/g, " ").slice(0, 120) + (spoken.length > 120 ? "…" : ""), { ms: Math.min(14000, 4200 + spoken.length * 90) });
    if (autoSpeak) speaker.speak(spoken);
    else { dh.setState("happy"); setTimeout(() => { if (dh.state === "happy") dh.setState("idle"); }, 1600); }
  } else {
    dh.setState("idle");
  }`, `  // 自動朗讀
  const spoken = res.text || res.reasoning || "";
  if (autoSpeak && spoken) speaker.speak(spoken);`);
m = m.replace(`    dh.setState("happy");
    dh.say(cmd.type === "route" ? \`\${T("帶你過去")} \${T(target.zh)} 🧭\` : \`\${T("找到了")}：\${T(target.zh)} 📍\`, { ms: 3400 });
`, "");
// 說明文字更新
m = m.replace(
  `      <p>\${T("· 左下角數位人「小澳」：按 🎤 用說的問問題（語音識別），開啟 🔊 會把 AI 回答朗讀出來（語音合成）；點對話圖示可開啟 AI 對話。")}</p>\n`,
  `      <p>\${T("· AI 對話框中：按 🎤 用說的問問題（語音識別），按 🔊 開啟自動朗讀（語音合成），回答會逐句唸出。")}</p>\n`
);
fs.writeFileSync("src/main.js", m);
console.log("main.js：已移除數位人呼叫");
