# Start only the independent Chief Platform project. No resource-preflight bypass.
[CmdletBinding()]
param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$chiefRoot = Split-Path -Parent $PSScriptRoot
$chiefScript = Join-Path $PSScriptRoot 'configure-chief-platform.mjs'
$chiefMode = if ($CheckOnly) { '--preflight' } else { '--start' }
Push-Location -LiteralPath $chiefRoot
try {
  & node $chiefScript $chiefMode
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  if (-not $CheckOnly -and (Test-Path -LiteralPath (Join-Path $chiefRoot '.chief-local/meeting-capture/worker.json'))) {
    & (Join-Path $PSScriptRoot 'start-chief-meeting-capture.ps1')
  }
} finally {
  Pop-Location
}
