@echo off
title 澳門立體誌 · 3D 立體澳門地圖
cd /d "%~dp0"
echo ============================================
echo   澳門立體誌 · 3D 立體澳門地圖
echo ============================================
echo.
if not exist "dist\index.html" (
  echo [1/3] 首次執行，正在打包前端...
  call npm run build
) else (
  echo [1/3] 使用已打包的 dist 版本
)
echo [2/3] 啟動本機伺服器 http://127.0.0.1:4173/
start "澳門立體誌伺服器" /min cmd /c "npx vite preview --port 4173 --host 127.0.0.1"
echo [3/3] 等待伺服器就緒...
timeout /t 6 /nobreak >nul
start "" "http://127.0.0.1:4173/"
echo.
echo 瀏覽器已開啟。若沒有自動開啟，請手動輸入：
echo     http://127.0.0.1:4173/
echo.
echo ＊關閉本視窗與最小化的「澳門立體誌伺服器」視窗，即可停止服務。
pause
