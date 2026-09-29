// 給瀏覽器測試用的小型靜態伺服器（只服務 photos-src，方便測試真實照片）。
// 為什麼需要：photos-src/ 不在 Vite 的 public/ 底下，測試腳本無法用網址取得照片；
// 而 public/photos/ 目前只有 thumb 與 demo 兩個子資料夾（原始大圖不在版控裡）。
//
// 用法：node tools/recognize/photo-server.mjs [--port 5180]
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, resolve, normalize } from "node:path";

const args = process.argv.slice(2);
const getArg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PORT = Number(getArg("--port", "5180"));
const ROOT = resolve(import.meta.dirname, "..", "..");
const TYPES = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

createServer((req, res) => {
  // CORS：讓 5173 的頁面可以直接抓這裡的照片
  res.setHeader("Access-Control-Allow-Origin", "*");
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, "");
  const file = resolve(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end("forbidden"); return; }
  try {
    const st = statSync(file);
    if (!st.isFile()) throw new Error("not a file");
    res.writeHead(200, { "Content-Type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream", "Content-Length": st.size });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`[photo-server] http://127.0.0.1:${PORT}/  →  ${ROOT}`);
  console.log(`  例：http://127.0.0.1:${PORT}/photos-src/cc/moorish-barracks/Moorish_Barracks.jpg`);
});
