import "./digital-guide.css";
import { splitSpeech, base64Audio, GuideRecorder, GuidePlayer } from "./guide-audio.js";

export function buildingIntroduction(a) {
  const facts = String(a.brief || a.detail || "你可以從建築外觀開始觀察，也可以問我相關問題。").replace(/\s+/g, " ").trim();
  if (a.kind === "memory") return `你好，我是小澳。你來到了${a.zh}的記憶點。${[...facts].slice(0, 95).join("")}想看看這裡的實拍照片，或問我這個地方的故事嗎？`;
  const memoryHint = a.nearbyMemory ? `這裡也有真實照片記憶點，你可以在建築資料中查看照片與故事。` : "";
  return `你好，我是小澳。這裡是${a.zh}。${[...facts].slice(0, 95).join("")}${memoryHint}你想了解它的歷史，還是建築特色？`;
}

export class DigitalGuide {
  constructor({ onNotice = () => {}, onOpen = () => {} } = {}) {
    this.onNotice = onNotice; this.onOpen = onOpen;
    this.element = document.getElementById("digital-guide");
    this.$ = (s) => this.element.querySelector(s);
    this.history = []; this.generation = 0; this.busy = false;
    this.controllers = new Set(); this.muted = false;
    this.player = new GuidePlayer({ onStart: () => { this.mode("speaking", "正在講解"); this.animateVoice(); }, onEnd: () => this.endAnimation() });
    this.recorder = new GuideRecorder(() => this.record());
    this.$("[data-guide-close]").addEventListener("click", () => this.hide());
    this.$("[data-guide-replay]").addEventListener("click", () => { this.player.unlock().catch(() => {}); this.speak(this.lastSpoken); });
    this.$("[data-guide-mute]").addEventListener("click", () => {
      this.muted = !this.muted;
      this.$("[data-guide-mute]").setAttribute("aria-pressed", String(this.muted));
      this.$("[data-guide-mute]").textContent = this.muted ? "開啟聲音" : "靜音";
      if (this.muted) this.stopSpeech();
    });
    this.$("form").addEventListener("submit", (e) => { e.preventDefault(); this.send(this.$("textarea").value); });
    this.$("textarea").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this.send(e.target.value); } });
    this.$("[data-guide-mic]").addEventListener("click", () => this.record());
    for (const button of this.element.querySelectorAll("[data-guide-question]")) button.addEventListener("click", () => this.send(button.dataset.guideQuestion));
    window.addEventListener("pagehide", () => this.hide());
    document.addEventListener("visibilitychange", () => { if (document.hidden) { this.stopSpeech(); this.recorder.cancel(); this.micPending = false; this.refreshMic(); } });
  }
  mode(mode, text) { this.element.dataset.mode = mode; this.$("[data-guide-status]").textContent = text; }
  show(a, { autoSpeak = true, arrival = false } = {}) {
    if (this.attraction?.id === a.id && !this.element.hidden) return;
    this.hide();
    if (autoSpeak && !this.muted) this.player.unlock().catch(() => {});
    this.attraction = a; this.history = []; this.element.hidden = false;
    this.$(".guide-kicker").textContent = arrival ? "途見 · 附近導覽" : "TUJIAN · VIRTUAL GUIDE";
    this.$("[data-guide-building]").textContent = a.zh;
    this.$("[data-guide-messages]").replaceChildren(); this.$("textarea").value = "";
    this.mode("idle", arrival ? "已到達附近 · 小澳帶你認識這裡" : "你的建築導覽員"); this.onOpen();
    const introduction = buildingIntroduction(a);
    this.addMessage("assistant", introduction); this.lastSpoken = introduction;
    if (autoSpeak && !this.muted) this.speak(introduction);
  }
  hide() {
    this.generation++; for (const controller of this.controllers) controller.abort(); this.controllers.clear();
    this.stopSpeech(); this.recorder.cancel(); this.micPending = false;
    this.busy = false; this.setBusy(false); this.refreshMic(); this.element.hidden = true;
  }
  addMessage(role, text) {
    const row = document.createElement("div"); row.className = `guide-message ${role}`;
    row.textContent = text; this.$("[data-guide-messages]").append(row); row.scrollIntoView({ block: "nearest" });
  }
  async request(route, body) {
    const controller = new AbortController(); this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 55000);
    try {
      const res = await fetch(new URL(`api/guide/${route}`, document.baseURI), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
      const data = await res.json().catch(() => ({ error: "導覽服務未啟動，請啟動本地後端或設定 HTTPS 代理。" }));
      if (!res.ok || data.error) throw new Error(data.error || "導覽服務暫時不可用。");
      return data;
    } finally { clearTimeout(timer); this.controllers.delete(controller); }
  }
  setBusy(on) {
    this.busy = on;
    this.$("[data-guide-send]").disabled = on;
    for (const button of this.element.querySelectorAll("[data-guide-question]")) button.disabled = on;
    this.$("[data-guide-mic]").disabled = on;
  }
  async send(text) {
    const clean = text?.trim(); if (!clean || this.busy || !this.attraction) return;
    if (clean.length > 600) { this.onNotice("問題限 600 字。"); return; }
    this.player.unlock().catch(() => {});
    const token = this.generation, buildingId = this.attraction.id;
    this.stopSpeech(); this.recorder.cancel(); this.micPending = false; this.refreshMic();
    this.setBusy(true); this.mode("thinking", "正在思考你的問題…");
    this.$("textarea").value = ""; this.addMessage("user", clean);
    try {
      const { text: answer } = await this.request("chat", { buildingId, text: clean, history: this.history });
      if (token !== this.generation) return;
      this.history.push({ role: "user", content: clean }, { role: "assistant", content: answer });
      this.history = this.history.slice(-8); this.addMessage("assistant", answer); this.lastSpoken = answer;
      this.mode("idle", "可以繼續提問");
      if (!this.muted) this.speak(answer);
    } catch (error) {
      if (token !== this.generation) return;
      this.addMessage("assistant", error.name === "AbortError" ? "服務等待逾時，請再試一次。" : error.message);
      this.mode("idle", "可重試或輸入文字提問");
    } finally { if (token === this.generation) this.setBusy(false); }
  }
  stopSpeech() {
    this.speechToken = (this.speechToken || 0) + 1;
    this.player.stop(); this.endAnimation();
  }
  async speak(text) {
    if (!text || this.muted || this.element.hidden) return;
    this.stopSpeech(); const token = this.speechToken, generation = this.generation;
    this.mode("loading", "正在準備語音…");
    try {
      // Keep sentences together up to the provider's 150-character limit to reduce request gaps.
      const chunks = splitSpeech(text); const groups = [];
      for (const chunk of chunks) { if (groups.length && [...(groups.at(-1) + chunk)].length <= 130) groups[groups.length - 1] += chunk; else groups.push(chunk); }
      for (const chunk of groups) {
        if (token !== this.speechToken || generation !== this.generation) return;
        const out = await this.request("tts", { text: chunk });
        if (token !== this.speechToken || generation !== this.generation) return;
        const bytes = Uint8Array.from(atob(out.audio), (c) => c.charCodeAt(0));
        await this.player.play(bytes.buffer);
        if (token !== this.speechToken) return;
      }
      if (token === this.speechToken) this.mode("idle", "講解完畢，可以問我問題");
    } catch (error) {
      if (token !== this.speechToken || generation !== this.generation) return;
      this.stopSpeech(); this.mode("idle", error.name === "NotAllowedError" ? "點擊「播放講解」開啟聲音" : error.message);
      if (error.name !== "NotAllowedError") this.onNotice(error.message);
    }
  }
  refreshMic() {
    const button = this.$("[data-guide-mic]"); button.textContent = this.recorder.recording ? "結束並提問" : this.micPending ? "取消開啟" : "語音提問";
    button.setAttribute("aria-pressed", String(this.recorder.recording || !!this.micPending));
  }
  async record() {
    if (this.busy) return;
    if (this.micPending) { this.recorder.cancel(); this.micPending = false; this.refreshMic(); this.mode("idle", "已取消錄音"); return; }
    const token = this.generation;
    if (this.recorder.recording) {
      this.setBusy(true); this.mode("thinking", "正在辨識語音…");
      try {
        const audio = base64Audio(this.recorder.finish()); this.refreshMic();
        const result = await this.request("asr", { audio });
        if (token !== this.generation) return;
        this.setBusy(false);
        if (!result.text?.trim()) throw new Error("沒有聽清楚，請再說一次。");
        this.$("textarea").value = result.text;
        await this.send(result.text);
      } catch (error) { if (token === this.generation) { this.setBusy(false); this.mode("idle", "可以重試語音或輸入文字"); this.onNotice(error.message); } }
      return;
    }
    this.player.unlock().catch(() => {});
    this.stopSpeech(); this.micPending = true; this.refreshMic(); this.mode("listening", "請允許麥克風權限…");
    try {
      if (!await this.recorder.start()) return;
      if (token !== this.generation || this.element.hidden) { this.recorder.cancel(); return; }
      this.micPending = false; this.refreshMic(); this.mode("listening", "正在聆聽，說完後點「結束並提問」（最多25秒）");
    } catch (error) { if (token === this.generation && this.micPending) { this.micPending = false; this.refreshMic(); this.mode("idle", "請用文字提問，或允許麥克風後重試"); this.onNotice(error.name === "NotAllowedError" ? "麥克風權限未開啟，請在網站設定允許麥克風。" : error.message); } }
  }
  animateVoice() {
    const analyser = this.player.analyser;
    if (!analyser) return;
    const values = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (!this.player.source) return;
      analyser.getByteFrequencyData(values);
      const energy = values.reduce((sum, x) => sum + x, 0) / values.length / 255;
      this.element.style.setProperty("--voice", String(Math.min(1, energy * 3.5)));
      this.frame = requestAnimationFrame(tick);
    }; cancelAnimationFrame(this.frame); tick();
  }
  endAnimation() { cancelAnimationFrame(this.frame); this.element.style.setProperty("--voice", "0"); }
}
