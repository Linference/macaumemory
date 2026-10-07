# Live progress monitor for the 3-minute Macau Memory video render.
#
# Usage (either shell works):
#   powershell -ExecutionPolicy Bypass -File "<repo>\tools\video\watch-render.ps1"
#   pwsh -File "<repo>\tools\video\watch-render.ps1"
#
# Ctrl+C to stop.
#
# NOTE: this file is intentionally pure ASCII. The repo output folder is derived
# from the script's own location ($PSScriptRoot) instead of being hard-coded, so
# the script cannot break on a non-ASCII path or a different code page.

$TOTAL = 6192

# <repo>\tools\video\watch-render.ps1  ->  <repo>
$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$outDir   = Join-Path $repoRoot "docs\video"
$target   = Join-Path $outDir "macau-memory-web-3min.mp4"
$stage    = Join-Path $env:TEMP "hf-render-LP3r2u\capture-attempt-0"

Write-Host ""
Write-Host "  Macau Memory - 3min video render monitor"
Write-Host ("  watching : " + $stage)
Write-Host ("  output   : " + $target)
Write-Host "  Ctrl+C to stop"
Write-Host ""

if (-not (Test-Path $stage)) {
    Write-Host "  WARNING: frame folder not found - render may not have started yet." -ForegroundColor Yellow
}
if (-not (Test-Path $outDir)) {
    Write-Host ("  ERROR: output folder not found: " + $outDir) -ForegroundColor Red
    Write-Host "  (run this script from inside the repo)" -ForegroundColor Red
}

$t0 = Get-Date

while ($true) {
    $now   = Get-Date
    $count = 0
    if (Test-Path $stage) {
        $count = @(Get-ChildItem $stage -Recurse -File -Filter "frame_*.png" -Force -ErrorAction SilentlyContinue).Count
    }
    if ($count -gt $TOTAL) { $count = $TOTAL }
    $pct = [math]::Round(100 * $count / $TOTAL, 1)

    $elapsed = ($now - $t0).TotalSeconds
    $rate = 0
    if ($elapsed -gt 5) { $rate = $count / $elapsed }

    $filled = [int]($pct / 4)
    if ($filled -gt 25) { $filled = 25 }
    $bar = ("#" * $filled).PadRight(25, ".")

    $eta = "--:--"
    if ($rate -gt 0.5 -and $count -lt $TOTAL) {
        $eta = $now.AddSeconds(($TOTAL - $count) / $rate).ToString("HH:mm")
    }

    $note = ""
    if (Get-Process ffmpeg -ErrorAction SilentlyContinue) { $note = "ENCODING" }
    elseif ($count -ge $TOTAL) { $note = "render done, waiting for encode" }
    if (Test-Path $target) { $note = "*** VIDEO READY ***" }

    $line = "  [{0}] {1,5}%  {2,5}/{3} frames  {4,5:N2} fps  eta {5}  {6}" -f `
            $bar, $pct, $count, $TOTAL, $rate, $eta, $note
    Write-Host ("`r" + $line.PadRight(100)) -NoNewline

    if (Test-Path $target) {
        $f = Get-Item $target
        Write-Host ""
        Write-Host ""
        Write-Host ("  DONE: " + $f.FullName)
        Write-Host ("        {0:N2} MB   {1}" -f ($f.Length / 1MB), $f.LastWriteTime)
        Write-Host ""
        break
    }

    Start-Sleep -Seconds 3
}
