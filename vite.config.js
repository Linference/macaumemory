import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const MAPLIBRE_DIST = path.resolve("node_modules/maplibre-gl/dist");
// MapLibre GL JS v6 會以 import.meta.url 的相對路徑載入 worker（module worker），
// 因此必須把 worker 與它相依的 shared 模組一起輸出到 assets/ 目錄。
const WORKER_FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];
// 透明 1x1 PNG：避免靜態伺服器把不存在的圖磚請求回傳 index.html（會造成解碼錯誤）
// 缺圖磚時回傳：一般圖磚用 1x1 透明 PNG；DEM 圖磚必須是 256x256 的海平面（terrarium 0 公尺 = RGB 128,0,0），
// 否則 MapLibre 會出現 "dem dimension mismatch"
let demZeroPromise = null;
function getDemZeroPng() {
  if (!demZeroPromise) {
    const size = 256;
    const raw = Buffer.alloc(size * size * 3);
    for (let i = 0; i < raw.length; i += 3) { raw[i] = 128; raw[i + 1] = 0; raw[i + 2] = 0; }
    demZeroPromise = sharp(raw, { raw: { width: size, height: size, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer();
  }
  return demZeroPromise;
}
const BLANK_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

function maplibreWorkerPlugin() {
  return {
    name: "maplibre-worker-files",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const hit = WORKER_FILES.find((f) => (req.url || "").includes(f.replace(/\.mjs$/, "")));
        if (!hit) return next();
        res.setHeader("Content-Type", "text/javascript; charset=utf-8");
        res.end(readFileSync(path.join(MAPLIBRE_DIST, hit)));
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || "").split("?")[0];
        if (!/^\/(tiles|dem)\//.test(url)) return next();
        const file = path.join("dist", url.replace(/^\//, ""));
        try { readFileSync(file); return next(); } catch { /* 缺圖磚：回傳替代內容 */ }
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "no-store");
        if (url.startsWith("/dem/")) return res.end(await getDemZeroPng());
        res.end(BLANK_PNG);
      });
    },
    generateBundle() {
      for (const f of WORKER_FILES) {
        this.emitFile({ type: "asset", fileName: `assets/${f}`, source: readFileSync(path.join(MAPLIBRE_DIST, f)) });
      }
      // 另外輸出 .js 版本：部分靜態伺服器（含 GitHub Pages）對 .mjs 會給
      // application/octet-stream，瀏覽器會拒絕載入 module worker。
      // 這裡把 worker 內對 shared 的匯入一併改成 .js。
      const worker = readFileSync(path.join(MAPLIBRE_DIST, "maplibre-gl-worker.mjs"), "utf8")
        .replace(/maplibre-gl-shared\.mjs/g, "maplibre-gl-shared.js");
      this.emitFile({ type: "asset", fileName: "assets/maplibre-gl-worker.js", source: worker });
      this.emitFile({ type: "asset", fileName: "assets/maplibre-gl-shared.js", source: readFileSync(path.join(MAPLIBRE_DIST, "maplibre-gl-shared.mjs")) });
    },
  };
}

export default defineConfig({
  base: "./",
  server: { host: "127.0.0.1", port: 5173, strictPort: false },
  preview: { host: "127.0.0.1", port: 4173, strictPort: false },
  optimizeDeps: { exclude: ["maplibre-gl"] },
  plugins: [maplibreWorkerPlugin()],
  build: { target: "es2022", outDir: "dist", assetsInlineLimit: 0, chunkSizeWarningLimit: 3000 },
});
