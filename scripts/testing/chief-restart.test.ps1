# Isolated Windows fixture: no real processes, tasks, Docker services, or owner data.
$ErrorActionPreference = 'Stop'
$source = Split-Path -Parent $PSScriptRoot
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('chief-restart-test-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path (Join-Path $fixture 'scripts'),(Join-Path $fixture '.chief-local') | Out-Null
try {
    foreach ($file in @('restart-chief-dev.ps1','chief-restart-policy.psm1')) { Copy-Item -LiteralPath (Join-Path $source $file) -Destination (Join-Path $fixture "scripts/$file") }
    'param([switch]$CheckOnly)' | Set-Content (Join-Path $fixture 'scripts/start-chief-local.ps1')
    @{pid=101;launcherPid=102;url='http://127.0.0.1:23456';pairingOrigin='http://localhost:18087'} | ConvertTo-Json | Set-Content (Join-Path $fixture '.chief-local/preview.json')
    $global:chiefTestRoot = $fixture
    $global:chiefTestCalls = [Collections.Generic.List[string]]::new()
    $global:chiefTestBusy = $false
    $global:chiefTestBadOwner = $false
    $global:chiefTestTaskScript = 'start-chief-local.ts'
    $global:chiefTestRows = @()
    $services = @('nginx','cockroach','redpanda','minio','elastic','rekoni','print','transactor','collaborator','account','workspace','front','fulltext','stats','kvs','love','livekit','chief-lifecycle')
    $counter=0
    foreach ($service in $services) {
        $counter++
        $project = if ($service -eq 'chief-lifecycle') {'chief-lifecycle-local'} else {'chief-platform'}
        $directory = if ($service -eq 'chief-lifecycle') {'.chief-local/m1-pairing/deployment'} else {'integrations/platform'}
        $global:chiefTestRows += @{Id=$counter.ToString('x64');Name="/$project-$service-1";Config=@{Labels=@{'com.docker.compose.project'=$project;'com.docker.compose.service'=$service;'com.docker.compose.project.working_dir'=(Join-Path $fixture $directory)}}}
    }
    @'
$global:LASTEXITCODE=0
switch ($args[0]) {
 'info' { 'synthetic'; return }
 'ps' { if ($args -contains 'label=com.docker.compose.project=chief-platform') {'platform'} else {'lifecycle'}; return }
 'inspect' { if ($global:chiefTestBadOwner) { $global:chiefTestRows[0].Config.Labels['com.docker.compose.project.working_dir']='C:\unrelated' }; ConvertTo-Json -InputObject $global:chiefTestRows -Depth 5; return }
 'restart' { $global:chiefTestCalls.Add(('docker ' + ($args -join ' '))); return }
 default { throw 'Unexpected Docker command' }
}
'@ | Set-Content (Join-Path $fixture 'docker.ps1')
    function global:Get-Command { param($Name) if ($Name -ne 'docker') {throw 'Unexpected command lookup'}; @{Source=(Join-Path $global:chiefTestRoot 'docker.ps1')} }
    function global:Get-ScheduledTask { param($TaskName) if ($TaskName -eq 'Chief Mobile Connector (Dev)') {return $null}; if ($TaskName -ne 'Chief Local Workspace') {throw 'Wrong task'}; @{Actions=@(@{Arguments=('--experimental-strip-types "' + (Join-Path $global:chiefTestRoot ('scripts/' + $global:chiefTestTaskScript)) + '"')})} }
    function global:Get-CimInstance {
        param($ClassName,$Filter)
        if ($global:chiefTestBusy -and $Filter -eq 'ProcessId=101') { return @{Name='node.exe';CommandLine=('node "' + (Join-Path $global:chiefTestRoot 'server/index.ts') + '"');ProcessId=101} }
        # A reboot can reuse either recorded PID. These must never be stopped.
        return @{Name='unrelated.exe';CommandLine='unrelated';ProcessId=101}
    }
    function global:Stop-Process { throw 'Attempted to stop an unrelated process' }
    function global:Stop-ScheduledTask { param($TaskName) $global:chiefTestCalls.Add('stop task') }
    function global:Start-ScheduledTask { param($TaskName) $global:chiefTestCalls.Add('start task') }
    function global:Start-Sleep { param($Seconds) }
    function global:Invoke-RestMethod { param($Uri,$TimeoutSec) if ($Uri -like '*/api/bots*') {return @{bots=@(@{busy=$true})}}; @{app='openmausbot';enabled=$true} }
    function global:Invoke-WebRequest { param($Uri,$TimeoutSec,[switch]$UseBasicParsing) @{StatusCode=200} }
    function global:Start-Process { throw 'Unexpected app launch during isolated test' }
    & (Join-Path $fixture 'scripts/restart-chief-dev.ps1') -NoOpen
    if ($global:chiefTestCalls.Count -ne 4 -or $global:chiefTestCalls[2] -ne 'stop task' -or $global:chiefTestCalls[3] -ne 'start task') {throw 'Restart sequence incorrect'}
    $allRestarts = ($global:chiefTestCalls | Where-Object {$_ -like 'docker*'}) -join ' '
    foreach ($row in $global:chiefTestRows) { if (-not $allRestarts.Contains($row.Id)) {throw 'Owned container omitted'} }
    $global:chiefTestCalls.Clear()
    $global:chiefTestTaskScript = 'start-chief-local.ps1'
    & (Join-Path $fixture 'scripts/restart-chief-dev.ps1') -NoOpen
    if ($global:chiefTestCalls.Count -ne 4) {throw 'Legacy task action was not accepted'}
    $global:chiefTestCalls.Clear()
    $global:chiefTestTaskScript = 'other-checkout/start-chief-local.ts'
    $rejected=$false
    try { & (Join-Path $fixture 'scripts/restart-chief-dev.ps1') -NoOpen } catch { $rejected=$_.Exception.Message -like '*another checkout*' }
    if (-not $rejected -or $global:chiefTestCalls.Count -ne 0) {throw 'Other startup script was not refused'}
    $global:chiefTestTaskScript = 'start-chief-local.ts'
    $global:chiefTestBusy=$true
    $rejected=$false
    try { & (Join-Path $fixture 'scripts/restart-chief-dev.ps1') -NoOpen } catch { $rejected=$_.Exception.Message -like '*agent is working*' }
    if (-not $rejected -or $global:chiefTestCalls.Count -ne 0) {throw 'Busy agent did not stop restart before mutations'}
    $global:chiefTestBusy=$false
    $global:chiefTestBadOwner=$true
    $rejected=$false
    try { & (Join-Path $fixture 'scripts/restart-chief-dev.ps1') -NoOpen } catch { $rejected=$_.Exception.Message -like '*ownership*' }
    if (-not $rejected -or $global:chiefTestCalls.Count -ne 0) {throw 'Other checkout did not stop restart before mutations'}
    Write-Output 'PASS: isolated restart sequence, reused PID protection, active-agent refusal, wrong-checkout refusal.'
} finally {
    foreach ($name in @('Get-Command','Get-ScheduledTask','Get-CimInstance','Stop-Process','Stop-ScheduledTask','Start-ScheduledTask','Start-Sleep','Invoke-RestMethod','Invoke-WebRequest','Start-Process')) { Remove-Item -LiteralPath "function:global:$name" -ErrorAction SilentlyContinue }
    $resolved=[IO.Path]::GetFullPath($fixture)
    if ($resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath())) -and (Split-Path $resolved -Leaf) -like 'chief-restart-test-*') { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
