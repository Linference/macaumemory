$ErrorActionPreference = 'Stop'
$taskProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskProjectRoot
$taskRuntimeNode = (Get-Command node).Source
if ([int]((& $taskRuntimeNode -p 'process.versions.node.split(String.fromCharCode(46))[0]')) -lt 24) { throw '請安裝 Node.js 24 或更新版本。' }
$taskLogs = Join-Path $taskProjectRoot 'output/local-services'
New-Item -ItemType Directory -Path $taskLogs -Force | Out-Null
$taskServices = @(
  @{ Name='memory'; Port=8790; Args=@('server/memory.mjs') },
  @{ Name='guide'; Port=8787; Args=@('server/guide.mjs') },
  @{ Name='preview'; Port=4173; Args=@('node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4173','--strictPort') }
)
foreach ($taskService in $taskServices) {
  if (-not (Get-NetTCPConnection -LocalPort $taskService.Port -State Listen -ErrorAction SilentlyContinue)) {
    $taskServiceProcess = Start-Process -FilePath $taskRuntimeNode -ArgumentList $taskService.Args -WorkingDirectory $taskProjectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskLogs ($taskService.Name+'.stdout.log')) -RedirectStandardError (Join-Path $taskLogs ($taskService.Name+'.stderr.log')) -PassThru
    Write-Host ($taskService.Name + ' PID ' + $taskServiceProcess.Id)
  }
}
Start-Sleep -Seconds 2
$taskHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:8790/api/memory/health' -TimeoutSec 10
if (-not $taskHealth.ready) { throw '本機記憶服務未能啟動，請查看 output/local-services 的日誌。' }
Start-Process 'http://127.0.0.1:4173/memory.html'
Write-Host '途見共創記憶已啟動：http://127.0.0.1:4173/memory.html'
