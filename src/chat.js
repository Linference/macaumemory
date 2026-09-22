// AI 導覽助理（DeepSeek）：對話、串流輸出，並可透過 [[goto:id]] / [[route:id]] 連動地圖
const ENDPOINT = "https://api.deepseek.com/chat/completions";
const MODELS_ENDPOINT = "https://api.deepseek.com/models";
const KEY_STORE = "macau.ai.key";
const MODEL_STORE = "macau.ai.model";
const THINK_STORE = "macau.ai.thinking";
const DEFAULT_MODELS = ["deepseek-flash", "deepseek-v4-pro"];

export class AiChat {
  constructor({ getContext, onCommand, onError } = {}) {
    this.getContext = getContext ?? (() => ({}));
    this.onCommand = onCommand ?? (() => {});
    this.onError = onError ?? (() => {});
    this.messages = [];
    this.busy = false;
    this.key = null;
    this.model = localStorage.getItem(MODEL_STORE) || "deepseek-flash";
    this.thinking = localStorage.getItem(THINK_STORE) === "1"; // 預設關閉思考（速度優先）
    this.source = null; // local / user
    this.availableModels = [...DEFAULT_MODELS];
  }

  /** 取得 API Key：優先 localStorage，其次本機 public/ai-local.json（不進版控） */
  async init() {
    const saved = localStorage.getItem(KEY_STORE);
    if (saved) { this.key = saved; this.source = "user"; return true; }
    try {
      const r = await fetch("ai-local.json", { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        if (j?.key) { this.key = j.key; this.source = "local"; if (j.model) this.model = j.model; return true; }
      }
    } catch { /* 沒有本機金鑰檔是正常的 */ }
    return false;
  }

  setKey(key, { remember = true } = {}) {
    this.key = key?.trim() || null;
    this.source = this.key ? "user" : null;
    if (this.key && remember) localStorage.setItem(KEY_STORE, this.key);
    else localStorage.removeItem(KEY_STORE);
  }

  setModel(model) {
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
      const res = await fetch(MODELS_ENDPOINT, { headers: { Authorization: `Bearer ${this.key}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
  }

  get ready() { return !!this.key; }

  clear() { this.messages = []; }

  buildSystemPrompt() {
    const ctx = this.getContext();
    const list = (ctx.attractions ?? [])
      .map((a) => `- ${a.id}｜${a.zh}（${a.cat}）${a.tag ? "｜" + a.tag : ""}｜${(a.brief ?? "").slice(0, 60)}`)
      .join("\n");
    return [
      "你是「澳門立體誌」3D 地圖網站的導覽助理，熟悉澳門的歷史、世界遺產、美食、交通與旅遊路線。",
      "回答規則：",
      "1. 用繁體中文、條列式、精簡（盡量 200 字內），必要時給出步行時間與順路建議。",
      "2. 只根據下方資料與你對澳門的知識回答；不確定就直說。",
      "3. 若你建議某個本圖收錄的景點，請在回答最後單獨一行加上指令：[[goto:景點id]]（只加一個，最推薦的那個）。",
      "4. 若使用者詢問怎麼去、路線、導航，請在最後加上：[[route:景點id]]。",
      "5. 不要提到指令本身、不要解釋格式。",
      ctx.selected ? `\n使用者目前在地圖上選中的景點：${ctx.selected.id}｜${ctx.selected.zh}` : "",
      ctx.position ? `\n使用者目前位置：${ctx.position[1].toFixed(5)}, ${ctx.position[0].toFixed(5)}（可用來計算距離）` : "\n使用者未開啟定位。",
      `\n本圖收錄的景點（id｜名稱（類別）｜簡介）：\n${list}`,
    ].join("\n");
  }

  async send(text, onDelta) {
    if (this.busy) return null;
    if (!this.ready) { this.onError({ code: "nokey", message: "尚未設定 DeepSeek API Key" }); return null; }
    this.busy = true;
    this.messages.push({ role: "user", content: text });
    const payload = {
      model: this.model,
      messages: [{ role: "system", content: this.buildSystemPrompt() }, ...this.messages.slice(-12)],
      temperature: 0.7,
      max_tokens: this.thinking ? 3000 : 1400,
      stream: true,
      // 新型號（deepseek-flash / deepseek-v4-pro）預設會先輸出思考過程而吃掉 token，
      // 導致 max_tokens 用完、content 為空。可用 thinking.type 控制。
      thinking: { type: this.thinking ? "enabled" : "disabled" },
    };
    let full = "";
    let reasoning = "";
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.key}` },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(res.status === 401
          ? "API Key 無效或已過期"
          : res.status === 400 && /model/i.test(detail) ? `模型「${this.model}」不適用此帳號（請在設定中換一個）`
            : `API 回應 ${res.status}：${detail.slice(0, 140)}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const s = line.trim();
          if (!s.startsWith("data:")) continue;
          const data = s.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            const j = JSON.parse(data);
            const d = j.choices?.[0]?.delta ?? {};
            let changed = false;
            if (d.reasoning_content) { reasoning += d.reasoning_content; changed = true; }
            if (d.content) { full += d.content; changed = true; }
            if (changed) onDelta?.({ content: full, reasoning });
          } catch { /* 忽略不完整片段 */ }
        }
      }
    } catch (e) {
      this.busy = false;
      this.onError({ code: "api", message: e.message });
      return null;
    }
    this.busy = false;
    // 若模型只吐思考內容（token 用完），至少把思考內容當作回覆，避免「什麼都沒有」
    let answer = full.trim();
    if (!answer && reasoning.trim()) answer = reasoning.trim().split("\n").slice(-6).join("\n").trim();
    const cmds = [...answer.matchAll(/\[\[(goto|route):([\w\-]+)\]\]/g)].map((m) => ({ type: m[1], id: m[2] }));
    const clean = answer.replace(/\[\[(goto|route):[\w\-]+\]\]/g, "").trim();
    this.messages.push({ role: "assistant", content: clean });
    if (cmds.length) this.onCommand(cmds[0]);
    return { text: clean, reasoning, commands: cmds };
  }
}
