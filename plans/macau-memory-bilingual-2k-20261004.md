# 澳門記憶雙語 2K 講解影片

交付：2560×1440、30fps、H.264 MP4；普通話及粵語各一版，配音、同步字幕、背景音樂、封面、可重建腳本。時長隨真實合成音訊決定，目標約四分鐘。

畫面：真實網站介面、已發布實拍照片、清楚標示的流程動畫；不把介面截圖動效宣稱為連續即時錄屏。數字人展示為已實現的介面與接口，不偽造正在進行的對話。

事實來源：public/data/macau-stats.json（24904 建築、7158 有高度欄位、20972 道路）；public/data/places.geojson 與 photos.geojson（32 記憶點、305 實拍）；memory-embeddings.json（38 建築、335 參考）；src/recognize、src/collection、docs/location-upgrade.md、docs/acquisition-upgrade.md、docs/system-integration.md。小程序僅有共用名錄與手動探索清單，無即時同步；普通建築新照片自動入庫與再次識別尚未接通。

MacauSplat：重建沿用 OOOSplat，新增幾何辅助標註與人工複核；資料示例不能當成澳門建築效果結論。不得使用「零漏框」「厘米級」「已優於通用 AI」等未经實驗支持的表述。

語音：腾讯云 TextToVoice，普通話 101001，粵語 101019，16000Hz WAV，EnableSubtitle。文本單次不超過130字；使用接口回報的字元時間戳對齊字幕。密鑰只從現有本地環境載入，不進入腳本、圖像、音訊元資料或 Git。

渲染調整：自動审批拒絕下載並以提升權限執行 HyperFrames。改用已安裝 FFmpeg、Pillow 與 NumPy 合成，保持獨立新輸出目錄，不修改既有影片。本次不宣稱通過 HyperFrames lint/check。

驗收：逐場景封面與字幕目視、音畫時間線檢查、實際聆聽雙語樣段；ffprobe 確認解析度／幀率／AAC；loudnorm 計量、黑場與靜音檢查。所有相片保留來源清單。

官方參考：
- https://cloud.tencent.com/document/api/1073/37995
- https://cloud.tencent.com/document/product/1073/92668
