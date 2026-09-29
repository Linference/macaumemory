# 一次跑完普查建檔相關的五支檢查，並記錄各支的退出碼。
#
# 前置：
#   1. Vite dev server（5173）——browser-check*.mjs 都連 http://127.0.0.1:5173/recognize.html
#   2. 照片伺服器（5180）：python tools/recognize/serve-cors.py（只有 browser-check.mjs 需要）
# 用法：powershell -NoProfile -File tools/recognize/run-all-checks.ps1
#
# 註：本檔刻意只用 ASCII。Windows PowerShell 5.1 讀 .ps1 時若沒有 BOM 會當成 ANSI，
#     中文註解會把字串常值弄壞（實際踩過）。
$ErrorActionPreference = "Continue"
Set-Location (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent)
$checks = @(
  @{ name = "check-survey-geo.mjs  (Node: GPS sampling + weighting)"; cmd = "node tools/recognize/check-survey-geo.mjs" },
  @{ name = "check-survey-db.mjs   (Node: SQLite + R-Tree)"; cmd = "node tools/recognize/check-survey-db.mjs" },
  @{ name = "browser-check-survey.mjs (E2E: survey main flow)"; cmd = "node tools/recognize/browser-check-survey.mjs" },
  @{ name = "browser-check-discover.mjs (E2E: legacy discover path)"; cmd = "node tools/recognize/browser-check-discover.mjs" },
  @{ name = "browser-check.mjs (E2E: models + real photos)"; cmd = "node tools/recognize/browser-check.mjs --budget 300" }
)
$summary = @()
foreach ($c in $checks) {
  Write-Output ""
  Write-Output "================ $($c.name) ================"
  $out = Invoke-Expression $c.cmd 2>&1 | Out-String
  $code = $LASTEXITCODE
  Write-Output $out
  Write-Output ">>> EXIT CODE: $code"
  $summary += ("{0,-52} exit={1}" -f $c.name, $code)
}
Write-Output ""
Write-Output "================ SUMMARY ================"
$summary | ForEach-Object { Write-Output $_ }
