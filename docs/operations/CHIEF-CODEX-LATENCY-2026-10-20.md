# Chief native Codex latency investigation

This is the initial investigation and rejected reuse experiment. Subsequent implementation, measurements and deployment status are recorded in [Chief startup repairs](CHIEF-STARTUP-FIXES-2026-10-20.md). Statements below about no deployed fix describe this earlier phase.

The owner reported markedly slower Codex replies inside Chief and rejected shutting down applications that must coexist as a performance solution. Native Codex is a separate driver from the Hermes Bacca/Solo profiles; Python SDK changes cannot repair its process lifecycle.

## Observed user turns

Read-only extraction from the most recent native Codex conversation log produced `work/performance-20261020/codex-live-recent-timing.json`. The extractor retains timing, RPC method names, effective reasoning effort and MCP startup status; it does not copy prompts, replies, tool arguments, credentials or conversation history.

All three turns resumed `gpt-6.1-sol` with **High** effective reasoning effort. Chief omitted a turn-level effort override.

| Turn start (UTC) | Before `turn/start` | `thread/resume` alone | First text from initialization | Completion from initialization |
| --- | ---: | ---: | ---: | ---: |
| 10:13:12.483 | 6.582 s | 5.893 s | 11.771 s | 12.142 s |
| 10:13:56.437 | 4.303 s | 3.816 s | 8.597 s | 8.810 s |
| 10:14:34.503 | 8.456 s | 7.213 s | 12.495 s | 13.113 s |

These intervals begin at the first logged initialization request, not the browser click. They exclude any earlier Chief admission/recall/queue delay and the final rendering delay. `turn/start` acceptance is not an HTTP wire timestamp and its remaining interval includes native tool startup and model work.

Each turn had 34–36 MCP `starting` notifications, including repeats, with 11–19 `failed` notifications. These counts are events, not unique services. Examples: Supabase/Vercel reported missing login; OpenSEO reported HTTP 404; Docker MCP and NAS reported handshake failure. Those integrations have not been disabled. The failures are not yet proven to account for the entire resume interval.

## Confirmed implementation behavior

`server/drivers/codex.ts` launches a fresh `codex app-server` inside every turn attempt. It initializes the protocol, reads effective configuration, resumes or creates the native thread, synchronizes instructions and submits the turn. On completion it terminates the process. Chief therefore repeats cold process and connection setup for follow-up messages.

The running Codex desktop instead has a persistent app-server process. Chief currently resolves its default CLI through the globally installed npm Codex package; the desktop uses its bundled executable. A fair integration comparison must use the same executable, model, reasoning effort and prompt. Desktop application timing is not established merely by measuring a direct app-server control.

The investigated fix was bounded reuse of a matching idle Codex process while retaining configuration, instruction and permission checks. Reuse must preserve process-lifetime RPC IDs and framing, isolate threads and turn notifications, invalidate changed credentials/configuration/tool scopes, and retire stopped/failed/disposed processes. It must not extend turn capability authorization. The existing Chief agents integration already has a stable session bearer with authorization revoked between turns.

**Release decision: do not deploy the experimental pool.** The installed 0.160.1 protocol permits MCP elicitation requests with a null native turn ID. Chief currently auto-approves some permission forms under Full access. After reuse, a delayed permission request cannot always be attributed to the completed versus current turn. Automatically accepting it would weaken approval isolation; rejecting it could break existing tool behavior. Helper lineage can identify some delegated requests, but does not solve nullable MCP ownership. The speed request does not authorize either behavior change.

A production implementation needs an explicit connection-scoped permission contract for uncorrelated elicitation, plus current-turn helper lineage and lifecycle tests. It must also retain ownership of processes whose retirement fails, avoid stdin errors crashing the backend, and invalidate relevant credential/configuration/instruction changes. The experimental patch is evidence for further work, not a production repair.

The candidate was archived and rolled back. `server/drivers/codex.ts` is byte-identical to its pre-investigation snapshot (SHA-256 `fbdb4707073c53c2c18844526a198a2564ac65b726809ad1719474baf182bbc1`), retaining earlier user changes. The candidate test/fake changes were restored and the new pool implementation/test files removed. Evidence and the explicitly non-deployable patch are under `work/performance-20261020/codex-process-reuse-rejected/`, `codex-process-reuse-NOT-FOR-DEPLOYMENT.patch`, and `codex-process-reuse-rollback.json`. No Chief restart was needed for these reverted changes.

## Verification status

The matched isolated baseline and persistent-process control completed six real replies using the same Chief CLI executable, GPT-6.1 Sol, High reasoning and priority tier. Both replayed the same synthetic Chief instructions and outgoing inputs; the direct control also performed `config/read` and `thread/resume` on follow-ups.

| Path | First cold reply text | Follow-up reply text | Follow-up setup before `turn/start` |
| --- | ---: | ---: | ---: |
| Existing Chief, fresh process each turn (browser-visible) | 5.436 s | 4.110 / 4.207 s | 0.964 / 1.017 s |
| Persistent native control (protocol text) | 5.117 s | 1.859 / 2.102 s | 0.022 / 0.017 s |

