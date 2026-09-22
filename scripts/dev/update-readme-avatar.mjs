import fs from "node:fs";
let r = fs.readFileSync("README.md", "utf8");
r = r.replace(
  "## 巴士站與即時報站",
  `## 數位人導覽員「小澳」＋ 語音對話

左下角的 3D 數位人（以 three.js 幾何體即時建模，**不需任何外部模型檔或授權**）：

| 元件 | 說明 |
| --- | --- |
| 嘴型 | 依 TTS 的**字詞邊界事件**與節奏驅動開合，說話時同步動嘴 |
| 表情動作 | 隨機眨眼、頭部微擺、待機呼吸；推薦景點時**揮手**、進入路線時點頭 |
| 狀態 | 待機 / 聆聽（脈衝光環＋耳機發光）/ 思考（頭上三點）/ 說話 / 開心 |
| 對話泡泡 | 顯示目前正在說的内容（AI 回答節錄） |

**語音輸入（ASR）**：按 🎤 用說的問問題 —— 使用瀏覽器內建 \`SpeechRecognition\`（zh-TW），免金鑰；
Chrome／Edge 支援，其他瀏覽器會提示改用打字。
**語音輸出（TTS）**：按 🔊 開啟自動朗讀 —— 使用瀏覽器內建 \`speechSynthesis\`，優先挑選
zh-TW／zh-HK／zh-CN 的中文語音（Windows／macOS 內建），可離線運作；會自動移除 Markdown 與 emoji，
並以句子為單位排隊朗讀（附保險計時器，避免個別瀏覽器不觸發結束事件而卡住）。

> 想換成雲端語音（Azure／ElevenLabs／MiniMax 等）以獲得更自然的音色與精準嘴型，
> 只要改 \`src/speech.js\` 的 \`Speaker.speak()\`；架構已預留回呼（onStart/onProgress/onEnd）。

---

## 巴士站與即時報站`
);
r = r.replace(
  `### 中期（體驗與內容）
- [x] ~~步行路線規劃~~ → **已完成**（含開車模式、最快路徑動畫、逐段指引）`,
  `### 中期（體驗與內容）
- [x] ~~步行路線規劃~~ → **已完成**（含開車模式、最快路徑動畫、逐段指引）
- [x] ~~數位人＋語音合成／語音識別~~ → **已完成**（3D 數位人、嘴型同步、語音問答、自動朗讀）
- [ ] **雲端語音**：接 Azure／ElevenLabs TTS（更自然音色＋音訊驅動精準嘴型）與 Whisper ASR
- [ ] **數位人升級**：換成帶 blend shape 的 GLB 虛擬人（Ready Player Me／TalkingHead），支援精準 viseme`
);
r = r.replace(
  "- **深連結**：網址即時反映鏡頭與選取景點",
  `- **數位人「小澳」**：左下角 3D 導覽員，可語音問答（🎤 語音識別）與自動朗讀（🔊 語音合成）
- **深連結**：網址即時反映鏡頭與選取景點`
);
fs.writeFileSync("README.md", r);
console.log("README 已加入數位人與語音章節");
