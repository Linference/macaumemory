# 小澳 · 建築數字人導覽

點選景點標記或列表後，自動顯示當前建築介紹，嘗試播放腾讯雲語音；手機若攔截自動播放，可按「播放講解」。數字人提供呼吸動作與依音訊能量切換的說話表情，是 2D 動畫角色，不是三維人物或逐音素嘴型模型。

## 本地啟動

需要 Node.js 24。將 `.env.example` 複製為 `.env.local`，填入腾讯雲 SecretId/SecretKey，開通 TTS 和 ASR。對話使用 `DEEPSEEK_API_KEY`，本機亦相容既有 `public/ai-local.json`；正式部署應遷移至後端環境變數並移除公開目錄內的金鑰。

```sh
npm run guide:server
npm run build
npm run preview
```

Vite 的開發及預覽伺服器將 `/api/guide/*` 轉發到本機 8787。密鑰不使用 VITE 前綴、不返回前端、不寫入版本控制。正式上線需部署 Node 後端或同等雲函數，由 HTTPS 網站同源代理接口；GitHub Pages 本身不能執行這個後端。當前服務只監聽 127.0.0.1，勿直接改成公開服務；上線前應加入使用者驗證、每使用者配額、HTTPS 及明確的來源白名單。

## 互動與語音

- 每次選擇不同景點會取消舊請求、關閉舊錄音並停止播放，對話記錄隔離。
- 介紹取自網站景點資料；AI 回答帶當前建築資料，缺少資料須承認未核實。
- `TextToVoice` 使用 101001 女聲，可透過 `TENCENT_VOICE_TYPE` 修改。中文每段不超過130字，MP3 16kHz，伺服器快取80段。
- 點「語音提問」後取得麥克風權限，點「結束並提問」提交。最長25秒，自動轉16kHz單聲道 PCM WAV，使用 `SentenceRecognition`；成功結果自動送給對話服務。
- 錄音只在點擊後開始；錄音會傳送腾讯雲，問題傳送對話服務。關閉面板、切換景點、離開頁面均清理錄音。手機相機及麥克風需 HTTPS 或本機 localhost。
- 當前觸發範圍是網站收錄的景點標記及清單，尚未涵蓋全部24,904棟無介紹資料的建築。

## 形象素材

內建 imagegen 生成，保存 `public/guide/xiaoao.webp` 與 `xiaoao-speaking.webp`。主提示：原創澳門文化導覽員、東亞年輕成年女性、精緻三維動畫風格、深藍金邊制服、金色蓮花髮飾、正面半身、柔和棚光；說話版以同一形象為參考，只修改嘴唇為自然微張。角色屬原創虛構形象。

接口參考：[腾讯雲 TTS](https://cloud.tencent.com/document/api/1073/37995)、[ASR](https://cloud.tencent.com/document/api/1093/35646)、[TC3 簽名](https://cloud.tencent.com/document/api/213/30654)。
