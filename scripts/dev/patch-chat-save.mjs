import fs from "node:fs";
let m = fs.readFileSync("src/main.js", "utf8");
// 允許只改模型／思考模式而不用重輸金鑰
m = m.replace(
  `$("#ai-save").addEventListener("click", () => {
  const k = $("#ai-key").value.trim();
  if (!k) { toast(T("請輸入 API Key")); return; }
  ai.setKey(k, { remember: true });
  ai.setModel($("#ai-model").value);
  ai.setThinking($("#ai-think")?.checked ?? false);
  openAiSetup(false);
  $("#ai-sub").textContent = \`DeepSeek · \${ai.model}\`;
  toast(T("已儲存 API Key（僅存在此瀏覽器）"));
});`,
  `$("#ai-save").addEventListener("click", async () => {
  const k = $("#ai-key").value.trim();
  if (!k && !ai.ready) { toast(T("請輸入 API Key")); return; }
  if (k) ai.setKey(k, { remember: true });   // 留空＝沿用已儲存的金鑰
  ai.setModel($("#ai-model").value);
  ai.setThinking($("#ai-think")?.checked ?? false);
  openAiSetup(false);
  if (ai.ready) await ai.listModels();       // 重新取得此帳號可用的模型
  const sel = $("#ai-model");
  if (sel && ai.availableModels?.length) {
    sel.innerHTML = ai.availableModels.map((id) => \`<option value="\${id}">\${id}</option>\`).join("");
    sel.value = ai.model;
  }
  $("#ai-sub").textContent = \`DeepSeek · \${ai.model}\${ai.thinking ? "（深度思考）" : ""}\${ai.source === "local" ? " · 本機金鑰" : ""}\`;
  toast(k ? T("已儲存設定（金鑰只存在此瀏覽器）") : T("已更新模型設定"));
});`
);
// 設定面板提示：已存金鑰可留空
m = m.replace(
  `  if (on) {
    $("#ai-key").value = "";`,
  `  if (on) {
    $("#ai-key").value = "";
    $("#ai-key").placeholder = ai.ready && ai.source === "user" ? "（已儲存，留空即沿用）" : "sk-...";`
);
fs.writeFileSync("src/main.js", m);
console.log("已允許只改模型／思考模式");
