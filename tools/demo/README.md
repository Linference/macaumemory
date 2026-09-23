# tools/demo —— 離線現場演示頁

## 產生與執行

```powershell
cd 'D:\Users\LINKIT\Desktop\澳门记忆'
python tools\demo\build_demo.py          # 產生 index.html（內嵌資料，約 61 KB）
node   tools\demo\smoke_test.mjs         # 冒煙測試：資料、照片路徑、UI 腳本、5 幕流程
```

然後**直接雙擊** `tools/demo/index.html` 用瀏覽器開啟即可——**file:// 也能跑，完全離線**。

現場話術與故障預案見 [`DEMO.md`](DEMO.md)。

## 為什麼要「產生」而不是手寫 HTML

1. 展場網路不可靠 → 頁面必須離線：把 `photo-archive.json`（真實產線輸出）與
   `macau-boundary.geojson`（澳門邊界）**內嵌**進 HTML，照片用相對路徑指到 `public/photos/`。
2. 資料一改（例如實拍照片跑完產線後）重跑 `build_demo.py` 就會更新，不必手改數字。
3. 沙箱內沒有瀏覽器可以目視檢查，所以附一支 `smoke_test.mjs`：
   用最小 DOM 樁在 Node 裡**真的執行頁面腳本**，驗證內嵌資料、照片是否存在、
   5 幕流程走完會出現「併入 MM-0001」「建立新記憶點 MM-0004」等關鍵結果。

## 頁面結構

| 面板 | 內容 |
|---|---|
| ① 歸戶流程 | 六步流程（EXIF → YOLO → CLIP → **地理先驗** → 相似度 → 建檔），逐步亮起 |
| ② 手機 | 照片、EXIF（GPS／時間／檔名）、逐條判定卡、同棟時間軸 |
| ③ 記憶點地圖 | 澳門邊界 SVG + 記憶點（永久編號）+ 90 m 地理先驗圈 + 路氹城相似度假村群標註 |

## 操作

| 按鍵 | 效果 |
|---|---|
| 空白鍵 | 下一步（建議評審互動時用） |
| R | 重播 |
| D | 答辯細節（AUC、FPR、資料集規模等 KPI） |
| F | 全螢幕 |

「▶ 開始 90 秒示範」＝自動播放 5 幕，秒數由 `build_demo.py` 的 `SCRIPT` 控制（10/22/22/16/20＝90 秒）。

## 資料誠實性

- 頁面上的相似度（0.903）、判定（merge／new）、解讀文字**全部來自產線實際輸出**
  （`public/data/photo-archive.json`），不是為了演示編的數字。
- 頂端有兩個標籤明示：`示範重播 · 產線實際輸出`、`測試素材為 3D 模型截圖（非實拍）`。
- KPI 卡的數字來自 `tools/eval/out/metrics.json`（受控實驗），答辯時可直接對照報告。

## 其他

- `check_map.py`：把同一份邊界與記憶點用 matplotlib 畫出來，確認投影與落點正確
  （產出 `out/map-check.png`）。
- 換幕次內容／秒數 → 改 `build_demo.py` 的 `SCRIPT`；換預載記憶點 → 改 `PRELOADED`。
