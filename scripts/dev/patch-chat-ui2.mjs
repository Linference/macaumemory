import fs from "node:fs";
// index.html：設定面板加入「深度思考」勾選 + 模型下拉改為動態
let h = fs.readFileSync("index.html", "utf8");
if (!h.includes("ai-think")) {
  h = h.replace(
    `        <div class="ai-setup-row">
          <select id="ai-model">
            <option value="deepseek-chat">deepseek-chat（快、便宜）</option>
            <option value="deepseek-reasoner">deepseek-reasoner（推理強）</option>
          </select>
          <button class="btn" id="ai-save">儲存並開始</button>
        </div>`,
    `        <div class="ai-setup-row">
          <select id="ai-model">
            <option value="deepseek-flash">deepseek-flash（快速）</option>
            <option value="deepseek-v4-pro">deepseek-v4-pro（更強）</option>
          </select>
          <button class="btn" id="ai-save">儲存並開始</button>
        </div>
        <label class="ai-check"><input type="checkbox" id="ai-think" /> <span>深度思考模式（較慢、會先顯示思考過程）</span></label>`
  );
  fs.writeFileSync("index.html", h);
  console.log("index.html：已加入思考模式勾選");
}
// styles.css：思考區塊樣式
let c = fs.readFileSync("src/styles.css", "utf8");
if (!c.includes(".ai-think-box")) {
  c += `
.ai-think-box { margin-bottom: 8px; padding: 8px 10px; border-radius: 9px; background: rgba(111,178,210,.07); border: 1px dashed rgba(111,178,210,.28); font-size: 11.5px; line-height: 1.7; color: #8fa6b8; white-space: pre-wrap; }
.ai-think-box b { color: #6fb2d2; font-weight: 500; display: block; margin-bottom: 3px; font-size: 11px; letter-spacing: .06em; }
.ai-check { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--ink-dim); cursor: pointer; }
.ai-check input { accent-color: var(--gold); }
.ai-msg.ai .ai-answer { white-space: pre-wrap; }
`;
  fs.writeFileSync("src/styles.css", c);
  console.log("styles.css：已加入思考區塊樣式");
}

// main.js：串流改為物件、顯示思考過程、載入模型清單、儲存思考設定
let m = fs.readFileSync("src/main.js", "utf8");
m = m.replace(
  `  const res = await ai.send(t, (partial) => {
    bubble.innerHTML = renderAiText(partial);
    $("#ai-msgs").scrollTop = $("#ai-msgs").scrollHeight;
  });`,
  `  const res = await ai.send(t, ({ content, reasoning }) => {
    bubble.innerHTML =
      (reasoning ? \`<div class="ai-think-box"><b>思考過程</b>\${renderAiText(reasoning)}</div>\` : "") +
      \`<div class="ai-answer">\${renderAiText(content)}</div>\`;
    $("#ai-msgs").scrollTop = $("#ai-msgs").scrollHeight;
  });`
);
m = m.replace(
  `  if (!res) { bubble.innerHTML = renderAiText(T("（回覆失敗，請檢查 API Key 或稍後再試）")); return; }`,
  `  if (!res) {
    bubble.classList.remove("typing");
    bubble.innerHTML = \`<div class="ai-answer">\${renderAiText(T("（沒有回覆）請在設定中確認 API Key 與模型名稱是否正確。"))}</div>\`;
    return;
  }
  if (res.reasoning && !res.text) {
    bubble.innerHTML = \`<div class="ai-think-box"><b>思考過程（未產生最終回答）</b>\${renderAiText(res.reasoning)}</div>\`;
  }`
);
m = m.replace(
  `  ai.setKey(k, { remember: true });
  ai.setModel($("#ai-model").value);`,
  `  ai.setKey(k, { remember: true });
  ai.setModel($("#ai-model").value);
  ai.setThinking($("#ai-think")?.checked ?? false);`
);
m = m.replace(
  `  if (on) {
    if (!ai.ready) await ai.init();
    $("#ai-sub").textContent = ai.ready
      ? \`DeepSeek · \${ai.model}\${ai.source === "local" ? "（本機金鑰）" : ""}\`
      : T("尚未設定 API Key");`,
  `  if (on) {
    if (!ai.ready) await ai.init();
    if (ai.ready) {
      const models = await ai.listModels();
      const sel = $("#ai-model");
      if (sel && models.length) {
        sel.innerHTML = models.map((id) => \`<option value="\${id}">\${id}</option>\`).join("");
        sel.value = ai.model;
      }
    }
    $("#ai-sub").textContent = ai.ready
      ? \`DeepSeek · \${ai.model}\${ai.thinking ? "（深度思考）" : ""}\${ai.source === "local" ? " · 本機金鑰" : ""}\`
      : T("尚未設定 API Key");`
);
m = m.replace(
  `  if (on) { $("#ai-key").value = ""; $("#ai-model").value = ai.model; $("#ai-key").focus(); }`,
  `  if (on) {
    $("#ai-key").value = "";
    $("#ai-model").value = ai.model;
    if ($("#ai-think")) $("#ai-think").checked = ai.thinking;
    $("#ai-key").focus();
  }`
);
fs.writeFileSync("src/main.js", m);
console.log("main.js：已更新思考顯示與模型清單載入");
