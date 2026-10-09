$ErrorActionPreference = 'Stop'
$chiefRoot = Split-Path $PSScriptRoot -Parent
$image = 'livekit/livekit-server@sha256:d0c04791bf63ca8dcea123571827d56ba9504bd57c8d5de60ee03b5408cc3154'
Push-Location $chiefRoot
try {
  & node scripts/configure-chief-media.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Chief media configuration failed.' }
  $existing = & docker ps -a --filter 'name=^/chief-office-media$' --format '{{.ID}}'
  if ($existing) {
    $info = (& docker inspect chief-office-media | ConvertFrom-Json)[0]
    if ($info.Config.Labels.'chief.preview' -ne 'office' -or $info.Config.Image -ne $image) { throw 'Container name belongs to another installation.' }
    foreach ($binding in $info.HostConfig.PortBindings.PSObject.Properties.Value) {
      foreach ($entry in $binding) { if ($entry.HostIp -ne '127.0.0.1') { throw 'Existing media port is not loopback-only.' } }
    }
    if (-not $info.State.Running) { & docker start chief-office-media | Out-Null }
  } else {
    if (Get-NetTCPConnection -State Listen -LocalPort 18920,18921 -ErrorAction SilentlyContinue) { throw 'Chief media TCP ports are occupied.' }
    if (Get-NetUDPEndpoint -LocalPort 18922 -ErrorAction SilentlyContinue) { throw 'Chief media UDP port is occupied.' }
    $config = Join-Path $chiefRoot '.chief-local/livekit.yaml'
    & docker run -d --name chief-office-media --label chief.preview=office --restart=no -p 127.0.0.1:18920:18920 -p 127.0.0.1:18921:18921 -p 127.0.0.1:18922:18922/udp --mount "type=bind,source=$config,target=/etc/livekit.yaml,readonly" $image --config /etc/livekit.yaml | Out-Null
  }
  if ($LASTEXITCODE -ne 0) { throw 'Chief media did not start.' }
  Write-Output 'Chief local media: ws://127.0.0.1:18920 (this machine only).'
} finally { Pop-Location }
