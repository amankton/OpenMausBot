# Chief startup repairs — 20 October 2026

The owner requires implementation and verification after diagnosis, with the applications intended to coexist left running. This report records the repair work following the earlier latency investigation.

## Hermes configuration parsing

The Windows AMD64 Python 3.14 installation lacked the native YAML parser. Startup repeatedly parsed 21 profile configurations and 52 plugin declarations using Python code. The managed package-manager and application dependencies now include `ruamel.yaml.clib==0.2.15`, restricted to Windows AMD64 Python 3.14 and later. The existing YAML wrapper, fallback behavior, model settings, tools and recall remain intact.

Parsed comparisons of the core, package-manager and resolved application lockfiles show only the accelerator added; no existing package version was removed or upgraded. All previous managed environment generations remain available.

| Fresh-process measurement | Before, median of 3 | After, median of 3 |
| --- | ---: | ---: |
| Bootstrap | 6.262 s | 1.148 s |
| Canonical launcher | 7.820 s | 1.173 s |

These are fresh processes, not cleared operating-system caches. The first after-change pair took 4.233 and 3.439 seconds; the remaining four observations were 1.124–1.173 seconds. They demonstrate reduced local startup overhead, not a guarantee about provider or end-to-end latency.

The canonical launcher confirmed the compiled parser loaded from managed application environment `e6adfb7f827b4c0d99570cbfe81f202a`. Seven YAML/config test files produced 33 passes, one skip and one failure. The failing pinned-mtime/size configuration-cache test failed identically in the retained previous environment; its source was unchanged. The new native-parser regression passes.

Evidence: `work/performance-20261020/hermes-yaml-accelerator/`, `hermes-yaml-startup-before.json` and `hermes-yaml-startup-after.json`.

## Native Codex preparation

The previous cross-turn process-reuse experiment remains rejected. The new candidate prepares a fresh process after a completed reply. Each prepared process may receive exactly one actual model turn and is then destroyed through the ordinary driver lifecycle. Preparation does not send a model turn or tool call.

Preparation checks effective file-backed authentication, configuration, instructions, tool scope and authoritative hook trust. Approval requests are held until an actual user turn takes ownership and validates the current contract. Unknown or unsupported configurations use the ordinary cold path.

The resource budget permits one speculative process across provider instances, requires 4 GiB available RAM at admission, imposes a 30-second preparation deadline and monitors the idle process family. Stop, removal and sign-out attempt active and idle cleanup independently; a cleanup failure cannot prevent the other cleanup attempt.

Actual installation probes confirmed file-backed authentication and an unmanaged, untrusted SessionEnd hook. A synthetic positive-control test confirmed that this untrusted hook did not execute, while the same trusted synthetic hook did. These probes sent no model turn and copied no credentials.

The final focused run passed 27 tests, covering one-use ownership, immediate follow-ups, configuration and scope invalidation, hook trust, memory limits, global admission, Stop/sign-out/removal cleanup and restored cumulative usage. The broader preceding run passed 200 tests, skipped one and failed eight: seven pre-existing branding expectations and a cleanup regression introduced by waiting for startup promises. The latter was fixed by immediately rejecting abandoned startup RPCs and passed its exact regression rerun. The focused filter skipped 182 unrelated cases; it was not another full-suite pass.

The server typecheck passed. The first real fixture launch then caught an unsupported TypeScript parameter property under Node's strip-only runtime, before any model request. Replacing it with an ordinary field assignment passed the actual strip-only driver import and all 26 prewarm-focused tests. The failed launch and cleanup remain recorded separately.

**Decision: do not activate native prewarming.** Three real browser replies took 9.367 / 4.463 / 4.960 seconds to first visible text, versus the earlier baseline's 5.436 / 4.110 / 4.207 seconds. Startup on the two immediate follow-ups changed from 964 / 1,017 ms to 426 / 1,467 ms. One improved and one regressed; provider time also varied. Both preparations were consumed safely, but neither was ready when the immediate reply arrived. This does not justify speculative memory use as a demonstrated speed repair. The scoped candidate is archived and its production edits were restored byte-for-byte to the pre-experiment baseline, preserving earlier edits. Rollback hashes and the forward-applicable archived patch are recorded in `work/performance-20261020/codex-one-use-prewarm-rollback.json`. No Chief restart occurred.

The clean native fixture excludes the user's full MCP catalog and conversation history; it cannot establish desktop UI latency or full-profile production percentiles. Evidence: `work/performance-20261020/candidate-response-report.md`.

## Actual Hermes replies after the YAML change

| Profile | Cold first visible text | Two warm first-visible times |
| --- | ---: | ---: |
| Bacca | 23.007 s | 4.095 / 2.162 s |
| Solo | 17.141 s | 2.438 / 3.408 s |

Both real ACP processes loaded the new compiled parser. All six replies made one physical provider request, returned HTTP 200 and produced no observed provider retry/error or browser page error. Bootstrap/import time improved to 3.858 / 3.831 seconds, but local agent construction and prompt preparation still dominated the first reply. Bacca's prompt preparation took 6.889 seconds; this needs further causal attribution. Missing bytecode is not established: relevant compiled files existed before the run.

