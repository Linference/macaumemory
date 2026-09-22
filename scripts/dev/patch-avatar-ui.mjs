import fs from "node:fs";
let h = fs.readFileSync("index.html", "utf8");
// 1) 數位人面板（左下）
if (!h.includes("dh-card")) {
  h = h.replace(
    `    <!-- AI 導覽助理 -->`,
    `    <!-- 數位人導覽員 -->
    <div class="dh-card" id="dh-card">
      <div class="dh-bubble" id="dh-bubble"></div>
      <div class="dh-stage"><canvas id="dh-canvas"></canvas></div>
      <div class="dh-bar">
        <button class="dh-btn" id="dh-mic" title="語音對話（說給我聽）">
          <svg viewBox="0 0 24 24" width="15" height="15"><path d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-5a3.5 3.5 0 1 0-7 0v5A3.5 3.5 0 0 0 12 15z" fill="currentColor"/><path d="M5.5 11.5v.5a6.5 6.5 0 0 0 13 0v-.5M12 18.5V22" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/></svg>
        </button>
        <button class="dh-btn" id="dh-speak" title="自動朗讀回覆">
          <svg viewBox="0 0 24 24" width="15" height="15"><path d="M4 9.5h3l4-3.2v11.4l-4-3.2H4z" fill="currentColor"/><path d="M15 8.5a5 5 0 0 1 0 7M17.6 6a8.4 8.4 0 0 1 0 12" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/></svg>
        </button>
        <button class="dh-btn" id="dh-chat" title="開啟 AI 對話">
          <svg viewBox="0 0 24 24" width="15" height="15"><path d="M4 5.5h16v10H9l-5 4z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </div>
    <!-- AI 導覽助理 -->`
  );
  // 2) 對話框加入麥克風與朗讀開關
  h = h.replace(
    `        <button class="ai-send" id="ai-send" title="送出">`,
    `        <button class="ai-send ai-mic" id="ai-mic" title="語音輸入（按一下開始／停止）">
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-5a3.5 3.5 0 1 0-7 0v5A3.5 3.5 0 0 0 12 15z" fill="currentColor"/><path d="M5.5 11.5v.5a6.5 6.5 0 0 0 13 0v-.5M12 18.5V22" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/></svg>
        </button>
        <button class="ai-send" id="ai-send" title="送出">`
  );
  fs.writeFileSync("index.html", h);
  console.log("index.html：已加入數位人與語音按鈕");
}
// 3) 樣式
let c = fs.readFileSync("src/styles.css", "utf8");
if (!c.includes(".dh-card")) {
  c += `
/* ---------------- 數位人導覽員 ---------------- */
.dh-card { position: fixed; left: 16px; bottom: 58px; z-index: 33; width: 168px; border-radius: 16px; overflow: hidden;
  background: linear-gradient(180deg, rgba(111,178,210,.14), rgba(11,16,22,.94)); border: 1px solid var(--line);
  backdrop-filter: blur(14px); box-shadow: var(--shadow); }
.dh-stage { height: 176px; position: relative; }
#dh-canvas { width: 100%; height: 100%; display: block; }
.dh-bubble { position: absolute; left: 8px; right: 8px; bottom: 100%; margin-bottom: 8px; padding: 9px 11px; border-radius: 12px;
  background: rgba(11,16,22,.96); border: 1px solid var(--line); color: var(--ink); font-size: 12.5px; line-height: 1.65;
  opacity: 0; transform: translateY(6px); transition: opacity .25s, transform .25s; pointer-events: none; max-height: 34vh; overflow: hidden; }
.dh-bubble.on { opacity: 1; transform: none; }
.dh-bar { display: flex; gap: 6px; padding: 8px; border-top: 1px solid var(--line-soft); background: rgba(9,13,18,.6); }
.dh-btn { flex: 1; height: 30px; border-radius: 9px; border: 1px solid var(--line-soft); background: rgba(255,255,255,.05); color: var(--ink-dim); cursor: pointer; display: grid; place-items: center; transition: all .18s; }
.dh-btn:hover { color: var(--gold); border-color: var(--line); }
.dh-btn.on { background: var(--gold); color: #14171c; border-color: var(--gold); }
.dh-btn.listening { background: #d9707a; color: #fff; border-color: #d9707a; animation: dhPulse 1.1s ease-in-out infinite; }
@keyframes dhPulse { 50% { box-shadow: 0 0 0 6px rgba(217,112,122,.22); } }
.ai-mic.on { background: #d9707a; border-color: #d9707a; color: #fff; }
.ai-speak.on { color: var(--gold); border-color: var(--gold); }
@media (max-width: 900px) { .dh-card { width: 126px; bottom: 52px; } .dh-stage { height: 132px; } }
@media (max-width: 640px) { .dh-card { display: none; } }
`;
  fs.writeFileSync("src/styles.css", c);
  console.log("styles.css：已加入數位人樣式");
}
