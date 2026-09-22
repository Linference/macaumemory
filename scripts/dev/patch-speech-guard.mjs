import fs from "node:fs";
let s = fs.readFileSync("src/speech.js", "utf8");
// 保險：若瀏覽器沒有觸發 onend（例如無音訊裝置），依文字長度估算自動結束
s = s.replace(
  `      u.onstart = () => this.onProgress({ index: idx, total: chunks.length, text: chunks[idx], kind: "start" });`,
  `      const guard = setTimeout(() => { if (this.speaking) { try { synth.cancel(); } catch {} idx = chunks.length; next(); } }, Math.min(60000, 3500 + chunks[idx].length * 380));
      u.onstart = () => { clearTimeout(guard); this.onProgress({ index: idx, total: chunks.length, text: chunks[idx], kind: "start" }); };`
);
s = s.replace(
  `      u.onend = () => { idx++; next(); };`,
  `      u.onend = () => { clearTimeout(guard); idx++; next(); };`
);
s = s.replace(
  `      u.onerror = (e) => { if (e.error !== "interrupted" && e.error !== "canceled") this.onError(\`語音合成失敗：\${e.error}\`); idx++; next(); };`,
  `      u.onerror = (e) => { clearTimeout(guard); if (e.error !== "interrupted" && e.error !== "canceled") this.onError(\`語音合成失敗：\${e.error}\`); idx++; next(); };`
);
fs.writeFileSync("src/speech.js", s);
console.log("已加入語音朗讀保險計時器");
