# RAM investigation and authorized cleanup

**Current disposition:** The owner subsequently clarified that Crewframe, Chief and the applications expected to coexist must remain viable together. The shutdown results below are diagnostic observations, not the performance solution. `Crewframe G Ninja` was re-enabled and started at 2026-10-20 10:26:53 UTC; the task reported Running. Its restoration receipt is `work/performance-20261020/ram-gmail-restored.json`. No further application shutdowns are planned as a latency optimization. Claude Desktop, ChatGPT Classic and Podman Desktop were not reopened automatically. Docker, the Podman desktop VM, Chief, Hermes, Chrome and GBrain remained running throughout.

The owner reported using only Codex, Docker and Chief and requested isolation of unexpected memory consumers. During the preceding response baseline, Windows had about 1.6 GiB available, with 2,958 pages input/second and 391 page reads/second. This proves active paging in that observation, but does not attribute every response delay to paging.

## Findings

Process ancestry, executable paths, creation times, scheduled tasks and listening ports were inspected. No command-line credentials were retained. Working-set totals below are sums and can include shared pages; private committed memory is not all resident RAM. Measurements are a snapshot, not a leak diagnosis.

A later native-startup probe exposed a PID-reuse pitfall in ancestry grouping: an older process can retain a parent PID that Windows has since assigned to a different process. Treat the initial family totals as diagnostic estimates, not exact ownership accounting. The corrected native probe rejects children older than their alleged parent. The authorized shutdowns separately checked executable identity and creation time before acting.

| Family | Working set | Private committed | Finding |
| --- | ---: | ---: | --- |
| WSL virtual machine family | 7.27 GiB | 12.06 GiB | Docker plus running Ubuntu and Podman distributions; do not count container memory again on top |
| Codex desktop and descendants | 4.79 GiB | 10.01 GiB | 221 processes in the snapshot, including tool workers and owned helper descendants |
| Chrome | 2.23 GiB | 4.62 GiB | 32 processes, browser started October 16 |
| Hermes gateway and descendants | 1.34 GiB | 3.49 GiB | 107 processes, serving 21 profiles and their tools |
| GBrain service family | 1.23 GiB | 1.54 GiB | Bun/PGLite service on loopback 47831; scheduled `gbrain-service`; retained because legacy clients still connect |
| Gmail Ninja service family | 0.35 GiB | 1.81 GiB | Next development server on loopback 3100; scheduled `Crewframe G Ninja`; not the Chief backend |
| Claude Desktop | 0.61 GiB | 0.99 GiB | Separate desktop application, 10 processes |
| ChatGPT Classic | 0.26 GiB | 0.63 GiB | Separate from the active Codex application |
| Podman Desktop | 0.17 GiB | 0.46 GiB | Separate desktop application; closing it does not stop the Podman VM |

Codex's tool-worker groups include six REA processes (about 1.30 GiB private committed), four Playwright launcher/server pairs, four sequential-thinking pairs and four Simpligen pairs. Hermes has eleven npm launcher/filesystem-server pairs (about 1.53 GiB private committed together). These are connected tooling, not proved orphan fixtures. Blindly terminating Node processes would break required tools. All performance agents confirmed their temporary fixture processes had exited.

Docker reported 40 running containers using approximately 7.92 GiB in aggregate cgroup accounting. The largest were Baserow pilot (1.42 GiB), VoiceStudio (1.29 GiB), Chief CockroachDB (1.11 GiB), Chief Elasticsearch (1.06 GiB) and Redpanda (0.49 GiB). These figures use different accounting from Windows working sets. Baserow and VoiceStudio were not part of the approved shutdown and remain running.

## Authorized actions

The owner explicitly approved: "Yes—close those apps and stop Gmail Ninja" in response to a question naming Claude Desktop, ChatGPT Classic, Podman Desktop and Gmail Ninja, while preserving Codex, Docker, Chief, Chrome and GBrain.

The three desktop apps had no closable main window, so their exact recorded process identities were checked before termination. Their descendants exited. Gmail Ninja's scheduled task was stopped, but its supervisor restarted. To honor the requested stop, `Crewframe G Ninja` was disabled, stopped again, and its newly verified watcher/server descendants terminated. No files, containers or volumes were deleted. The task definition remains available.

To deliberately restore Gmail Ninja:

```powershell
Enable-ScheduledTask -TaskName 'Crewframe G Ninja'
Start-ScheduledTask -TaskName 'Crewframe G Ninja'
```

Free memory initially increased from about 1.9 GiB to 3.7 GiB, then reached **7.37 GiB** at 03:17:40 PDT after the restarted Gmail Ninja family was stopped. This is an observed availability change, not a claim that process-private counters equal reclaimed physical RAM. The three apps were absent, the scheduled task was disabled, and port 3100 had no listener. Evidence: `work/performance-20261020/ram-cleanup-verification.json`. Memory fluctuates with other activity. Chief backend/UI/Workspace/Phone/Hermes remained available, and all 40 original containers remained ready in the post-cleanup audit. The Podman VM has an active desktop/CUA service, so it was not terminated merely because its desktop app closed. Ubuntu contains Tailscale and system services; it was not terminated either.

## Evidence

All paths below are under `work/performance-20261020/`:

- `ram-process-inventory.json`, `ram-family-totals.json`, `ram-node-workers.json`: process ownership and memory snapshots.
- `ram-docker-stats.json`: all 40 container measurements.
- `ram-authorized-stops.json`, `ram-gmail-respawn-stops.json`: exact-process shutdown results.
- `ram-gmail-task-recovery.json`: prior task state and restoration command.
- `ram-cleanup-verification.json`, `ram-post-cleanup-service-audit.json`: cleanup and required-service verification.

The response investigation also corrected an attribution gap: dispatch-to-text included local SDK setup. Current cold Bacca spent 4.750 seconds between agent dispatch and the actual HTTP request, then 1.505 seconds from request to readable text. Solo spent 0.553 seconds locally, then 1.959 seconds on that HTTP-to-text interval. No failed or retried HTTP request was observed. Further startup work and final real cold/warm verification remain separate from this RAM cleanup.