The canonical launcher improvement is verified; these results do **not** establish faster end-to-end cold responses. All recorded native/Python fixture processes exited. The Bacca fixture folder `C:\Users\amank\AppData\Local\Temp\chief-hermes-latency-20261020-FASD5e` remained after an EPERM cleanup error; deletion was not retried.

## Remaining preparation attribution

A subsequent isolated owner-thread wall profile, using the normal ACP entry point and blocking real model dispatch, measured 12.346 seconds in prompt preparation: 7.294 seconds waiting for `tools.env_probe.get_environment_probe_line` and 3.934 seconds in recall. The environment probe sequentially launches Python version, pip-module, bare-pip and externally-managed-environment checks. Existing early warmup is exercised by both the browser fixture and this profile; recall remains enabled.

The installed `tools/env_probe.py` now delays the optional `python` alias check until a diagnostic will actually be emitted. It also skips the externally-managed check only when healthy Python/pip plus available `uv` already guarantee the same empty diagnostic. Unhealthy and remote behavior is preserved. This nine-line change reduces the observed healthy-path subprocess count from five to three. New and existing probe tests passed **20/20**, including timeout and concurrency behavior.

Standalone wall time changed from 3.441 to 1.077 seconds, but the retained `python3` version check itself varied from 2.568 to 0.121 seconds. The removed checks cost approximately 193 ms in that pair, so the entire wall-time difference must not be attributed to the repair. An earlier profile measured the unused alias check at 3.209 seconds, demonstrating variable exposure. In another matched ACP pair, early warmup hid the probe on both sides and prompt preparation was 2.456 / 2.658 seconds. The verified result is fewer unnecessary subprocesses with unchanged output; end-to-end consistency still requires the final browser measurements.

## Final response verification and live state

The final six real replies ran through the Chief renderer in isolated fixtures using the installed Hermes runtime, GPT-6.1 Sol/low reasoning, 19 tools and unchanged recall.

| Profile | Cold first visible text | Warm first visible text | Cold completed reply |
| --- | ---: | ---: | ---: |
| Bacca | 16.389 s | 2.727 / 3.726 s | 19.003 s |
| Solo | 11.850 s | 2.267 / 1.843 s | 14.971 s |

All six requests returned HTTP 200, made exactly one physical provider request, and had no observed provider retries/errors or browser page errors. Both processes loaded the new managed YAML extension and the installed `tools/env_probe.py`. Both final fixture homes were removed and their recorded Python processes exited.

These final cold samples are lower than the preceding YAML-only pair (23.007 / 17.141 seconds), but filesystem caching, process launch variance and provider timing changed too. The whole difference is not a controlled estimate of either patch. The earlier broader baseline also included Bacca cold replies near 16 seconds. This establishes functioning installed repairs and current measured response times, **not consistently fast cold replies**. Native Codex latency remains unresolved; its speculative candidate was withdrawn.

Fresh ACP processes automatically load the selected managed environment and editable Hermes source. Live Chief had zero owned Python/ACP processes after verification, so no stale ACP instance needed recycling. The gateway was left running; it retains its prior imported modules until its normal restart. No Chief, Docker, WSL or gateway restart was required for the retained direct-ACP changes.

The live UI API at `http://127.0.0.1:5299/api/health` responded successfully. Chief retained backend PID 32076, launcher PID 60880, the same data directory and all 194 bots, with no active or queued work at inspection. SHA-256 checks for `config.json`, `bots.json`, `groups.json` and `external-runtimes.json` matched the pre-work snapshot. All 40 Docker containers and Gmail Ninja remained running. Available physical RAM was 4,608 MiB at the final resource snapshot; this is not a controlled memory-leak measurement.

Detailed final timing and provenance: `work/performance-20261020/provider-cold-candidate-summary.json`, `provider-cold-after-env-probe-{default,solo}.json`, `candidate-response-report.md` and `env-probe-lazy-checks.md`. Live workspace receipt: `work/performance-20261020/fix-rollout-after.json`.

## Retained temporary files

**Resolved:** the owner deleted all three folders. Subsequent read-only checks independently verified all three exact paths absent. `work/performance-20261020/cleanup-resolution.json` records the verification. No policy override was used. The following paragraphs retain the earlier rejection history.

Follow-up: the owner explicitly requested resolving the cleanup blocker. Read-only checks found all three retained test folders, no reparse points, no referencing non-shell processes, and existing owner full-control permissions on the inspected hook folder. A new path-validated PowerShell cleanup request was again rejected before execution with only “blocked by policy.” Nothing was deleted and no policy was changed. The three exact paths and inspection counts are recorded in `work/performance-20261020/cleanup-resolution.json`. Manual deletion of those specific folders in Windows File Explorer remains available to the owner; the agent did not attempt another execution route after rejection.

Automatic approval review blocked deletion of two synthetic hook-test folders, reporting only “blocked by policy.” Their test processes exited. The folders remain at `C:\Users\amank\AppData\Local\Temp\chief-hook-trust-proof-ZW7isS` and `C:\Users\amank\AppData\Local\Temp\chief-hook-trust-proof-TGoYXh`; no alternate deletion was attempted after the rejection. They contain no copied credentials.
