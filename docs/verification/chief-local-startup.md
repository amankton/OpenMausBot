# Local Chief automatic startup

October 10, 2026: the owner requested server recovery after restarting for
updates. The personal browser server on port 5299 was stopped; all 18 deployed
workspace/pairing Docker containers were already running. Docker Desktop has
automatic startup enabled, and the checked frontend, Accounts, nginx and
lifecycle containers use `unless-stopped` restart policies.

Registered the owner-level Windows task **Chief Local Workspace** at user sign-in.
It runs `scripts/start-chief-local.ps1` with a hidden window and no stored password.
The task allows battery operation, has no execution time limit, ignores duplicate
instances, and retries a failed launch up to three times at one-minute intervals.
The wrapper refuses missing saved data, uses the existing preview manifest,
preserves media/pairing options and provider home, and exits successfully when
the existing server is healthy. An unhealthy occupied port is not killed.

Recovery evidence: `.chief-local/restart-verification.json`. The restored
5299 health, workspace and personal pairing endpoints pass; the deployed
workspace pairing service returns 200. All 190 agents remain: 174 imported
GPT-6.1-Sol agents, seven Design agents on Opus 5.5, and nine original agents.
`bots.json`, `config.json` and private pairing state match the pre-start snapshot
byte for byte. Recovery snapshot:
`.chief-local/recovery/2026-10-10T20-12-43-512Z` (SQLite quick_check passed).

The task was launched through Task Scheduler and rerun against the healthy
server to check duplicate prevention. No Windows reboot was performed. This is
sign-in startup for the existing local browser runtime; it does not make the
workspace a cloud service or replace the separate desktop installer. The local
runtime directory has not been moved. No Docker containers or storage mounts
were replaced. The first task launcher remained alive while Vite completed
startup; a concurrent attempt was rejected by the data-directory lease.

Manage startup with Windows Task Scheduler using the exact task name above.
Startup stdout/stderr and supervisor logs are under `.chief-local/startup-*`.
