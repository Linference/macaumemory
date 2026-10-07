# 城市記憶實拍相冊

目前發布 32 個建築記憶點、305 張實拍照片。資料來自本地已歸類的建築照片，以及 datasets/macau-buildings 中附有來源記錄的照片。

重新發布：

```powershell
python tools/photo-archive/publish_real_photos.py
npm test
npm run build
```

需要 Pillow。輸出位於 public/photos/real，以及 public/data 下的 places.geojson、photos.geojson 和 photo-archive.json。

發布保留原有記憶點編號，以建築名錄對應座標，不將座標冒充照片 GPS。拍攝日期只接受完整有效的年月日；未記錄日期的照片排在有日期的照片之後。Commons 照片保留作者、授權及原始來源頁，資料不完整的照片不發布。

照片輸出為最大邊 1600 像素的 WebP，縮圖最大邊 420 像素；保留比例，不放大原圖，不生成建築內容。辨識模型與評測資料不受此發布步驟影響。

網站會自動載入相冊資料，景點面板可直接進入附近建築相冊；照片圖層開關另行控制地圖上的記憶點。相冊縮圖支援鍵盤操作，顯示拍攝日期，來源連結經過協定檢查與文字轉義。

2026-10-03 驗證：21 項測試及 Vite 生產構建通過；在瀏覽器中確認龍環葡韻實拍相冊可開啟、切換照片及顯示來源。頁面截圖位於 output/city-memory/real-photo-album-desktop.png。
