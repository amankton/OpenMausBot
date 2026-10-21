function Get-ChiefRestartContainers {
    param([object[]]$Rows, [string]$Root, [switch]$Pairing)
    $services = @('nginx','cockroach','redpanda','minio','elastic','rekoni','print','transactor','collaborator','account','workspace','front','fulltext','stats','kvs','love','livekit')
    $result = @()
    foreach ($service in $services) {
        $found = @($Rows | Where-Object { $_.project -eq 'chief-platform' -and $_.service -eq $service })
        if ($found.Count -ne 1) { throw "Expected one existing Chief workspace container for $service. No containers were changed." }
        $row = $found[0]
        $expected = Join-Path $Root 'integrations/platform'
        if ($row.id -notmatch '^[a-f0-9]{64}$' -or $row.name -ne "/chief-platform-$service-1" -or [IO.Path]::GetFullPath($row.directory) -ne [IO.Path]::GetFullPath($expected)) { throw 'Workspace container ownership did not match this checkout.' }
        $result += $row
    }
    if ($Pairing) {
        $found = @($Rows | Where-Object { $_.project -eq 'chief-lifecycle-local' -and $_.service -eq 'chief-lifecycle' })
        if ($found.Count -ne 1) { throw 'Existing Chief pairing container is missing.' }
        $row = $found[0]
        $expected = Join-Path $Root '.chief-local/m1-pairing/deployment'
        if ($row.id -notmatch '^[a-f0-9]{64}$' -or $row.name -ne '/chief-lifecycle-local-chief-lifecycle-1' -or [IO.Path]::GetFullPath($row.directory) -ne [IO.Path]::GetFullPath($expected)) { throw 'Pairing container ownership did not match this checkout.' }
        $result += $row
    }
    return $result
}

function Test-ChiefPreviewProcess {
    param($Process, [string]$Root, [ValidateSet('backend','launcher')][string]$Kind)
    if (-not $Process -or $Process.Name -ne 'node.exe') { return $false }
    $file = if ($Kind -eq 'backend') { 'server/index.ts' } else { 'scripts/chief-preview.ts' }
    $path = (Join-Path $Root $file).Replace('\','/')
    return $Process.CommandLine.Replace('\','/').Contains(('"' + $path + '"'))
}
Export-ModuleMember -Function Get-ChiefRestartContainers,Test-ChiefPreviewProcess
