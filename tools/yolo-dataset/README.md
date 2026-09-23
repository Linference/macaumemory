# tools/yolo-dataset —— 訓練「澳門建築偵測器」

> 目的：讓 YOLO **真的能認建築**。COCO 預訓練的 YOLO 沒有「建築」類別（這也是展板上那張對照圖的重點），
> 所以要自己標、自己訓。這套工具把最花時間的部分自動化：**抓圖 → 自動框 → 分組切分 → 訓練 → 評估**。

## 三步走

```powershell
cd 'D:\Users\LINKIT\Desktop\澳门记忆'

# 1) 抓圖（Wikimedia Commons，含授權標註；11 類 × 預設 60 張）
python tools\yolo-dataset\fetch_dataset.py --per-class 60

# 2) 自動預標註 + 防洩漏分組切分 train/val
python tools\yolo-dataset\prelabel.py

# 3) 訓練 + 驗證（RTX 5070 約 20~40 分鐘 / 100 epochs）
python tools\yolo-dataset\train.py --model yolo11n.pt --epochs 100 --batch 16
```

## 目錄結構

```
datasets/macau-buildings/
├─ images/raw/<class>/*.jpg      ← 原始下載（依類別分資料夾）
├─ images/{train,val}/*.jpg      ← prelabel 切分後的訓練／驗證集
├─ labels/{train,val}/*.txt      ← YOLO 格式標籤（cls cx cy w h，正規化）
├─ out/preview-prelabel.jpg      ← 畫框預覽（肉眼 QA）
├─ ATTRIBUTION.csv               ← 每張圖的作者、授權、日期、來源頁
├─ data.yaml                     ← 類別定義（11 類）
└─ runs/train/weights/best.pt    ← 訓練結果
```

## 11 個類別

`portuguese`（葡式殖民）`temple`（廟宇）`church`（教堂）`tong_lau`（騎樓唐樓）
`residential_tower`（高層住宅）`casino_hotel`（酒店娛樂場）`civic`（公共建築）
`industrial`（工業倉庫）`village`（村落民居）`monument`（牌坊紀念物）`market`（街市）

> 刻意**不含「街景」**：那是場景標籤不是物件，偵測框無從界定。

## 每個環節在做什麼（以及為什麼這樣做）

### 1. 抓圖：為什麼用 Commons
真實照片 + 明確授權 + 有拍攝日期／作者，這三件事對參賽作品的資料誠信都是必要的。
每張圖都記錄在 `ATTRIBUTION.csv`，海報與報告要引用時直接可用。

### 2. 自動框：YOLO-World 開放詞彙
我們**不需要模型判斷類別**——類別已經由資料夾決定（`temple/` 裡的圖就是廟）。
所以只要模型回答「建築在哪」，用 `yolov8s-worldv2.pt` 以
`a photo of a building` 等提示詞偵測，取信心最高的框即可。
未被偵測到框的圖不會匯入（寧缺勿濫）。

### 3. 防資料洩漏：按「同棟」分組切分
**同一棟建築的不同照片若同時出現在 train 與 val，val 分數會虛高。**
所以 `prelabel.py` 預設用 CLIP 影像向量把近似重複的照片聚成組（餘弦 ≥ 0.92），
再整組分到 train 或 val（可用 `--group-threshold` 調整、`--no-group-split` 關閉）。
這與我們在重辨識評測裡抓到的「同張圖裁切」洩漏是同一個問題。

### 4. 人工修正（建議做，時間成本 1~3 小時）
自動框只是起點。用任一工具打開 `images/train` + `labels/train` 修正框的位置：

| 工具 | 說明 |
|---|---|
| **LabelImg** | 最簡單，`pip install labelImg`，直接開 `images/train` 目錄 |
| **CVAT** | 網頁版、支援協作，適合兩人分工 |
| **Ultralytics HUB** | 上傳資料集即可，雲端標註 + 訓練一條龍 |

修正原則：
- 框要**貼緊建築主體**（不要框到天空與地面），但也不要切掉屋頂或簷角。
- 一張圖有兩棟主建築時，可以只留最主要那棟（本資料集是單一建築為主）。
- **類別不用改**（類別來自資料夾），所以修正速度很快：多數圖只需微調或直接通過。

### 5. 訓練與評估
`train.py` 用 YOLO11n 起手（快、夠用）；資料量夠、想更準再換 `yolo11s.pt`。
評估要誠實回報 **mAP50 / mAP50-95 與各類別 AP**，特別注意：
- 樣本少的類別（`industrial`、`village`）AP 通常明顯偏低，要在報告裡說明。
- 分組切分後的 val 分數才是可信的「同一棟沒見過」分數。

## 接回產品管線

訓練好的偵測器可以補上目前系統缺的一塊：

```
照片 → YOLO 偵測器（框出建築 + 給類型）      ← 新
     → CLIP 影像向量（重辨識：是不是同一棟）  ← 現有
     → 地理先驗 90 m（排除不可能的候選）      ← 現有
     → 永久編號 MM-#### + DeepSeek 解讀        ← 現有
```

`pipeline.py` 的 `Detector` 已經有 `self.model`（COCO）與 `self.face_model`（人臉），
只要多載一個 `macau-buildings-best.pt` 就能並用：

```python
from ultralytics import YOLO
bld = YOLO(".cache/models/yolo/macau-buildings-best.pt")
for b in bld.predict(photo, conf=0.35)[0].boxes:
    print(bld.names[int(b.cls[0])], float(b.conf[0]), b.xyxy[0].tolist())
```

## 常見坑

| 坑 | 後果 | 解法 |
|---|---|---|
| 同一棟的照片分到 train 與 val | val mAP 虛高 | 用預設的 `--group-split` |
| 框太鬆（含大量背景） | 模型學會看天空 | 人工修正時把框貼緊建築 |
| 類別不平衡（casino 很多、industrial 很少） | 少數類別 AP 極低 | 補抓該類圖片，或用 `--per-class` 分別控制 |
| 直接拿 COCO 模型測建築 | 檢出 0 棟 | 這正是本資料集存在的理由 |
| 忘了記錄授權 | 參賽資料誠信問題 | `ATTRIBUTION.csv` 要跟著資料一起提交 |

## 時間估算（兩週內可行）

| 步驟 | 時間 |
|---|---|
| 抓圖 660 張 | 15~25 分鐘（自動） |
| 自動預標註 + 切分 | 5~10 分鐘（自動） |
| 人工修正 | 1~3 小時（看要求嚴格度） |
| 訓練 100 epochs | 20~40 分鐘（RTX 5070） |
| 寫評估與圖表 | 1 小時 |
