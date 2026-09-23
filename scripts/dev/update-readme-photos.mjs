import fs from "node:fs";
let r = fs.readFileSync("README.md", "utf8");
const section = `## 實景照片檔案（拍照 → AI 分類 → 地圖展示）

把「遊客拍的照片」變成地圖上的建築檔案：照片依 EXIF 定位落在澳門地圖的真實位置，附上建築類別與解讀。

### 使用方式

\`\`\`bash
# 1. 把照片放進 photos-src/（可分子資料夾；支援 jpg / png / heic / webp）
#    手機拍照請開啟「記錄位置」，這樣才有 GPS
# 2. 跑產線
python tools/photo-archive/pipeline.py

# 常用選項
python tools/photo-archive/pipeline.py --limit 5        # 先試 5 張
python tools/photo-archive/pipeline.py --blur-faces     # 人臉自動模糊（街拍有路人時建議）
python tools/photo-archive/pipeline.py --no-clip        # 跳過 CLIP（只做定位/縮圖/位置推斷）
python tools/photo-archive/pipeline.py --caption none   # 不呼叫 DeepSeek
python tools/photo-archive/pipeline.py --refresh        # 忽略快取重跑
\`\`\`

網站端：圖層面板打開「**實景照片**」→ 地圖出現相機標記（依類別上色），點標記看照片＋解讀；
景點詳情面板下方有「**實景照片**」相簿；點縮圖可看大圖與完整檔案（座標、拍攝時間、分類依據、來源標示）。

### 產線怎麼運作

\`\`\`
照片
 ├─ EXIF：GPS、拍攝時間、機型 →（沒有 GPS 時）讀 photos-src/labels.csv 的 lat/lon
 │                              →（再沒有）用檔名比對景點名稱自動定位
 ├─ 自動轉正 + 產生網站大圖（最長邊 1600）與縮圖（480）
 ├─ YOLO（yolo11n）：偵測人物等物件；--blur-faces 時用 OpenCV 偵測並模糊人臉（隱私）
 ├─ CLIP 零樣本分類：12 類建築風格（零訓練，改類別只要改 taxonomy.py）
 ├─ 位置推斷分類：用既有的 24,904 棟 OSM 建築與 61 個景點資料推斷（優先採用，比單純看圖可靠）
 ├─ DeepSeek：把「類別＋座標＋附近景點／建築資訊」寫成 2~3 句建築解讀 + 標籤 + 風格
 └─ 輸出 public/data/photos.geojson（地圖）與 public/data/photo-archive.json（完整檔案）
\`\`\`

**分類優先序**（越前面越可信）：

| 順序 | 來源 | 說明 |
| --- | --- | --- |
| 1 | 手動標註 | 在 \`photos-src/labels.csv\` 填 \`檔名,類別id,解讀\` 即完全採用 |
| 2 | 位置推斷 | 照片 60 公尺內有景點，或最近的 OSM 建築有明確類型（temple/hotel/apartments…） |
| 3 | CLIP | 只有「位置完全沒線索」時才用它決定類別；其結果一律記在 \`clipTop\` 供參考 |

### 12 類建築分類

葡式殖民建築、中式廟宇、天主教教堂、騎樓與唐樓、現代高層住宅、酒店與娛樂場、
公共建築、工業與倉庫、圍里與村落民居、牌坊與紀念物、街市與市集、街景與其他。

### 模型與離線說明

- **CLIP**：預設用 \`.cache/models/clip-vit-base-patch32\`（可用 \`python tools/photo-archive/fetch_clip_modelscope.py\` 從 ModelScope 下載，約 605 MB）；HF 在大陸被封鎖時會自動改用 \`hf-mirror.com\`
- **YOLO**：\`yolo11n.pt\`（約 5 MB）首次執行自動下載
- **DeepSeek 金鑰**：讀 \`public/ai-local.json\`（已 gitignore）或環境變數 \`DEEPSEEK_API_KEY\`；沒有金鑰也能跑，只是沒有自動解讀

### 授權提醒

照片若是自己拍的沒問題；若使用他人照片（例如 Wikimedia Commons），請在 \`labels.csv\` 的 \`credit\` 欄填作者與授權，網站的大圖檢視會顯示「來源」，這是授權要求。

---

`;
r = r.replace("## 資料來源與授權", section + "## 資料來源與授權");
r = r.replace(
  "- **深連結**：網址即時反映鏡頭與選取景點",
  `- **實景照片**：圖層面板可開啟照片標記（依建築類別上色），景點標記會顯示 📷 數量徽章；點標記或景點面板的相簿可看大圖與建築解讀
- **深連結**：網址即時反映鏡頭與選取景點`
);
fs.writeFileSync("README.md", r);
console.log("README 已加入實景照片章節");