This clean-home fixture excludes the user's native MCP connections and historical conversation. Review found that the direct control selected the first captured launch (catalog lookup), so the complete turn-specific browser/computer feature flags were not guaranteed identical. This is a diagnostic comparison, not a controlled estimate of the entire response-time gain. The future harness must select the launch PID that actually received `thread/start`. It is also not a desktop UI benchmark or a statistically reliable percentile. Browser-visible and protocol text are separately labeled. Evidence: `work/performance-20261020/codex-native-baseline-v5.json`. Earlier fixture attempts failed local preflight checks before submitting any model request; their cleanup/evidence were retained.

A separate synthetic MCP test with no credentials or inference observed one initialization on cold start, **zero** new initializations on two same-process resumes, and another initialization after a new process. Same-process resumes took 10 ms and 4 ms versus 717 ms after process restart. Both owned process trees exited. Evidence: `work/performance-20261020/codex-mcp-reuse-probe.json`.

The full native configuration was then exercised without any model turn or tool invocation, using an isolated copy of configuration/authentication and synthetic history. The corrected follow-up observed all 23 enabled configured servers. The first terminal-status round took **10.197 seconds** (14 ready, 10 failed) on cold start and **9.212 seconds** (15 ready, 10 failed) after a new process. Dynamic services account for totals exceeding the configured count. Same-process resume RPCs took 7 ms each, but later plugin discovery retried failed servers; five Ruflo entries were still starting when the first process stopped. These are first-round status times, not permanently settled readiness times, and they do not prove zero warm connection work.

The probe's timestamp-validated process families used **2,050–2,285 MiB of summed resident working sets** and **1,813–2,001 MiB of private committed memory**. Shared working-set pages may be counted more than once. Host available memory was 6,257 MiB before, 4,173–4,561 MiB during, and 5,788 MiB afterward; other activity prevents exact causal attribution. Both owned trees and sampled descendants exited, and the private temporary copy was removed. The earlier probe's process-family memory sample was invalid because PID reuse included an older unrelated process; do not use that sample. Corrected evidence: `work/performance-20261020/codex-full-native-followup.json`.

This full-configuration probe preserves normal home resolution but does not reproduce Chief-injected mounts, the user's conversation, or every plugin-cache dependency. The isolated home did not copy the plugin cache or OAuth store, so its ten failures are not evidence that those same connections fail in the live session. Live failures described above come separately from actual user-turn logs. No production MCP connection was disabled to obtain faster timings.

The resolved Chief binary reports 0.160.1; the installed desktop binary reports 0.163.0-alpha.10.2. Both arms above deliberately used the Chief binary, so version differences do not explain their measured difference. No native Codex production fix is verified or deployed yet.

The secondary Hermes ACP readiness-order change was tested but showed no measured speedup; it was rolled back. A Python SDK bypass was not integrated. Earlier verified quiet-announcement and official metadata transport fixes remain intact.

Gmail Ninja's scheduled service was restored for coexistence testing. Application shutdown is not the accepted optimization.

## Final Hermes browser measurements

The separate Bacca/Solo verification completed 18 actual replies through the Chief renderer in isolated fixtures: three fresh ACP processes per profile, each followed by two warm messages. The existing GPT-6.1 Sol/low settings, 19 advertised tools and recall were retained. Tool execution and durable writes were blocked by the fixture. These measurements do not include canonical `hermes.exe` packaging overhead.

| Profile | Cold first visible text, three runs | Warm first visible text, six-run range |
| --- | ---: | ---: |
| Bacca | 23.221 / 16.377 / 15.740 s | 1.708–5.353 s |
| Solo | 17.143 / 14.882 / 15.102 s | 1.716–2.447 s |

Across the six cold turns, actual HTTP request to readable provider text took 1.406–1.882 seconds. Local imports, agent construction and prompt preparation dominated the cold delay. These results identify remaining work; they are not evidence of a newly shipped speed improvement or a guaranteed latency target. No new Hermes change survived this investigation. All six owned fixture homes were removed and recorded Python processes exited. Full timing, transport and cleanup evidence is in `work/performance-20261020/provider-cold-response-report.md` and its referenced JSON files.

Each of the 18 replies made exactly one physical provider request, returned HTTP 200, and had no observed provider retry/error event or browser page error. Readable provider text appeared in the browser 53–69 ms later. Rendering therefore did not account for the multi-second delay in these Hermes fixtures. Available host memory was 6,212 MiB before the final series and 5,788 MiB after cleanup; these are observations with other services running, not a controlled memory-leak test.

Chief's existing production UI and backend remained reachable after verification, and Gmail Ninja remained running. No production restart was performed for the withdrawn experiments. Desktop UI response timing has not been measured, so the same root cause has not been established for the desktop complaint.
