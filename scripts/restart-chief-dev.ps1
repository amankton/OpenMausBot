# Developer convenience for the existing local installation. No rebuilds or data resets.
[CmdletBinding()]
param([switch]$CheckOnly, [switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$chiefRoot = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $PSScriptRoot 'chief-restart-policy.psm1') -Force
$chiefMutex = New-Object Threading.Mutex($false, 'Local\ChiefDevRestart')
$chiefLocked = $false
function Test-ChiefDockerReady {
    # Windows PowerShell treats native stderr as an error record, even when
    # redirected. A stopped daemon is an expected result of this probe.
    $chiefPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $chiefDocker info --format '{{.ServerVersion}}' 2>$null | Out-Null
        return $LASTEXITCODE -eq 0
    } finally { $ErrorActionPreference = $chiefPreference }
}
try {
    try { $chiefLocked = $chiefMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $chiefLocked = $true }
    if (-not $chiefLocked) { throw 'A Chief restart is already in progress.' }
    $chiefSaved = Get-Content -LiteralPath (Join-Path $chiefRoot '.chief-local/preview.json') -Raw | ConvertFrom-Json
    & (Join-Path $PSScriptRoot 'start-chief-local.ps1') -CheckOnly | Out-Null
    $chiefTask = Get-ScheduledTask -TaskName 'Chief Local Workspace'
    $chiefStartScripts = @('start-chief-local.ps1', 'start-chief-local.ts') | ForEach-Object { Join-Path $PSScriptRoot $_ }
    if (@($chiefTask.Actions).Count -ne 1 -or @($chiefStartScripts | Where-Object { $chiefTask.Actions[0].Arguments.Contains(('"' + $_ + '"')) }).Count -ne 1) { throw 'The Chief startup task belongs to another checkout.' }
    $chiefDocker = (Get-Command docker -ErrorAction Stop).Source
    if (-not (Test-ChiefDockerReady)) {
        if ($CheckOnly) { throw 'Docker Desktop is not ready.' }
        $chiefDockerDesktop = Join-Path $env:ProgramFiles 'Docker/Docker/Docker Desktop.exe'
        if (-not (Test-Path -LiteralPath $chiefDockerDesktop)) { throw 'Docker Desktop could not be found.' }
        Write-Output 'Starting Docker Desktop...'
        Start-Process -FilePath $chiefDockerDesktop -WindowStyle Hidden
        $chiefDeadline = (Get-Date).AddMinutes(3)
        do {
            Start-Sleep -Seconds 3
            $chiefDockerReady = Test-ChiefDockerReady
        } until ($chiefDockerReady -or (Get-Date) -ge $chiefDeadline)
        if (-not $chiefDockerReady) { throw 'Docker Desktop did not become ready. Try again after Docker finishes starting.' }
    }
    $chiefIds = @()
    foreach ($chiefProject in @('chief-platform','chief-lifecycle-local')) {
        $chiefIds += @(& $chiefDocker ps -a --filter "label=com.docker.compose.project=$chiefProject" --format '{{.ID}}')
        if ($LASTEXITCODE -ne 0) { throw 'Chief container discovery failed.' }
    }
    if ($LASTEXITCODE -ne 0 -or $chiefIds.Count -eq 0) { throw 'Existing Chief containers were not found. No new installation was created.' }
    # Parse privately; never print Docker environment or credentials.
    $chiefRows = @((& $chiefDocker inspect @chiefIds | ConvertFrom-Json) | ForEach-Object {
        [pscustomobject]@{ id=$_.Id; name=$_.Name; project=$_.Config.Labels.'com.docker.compose.project'; service=$_.Config.Labels.'com.docker.compose.service'; directory=$_.Config.Labels.'com.docker.compose.project.working_dir' }
    })
    if ($LASTEXITCODE -ne 0) { throw 'Chief container inspection failed.' }
    $chiefContainers = @(Get-ChiefRestartContainers -Rows $chiefRows -Root $chiefRoot -Pairing:([bool]$chiefSaved.pairingOrigin))
    $chiefBackend = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$chiefSaved.pid)
    $chiefLauncher = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$chiefSaved.launcherPid)
    $chiefOwnBackend = Test-ChiefPreviewProcess $chiefBackend $chiefRoot 'backend'
    $chiefOwnLauncher = Test-ChiefPreviewProcess $chiefLauncher $chiefRoot 'launcher'
    if ($chiefOwnBackend) {
        $chiefState = Invoke-RestMethod -Uri ($chiefSaved.url + '/api/bots?messages=0') -TimeoutSec 10
        if (@($chiefState.bots | Where-Object { $_.busy -or @($_.tasks | Where-Object { $_.busy }).Count -gt 0 }).Count -gt 0) { throw 'An agent is working. Let it finish before restarting Chief.' }
    }
    if ($CheckOnly) { Write-Output "Ready: existing Chief data, startup task, and $($chiefContainers.Count) workspace containers verified."; return }
    Write-Output 'Restarting the existing workspace containers. Saved data and images stay in place...'
    $chiefRestartIds = @($chiefContainers | Where-Object {$_.service -ne 'nginx'} | ForEach-Object {$_.id})
    & $chiefDocker restart --time 20 @chiefRestartIds | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'A workspace container could not restart.' }
    & $chiefDocker restart --time 20 ($chiefContainers | Where-Object {$_.service -eq 'nginx'}).id | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'The workspace proxy could not restart.' }
    if ($chiefSaved.media -eq 'local LiveKit') {
        & (Join-Path $PSScriptRoot 'start-chief-media.ps1')
    }
    Write-Output 'Restarting personal Chief...'
    Stop-ScheduledTask -TaskName 'Chief Local Workspace'
    foreach ($chiefEntry in @(@{process=$chiefBackend;owned=$chiefOwnBackend}, @{process=$chiefLauncher;owned=$chiefOwnLauncher})) {
        if ($chiefEntry.owned) {
            $chiefCurrent = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $chiefEntry.process.ProcessId)
            if ($chiefCurrent -and $chiefCurrent.CreationDate -eq $chiefEntry.process.CreationDate) { Stop-Process -Id $chiefCurrent.ProcessId }
        }
    }
    Start-ScheduledTask -TaskName 'Chief Local Workspace'
    $chiefPhoneTask = Get-ScheduledTask -TaskName 'Chief Mobile Connector (Dev)' -ErrorAction SilentlyContinue
    if ($chiefPhoneTask) {
        $chiefPhoneScript = Join-Path $PSScriptRoot 'start-chief-phone.ps1'
        if (-not $chiefPhoneTask.Actions[0].Arguments.Contains(('"' + $chiefPhoneScript + '"'))) { throw 'The mobile connector task belongs to another checkout.' }
        Start-ScheduledTask -TaskName 'Chief Mobile Connector (Dev)'
    }
    $chiefDeadline = (Get-Date).AddMinutes(3)
    do {
        Start-Sleep -Seconds 3
        $chiefReady = $false
        try {
            $chiefHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:5299/api/health' -TimeoutSec 3
            $chiefWorkspace = Invoke-WebRequest -Uri 'http://localhost:18087/config.json' -UseBasicParsing -TimeoutSec 3
            $chiefPairing = if ($chiefSaved.pairingOrigin) { (Invoke-RestMethod -Uri 'http://localhost:18087/chief/v1/status' -TimeoutSec 3).enabled } else { $true }
            $chiefReady = $chiefHealth.app -eq 'openmausbot' -and $chiefWorkspace.StatusCode -eq 200 -and $chiefPairing
            if ($chiefReady -and $chiefPhoneTask) {
                $chiefMobile = Invoke-RestMethod -Uri 'http://127.0.0.1:18910/api/health' -TimeoutSec 3
                $chiefReady = $chiefMobile.app -eq 'openmausbot'
            }
        } catch { $chiefReady = $false }
    } until ($chiefReady -or (Get-Date) -ge $chiefDeadline)
    if (-not $chiefReady) { throw 'Startup has not passed its health checks. Check .chief-local/startup-*-error.log and Docker Desktop.' }
    Write-Output 'Chief and Workspace are ready: http://127.0.0.1:5299/workspace'
    if (-not $NoOpen) { Start-Process 'http://127.0.0.1:5299/workspace' }
} finally {
    if ($chiefLocked) { $chiefMutex.ReleaseMutex() }
    $chiefMutex.Dispose()
}
