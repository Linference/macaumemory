import fs from "node:fs";
let r = fs.readFileSync("README.md", "utf8");
r = r.replace(
  `- 金鑰只存在**你的瀏覽器 localStorage**，或本機 \`public/ai-local.json\`（已加入 \`.gitignore\`，不會被提交）`,
  `- 預設模型 **\`deepseek-flash\`**（會自動向 \`/models\` 取得此帳號可用清單，例如 \`deepseek-flash\`／\`deepseek-v4-pro\`）；
  可勾選「**深度思考模式**」，開啟後會先顯示思考過程再給答案
- 新型號預設會先輸出思考內容（\`reasoning_content\`）而吃掉 token，本專案以 \`thinking: {type:"disabled"}\` 控制，
  並同時解析 \`reasoning_content\` 與 \`content\`，避免出現「按了卻沒有回覆」
- 金鑰只存在**你的瀏覽器 localStorage**，或本機 \`public/ai-local.json\`（已加入 \`.gitignore\`，不會被提交）`
);
r = r.replace(
  `- DeepSeek API 允許瀏覽器直呼（CORS 開放），因此靜態網站也能運作；模型可切換 \`deepseek-chat\`（快）／\`deepseek-reasoner\`（推理強）`,
  `- DeepSeek API 允許瀏覽器直呼（CORS 開放），因此靜態網站也能運作；若更換金鑰或模型，在設定面板留空金鑰即可沿用舊金鑰`
);
fs.writeFileSync("README.md", r);
console.log("README 已更新 AI 模型說明");
