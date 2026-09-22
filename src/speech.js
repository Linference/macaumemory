// 語音：瀏覽器內建 TTS + ASR（免金鑰），可日後接雲端 TTS
const synth = typeof window !== "undefined" ? window.speechSynthesis : null;

export const speechSupported = { tts: !!synth, asr: typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition) };

let voices = [];
function refreshVoices() {
  if (!synth) return;
  voices = synth.getVoices() ?? [];
}
refreshVoices();
if (synth?.addEventListener) synth.addEventListener("voiceschanged", refreshVoices);

/** 選一個中文語音（台灣 > 香港 > 中國） */
export function pickChineseVoice() {
  if (!voices.length) refreshVoices();
  const norm = (v) => (v.lang || "").toLowerCase().replace("_", "-");
  const prefer = ["zh-tw", "zh-hk", "zh-mo", "zh-cn", "zh"];
  for (const p of prefer) {
    const hit = voices.find((v) => norm(v).startsWith(p) && /natural|premium|xiaoxiao|hanhan|yating|zhiyu|sinji|mei/i.test(v.name));
    if (hit) return hit;
    const any = voices.find((v) => norm(v).startsWith(p));
    if (any) return any;
  }
  return voices.find((v) => norm(v).startsWith("zh")) ?? null;
}

export function listVoices() {
  if (!voices.length) refreshVoices();
  return voices.filter((v) => (v.lang || "").toLowerCase().startsWith("zh"));
}

/** 清掉 Markdown 與 emoji，讓朗讀自然 */
export function cleanForSpeech(text) {
  return String(text)
    .replace(/\[\[(goto|route):[\w\-]+\]\]/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/[#>*`_]/g, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "")
    .replace(/・/g, "，")
    .replace(/\s*\n\s*/g, "。")
    .replace(/。{2,}/g, "。")
    .trim();
}

/** 語音合成：逐句朗讀，句界回呼可驅動嘴型 */
export class Speaker {
  constructor({ onStart, onProgress, onEnd, onError } = {}) {
    this.onStart = onStart ?? (() => {});
    this.onProgress = onProgress ?? (() => {});
    this.onEnd = onEnd ?? (() => {});
    this.onError = onError ?? (() => {});
    this.speaking = false;
    this.voice = null;
    this.rate = 1.02;
    this.pitch = 1.05;
  }

  get supported() { return !!synth; }

  stop() {
    if (!synth) return;
    synth.cancel();
    this.speaking = false;
    this.onEnd();
  }

  /** 朗讀文字（會自動切成句子） */
  speak(text, { lang = "zh-TW" } = {}) {
    if (!synth) { this.onError("此瀏覽器不支援語音合成"); return false; }
    const clean = cleanForSpeech(text);
    if (!clean) return false;
    synth.cancel();
    const sentences = clean.split(/(?<=[。！？!?；;])/g).map((s) => s.trim()).filter(Boolean);
    const chunks = [];
    let buf = "";
    for (const s of sentences) {
      if ((buf + s).length > 60) { if (buf) chunks.push(buf); buf = s; } else buf += s;
    }
    if (buf) chunks.push(buf);

    this.voice = pickChineseVoice();
    this.speaking = true;
    this.onStart(chunks.join(""));
    let idx = 0;
    const next = () => {
      if (!this.speaking || idx >= chunks.length) { this.speaking = false; this.onEnd(); return; }
      const u = new SpeechSynthesisUtterance(chunks[idx]);
      if (this.voice) u.voice = this.voice;
      u.lang = this.voice?.lang ?? lang;
      u.rate = this.rate;
      u.pitch = this.pitch;
      const guard = setTimeout(() => { if (this.speaking) { try { synth.cancel(); } catch {} idx = chunks.length; next(); } }, Math.min(60000, 3500 + chunks[idx].length * 380));
      u.onstart = () => { clearTimeout(guard); this.onProgress({ index: idx, total: chunks.length, text: chunks[idx], kind: "start" }); };
      u.onboundary = (e) => this.onProgress({ index: idx, total: chunks.length, text: chunks[idx], kind: "boundary", charIndex: e.charIndex });
      u.onend = () => { clearTimeout(guard); idx++; next(); };
      u.onerror = (e) => { clearTimeout(guard); if (e.error !== "interrupted" && e.error !== "canceled") this.onError(`語音合成失敗：${e.error}`); idx++; next(); };
      synth.speak(u);
    };
    next();
    return true;
  }
}

/** 語音識別（中文） */
export class Listener {
  constructor({ onPartial, onFinal, onError, onStateChange } = {}) {
    this.onPartial = onPartial ?? (() => {});
    this.onFinal = onFinal ?? (() => {});
    this.onError = onError ?? (() => {});
    this.onStateChange = onStateChange ?? (() => {});
    this.rec = null;
    this.active = false;
    const SR = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
    this.Ctor = SR;
  }

  get supported() { return !!this.Ctor; }

  start({ lang = "zh-TW", continuous = false, interimResults = true } = {}) {
    if (!this.Ctor) { this.onError("此瀏覽器不支援語音識別（建議用 Chrome 或 Edge）"); return false; }
    if (this.active) return true;
    const rec = new this.Ctor();
    rec.lang = lang;
    rec.continuous = continuous;
    rec.interimResults = interimResults;
    rec.maxAlternatives = 1;
    rec.onstart = () => { this.active = true; this.onStateChange(true); };
    rec.onresult = (e) => {
      let interim = "", final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript;
      }
      if (interim) this.onPartial(interim);
      if (final) { this.onFinal(final.trim()); }
    };
    rec.onerror = (e) => {
      const map = {
        "not-allowed": "麥克風權限被拒：請在網址列允許麥克風",
        "service-not-allowed": "瀏覽器未允許語音服務",
        "no-speech": "沒有聽到聲音，請再說一次",
        "audio-capture": "找不到麥克風裝置",
        network: "語音識別需要網路連線（瀏覽器內建服務）",
        aborted: null,
      };
      const msg = map[e.error];
      if (msg === null) return;
      this.onError(msg ?? `語音識別錯誤：${e.error}`);
    };
    rec.onend = () => { this.active = false; this.onStateChange(false); };
    this.rec = rec;
    try { rec.start(); } catch (e) { this.onError(String(e.message ?? e)); return false; }
    return true;
  }

  stop() {
    try { this.rec?.stop(); } catch { /* ignore */ }
    this.active = false;
    this.onStateChange(false);
  }
}
