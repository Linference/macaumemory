# 三端整合與標註對照

三端分工：MacauSplat 產生幾何輔助標註；網站提供辨識、實拍檔案與對照報告；微信小程序提供隨身實拍檔案與文化探索清單。

## 共用地點契約

`public/data/system-catalog.json` 為網站與小程序共同來源。`id` 是辨識庫的建築編號；`spotId` 是地圖景點編號；`memoryId` 是記憶點編號。座標為 WGS84。小程序原生地圖入口轉換至 GCJ02，保留原始座標。

```powershell
python tools/integration/export_catalog.py --mini-out output/integration/mini
```

小程序 `pages2/city-memory` 使用打包的本地資料與精選實拍縮圖，無需新建雲函數或新增密鑰。主頁可進入，選中的建築以穩定 ID 加入規劃頁的文化探索清單。這是手動清單的整合，尚未改變既有行程生成算法。

## MacauSplat 標註對照

保留 OOOSplat／COLMAP／Brush 原有重建來源。新增的 `scripts/memory-bridge.py` 是命令列伴隨工具，不修改原重建流程；相同工具在網站專案 `tools/integration/annotation_bridge.py`。

```powershell
python scripts/memory-bridge.py --annotations "工程/annotation/annotations.json" --frames "工程/work/frames" --building-id taipa-houses --session-id capture-01 --scene-kind building --split train --out "output/memory-review" --review-template scripts/annotation-review.html
```

開啟產出的 `review.html`，在實拍影格上拖曳畫框，或選擇無目標，匯出 `manual-review.json`。頁面預設不展示自動框；查看自動框後會記為 `assisted-review`，不當作盲標的人工基準。需透過本機靜態伺服器提供 `output/memory-review` 時，可用 `python -m http.server 8788 --bind 127.0.0.1 --directory output/memory-review`。

用完全相同的參數，再加 `--review manual-review.json` 重跑，可得到平均 IoU（漏標記為零）、IoU≥0.5 的精確率與召回率、負例誤接受率及操作計時。人工基準與原始標註 SHA256、拍攝 session 必須相符。沒有人工基準時只輸出接受率，不生成准确率。所有品質指標僅針對已複核樣本，與下游辨識準確率分開。

使用 `--manifest` 指向既有 `bundle.json` 可檢查拍攝 session 或完全相同影像是否跨 train／val／test。此檢查不替代近重複影像檢查，也不會自動審計其他已存在但未提供的資料集。抽樣覆蓋已接受及已拒絕影格，並在各組中按影格次序均勻選取。

## 現有示例與研究邊界

已有 MacauSplat 示例主要是室內掃描；可用來驗證解析、抽樣、人工複核和結果輸出，不代表澳门建筑標註效果。尚需提供可明確辨認目標的澳门建筑重建、獨立人工框和拍攝記錄，再比較標註時間、品質與下游辨識效果。

COLMAP 未經量測校準時的三維尺度不能直接當作公尺。稀疏點的 track 只是遮擋代理，不能保證零漏框；三維包圍盒投影與 PCA 是既有方法，新增流程的研究價值仍待查新與實驗確認。軟件單元測試不能替代人工真值的品質測試。

## 本地更新

網站 `system.html` 新增整合入口，可搜尋實拍檔案並匯入 `audit.json`，資料留在本機瀏覽器。小程序照片保留作者與授權，可複製原圖來源。

整合工具安裝時先備份既有檔案到 `macaumemory/output/integration/backups`，不覆蓋其他未提交的改動。新增微信頁面的真機與開發者工具編譯仍需分別確認；本地 Node 契約測試不等同微信真機驗證。
