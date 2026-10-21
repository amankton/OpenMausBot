# Resume the existing local Chief workspace. Never seed or replace runtime data.
[CmdletBinding()]
param([switch]$CheckOnly, [switch]$Development)
$ErrorActionPreference = 'Stop'
$chiefRoot = Split-Path -Parent $PSScriptRoot
$chiefPrivate = Join-Path $chiefRoot '.chief-local'
$chiefManifest = Join-Path $chiefPrivate 'preview.json'
$chiefNode = (Get-Command node -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath $chiefManifest)) { throw 'Existing Chief preview manifest is required.' }
$chiefSaved = Get-Content -LiteralPath $chiefManifest -Raw | ConvertFrom-Json
foreach ($chiefRequired in @('config.json', 'bots.json')) {
  if (-not (Test-Path -LiteralPath (Join-Path $chiefSaved.dataDir $chiefRequired))) {
    throw "Saved Chief data is not visible to this Windows process: $($chiefSaved.dataDir)\$chiefRequired. Check the saved path and Windows app-storage redirection before restoring any data."
  }
}
if ($chiefSaved.previewUrl -ne 'http://127.0.0.1:5299') { throw 'Unexpected Chief preview address.' }
if (-not $Development) {
  & $chiefNode --experimental-strip-types (Join-Path $PSScriptRoot 'build-chief-ui.ts') --check | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Build the current Chief UI before starting this workspace.' }
}
if ($CheckOnly) {
  [pscustomobject]@{ status='ready'; url=$chiefSaved.previewUrl; dataDir=$chiefSaved.dataDir } | ConvertTo-Json -Compress
  return
}
$chiefSupervisorLog = Join-Path $chiefPrivate 'startup-supervisor.log'
Add-Content -LiteralPath $chiefSupervisorLog -Value ((Get-Date -Format o) + ' Checking saved workspace health.')
# Keep the bounded loopback probe outside native-shell argument quoting.
& $chiefNode (Join-Path $PSScriptRoot 'chief-local-health.mjs')
$chiefHealthy = $LASTEXITCODE -eq 0
if ($chiefHealthy) {
  Add-Content -LiteralPath $chiefSupervisorLog -Value ((Get-Date -Format o) + ' Existing Chief is healthy; no duplicate started.')
  Write-Output 'Chief is already running.'
  exit 0
}
if (Get-NetTCPConnection -State Listen -LocalPort 5299 -ErrorAction SilentlyContinue) {
  throw 'Port 5299 is occupied but Chief is not healthy. No existing process was stopped.'
}
$chiefStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Add-Content -LiteralPath $chiefSupervisorLog -Value ((Get-Date -Format o) + ' Starting saved workspace.')
$chiefArguments = @('--experimental-strip-types', ('"' + (Join-Path $PSScriptRoot 'chief-preview.ts') + '"'))
if ($Development) { $chiefArguments += '--dev' }
if ($chiefSaved.media -eq 'local LiveKit') { $chiefArguments += '--with-local-media' }
if ($chiefSaved.pairingOrigin) { $chiefArguments += '--with-chief-pairing' }
$chiefProcess = Start-Process -FilePath $chiefNode -ArgumentList $chiefArguments -WorkingDirectory $chiefRoot -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput (Join-Path $chiefPrivate "startup-$chiefStamp.log") -RedirectStandardError (Join-Path $chiefPrivate "startup-$chiefStamp-error.log")
exit $chiefProcess.ExitCode
