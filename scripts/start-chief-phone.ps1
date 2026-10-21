# Dedicated phone connector for the saved Chief development workspace.
$ErrorActionPreference='Stop'
$chiefRoot=Split-Path -Parent $PSScriptRoot
$chiefPrivate=Join-Path $chiefRoot '.chief-local/phone'
New-Item -ItemType Directory -Path $chiefPrivate -Force | Out-Null
$chiefNode=(Get-Command node -ErrorAction Stop).Source
# This separate service follows Chief's current backend port automatically.
$chiefArguments=@('--experimental-strip-types',('"' + (Join-Path $PSScriptRoot 'chief-phone.ts') + '"'))
$chiefProcess=Start-Process -FilePath $chiefNode -ArgumentList $chiefArguments -WorkingDirectory $chiefRoot -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput (Join-Path $chiefPrivate 'supervisor.log') -RedirectStandardError (Join-Path $chiefPrivate 'supervisor-error.log')
exit $chiefProcess.ExitCode
