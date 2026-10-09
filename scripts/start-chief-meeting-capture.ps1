# Native local worker only. No microphone access, capture request, or API keys on argv.
[CmdletBinding()]
param([switch]$Stop)
$ErrorActionPreference = 'Stop'
$captureRoot = Split-Path -Parent $PSScriptRoot
$capturePrivate = Join-Path $captureRoot '.chief-local/meeting-capture'
$captureConfig = Join-Path $capturePrivate 'worker.json'
$captureWorker = Join-Path $captureRoot 'integrations/meeting-capture/worker.py'
$capturePython = Join-Path $captureRoot '.chief-local/capture-venv/Scripts/python.exe'
$captureReceipt = Join-Path $capturePrivate 'process.json'
$captureStop = Join-Path $capturePrivate 'stop.request'
Push-Location -LiteralPath $captureRoot
try {
  & node --input-type=module -e "import {validateCaptureConfiguration} from './scripts/prepare-chief-meeting-capture.mjs'; await validateCaptureConfiguration();"
  if ($LASTEXITCODE -ne 0) { throw 'Private capture configuration failed validation.' }
  $captureExisting = $null
  if (Test-Path -LiteralPath $captureReceipt) {
    $captureSaved = Get-Content -LiteralPath $captureReceipt -Raw | ConvertFrom-Json
    $captureExisting = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$captureSaved.pid)
    if ($captureExisting -and ($captureExisting.ExecutablePath -ne $capturePython -or $captureExisting.CommandLine -notlike ('*"' + $captureWorker + '"*') -or $captureExisting.CommandLine -notlike ('*"' + $captureConfig + '"*') -or $captureExisting.CreationDate.ToUniversalTime().Ticks -ne ([DateTime]$captureSaved.createdAt).ToUniversalTime().Ticks)) {
      throw 'Stored worker identity changed; no process was touched.'
    }
  }
  if ($Stop) {
    if ($captureExisting) {
      [IO.File]::WriteAllText($captureStop, 'Stop the owned local worker')
      [pscustomobject]@{status='graceful-stop-requested';pid=$captureExisting.ProcessId} | ConvertTo-Json -Compress
    } else { '{"status":"already-stopped"}' }
    return
  }
  if ($captureExisting) { [pscustomobject]@{status='already-running';pid=$captureExisting.ProcessId} | ConvertTo-Json -Compress; return }
  if (-not (Test-Path -LiteralPath $capturePython)) { throw 'Install the pinned isolated capture dependencies first.' }
  if (Test-Path -LiteralPath $captureStop) { Remove-Item -LiteralPath $captureStop }
  $captureProcess = Start-Process -FilePath $capturePython -ArgumentList @(('"' + $captureWorker + '"'),'--config',('"' + $captureConfig + '"')) -WorkingDirectory $captureRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $capturePrivate 'worker.log') -RedirectStandardError (Join-Path $capturePrivate 'worker-error.log')
  Start-Sleep -Seconds 2
  $captureProcess.Refresh()
  if ($captureProcess.HasExited) { throw 'Local capture worker did not stay running; inspect its private logs.' }
  $captureIdentity = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $captureProcess.Id)
  [ordered]@{pid=$captureProcess.Id;createdAt=$captureIdentity.CreationDate.ToUniversalTime().ToString('o');startedAt=(Get-Date).ToUniversalTime().ToString('o');script=$captureWorker;config=$captureConfig} | ConvertTo-Json | Set-Content -LiteralPath $captureReceipt
  [pscustomobject]@{status='running';pid=$captureProcess.Id;captureStarted=$false} | ConvertTo-Json -Compress
} finally { Pop-Location }
