# Local Chief developer restart

Desktop shortcut: **Restart Chief and Workspace (Dev)**. It runs
`scripts/restart-chief-dev.cmd`, which keeps errors visible and opens
`http://127.0.0.1:5299/workspace` after successful health checks.

The PowerShell routine starts Docker Desktop if needed, verifies the existing
17 workspace containers and configured pairing service belong to this checkout,
restarts those exact containers, restores configured local media, and restarts
the existing **Chief Local Workspace** scheduled task. It checks the Chief API,
workspace configuration endpoint, and pairing status before opening the browser.
It does not rebuild images, recreate containers, delete volumes, reset accounts,
or replace the runtime data directory. The installed desktop application shortcut
remains separate.

Active agents prevent the restart. Old PIDs from a reboot do not authorize
stopping unrelated processes. Repeated clicks are serialized by a local mutex.
The personal backend now has 120 seconds to start; its previous 30-second limit
was exceeded during Windows cold startup after reboot.

Commands:

```powershell
# Read-only readiness and ownership validation:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/restart-chief-dev.ps1 -CheckOnly
# Restart without opening another browser tab:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/restart-chief-dev.ps1 -NoOpen
# Isolated fixture, with synthetic Docker/process/task/HTTP adapters:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/testing/chief-restart.test.ps1
```

The isolated fixture covers restart order, preserved existing container identities,
stale PID reuse, refusal while an agent is active, and refusal for containers from
another checkout. It never controls real Docker services or owner data. Docker
Desktop's own cold launch is environment dependent; the routine waits up to three
minutes and reports failure if Docker remains unavailable.
