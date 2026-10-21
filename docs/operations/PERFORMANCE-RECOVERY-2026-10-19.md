# Chief, WSL and Hermes recovery — October 19, 2026

Later contention fixes, real browser/model measurements and remaining limitations are in the [performance follow-up](PERFORMANCE-FOLLOWUP-2026-10-19.md). This report preserves the earlier recovery state.

The owner explicitly authorized safe service restarts and approved the Windows administrator prompt. Recovery restored services, but it did not establish that all response latency is resolved.

## Runtime recovery

- Docker Desktop had independently updated from 4.95 to 4.96 at 20:02–20:04 UTC before this recovery. Its WSL engine then failed to respond to bounded control requests. This update was not initiated by this task; its timing does not prove causation.
- Supported Docker stop and WSL shutdown initially timed out. Docker's supported forced desktop stop completed. The owner-approved elevated helper stopped and restarted `WslService` successfully at 20:11:08–20:11:42 UTC. WSL command execution and Docker engine 29.9.1 recovered.
- Restart policies restored the previously running Docker workloads. The original Podman machine and original `openmausbot-computer` container (`9da86897a674`) were restored. No containers, images, volumes, databases or user workspaces were deleted/recreated.
- Restoring all workloads reproduced memory pressure: WSL reached roughly 14 GB and Windows available memory fell to approximately 0.4–0.7 GB. A one-time synchronized Linux page-cache release and compaction provided only temporary relief.
- Created `C:\Users\amank\.wslconfig` (previously absent) with `memory=12GB`, `swap=8GB` and `autoMemoryReclaim=dropCache`. Applied it with supported Docker/Podman stops and a clean WSL shutdown, then restored the same existing workloads. Linux reported 12,245,148 kB total memory and 8,388,608 kB swap afterward. CPU allocation was not changed.
- These settings follow [Microsoft's WSL configuration reference](https://learn.microsoft.com/en-us/windows/wsl/wsl-config). The one-time cache reclamation follows [Microsoft's memory reclamation documentation](https://devblogs.microsoft.com/commandline/memory-reclaim-in-the-windows-subsystem-for-linux-2/). Automatic cache reclamation was already the documented default; the explicit memory ceiling is the material persistent change. Removing the newly created file and restarting WSL restores defaults.

## Chief and phone

- Fresh state showed no active Chief work before shutdown. Exact PID, parent, source path, working directory and SIGINT-handler ownership were verified before asking the existing backend and launcher to shut down gracefully. Both exited; no force kill was used.
- Restarted the existing `Chief Local Workspace` scheduled task. Its Windows PowerShell startup was delayed: the 150-second verification helper expired before the application became ready. The original failure receipt is retained; subsequent independent checks confirmed recovery, rather than treating the task's Running state as health.
- Verified replacement backend 82372 and launcher 61584 at 20:20 UTC, using the same durable data directory and retaining all 194 bots. The backend now loads the earlier timing instrumentation. No live user messages were sent for testing.
- The phone supervisor remained running and followed the changed backend address. Its companion endpoint was temporarily unavailable during startup, then returned on ports 18910/18911. Phone network delivery and remote access were not exercised.

## Hermes

- Changed only the master answer-streaming setting, through the supported atomic configuration writer, with a backup and parsed equality check for all other settings. Per-platform overrides and hidden reasoning remain intact.
- Supported idle drain/restart replaced gateway PID 26380 with 80848 through the existing supervisor. All 21 profiles and six adapters were verified connected, including default/Bacca, Solo and Ailex Telegram. No Telegram messages were sent.
- Local API health measured 36/3/2 ms and control status 22 ms. These are gateway health timings, not assistant reply timings.
- Gateway startup spent about 4 minutes 22 seconds in discovery before adapters began connecting. It sequentially discovers 94 enabled MCP configuration entries across 21 profiles. Default/Solo schema caches had zero TTL, so enabling lazy loading had no demonstrated benefit; no bulk capability or cache-policy changes were made.
- Three comparable no-tool synthetic provider requests after restart completed in 33.533, 23.931 and 7.883 seconds (median 23.931 seconds), versus one transitional pre-restart sample of 6.563 seconds. All returned the expected answer. These small samples around host recovery do not establish a trend or isolate the cause; they do not support claiming model latency improved. The adapter buffers output, so first visible text was not measurable.
- Detailed evidence and backup reference: `C:\Users\amank\AppData\Local\hermes\reports\latency-recovery-20261019.md`.

## Measurement limits and evidence

### Additional software findings and fixes

Provider discovery was independently slow: direct backend health responded while `/api/instances` exceeded 45 seconds. Every request previously ran fresh CLI version/authentication checks across all providers; a Hermes version-check process and its Python child were still alive at 30 seconds. The registry now shares in-flight probes and caches successful discovery for 30 seconds. Unavailable results retry after 5 seconds. Both available and unavailable results can be served for at most 120 seconds while one background refresh runs. Authentication/install/model changes and replacement/disposal invalidate status. Exact instance identity, mutable state and private fields are preserved. First cold discovery still awaits the real provider probe and can remain slow. The unavailable-result behavior matters: an earlier revision allowed failures to expire while a slower sibling probe was still running, repeatedly blocking the whole response. This was corrected and tested before the latest restart.

Verification: 39 unit tests passed (2 platform skips), scoped lint and server TypeScript checks passed for the final registry change. The isolated account API's 5 tests and isolated chat fixture also passed earlier in the same recovery. These checks use fixtures rather than live conversations.

The Vite front door separately timed out on both health and a public static asset while direct backend health returned in 1.6 ms. A dependency reoptimization was active, esbuild showed heavy page faults, and the default HTML entry scan included generated work/build/fixture files. The front door eventually recovered without intervention, supporting a transient optimizer/resource-contention diagnosis rather than proving a precise blocked call stack.

Vite now explicitly discovers dependencies from `index.html`. The isolated optimizer fixture verified React and a lazy route's `react-dom/client` remain discovered while deliberately invalid imports in generated `work`, `.chief-local` and `release` HTML are excluded. Both preview-artifact tests, scoped lint and diff checks passed. The initial restart loading these changes completed in 45 seconds (`personal-chief-final-restart.json`). A subsequent graceful restart loaded the corrected unavailable-result caching at 20:37:05 UTC: backend/launcher 68868/55088, same data directory, with byte-for-byte unchanged config, bots, groups and external-runtime files. Final receipt: `personal-chief-cache-refresh-restart.json`.

### Intermediate Chief measurements at 20:27 UTC

All requests returned HTTP 200. `measurements-before-final-docker-recovery.json` preserves these intermediate samples:

| Read-only endpoint | Samples |
| --- | --- |
| Provider discovery, first observed after restart | 87 ms |
| Provider discovery, warm | 13 / 10 / 10 ms |
| Chief direct backend health | 1 / 1 / 1 ms |
| Chief browser proxy health | 1 / 1 / 1 ms |
| Chief HTML | 33 / 411 / 4 ms |
| Workspace HTML | 7 / 3 / 4 ms |
| Phone companion health | 5 / 2 / 2 ms |
| Hermes API health | 3 / 2 / 2 ms |

The first observed discovery request is not guaranteed to be a cold probe: an existing client may have warmed it. Snapshot caching improves repeated discovery; it does not make the external CLI itself faster. Five subsequent 2-second host samples showed 3,649–3,743 MiB available memory and 4.56–16.37% CPU. Paging remained present. These are short observations, not a long-duration load test or proof that every conversation is fast.

Docker management still required follow-up after these application checks: a direct named-pipe `/_ping` returned HTTP 200 in 12 ms, but `/containers/json` produced no initial bytes within 5 seconds and the CLI list/status diagnostics stalled. Health ping alone was therefore not accepted as full engine health.

### Docker follow-up and final application measurements

A supported Docker Desktop restart timed out while stopping. A supported forced desktop stop followed by start succeeded around 20:30 UTC. Existing containers restored automatically. An explicit inspect of the 40 original container names at 20:36:54 UTC returned all 40 running, no missing containers, no OOM-killed flags, and every configured health check healthy (`final-container-audit.json`). Container-list requests nevertheless continued to queue for minutes before eventually completing. No further broad restarts were attempted.

A diagnostic USR1 stack dump of the verified dockerd process, following [Docker's daemon troubleshooting documentation](https://docs.docker.com/engine/daemon/troubleshoot/), showed list handlers waiting in `daemon/list.go` while workers waited on containerd image-metadata gRPC calls (`refreshImage` / `GetImage` / `Images.Get`). The trace is retained as `docker-goroutine-stacks.log`. This supports a containerd metadata bottleneck; it does not establish a specific version defect or deadlock. A 20:38:57 UTC Linux snapshot attributed most sampled CPU to containerd and dockerd, with load average 16.86. Docker management contention remains unresolved.

The final measurement run at 20:38:16–20:38:38 UTC is in `final-measurements.json`:

| Read-only endpoint | Samples |
| --- | --- |
| Provider discovery, first observed | 212 ms |
| Provider discovery, warm | 24 / 28 / 24 ms |
| Chief direct backend health | 3 / 3 / 2 ms |
| Chief browser proxy health | 3 / 4 / 3 ms |
| Chief HTML | 165 ms, then two 5-second timeouts |
| Workspace HTML | 258 / 40 / 10 ms |
| Phone companion health | 9 / 10 / 4 ms |
| Hermes API health | 5 / 5 / 5 ms |

An immediate subsequent Chief HTML probe recovered to HTTP 200 in 192 ms; its health proxy took 7 ms. The intermittent page stalls are preserved as failures, not declared fixed. Host samples during the final run showed 1,745–2,144 MiB available memory, 72.81–84.79% CPU and substantial paging. The 12 GB WSL ceiling prevents unbounded VM growth but does not remove contention from the restored workload and Docker metadata processing.

An intermediate run at 20:32 UTC recorded 30.447-second first discovery and three 5-second warm timeouts before the unavailable-cache correction; it is preserved in `measurements-before-negative-cache-fix.json`. The earlier authenticated-provider check confirmed Hermes available/authenticated, but other providers included unconfigured or unauthenticated entries. Cached HTTP 200 responses do not imply every provider is configured or healthy. First cold discovery remains an external-CLI limitation; the installed Hermes version path performs a synchronous update check.

Recovery therefore restored service availability and improved repeated provider discovery, but did not establish consistently fast page loads or faster Hermes model replies. Remaining work is to isolate Docker/containerd metadata contention and Hermes discovery/model latency without deleting runtime state or changing model/capability policy speculatively.

`work/performance-20261019/before-measurements.json` is **after the first WSL recovery**, during Docker startup and before Chief restart. It is not an original pre-recovery baseline. `after-measurements.json` captures the second recovery while workloads were still warming: Chief cold health timed out once then reached 5 ms; Workspace returned 248/9/7 ms; provider discovery timed out at 8 seconds repeatedly; the phone companion was temporarily unavailable. Preserve these failures in the record.

Available Windows memory initially rose to about 4.7 GB after the memory ceiling was applied, but subsequent warmup samples were 1.6–2.0 GB with CPU 41–77% and measurable paging. Linux showed substantial I/O waits. Do not present the early low-load sample as sustained recovery or claim the workstation is fully optimized.

Other evidence in `work/performance-20261019`: `wsl-service-restart.json`, `wsl-memory-settings.json`, `personal-chief-restart.json`, `restored-services.json`, `running-before-memory-cap.txt`, and `settled-resource-samples.json`. The first restored-services check found all 40 previously running Docker containers present and no OOM-killed flags; some health checks were still warming.

The earlier frontend changes and isolated test/build evidence remain documented in [the implementation report](PERFORMANCE-IMPLEMENTATION-2026-10-19.md). Live health probes verify service reachability; they are not customer workflow acceptance tests.
