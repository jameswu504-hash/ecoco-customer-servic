param(
  [string]$TaskName = 'ECOCO IoT Station Sync'
)

$ErrorActionPreference = 'Stop'
$launcher = (Resolve-Path (Join-Path $PSScriptRoot 'run-hidden.vbs')).Path
$action = New-ScheduledTaskAction `
  -Execute "$env:SystemRoot\System32\wscript.exe" `
  -Argument "//B //Nologo `"$launcher`""
$trigger = New-ScheduledTaskTrigger `
  -Once `
  -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 5) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 4)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description 'Copies readonly ECOCO IoT station status into the cloud database.' `
  -Force
