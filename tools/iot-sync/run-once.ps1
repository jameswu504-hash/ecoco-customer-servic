$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$runtimeRoot = Join-Path $repoRoot '.local-iot-sync'
$logRoot = Join-Path $runtimeRoot 'logs'
$logPath = Join-Path $logRoot ("iot-sync-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))
$mutex = [Threading.Mutex]::new($false, 'Local\ECOCO-IoT-Station-Sync')
$hasLock = $false

New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

try {
  $hasLock = $mutex.WaitOne(0)
  if (-not $hasLock) {
    "[$(Get-Date -Format o)] Sync skipped because another run is active." | Add-Content -LiteralPath $logPath
    exit 0
  }

  "[$(Get-Date -Format o)] Starting ECOCO IoT sync." | Add-Content -LiteralPath $logPath
  Push-Location $repoRoot
  try {
    & npm.cmd run iot:sync *>> $logPath
    if ($LASTEXITCODE -ne 0) {
      throw "npm run iot:sync exited with code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
  "[$(Get-Date -Format o)] ECOCO IoT sync completed." | Add-Content -LiteralPath $logPath

  Get-ChildItem -LiteralPath $logRoot -Filter 'iot-sync-*.log' -File |
    Where-Object LastWriteTime -lt (Get-Date).AddDays(-30) |
    Remove-Item -Force
} catch {
  "[$(Get-Date -Format o)] ECOCO IoT sync failed: $($_.Exception.Message)" | Add-Content -LiteralPath $logPath
  exit 1
} finally {
  if ($hasLock) {
    $mutex.ReleaseMutex()
  }
  $mutex.Dispose()
}
