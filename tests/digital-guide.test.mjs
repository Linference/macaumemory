import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeWav, splitSpeech, GuidePlayer } from "../src/guide-audio.js";
import { signTencent, validateWav } from "../server/tencent.js";
import { createCameraSession } from "../src/recognize/camera.js";

test("mobile audio is resampled to 16k mono PCM with valid duration and clipping", () => {
  const wav = Buffer.from(encodeWav(new Float32Array(48000).fill(2), 48000));
  assert.equal(validateWav(wav), 1);
  assert.equal(wav.readInt16LE(44), 32767);
  assert.equal(wav.length, 32044);
  assert.throws(() => validateWav(wav.subarray(0, 45)), /不完整/);
  assert.throws(() => validateWav(Buffer.from(encodeWav(new Float32Array(16000 * 31), 16000))), /30/);
  const stereo = Buffer.from(wav); stereo.writeUInt16LE(2, 22);
  assert.throws(() => validateWav(stereo), /單聲道/);
});
test("speech segmentation respects Tencent character limit and preserves Unicode text", () => {
  const source = "澳門🙂".repeat(120);
  const chunks = splitSpeech(source);
  assert.ok(chunks.every((s) => [...s].length <= 130));
  assert.equal(chunks.join(""), source);
  assert.equal(splitSpeech("**你好**。[[goto:ruins]]").join(""), "你好。");
});
test("TC3 scope uses UTC and signatures change when signed payload changes", () => {
  const input = { service: "tts", action: "TextToVoice", version: "2019-08-23", secretId: "test-id", secretKey: "test-key", timestamp: 1551113065, payload: { Text: "你好" } };
  const a = signTencent(input), b = signTencent({ ...input, payload: { Text: "另一段" } });
  assert.match(a.headers.Authorization, /2019-02-25\/tts\/tc3_request/);
  assert.match(a.headers.Authorization, /Signature=[a-f0-9]{64}$/);
  assert.notEqual(a.headers.Authorization, b.headers.Authorization);
  assert.equal(a.url, "https://tts.tencentcloudapi.com/");
  assert.equal(a.headers["X-TC-Action"], "TextToVoice");
});
test("closing camera before permission resolves stops late streams", async () => {
  let resolve, stopped = 0, attached;
  const session = createCameraSession({ getUserMedia: () => new Promise((r) => { resolve = r; }) }, (s) => { attached = s; });
  const pending = session.start(); session.stop();
  resolve({ getTracks: () => [{ stop: () => stopped++ }] });
  assert.equal(await pending, false); assert.equal(stopped, 1); assert.equal(attached, null);
});
test("switching cameras disposes the preceding stream", async () => {
  let stopped = 0;
  const session = createCameraSession({ getUserMedia: async () => ({ getTracks: () => [{ stop: () => stopped++ }] }) }, () => {});
  assert.equal(await session.start(), true); assert.equal(await session.start("user"), true);
  assert.equal(stopped, 1); session.stop(); assert.equal(stopped, 2);
});
test("audio is unlocked before cloud fetch and playback runs through the unlocked context", async () => {
  const order = []; let source;
  const context = {
    state: "suspended", destination: {},
    createAnalyser: () => ({ connect() {} }),
    resume() { order.push("unlock"); this.state = "running"; return Promise.resolve(); },
    decodeAudioData: async () => { order.push("decode"); return {}; },
    createBufferSource() { source = { connect() {}, disconnect() {}, stop() {}, start() { order.push("play"); queueMicrotask(() => this.onended()); } }; return source; },
  };
  const player = new GuidePlayer({ createContext: () => context });
  await player.unlock(); order.push("fetch"); await player.play(new ArrayBuffer(4));
  assert.deepEqual(order, ["unlock", "fetch", "decode", "play"]);
  assert.equal(player.source, null);
});
test("changing buildings cancels audio that is still being decoded", async () => {
  let decoded, started = false;
  const player = new GuidePlayer({ createContext: () => ({ state: "running", destination: {},
    createAnalyser: () => ({ connect() {} }), decodeAudioData: () => new Promise((r) => { decoded = r; }),
    createBufferSource() { started = true; throw new Error("must not play"); },
  }) });
  await player.unlock(); const pending = player.play(new ArrayBuffer(4));
  await new Promise((r) => setImmediate(r)); player.stop(); decoded({}); await pending;
  assert.equal(started, false);
});
