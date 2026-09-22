import fs from "node:fs";
let s = fs.readFileSync("src/chat.js", "utf8");

// 1) 預設模型改為 deepseek-flash，加入思考模式開關與模型清單
s = s.replace(
  `const ENDPOINT = "https://api.deepseek.com/chat/completions";
const KEY_STORE = "macau.ai.key";
const MODEL_STORE = "macau.ai.model";`,
  `const ENDPOINT = "https://api.deepseek.com/chat/completions";
const MODELS_ENDPOINT = "https://api.deepseek.com/models";
const KEY_STORE = "macau.ai.key";
const MODEL_STORE = "macau.ai.model";
const THINK_STORE = "macau.ai.thinking";
const DEFAULT_MODELS = ["deepseek-flash", "deepseek-v4-pro"];`
);
s = s.replace(
  `    this.model = localStorage.getItem(MODEL_STORE) || "deepseek-chat";
    this.source = null; // local / user`,
  `    this.model = localStorage.getItem(MODEL_STORE) || "deepseek-flash";
    this.thinking = localStorage.getItem(THINK_STORE) === "1"; // 預設關閉思考（速度優先）
    this.source = null; // local / user
    this.availableModels = [...DEFAULT_MODELS];`
);
s = s.replace(
  `  setModel(model) {
    this.model = model;
    localStorage.setItem(MODEL_STORE, model);
  }`,
  `  setModel(model) {
    this.model = model;
    localStorage.setItem(MODEL_STORE, model);
  }

  setThinking(on) {
    this.thinking = !!on;
    localStorage.setItem(THINK_STORE, on ? "1" : "0");
  }

  /** 向 API 取得此帳號可用的模型清單（失敗時用預設值） */
  async listModels() {
    if (!this.key) return this.availableModels;
    try {
      const res = await fetch(MODELS_ENDPOINT, { headers: { Authorization: \`Bearer \${this.key}\` } });
      if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
      const j = await res.json();
      const ids = (j.data ?? []).map((m) => m.id).filter(Boolean);
      if (ids.length) {
        this.availableModels = ids;
        if (!ids.includes(this.model)) this.setModel(ids[0]); // 舊的模型名稱已不存在 → 自動切換
      }
    } catch (e) {
      console.warn("列出模型失敗：", e.message);
    }
    return this.availableModels;
  }`
);
// 2) 請求內容：加入 thinking 參數、提高 max_tokens
s = s.replace(
  `    const payload = {
      model: this.model,
      messages: [{ role: "system", content: this.buildSystemPrompt() }, ...this.messages.slice(-12)],
      temperature: 0.7,
      max_tokens: 900,
      stream: true,
    };`,
  `    const payload = {
      model: this.model,
      messages: [{ role: "system", content: this.buildSystemPrompt() }, ...this.messages.slice(-12)],
      temperature: 0.7,
      max_tokens: this.thinking ? 3000 : 1400,
      stream: true,
      // 新型號（deepseek-flash / deepseek-v4-pro）預設會先輸出思考過程而吃掉 token，
      // 導致 max_tokens 用完、content 為空。可用 thinking.type 控制。
      thinking: { type: this.thinking ? "enabled" : "disabled" },
    };`
);
// 3) 串流解析：同時收集 reasoning_content 與 content
s = s.replace(
  `    let full = "";`,
  `    let full = "";
    let reasoning = "";`
);
s = s.replace(
  `            const j = JSON.parse(data);
            const delta = j.choices?.[0]?.delta?.content ?? "";
            if (delta) { full += delta; onDelta?.(full); }`,
  `            const j = JSON.parse(data);
            const d = j.choices?.[0]?.delta ?? {};
            let changed = false;
            if (d.reasoning_content) { reasoning += d.reasoning_content; changed = true; }
            if (d.content) { full += d.content; changed = true; }
            if (changed) onDelta?.({ content: full, reasoning });`
);
// 4) 收尾：若 content 為空但思考有內容，用思考內容當回覆
s = s.replace(
  `    this.busy = false;
    // 解析地圖指令
    const cmds = [...full.matchAll(/\\[\\[(goto|route):([\\w\\-]+)\\]\\]/g)].map((m) => ({ type: m[1], id: m[2] }));
    const clean = full.replace(/\\[\\[(goto|route):[\\w\\-]+\\]\\]/g, "").trim();
    this.messages.push({ role: "assistant", content: clean });
    if (cmds.length) this.onCommand(cmds[0]);
    return { text: clean, commands: cmds };`,
  `    this.busy = false;
    // 若模型只吐思考內容（token 用完），至少把思考內容當作回覆，避免「什麼都沒有」
    let answer = full.trim();
    if (!answer && reasoning.trim()) answer = reasoning.trim().split("\\n").slice(-6).join("\\n").trim();
    const cmds = [...answer.matchAll(/\\[\\[(goto|route):([\\w\\-]+)\\]\\]/g)].map((m) => ({ type: m[1], id: m[2] }));
    const clean = answer.replace(/\\[\\[(goto|route):[\\w\\-]+\\]\\]/g, "").trim();
    this.messages.push({ role: "assistant", content: clean });
    if (cmds.length) this.onCommand(cmds[0]);
    return { text: clean, reasoning, commands: cmds };`
);
// 5) 錯誤訊息帶上模型名稱，方便排查
s = s.replace(
  `        throw new Error(res.status === 401 ? "API Key 無效或已過期" : \`API 回應 \${res.status}：\${detail.slice(0, 120)}\`);`,
  `        throw new Error(res.status === 401
          ? "API Key 無效或已過期"
          : res.status === 400 && /model/i.test(detail) ? \`模型「\${this.model}」不適用此帳號（請在設定中換一個）\`
            : \`API 回應 \${res.status}：\${detail.slice(0, 140)}\`);`
);
fs.writeFileSync("src/chat.js", s);
console.log("chat.js 已更新：deepseek-flash + thinking 控制 + 思考過程顯示 + 模型清單");
