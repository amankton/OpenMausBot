# Chief performance implementation — October 19, 2026

For later production deployment, Docker recovery and actual response measurements, see the [performance follow-up](PERFORMANCE-FOLLOWUP-2026-10-19.md).

Owner authorized proceeding after the performance assessment. Existing unrelated local changes were preserved.

## Delivered

- Chat hydration waits for the transcript, not provider discovery/settings/routines/webhooks. Optional loads have 12-second deadlines, cancellation, retry and generation/version guards. This removes the startup dependency on `/api/instances`, measured at 2.35–5.72 seconds during the assessment; it does not make that endpoint itself faster.
- Personal and group chats display transient assistant answer text. First text paints immediately; later changes coalesce over 80 ms. Preview size is capped at 32,768 characters, bypasses Markdown and global state, excludes reasoning/tool arguments/synthetic output, and clears on final reply, cancellation, retry, disconnect or thread switch. Durable messages remain authoritative.
- Startup displays connection feedback immediately. Personal, pairing and shared-route code loads after the session/trust check selects the correct surface. Unexpected startup/module failures display a retry action. Existing theme and session-recovery work remains intact.
- Backend direct-turn diagnostics emit one content-free timing record for setup, checkpoint, recall, dispatch-to-first-text, runtime and event gaps. Samples are bounded and cleaned up on release. See [timing semantics](../verification/turn-timing.md); runtime time includes tools and initialization and must not be called model inference time.

## Verification

- 181 focused frontend tests passed across store, hydration lifecycle, partial reply state, partial reply rendering and live-event isolation.
- 16 startup/session/shared-workspace/chat-follow regression tests passed.
- 5 backend timing tests passed, including two real isolated fake-engine chats with settled replies and content-free timing records.
- Frontend and server TypeScript checks passed. Scoped lint and diff checks passed.
- The real browser fixture passed: chat visible while instances remained pending, partial text visible during an active turn, partial text absent from persistence, clean completion, exactly one final reply, and zero page errors. Receipt: [chief-performance.json](../verification/evidence/chief-performance.json). Screenshot: [streaming preview](../verification/evidence/chief-performance-streaming.png).
- Isolated production build succeeded at `work/performance-20261019/dist`. Entry JS is approximately 209 kB versus 4.68 MB in the October 16 artifact. This is entry-code splitting, not the total page transfer or a measured live speedup; route-specific chunks still load afterward. Build retains existing CSS `::highlight` warnings and large lazy/shared chunk warnings.
- Read-only HTTP checks of the running Vite server confirmed it serves the new startup entry, detached hydration and partial-reply component. Existing open clients may need a reload. No user messages were sent for verification.

## Runtime boundaries and remaining work

The following paragraphs record the state at completion of the implementation pass. The owner subsequently authorized infrastructure recovery; see [the recovery report](PERFORMANCE-RECOVERY-2026-10-19.md) for completed restarts, the WSL memory limit, enabled Hermes streaming, and remaining measured delays.

The frontend source changes are available from the running development server. The isolated production build was not installed over the live app. Backend timing code is verified but is not loaded by the existing Node server until its next controlled restart. No service restart was performed: the supplied restart routine restarts the wider Workspace container stack as well, and Docker's control requests were timing out during this work.

Host contention remains material: WSL sampled roughly 15 core-equivalents; available Windows memory varied from about 1.3 to 4.3 GB during implementation. Bounded Docker/WSL inspection attempts timed out, including a 40-second Docker process-list request. No workload was conclusively identified as safe to stop, and no user service was killed. The next infrastructure step is a controlled recovery/inspection of Docker and WSL with ownership and active-job checks, not an indiscriminate process cleanup.

Hermes settings remain unchanged. One gateway serves 21 profiles; its master streaming setting is a shared startup snapshot, so changing it would affect profiles beyond default/Bacca and Solo and requires restart. Per-profile preferences cannot enable streaming while the master is disabled. Telegram connectivity failures and the previously observed inter-call gap remain unresolved. Chief's new preview improves display only when its provider emits answer deltas.

The full application test suite, installer packaging, real-provider response benchmarks, and live customer Workspace acceptance were not run. This pass delivers and verifies targeted response/display improvements; it does not claim that all host or Hermes latency has been resolved.
