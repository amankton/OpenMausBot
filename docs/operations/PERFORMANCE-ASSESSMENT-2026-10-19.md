# Chief and Hermes performance assessment

Assessed October 19, 2026, approximately 12:45–13:05 America/Los_Angeles. Source checkout HEAD `dfa7e50` with substantial existing local edits. Read-only service requests, host counters, existing logs, and source inspection; no application code/config changes, provider test requests, service restarts, or production load tests. This report is the only deliverable added by the assessment.

## Conclusion

The evidence supports several independent contributors: severe host resource contention, a measured multi-second provider-discovery request that blocks Chief chat hydration, hidden streaming text, and Hermes time spent outside model calls. Codebase size alone is not a diagnosis. Stabilize the host and fix the proven UI gate before attempting broad refactors or changing models.

## Live observations

| Observation | Evidence | Interpretation and limits |
| --- | --- | --- |
| Initial Windows available RAM approximately 266 MiB of 31.2 GiB | Win32_OperatingSystem | Very little memory headroom at inspection start. |
| Six samples over roughly 10 seconds: CPU 91.9–99.5%, available RAM 549–1,871 MiB, pages input 5,820–23,276/sec | Windows performance counters, 12:49:53–12:50:03 | Severe contention and hard-page-in activity. Counters include mapped files, not only pagefile reads. Later RAM recovered to 3,246 MiB and CPU sampled 81%; this is variable, not a sustained all-day baseline. |
| WSL 6.7 GiB, 76 Node processes totaling approximately 6.0 GiB, 44 Chrome processes totaling 3.3 GiB | Windows process working-set snapshot | Working sets include shared memory; do not sum as unique RAM. Many processes belong to other apps or this assessment. Do not label them orphaned without checking owners. |
| WSL sampled at 1,414% process CPU | Windows process performance counters | Approximately 14 core-equivalents. Docker containers were running alongside a separate Podman VM. No individual Linux workload was conclusively attributed. Bounded WSL/Docker inventory probes timed out at 12 seconds; one Docker stats request eventually returned. |
| Chief health 169 ms initially, then 7 and 4 ms | Three GET /api/health requests | Warm lightweight server route is responsive. Does not measure chat dispatch or rendering. |
| GET /api/instances 5,715 ms, then 2,349 ms | Two sequential read-only probes | This endpoint is part of the UI hydration gate below. |
| GET /api/bots?messages=200 159 ms, then 70 ms; 2,239,901 bytes | Two probes, 194 bots and 281 returned messages | Snapshot is substantial, but HTTP completion was much faster than discovery. Browser parse/render timing was not measured. |
| Config 33 ms, routines 7 ms, webhooks 25 ms, shared-workspace discovery 48 ms | One request each | No observed multi-second delay on these probes. |
| Chief root includes /@vite/client | GET /, 1,209 bytes | The measured personal UI is using the development server. Existing dist sizes below are not its measured network transfer. |
| Workspace URL returned as http://localhost:18087/; Python GET 2,057–2,059 ms; direct IPv4 29 and 5 ms | Four loopback GETs | Investigate hostname/address-family fallback. This client-specific difference is not proof of browser delay. Preserve origin/cookie/WebSocket contracts when testing any fix. |

## Confirmed Chief code findings

1. **Unrelated provider discovery blocks chat startup and reconnect.** `src/state/store.tsx:2721` awaits all chat/config/instances/routines/webhook requests before `:3790–3794` marks hydration complete and releases buffered live events. The optional calls lack an application deadline (`:2534–2545`). `/api/instances` resets PATH discovery and awaits `describeInstances()` (`server/index.ts:23343`). With the observed requests, discovery can impose seconds of startup wait. An isolated reproduction of the compiled hydration function remained pending after chat resolved until a held optional request settled. Existing tests cover optional rejection, not a request that never settles.

2. **Personal chat deliberately ignores partial answer text.** `src/state/store.tsx:2733–2740` and `:3926` filter runtime events; replies appear when finished. This increases first-visible-answer time even if the backend streams promptly. Add transient, throttled streaming display while preserving final message identity, ordering, cancellation and persistence semantics.

3. **Startup and navigation do more work than necessary.** `src/main.tsx:3` eagerly imports App, which imports many feature surfaces. `:43,72–73` delays the first root render for session/brand reads. Full-document links between personal and Workspace repeat bootstrap (`src/components/SidebarFooterNav.tsx:73`; `SharedWorkspacePage.tsx:111`). Workspace also boots its separate iframe. Route splitting and earlier shell rendering are plausible improvements; quantify browser traces before broader restructuring.

