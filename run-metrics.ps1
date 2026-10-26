param(
  [ValidateSet('restart', 'dashboard')]
  [string]$Mode = 'restart'
)

$ErrorActionPreference = 'Stop'
$repoRoot = $PSScriptRoot
$webRoot = Join-Path $repoRoot 'web'

if ($Mode -eq 'restart') {
  $instancePattern = 'run-metrics\.ps1.*-Mode dashboard(\s|$)'
  $instances = @(
    Get-CimInstance Win32_Process | Where-Object {
      $_.Name -eq 'powershell.exe' -and $_.CommandLine -match $instancePattern
    }
  )
  foreach ($instance in $instances) {
    & taskkill.exe /PID $instance.ProcessId /T /F | Out-Null
  }

  Start-Sleep -Milliseconds 800
  $arguments = "-NoExit -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Mode dashboard"
  Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WorkingDirectory $webRoot
  return
}

$Host.UI.RawUI.WindowTitle = 'Lumen - Metrics Dashboard'
Set-Location -LiteralPath $webRoot
npm run dev
exit $LASTEXITCODE
