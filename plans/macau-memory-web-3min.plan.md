# 澳門記憶 · 網站介紹影片（3 分鐘以上）— 製作計畫

- **專案根**：`docs/video/_work/web3min/`（HyperFrames 專案；basename `web3min` → 混音臨時目錄 `%TEMP%\web3min-mix`）
- **交付**：`docs/video/macau-memory-web-3min.mp4`（主，字幕燒入）＋ `-nosub.mp4`（無字幕）＋ `-social.mp4`（社群短版）
- **風格**：`style-glass-keynote.md`（premium / calm / clear）
- **規格**：1920×1080 · 30 fps · H.264 / yuv420p · 目標 204.0 s（≥180 s）
- **語言**：旁白與字幕皆**簡體中文**（skill 預設英文 VO + 越南字幕，本片改為中文；真站錄屏畫面本身是繁體，屬實拍素材不另改）

---

## 1. 真實數字來源（每個畫面上的數字都對應到這裡）

| # | 畫面數字 | 來源 | 查核狀態 |
|---|---|---|---|
| F1 | 24,904 棟建築輪廓 | `README.md:11`、`public/data/macau-stats.json` → `counts.buildings=24904` | ✅ 已核對 |
| F2 | 61 個景點 | `README.md:11`、`README.md:88` | ✅ 已核對 |
| F3 | 683 個 DEM 地形圖磚 | `README.md:69`、`README.md:339`（`public/dem/**` 683 張） | ✅ 已核對 |
| F4 | 14 個 GLB 三維模型 | `public/models/` 實際檔案數 = 14（7 個模型 × 全解析 + LOD） | ✅ 已核對（README 寫「7 個三維模型」，14 是含 LOD 的檔案數，畫面用「14 個 GLB 檔案 / 7 個模型＋7 個 LOD」表述） |
| F5 | 38 棟建築庫 / 335 張參考影像 | 使用者提供；**真站自身的 `libMeta.eval` 即為 `n_buildings: 38, n_queries: 335`**（在 `recognize.html` 以 headless Chrome 讀 `window.__recognize.meta` 取得） | ✅ 已用真站資料核對 |
| F6 | 留一法 Top-1 89.0% / Top-3 94.9% | 使用者提供；**真站 `libMeta.eval` = `top1: 0.8896, top3: 0.9493`** → 89.0% / 94.9% | ✅ 已用真站資料核對 |
| F7 | 約 3.5 秒辨識 | 使用者提供；本次錄製時 headless 實測一次完整辨識（含頁面互動）耗時 **4.00 s**（`real-a-ma-temple.jpg` → `temple` 0.9217） | ✅ 同數量級 |
| F8 | YOLO 36.3 MB + DINOv2 ViT-S/14 83.1 MB | 使用者提供 | 檔案實測：`macau-buildings-yolo.onnx` 38,017,428 B = 36.26 MiB；`dinov2-vits14-336.onnx` 87,186,817 B = 83.15 MiB → **與 36.3 / 83.1 MB 相符** ✅ |
| F9 | 瀏覽器端 WASM、不上傳伺服器 | `src/recognize/*`（onnxruntime-web WASM） | ✅ 已核對 |
| F10 | 媽閣廟實拍 → 中式廟宇 92.2% | 使用者提供；**本次錄製實測 `temple` 0.9217 = 92.2%**（`window.__recognize.results`） | ✅ 已實測核對 |
| F11 | 港務局大樓 → 葡式殖民建築 93.4% | 使用者提供 | ⚠️ 使用者提供（本次未重跑此張） |
| F12 | SQLite WASM + OPFS 持久化 | `src/recognize/db.js`、`MEMORY.md:307` | ✅ 已核對 |
| F13 | R-Tree 空間查重比 JS 全表掃描快 18 倍 | 使用者提供 | ⚠️ 使用者提供（`MEMORY.md:314` 證實 R-Tree 確實是核心需求） |
| F14 | GPS 多次取樣精度加權（1/accuracy²） | `src/recognize/geo-math.js`、`MEMORY.md:308` | ✅ 已核對 |
| F15 | SIFT+RANSAC，≥15 內點 → 100% 精確率 | 使用者提供；`docs/figs/geo-inliers.png` 顯示「內點 ≥15 零誤判線」 | ✅ 圖證一致 |
| F16 | 位姿驅動自動標註；人工標註一棟 2~3 小時 | 使用者提供 | ⚠️ 使用者提供 |
| F17 | 兩個入口 `index.html` / `recognize.html` | 實際檔案 | ✅ 已核對 |

