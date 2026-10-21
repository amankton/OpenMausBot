# Hermes cold-start optimization — October 19, 2026

Follow-up to [contention recovery and actual response verification](PERFORMANCE-FOLLOWUP-2026-10-19.md). The owner authorized the next step. This pass targets unnecessary cold-start work while retaining configured models, reasoning, memory recall, tools, credential/profile boundaries and dependency validation.

## Baseline and acceptance

The prior corrected real browser → Chief → Hermes test measured 22.069 seconds from Send to first painted text for a fresh process, then 1.954 / 2.409 seconds pooled. Separate configured-profile tests showed provider latency tails up to 7.150 seconds even in warmed sessions. Cold application setup and provider wait must remain separate measurements.

At 23:02:15 UTC, a fresh read-only service audit confirmed all 40 original Docker containers running, no missing originals, no unhealthy configured checks and no OOM flags. Docker listing took 303 ms. Chief, Workspace, Phone and Hermes endpoints responded, and Hermes discovery was authenticated/available. Fresh all-provider discovery still took 8.707 seconds. Evidence: `work/performance-20261019/next-step-service-baseline.json`.

Acceptance requires focused correctness/negative-path tests, unchanged validation and permission boundaries, isolated actual browser verification after source changes, cleanup of owned fixtures, and explicit reporting of remaining cold/provider tails. No synthetic prompts go to live conversations. No model substitution, persistent credential cache, skipped dependency guard or guessed filesystem access root is authorized by this implementation choice.

## Decisions

- **Do not add speculative chat prewarming in this pass.** A selected-chat process/initialize hook could shift approximately 6–10 seconds before Send, but not remove that work. Native `session/new` can persist a session and requires turn-scoped integration authority; it cannot safely be precreated with a fake turn. Process-only preparation would add lifecycle/endpoint/frontend code, and a complete existing Hermes startup credential/config revision fingerprint does not exist. Watching a few files would miss borrowed auth/provider state and external secrets. The analysis is retained in `work/performance-20261019/chief-active-chat-preparation-analysis.md`.
- **Consolidate duplicate managed-runtime validation only if its semantics are preserved.** The proposed read-only `venv_is_current` path will validate the same runtime dependencies inside its already-required isolated worker, preserve the 30-second validation bound and typed failure handling, and leave mutation/repair operations unchanged. Full plugin, lock, selected environment and machine-facts checks stay intact. Before/after timings and corruption/timeout tests are required.
- **Profile remaining ACP session/model-inventory work before changing it.** The prior scoped dotenv fix removed repeated file reads but left mutable pool loads live. Any further change must preserve fresh secret resolution, mutations and profile isolation.
- **Remove discovery that explicit-only ACP inventory already discards.** The post-dotenv profile attributes 2.847 seconds to one `gh auth token` probe within 3.723 seconds of provider listing. ACP requests explicit-only inventory, but ambient Copilot discovery runs before the result is filtered out. Moving that same eligibility decision ahead of discovery can remove actual work while retaining current/explicit Copilot and ordinary discovery. This narrow candidate is being checked against config/auth/env/manual-pool and named-endpoint edge cases. Repeated auth-store reads total only 0.253 seconds, so broad pool caching would miss the dominant cost.
- **Retain existing stream delivery guards.** The first gateway flush already becomes eligible immediately because its last-edit timestamp starts at zero; native streams also push immediately. The small-message and partial-silence guards prevent leaked silence markers or stuck fragment messages. Lowering the normal edit interval would not remove the measured multi-second provider wait.

## Implemented and checked

The installed Hermes read-only currency probe now validates runtime dependencies inside its required worker rather than launching a second interpreter. Dependency imports, generation/input checks and full environment currency checks remain mandatory. Mutation/repair operations retain their existing validation. The initial handshake has a 30-second deadline and kills only its owned worker on timeout. An inherited stdout pipe cannot block the caller's cleanup; a pathological descendant may retain one daemon reader until it closes that pipe. Focused tests cover missing dependencies, damaged selection, repair boundaries, protocol errors, real child termination, inherited pipes and reader cleanup. There are 48 unique passing PM cases; platform-specific coverage is identified in the PM handoff. Final review additionally moved application-path insertion after runtime validation to preserve isolated dependency resolution. All 26 validation cases were rerun after this correction, including an actual isolated worker with a shadowing source module.

Explicit-only inventory now applies its existing Copilot eligibility rule before ambient credential discovery. Current/explicit accounts and ordinary discovery remain intact; named-provider slug/endpoint collisions preserve the original discovery path. No credential cache was added. A real no-model ACP comparison returned the identical complete 151-model state SHA-256 (`2015def4e2313920fa8979920020b33f4ae6d37a7426d44743079006f47fdebe`), with the GitHub CLI token probe reduced from one call to zero. That probe cost 300 ms in this comparison versus 2.847 seconds in the earlier profile. The overall session timing difference is not solely attributable to this change.

A further six Docker samples from 23:08:44 to 23:09:35 UTC completed in 232–270 ms, with all 40 original containers running throughout. Evidence: `work/performance-20261019/cold-step-docker-window.json`.

## Actual experience after the changes

