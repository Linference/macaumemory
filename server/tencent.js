import { createHash, createHmac } from "node:crypto";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const hmac = (key, value) => createHmac("sha256", key).update(value).digest();
export function signTencent({ service, action, version, payload, secretId, secretKey, region = "ap-guangzhou", timestamp = Math.floor(Date.now() / 1000) }) {
  const host = `${service}.tencentcloudapi.com`;
  const body = JSON.stringify(payload);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const scope = `${date}/${service}/tc3_request`;
  const canonical = `POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:${host}\n\ncontent-type;host\n${hash(body)}`;
  const key = hmac(hmac(hmac(`TC3${secretKey}`, date), service), "tc3_request");
  const signature = createHmac("sha256", key).update(`TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${hash(canonical)}`).digest("hex");
  return { url: `https://${host}/`, body, headers: {
    "Content-Type": "application/json; charset=utf-8", Host: host,
    "X-TC-Action": action, "X-TC-Version": version, "X-TC-Timestamp": String(timestamp), "X-TC-Region": region,
    Authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=content-type;host, Signature=${signature}`,
  } };
}

export async function callTencent(service, action, version, payload) {
  const secretId = process.env.TENCENT_SECRET_ID, secretKey = process.env.TENCENT_SECRET_KEY;
  if (!secretId || !secretKey) throw Object.assign(new Error("語音服務尚未設定，請在後端 .env.local 設定腾讯雲密鑰。"), { status: 503 });
  const request = signTencent({ service, action, version, payload, secretId, secretKey, region: process.env.TENCENT_REGION || "ap-guangzhou" });
  const response = await fetch(request.url, { method: "POST", headers: request.headers, body: request.body, signal: AbortSignal.timeout(25000) });
  const result = (await response.json()).Response;
  if (!response.ok || result?.Error) {
    const code = result?.Error?.Code || `HTTP${response.status}`;
    // Return only an error code: credentials, provider payloads and recordings never enter logs.
    throw Object.assign(new Error(`腾讯雲語音服務：${code}。請確認服務已開通、密鑰權限及餘額。`), { status: 502 });
  }
  return result;
}

export function validateWav(buffer) {
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") throw new Error("請提供 WAV 音訊。");
  let validFormat = false, dataSize = 0;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const size = buffer.readUInt32LE(offset + 4), start = offset + 8;
    if (start + size > buffer.length) throw new Error("音訊檔案不完整。");
    const type = buffer.toString("ascii", offset, offset + 4);
    if (type === "fmt ") validFormat = size >= 16 && buffer.readUInt16LE(start) === 1 && buffer.readUInt16LE(start + 2) === 1 && buffer.readUInt32LE(start + 4) === 16000 && buffer.readUInt16LE(start + 14) === 16;
    if (type === "data") dataSize += size;
    offset = start + size + (size % 2);
  }
  if (!validFormat || dataSize < 3200 || dataSize > 16000 * 2 * 30) throw new Error("錄音需為 16kHz 單聲道 PCM，長度 0.1–30 秒。");
  return dataSize / 32000;
}