---

## 2. 分鏡表（目標 204.0 s @ 100 BPM，340 拍 = 85 小節）

| # | id | 起–訖 (s) | 內容 | 畫面素材 | 對應事實 |
|---|---|---|---|---|---|
| 01 | `s01-cover` | 0.0–11.0 | 開場：澳門立體誌 · 3D 立體澳門地圖 | 真站地圖推近鏡頭（`rec/map`）＋玻璃字卡 | F17 |
| 02 | `s02-stats` | 11.0–25.0 | 資料規模：24,904 建築輪廓 / 61 景點 / 683 DEM 圖磚 | 數字磚（odometer）＋真站地形鏡頭 | F1 F2 F3 |
| 03 | `s03-map` | 25.0–39.0 | MapLibre GL + DEM 地形：起伏是真的 | 真站地形俯衝鏡頭（錄屏） | F1 F3 |
| 04 | `s04-models` | 39.0–55.0 | 三維模型：14 個 GLB（文物＋建築） | **玫瑰堂 3D 模型轉台**（使用者提供 GLB 的渲染）＋真站模型檢視器錄屏 | F4 |
| 05 | `s05-problem` | 55.0–69.0 | 難題：要記錄老建築，得先標註 | 真站景點卡＋文字；人工 2~3 小時 | F16 |
| 06 | `s06-scale` | 69.0–80.0 | 規模：全澳門沒有人做得完 | 24,904 數字牆 + 真站地圖拉遠 | F1 F16 |
| 07 | `s07-pose` | 80.0–95.0 | **核心創新**：位姿驅動自動標註 | 流程圖（環繞影片→三維重建→相機位姿→投影） | F16 |
| 08 | `s08-project` | 95.0–110.0 | 投影到每一張影格：逐影格精確標註 | `docs/figs/prelabel.jpg` / `detect-demo.jpg` 真實標註圖 | F16 F15 |
| 09 | `s09-recognize` | 110.0–125.0 | 入口二：拍照 → 判定類型 | 真站 `recognize.html` 錄屏 | F17 |
| 10 | `s10-speed` | 125.0–139.0 | 約 3.5 秒 · YOLO 36.3 MB + DINOv2 83.1 MB · 本機 WASM | 模型檔案卡＋瀏覽器端標示 | F7 F8 F9 |
| 11 | `s11-accuracy` | 139.0–152.0 | 38 棟建築庫 / 335 張參考影像 · Top-1 89.0% / Top-3 94.9% | 條狀圖動畫＋`docs/figs/encoder-compare.png` | F5 F6 |
| 12 | `s12-cases` | 152.0–166.0 | 實測：媽閣廟 92.2% / 港務局大樓 93.4% | 真站錄屏結果框＋真實建築照片 | F10 F11 |
| 13 | `s13-survey` | 166.0–180.0 | 普查建檔：SQLite WASM + OPFS + R-Tree 快 18 倍 + GPS 加權 | 真站建檔流程錄屏＋18× 比較動畫 | F12 F13 F14 |
| 14 | `s14-geo` | 180.0–191.0 | 幾何驗證：SIFT+RANSAC ≥15 內點 → 100% | `docs/figs/geo-inliers.png`＋內點動畫 | F15 |
| 15 | `s15-outro` | 191.0–204.0 | 收尾：兩個入口、網址 | 雙卡片＋簽名 | F17 |