Two independent browser runs used production Chief UI/backend and real Hermes ACP/model requests, each with one fresh process followed by two pooled replies. Each used `gpt-6.1-sol`, medium reasoning, `openai-codex` / `codex_responses`, and 19 tool definitions. Test-only barriers prevented tool execution, live conversation writes, memory retention and background review; memory recall remained enabled. Both runs completed without browser errors and cleaned up their owned processes/data. Normal PM bootstrap validation was represented; the executable shim/CLI dispatch was not.

| Measurement | Prior baseline | After run 1 | After run 2 |
| --- | ---: | ---: | ---: |
| Cold Send → first painted text | 22.069 s | 22.587 s | 14.316 s |
| Cold Send → completion | 25.052 s | 25.142 s | 18.012 s |
| Cold Send → provider request | 19.471 s | 15.904 s | 12.201 s |
| Provider request → first painted text | 2.598 s | 6.683 s | 2.115 s |
| Pooled first text, next two replies | 1.954 / 2.409 s | 2.775 / 2.842 s | 1.747 / 1.837 s |

Local preparation was shorter in both observations, but provider delay offset the gain in the first run. These small samples demonstrate functioning real replies and remaining variability; they do not establish a percentile or a guarantee of consistently fast cold responses. The previous gateway/profile tests also observed warmed provider tails. No model/reasoning downgrade or response-quality shortcut was introduced.

Detailed stages, screenshots and cleanup evidence: [browser report](../../work/performance-20261019/hermes-real-acp-smoke-report.md), `hermes-real-acp-cold-step-comparison.json`, and separately retained `hermes-real-acp-cold-step-run1.json` / `run2.json` under the same evidence directory. The prior snapshot is preserved as `hermes-real-acp-before-cold-step.*`.

## Attribution and remaining work

**PM gain is modest in a settled runtime.** Initial sequential bootstrap samples fell from 5.596–6.418 seconds to 2.531–2.665 seconds, but this was largely host/cache variation. Alternating original/current client routing in isolated children without changing installed source measured original 2.573/2.708 seconds versus current 2.538/2.491 seconds: approximately 126 ms median improvement. A further instrumented control confirmed one separate 183 ms validator in the original path versus zero in the current path, with 158 ms overall improvement. The earlier profile's 1.327-second validator was a slower host observation, not a guaranteed saving. Both original/current controls exited successfully.

**Inventory removes a variable unnecessary probe.** The paired measurement removed 300 ms of credential probing; the earlier profile observed 2.847 seconds for the same call. Exact output equality and 44 passing inventory/discovery tests support the correction; the full browser/local timing improvement must not all be attributed to it.

**The next local costs are identified, not bypassed.** A corrected isolated local-model-stub profile measured 3.523 seconds through prompt preparation, with one stub response and zero tool executions. It includes first-use Hindsight client imports and bundled language-catalog parsing. The instrumented catalog parse accounted for about 1.221 seconds and memory preparation for about 1.690 seconds, including 1.357 seconds of client loading. These nested profiled times include instrumentation overhead and must not be summed or treated as uninstrumented latency estimates. The shared YAML loader already chooses its accelerated safe parser where available and retains required fallback semantics; no speculative parser or memory change was made. An initial stub had the wrong response shape and retried; its evidence is explicitly retained under `invalid-stub-*` and excluded from valid measurements.

The Docker contention recovery continues to hold in this observation window. At 23:13:23 UTC the final audit listed Docker in 246 ms, all 40 original containers ready, no missing originals; Chief/UI/Workspace/Phone/Hermes endpoints returned 200 in 1–7 ms. Hermes discovery was authenticated/available in 2.073 seconds. Endpoint results are recovery checks, distinct from the real conversational timings above. Evidence: `cold-step-final-service-audit.json`.

## Handoff and rollback

This step includes two scoped source corrections, independent review, 92 unique focused passing cases across PM and inventory, two actual browser runs, causal controls and a final service audit. **Consistently fast cold responses remain unresolved**, primarily because cold initialization and provider wait still vary. No further service restart was necessary. New ACP processes load these installed-source changes; the existing warmed gateway does not repeat PM startup or ACP model inventory on each turn. Chief application code was unchanged in this step. Browser timings and paired controls precede the final dependency-import ordering correction; the final isolated ACP initialize/session/prompt smoke with a local model stub passed against the final source state without another provider request (initialize 3.746 s, session/new 5.476 s, prompt 3.624 s, end_turn, exit 0).

The installed Hermes source has local changes, not an upstream release or commit; an update may overwrite them. Scoped patches passed reverse-apply checks and were not rolled back:

- PM details and exact tests: `C:/Users/amank/AppData/Local/hermes/reports/latency-pm-validation-handoff-20261019.md`; patch `latency-pm-validation-20261019.patch` in the same directory.
- Inventory details: [handoff](../../work/performance-20261019/hermes-explicit-inventory-handoff.md); patch `C:/Users/amank/AppData/Local/hermes/reports/latency-explicit-inventory-20261019.patch`.

Review intervening edits before using either rollback patch. Existing missing filesystem-root choices and provider authorization issues from the earlier recovery are unchanged and were not guessed around.

Shared-memory receipt: `family-2409e118bcf3c5959b806dbef9bca6a1d1a4f45f` was queued at handoff, not yet centrally verified. The local report and raw evidence are saved.
