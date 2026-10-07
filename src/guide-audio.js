export function splitSpeech(text, max = 130) {
  const clean = String(text).replace(/\[\[.*?\]\]/g, "").replace(/[*#`]/g, "").trim();
  const chunks = []; let part = "";
  for (const char of clean) {
    part += char;
    if ([...part].length >= max || /[。！？!?；;]/.test(char)) { chunks.push(part); part = ""; }
  }
  if (part) chunks.push(part);
  return chunks;
}

export function encodeWav(samples, sampleRate) {
  if (!Number.isFinite(sampleRate) || sampleRate < 16000) throw new Error("錄音採樣率不支援。");
  const length = Math.floor(samples.length * 16000 / sampleRate);
  const buffer = new ArrayBuffer(44 + length * 2), view = new DataView(buffer);
  const ascii = (offset, text) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  ascii(0, "RIFF"); view.setUint32(4, 36 + length * 2, true); ascii(8, "WAVE"); ascii(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, "data"); view.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) {
    const begin = Math.floor(i * sampleRate / 16000), end = Math.max(begin + 1, Math.floor((i + 1) * sampleRate / 16000));
    let value = 0; for (let j = begin; j < end && j < samples.length; j++) value += samples[j];
    value = Math.max(-1, Math.min(1, value / (end - begin)));
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return buffer;
}

export function base64Audio(buffer) {
  let binary = ""; const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

/** Unlock during the click itself; network responses must not create a new audio context. */
export class GuidePlayer {
  constructor({ createContext, onStart = () => {}, onEnd = () => {} } = {}) {
    this.createContext = createContext || (() => new (window.AudioContext || window.webkitAudioContext)());
    this.onStart = onStart; this.onEnd = onEnd; this.generation = 0;
  }
  unlock() {
    try {
      if (!this.context || this.context.state === "closed") {
        this.context = this.createContext();
        this.analyser = this.context.createAnalyser(); this.analyser.fftSize = 256;
        this.analyser.connect(this.context.destination);
      }
      if (this.context.state !== "running") return this.context.resume();
      return Promise.resolve();
    } catch (error) { return Promise.reject(error); }
  }
  stop() {
    this.generation++;
    if (this.source) { this.source.onended = null; try { this.source.stop(); } catch {} this.source.disconnect(); this.source = null; }
    this.complete?.(); this.complete = null; this.onEnd();
  }
  async play(bytes) {
    this.stop(); const token = this.generation;
    // A permission/autoplay promise can stay pending. Never leave the UI loading forever.
    if (!this.context) this.unlock().catch(() => {});
    await audioReady(this.context);
    if (token !== this.generation) return;
    const decoded = await this.context.decodeAudioData(bytes.slice(0));
    if (token !== this.generation) return;
    if (this.context.state !== "running") throw audioPermissionError();
    const source = this.context.createBufferSource(); source.buffer = decoded; source.connect(this.analyser); this.source = source;
    await new Promise((resolve, reject) => {
      const finish = () => { if (this.source === source) this.source = null; source.disconnect(); this.complete = null; this.onEnd(); resolve(); };
      this.complete = finish; source.onended = finish;
      try { source.start(); this.onStart(); } catch (error) { this.source = null; this.complete = null; source.disconnect(); reject(error); }
    });
  }
}

function audioPermissionError() { return Object.assign(new Error("請點「播放講解」啟用聲音，並確認裝置音量已開啟。"), { name: "NotAllowedError" }); }
export async function audioReady(context) {
  if (context.state === "running") return;
  let timer;
  try {
    await Promise.race([context.resume(), new Promise((_, reject) => { timer = setTimeout(() => reject(audioPermissionError()), 1800); })]);
    if (context.state !== "running") throw audioPermissionError();
  } finally { clearTimeout(timer); }
}

export class GuideRecorder {
  constructor(onLimit) { this.onLimit = onLimit; this.generation = 0; this.recording = false; }
  async start() {
    this.cancel(); const token = this.generation;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error("語音輸入需要 HTTPS 和麥克風權限，請用系統瀏覽器開啟。");
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContext(); this.context = context;
    // Mobile Safari must see resume() before getUserMedia's permission await.
    context.resume().catch(() => {});
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      if (token !== this.generation) { stream.getTracks().forEach((t) => t.stop()); return false; }
      this.stream = stream; this.parts = []; this.samples = 0;
      await audioReady(context);
      if (token !== this.generation) return false;
      this.source = context.createMediaStreamSource(stream);
      const collect = (data) => {
        if (!this.recording) return;
        this.parts.push(data.slice()); this.samples += data.length;
        if (this.samples >= context.sampleRate * 25) this.onLimit?.();
      };
      try {
        if (!context.audioWorklet || !window.AudioWorkletNode) throw new Error("worklet unavailable");
        await context.audioWorklet.addModule(new URL("audio/guide-recorder.js", document.baseURI));
        if (token !== this.generation) return false;
        this.node = new AudioWorkletNode(context, "guide-recorder");
        this.node.port.onmessage = ({ data }) => collect(data);
      } catch {
        if (token !== this.generation) return false;
        this.node = context.createScriptProcessor(4096, 1, 1);
        this.node.onaudioprocess = (event) => collect(event.inputBuffer.getChannelData(0));
      }
      this.gain = context.createGain(); this.gain.gain.value = 0;
      this.source.connect(this.node); this.node.connect(this.gain); this.gain.connect(context.destination);
      this.recording = true;
      this.timer = setTimeout(() => { if (this.recording) this.onLimit?.(); }, 25000);
      return true;
    } catch (error) { if (token === this.generation) this.cancel(); throw error; }
  }
  finish() {
    const rate = this.context?.sampleRate || 48000;
    const samples = new Float32Array(this.samples); let offset = 0;
    for (const part of this.parts || []) { samples.set(part, offset); offset += part.length; }
    this.cancel();
    if (samples.length < rate * .15) throw new Error("錄音太短，請說完問題後再結束。");
    return encodeWav(samples, rate);
  }
  cancel() {
    this.generation++; this.recording = false; clearTimeout(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop()); this.stream = null;
    this.node?.disconnect(); this.source?.disconnect(); this.gain?.disconnect();
    this.node = this.source = this.gain = null;
    this.context?.close().catch(() => {}); this.context = null;
    this.parts = []; this.samples = 0;
  }
}