音樂段落（100 BPM，beat = 0.6000 s，小節 = 2.4 s，共 85 小節）：

| 段落 | 小節 | 拍 | 秒 | 用途 |
|---|---|---|---|---|
| intro | 0–7 | 0–32 | 0.0–19.2 | 冷靜進場 |
| build A | 8–15 | 32–64 | 19.2–38.4 | 資料規模建立 |
| **drop A** | 16–31 | 64–128 | 38.4–76.8 | 模型／地圖主秀 |
| breakdown | 32–37 | 128–152 | 76.8–91.2 | 留白給「難題」 |
| build B | 38–43 | 152–176 | 91.2–105.6 | 推向核心創新 |
| **drop B** | 44–59 | 176–240 | 105.6–144.0 | 辨識主秀 |
| breakdown 2 | 60–65 | 240–264 | 144.0–158.4 | 準確率段落 |
| build C | 66–71 | 264–288 | 158.4–172.8 | 推向普查 |
| **drop C** | 72–79 | 288–320 | 172.8–192.0 | 普查／幾何驗證 |
| tail | 80–84 | 320–340 | 192.0–204.0 | 收尾淡出 |

---

## 3. 音訊替代方案（multix 不可用）

| skill 原本 | 本片做法 | 驗證方式 |
|---|---|---|
| Gemini TTS（multix） | **edge-tts** `zh-CN-XiaoxiaoNeural`（微軟線上語音，免費）；每行一句獨立產生 | 逐行 WAV，`vo-lines.json` 由能量包絡音節切分求得；`build-timeline` 的 missing-word 警告需為 0 |
| ElevenLabs forced alignment | 自寫 **音節核對齊**：短時能量包絡 → 峰值偵測 → 對齊漢字數；不符時退為字數比例分配 | 對齊報告寫入 `data/align-report.json`（每行偵測到的音節數 vs 字數） |
| ElevenLabs Music | **numpy 合成**：正弦疊加 pad（Am–F–C–G）＋ 濾波掃頻 ＋ 正弦 sub bass ＋ 鈴聲琶音 ＋ 合成 kick/hat ＋ riser/impact。100.00 BPM、beat0 = 0 | `scripts/fit-beat-grid.py` 需回報 BPM 100.00；`verify-arrangement.py` 每段 lag ≤ ±2 ms |
| ElevenLabs SFX | **numpy 合成**：whoosh / click / tick / riser / impact，48 kHz | 每檔 `ebur128` 正規化到 −16 LUFS |
| — | 混音：music −5 dB → sidechain（threshold 0.03 / ratio 3 / attack 15 / release 350）→ loudnorm −14 LUFS | `measure-mix-balance.py`：音樂需比語音低 4–6 dB |

---

## 4. 渲染與編碼（本機限制）

- 渲染器：`npx --yes hyperframes@0.7.99 render -q high -f 30 --strict`
- 本機 `ffmpeg` **沒有 libx264** → 編碼順序 **`h264_nvenc` → `h264_mf` → `libopenh264`**；`-pix_fmt yuv420p` 必加
- 若 `hyperframes render` 內建 libx264 失敗 → 改 `--format png-sequence` 取 RGBA 序列，再用 ffmpeg nvenc 自行編碼

---

## 5. 完成標準對照（`Done when`）

1. `hyperframes lint` / `check` 通過；每個 scene 的 snapshot 都看過（逐 scene 檢視）
2. `verify-arrangement.py` 每段 ±2 ms
3. `measure-mix-balance.py` 音樂比語音低 4–6 dB
4. `ffprobe`：1920×1080 / 30 fps / 204 s / AAC 48 kHz 立體聲；`ebur128` ≈ −14 LUFS、峰值 ≤ −1 dBFS
5. `blackdetect` 淡出以外無黑帧
6. `build-timeline` 無 clip / overlap / missing-word 警告
7. 逐帧 QA ≥30 帧（每 scene 首尾＋中段）

