import fs from "node:fs";
let r = fs.readFileSync("README.md", "utf8");

// 1) 章節：數位人 → 純語音
const start = r.indexOf("## 數位人導覽員");
const end = r.indexOf("## 巴士站與即時報站");
if (start >= 0 && end > start) {
  const voiceSection = `## 語音對話（自動朗讀 ＋ 語音輸入）

AI 對話框右上角提供兩個語音功能，**都使用瀏覽器內建能力，免任何 API 金鑰**：

| 按鈕 | 功能 | 說明 |
| --- | --- | --- |
| 🔊 | **自動朗讀（TTS）** | 使用 \`speechSynthesis\`，自動挑選 zh-TW／zh-HK／zh-CN 中文語音（Windows／macOS 內建），可離線；會移除 Markdown 與 emoji，以句子為單位排隊朗讀，並附保險計時器避免卡住 |
| 🎤 | **語音輸入（ASR）** | 使用 \`SpeechRecognition\`（zh-TW）即時聽寫，說完自動送出提問；Chrome／Edge 支援，其他瀏覽器會提示改用打字 |

流程：🎤 說出問題 → 即時字幕 → 送到 DeepSeek → 串流回答 → 🔊 自動逐句唸出。

> 想換成雲端語音（Azure／ElevenLabs／MiniMax 等）以獲得更自然的音色與精準嘴型，
> 只要改 \`src/speech.js\` 的 \`Speaker.speak()\`；架構已預留 onStart／onProgress／onEnd 回呼。

---

`;
  r = r.slice(0, start) + voiceSection + r.slice(end);
  console.log("已改寫語音章節");
}
// 2) 功能列表：移除數位人 bullet
r = r.replace("- **數位人「小澳」**：左下角 3D 導覽員，可語音問答（🎤 語音識別）與自動朗讀（🔊 語音合成）\n", "");
// 3) Roadmap：數位人改為待辦
r = r.replace(
  "- [x] ~~數位人＋語音合成／語音識別~~ → **已完成**（3D 數位人、嘴型同步、語音問答、自動朗讀）\n",
  "- [x] ~~語音合成／語音識別~~ → **已完成**（對話框內建 🎤 語音輸入與 🔊 自動朗讀）\n"
);
r = r.replace(
  "- [ ] **數位人升級**：換成帶 blend shape 的 GLB 虛擬人（Ready Player Me／TalkingHead），支援精準 viseme\n",
  "- [ ] **數位人（待加入）**：改成 GLB 虛擬人（Ready Player Me／TalkingHead 皆可），搭配 blend shape 做精準嘴型；\n      先前的程式化版本保留在 git 歷史（commit 9c5a693）可隨時取回\n"
);
fs.writeFileSync("README.md", r);
console.log("README 完成，長度:", (r.length / 1024).toFixed(1), "KB");