4. **Existing production artifact is large and differs from source.** October 16 main JS is 4,683,766 bytes; theoretical gzip 1,317,545 bytes; CSS 214,710 bytes. All JS totals 19,957,091 bytes across 372 files, many lazy—not all startup transfer. Ten locale source files total 1,562,228 bytes. That built bundle lacks the 12-second session deadline present in current source. The live measured UI serves Vite, so do not misattribute stale-dist behavior to it. Shiki/Mermaid already load lazily; message render/window protections also exist.

## Hermes evidence

Default/Bacca's October 19 `C:/Users/amank/AppData/Local/hermes/logs/agent.log` contains 42 completed API calls: median 2.25 seconds, observed p95 4.8 seconds, maximum 13.7 seconds. These are completed API-call durations, not user-response or first-token timings; failed/hanging calls are not represented.

One eight-call sequence ended at 12:41:53 with 19.8 seconds of aggregate API time across an estimated 126.4-second span. Approximately 106 seconds elapsed between calls 6 and 7 outside their measured API durations. Tool/dependency/queue tracing is needed; logs do not prove the cause or that this was an interactive user request. References: `logs/agent.log:9953,9973,9987,9991`; metric definition `hermes-agent/agent/turn_usage.py:212`.

Default gateway streaming is explicitly disabled (`config.yaml:699`; master-switch logic `hermes-agent/gateway/config.py:505`). This affects gateway delivery separately from Chief's renderer. Current default configuration is gpt-6.1-sol, medium reasoning, priority; Solo is gpt-6-astra, low reasoning, priority. Today's default inputs were 22,760–35,581 tokens, with recent calls 96–99% cached. Tool search already defers schemas; indiscriminate tool removal is not justified.

Both profiles logged Telegram connectivity failures today. Default examples: `logs/errors.log:12462,12464,12470`; Solo: `profiles/solo/logs/errors.log:4933,4935,4938`. Solo's latest completed-call sample is October 15 (128 calls, median 3 seconds, p95 6 seconds, maximum 33.5 seconds), so a current Solo model baseline remains missing. An assessment memory recall took 20.3 seconds and returned a partial timeout; this is dependency evidence, not attribution to a Hermes turn.

## Backend candidates requiring timings

- Hermes adapter creation awaits catalog discovery (`server/drivers/acp/core.ts:694`; `hermes.ts:299,381`). Historical October 7 Windows cold CLI measurement was 12.2 seconds; it is not today's chat timing. Warm reuse exists. MCP changes deliberately restart sessions to avoid stale credentials; unchanged ordinary grants retain stable bearers. Preserve this security boundary.
- Checkpoint snapshots run before dispatch (`server/index.ts:10262–10275`), serialize by workspace and invoke Git staging with per-command timeouts up to 120 seconds (`server/checkpoints.ts:135,475,590`). Measure queue/stage duration before changing recovery semantics.
- Native and canonical protocol logs append synchronously before delivery (`server/drivers/native.ts:12–26`; `server/harness/bus.ts:96–133`). Canonical deltas already batch for 50 ms. Measure event-loop stalls and use bounded ordered I/O only if justified.
- Automatic recall synchronously refreshes memory metadata/index before dispatch (`server/index.ts:10410`; `server/recall.ts:147`; `server/workspace.ts:265`). Measure file counts, bytes and timing without logging private content.

## Prioritized tuning plan and acceptance evidence

1. **Host capacity:** identify the exact busy Linux workload and process owners; separate optional development/background services from the interactive stack. Re-measure CPU, available RAM and paging under normal use. Do not stop unknown services or simply shrink VM memory under an active workload.
2. **Chief hydration:** release chat after its own consistent snapshot; load optional settings independently, bounded by deadlines. Isolated regression: an indefinitely pending instances request cannot block chat hydration/live-event delivery. Preserve reconnect ordering and account isolation.
3. **Visible replies:** add throttled streaming in Chief; separately validate gateway streaming on supported transports. Measure request-to-first-visible-text and final completion independently. Do not equate token display with faster task completion.
4. **Dispatch trace:** capture request accepted → checkpoint/recall ready → driver ready → provider start/first text → tool waits → SSE → visible text. Record warm/cold reasons and timings, not secrets or message bodies. Diagnose the unaccounted Hermes intervals and Telegram transport failures.
5. **Delivery footprint:** benchmark the production build against Vite; split routes and unused locale/dialog loading. Check browser hostname behavior before changing Workspace origin. Keep feature/security behavior intact.

Suggested initial gates, to validate on representative workloads: optional endpoints never block chat; warm local metadata p95 under 200 ms; received stream text rendered within 100 ms; startup has immediate useful feedback. Model/task completion requires separate per-workload budgets. Existing source tests and static reproductions do not prove user-perceived improvement. No tuning or deployed speedup is claimed by this assessment.