---

## 6. 素材清單

| 類別 | 來源 | 用途 |
|---|---|---|
| 真站錄屏 | 自建 Puppeteer 錄製器：`index.html`（地圖旋轉／地形／景點／模型檢視器）、`recognize.html`（辨識流程／建檔流程） | scene 01/03/04/05/06/09/12/13 |
| 實驗圖 | `docs/figs/{encoder-compare,geo-inliers,roc,confusion,classifier-compare,prelabel,detect-demo,demo-geo-verify}.png/jpg` | scene 08/11/14 |
| 真實照片 | `photos-src/cc/<building>/` | scene 12 |
| 三維模型 | 使用者提供 GLB（玫瑰堂立面）→ 自建 three.js 檢視器轉台渲染 | scene 04 |
| 舊片重用 | `docs/video/macau-memory-90s.mp4`（**唯讀，不覆寫**） | 必要時擷取片段 |

**GLB 辨識結果**：已渲染確認＝**玫瑰堂（聖多明我堂）葡式巴洛克立面**——0.9269 × 0.7070 × 0.2938（寬×高×深），878,851 頂點／1,492,834 三角面／4 張 4096² PBR 貼圖。使用者原本判定的「扁平、不是建築」是把 glTF 的 Y-up 軸序讀成高度（0.294）所致；實際高度是 0.707（Y 軸），高/寬 = 0.763，是一棟建築的**立面模型**（進深僅 0.294，符合「只有立面＋淺短主體」的實況）。主題與本片高度相符，**採用**為 scene 04 主視覺。

---

## 7. 已知落差與誠實註記

1. **F5/F6（38 棟 / 335 張 / 89.0% / 94.9%）原以為與 repo 內的圖不一致**：`docs/figs/recognize-all-summary.png` 標的是「留一法辨識準確率（**322 張**參考照片）Top-1 **89.1%** / Top-3 **95.7%**」，那是**較舊的一次評測跑出來的圖**。實際上真站自己的 `libMeta.eval`（本片錄製時直接從 `recognize.html` 讀出）是 `n_queries: 335, n_buildings: 38, top1: 0.8896, top3: 0.9493`，**與指示的數字一致**。因此本片採用指示數字，並且**刻意不使用那張舊圖**當素材，避免同一畫面上出現互相矛盾的數字。
2. **F7（3.5 秒）**：使用者提供。本次錄製時以 headless Chrome 實測同一條流程為 **4.00 s**（含 headless 環境的額外負擔），未在原生 GPU 桌面環境重測，故片中保留「大約 3.5 秒」的敘述。
3. **音樂與音效為 numpy/scipy 合成**（非 ElevenLabs），因此「音樂由生成模型產生」這件事不成立；BPM／beat grid／整小節 splice 仍照 skill 完整驗證（BPM 100.00、10 段 splice lag 全部 0.0 ms）。
4. 旁白為 edge-tts 雲端語音（`zh-CN-XiaoxiaoNeural`，非 Gemini TTS / Puck），音色與 skill 參考片不同。
5. 對齊方式改為自製「能量等分 + 谷底吸附」強制對齊（非 ElevenLabs forced alignment）；36 行全部走 energy-eq 路徑，邊界落在能量谷的比例平均 0.734、最低 0.500。
6. **GLB 的軸序更正**：使用者原本判定「高/寬比 0.32 → 扁平，不是建築」是把 glTF 的 Z 當成高度。glTF 是 Y-up：實際 `size = (0.9269, 0.7070, 0.2938)`，**高度是 0.707（Y 軸）**，高/寬 = 0.763 —— 它是一棟建築的**立面模型**（進深僅 0.294）。
