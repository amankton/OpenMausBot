# Windows Hermes Desktop baseline and Chief HTTP Bridge acceptance

Owner direction: use the Windows installation as the baseline, leave WSL alone, and verify current workflows rather than complete Desktop parity. This run did not access or modify WSL or change credentials.

## Baseline identity and execution

The native Windows app was launched and exercised through its visible UI, not a web dashboard or VM substitute:

`C:\Users\amank\AppData\Local\hermes\hermes-agent\apps\desktop\release\win-unpacked\Hermes.exe`

The app footer identifies commit `e06df9c`; Desktop build metadata stamps 2026-10-14T22:13:25.085Z. Its local backend launched the Windows `hermes.exe serve --host 127.0.0.1 --port 0` under the installed source's `.hermes\bin`, then managed Windows Python 3.14.7, PID 57100, listening on 65001. The visible app reached ready. The startup log spans 21.3 seconds from "Resolving Hermes backend" to "Hermes backend is ready"; that is application startup, not a chat response measurement.

Chief uses the separate, already-running Windows Hermes API process, PID 3744, on port 8642, version 0.22.0. Its process creation time remained 2026-10-20 11:36:22 local before and after the trials. No per-turn ACP process appeared. This proves API process reuse, not reuse of an in-memory AIAgent instance: the API still logs agent initialization on turns.

Important model distinction: `/v1/capabilities` advertises `gpt-6-luna`, but this value is the API's virtual alias for its configured default. Executing provider logs show **GPT-6.1-sol, openai-codex**. Desktop was matched to GPT-6.1-sol with Low reasoning for comparison. An earlier Desktop Luna trial is separate evidence, not the matched comparison. The original Desktop model preference was GPT-5.6-sol / Low; comparison changes are temporary, not a recommendation to change that preference.

After the trials, Desktop was returned to its default profile and its original pinned GPT-5.6-sol / Low new-chat preference was restored and read back from the native UI. Synthetic verification conversations remain labeled in Desktop history.

## Fresh workflow results

| Workflow | Native Windows Desktop | Chief HTTP Bridge |
| --- | --- | --- |
| Chat and progressive response | Passed, observed native partial output and completion | Passed in the real renderer, multiple partial lengths |
| Follow-up conversation recall | Passed for default/Bacca and Solo profiles | Passed, including independent synthetic Bacca and Solo bot sessions |
| Scratch-file write and tool readback | Passed: native write_file/read_file, exact content independently read from disk | Passed: native tools through Chief policy, exact content independently read from disk |
| Skills and memory initialization | workspace-hygiene skill loaded in file workflow; Hindsight recall logged for both profiles | Prior skill/memory workflow evidence retained; this run's chat trials did not request explicit memory/skill tools |
| Approval round trip | No native approval was required by the tested Desktop file action | Passed: write_file and read_file cards rendered with tool names, answered once through the normal thread response endpoint, generation resumed |
| Stop | Passed through native Stop button during streamed output; backend and UI report interrupted / Response stopped | Passed after first text; exactly one interrupted terminal event |
| Viewing browser disconnect/reload during generation | Not separately tested on Desktop | Passed: disconnected after first delta, reloaded/rejoined while generation was active, full final prose matched stored response, exactly one completion |

Reconnect comparison removes Markdown ordered-list numbering, which the browser renders as CSS list markers rather than innerText; every sentence and final sentinel is still compared. Independent event observation remains connected during the browser interruption. No automatic duplicate generation is initiated by the test. Five dispatches correspond to the five intended chat, recall, reconnect, file, and Stop turns.

Native matched default/Bacca session: `20261020_121733_e83dca`; Solo: `20261020_122224_9952a2`. Native default/Bacca backend completion durations were 2.9 seconds for the fresh-session count response and 2.6 seconds for recall. Solo durations were 3.8 and 5.0 seconds. These are backend-accepted-turn durations, **not instrumented composer-to-first-visible-token timings**.

The matched Chief real-renderer run recorded composer-to-first-text / observed completion:

| Turn | First text | Completion observed |
| --- | ---: | ---: |
| Fresh session, same count prompt as Desktop | 3.067 s | 4.167 s |
| Follow-up recall | 2.383 s | 3.127 s |

A separate post-restart isolated Chief fixture checked independent bot sessions against the same live API instance as the configured Bacca - Chief and Solo - Chief bots:

| Synthetic bot | Fresh-session first text / completion | Follow-up first text / completion |
| --- | ---: | ---: |
| Bacca | 3.065 / 3.621 s | 2.196 / 2.584 s |
| Solo | 2.815 / 3.610 s | 2.224 / 2.580 s |

These bots use the production transport/model route but do not copy live personas, conversations, integrations, or workload. Both current Chief bots select the same `hermes` instance and `hermes-default` alias. That does not route Solo - Chief into the native Desktop's separate `solo` profile; native Solo has a different tool/prompt/memory configuration. Native Solo therefore supplies workflow evidence, not an identical-context latency control. A read-only profile-prefixed API capability probe returned 401; no credentials or profile routing were changed to manufacture a comparison.

All response measurements used an already-running API/provider path and ordinary caches. They measure fresh conversations and follow-ups, **not a provider-cold launch** or a sustained performance guarantee. The differing timing boundaries and prompts/tool inventories prevent a precise Desktop-versus-Chief speed ranking. No apps were stopped to inflate results.

## Fix and deployment

Real native-tool approvals carry `<write_file> (plugin approval rule)` in `command`, not a `tool` field. Chief previously displayed only "Hermes requests permission for an action". The HTTP driver now recognizes this exact bounded format and displays the tool name. Arbitrary command strings are not copied into the card. Existing choices and allow-once handling are preserved.

Validation: HTTP driver, tool broker, and turn-log suites: **30 tests passed**; server TypeScript check passed; scoped diff whitespace check passed. The regression checks both actual plugin payload rendering and refusal to expose arbitrary command text.

The completed real-renderer trial exercised the patched driver and both visible approvals. Verification-harness failures encountered before the final pass were fixed: ordered-list innerText normalization; retaining full approval event metadata; handling the expected needs-user approval state; preserving partial samples across reload. They are not reported as product failures. A known abandoned synthetic approval run was explicitly stopped, and final harness cleanup interrupts its owned bot before shutting down its fixture.

Chief was confirmed idle (194 bots, no running/queued work), stopped through its verified SIGINT handler, and restarted using `pnpm dev:server`. The new backend is PID 53224, launcher 35972. Before/after hashes of config, bots, groups, and external runtimes match for this restart. Chief's backend and `http://127.0.0.1:5299/` return 200 afterward. Hermes Desktop/API processes were retained.

## Scope and retained limits

The tested core workflows are suitable for bounded real work. This is not full Desktop parity or a certification of every integration.

Prior evidence, inspected but not rerun here: teammate dispatch/return/resumption; skills/session search; built-in browser button interaction; isolated VM screenshot and permission card. The supplied upstream-failure evidence shows one admission, one Stop, one error completion, and upstream cancellation after an injected stream break. It proves controlled failure handling, not transparent upstream reconnection or replay.

Still outside this acceptance: in-session model switching (explicitly unsupported), guest-confined turns (rejected), complete media/phone/connected-integration workflows, equivalent native Solo profile routing, sustained/concurrent workload performance and provider-cold timing. Desktop also reported unrelated WhatsApp-down status and an unavailable Baserow MCP at startup; ordinary tested chat/file actions still completed. Their integration workflows are not certified by these results.

Evidence under the repository's `.chief-local/`:

- `windows-bridge-results.json`, `windows-bridge-ui.png`
- `windows-reconnect-transcript.json`, `windows-reconnect.png`
- `windows-file-approvals.json`, `windows-file-approval.png`
- `windows-desktop-ui-evidence.json`, `windows-solo-ui-evidence.json`
- `windows-bot-session-results.json`
- `pnpm-restart-receipt.json`, `graceful-backend-receipt.json`
- Reproduction harnesses: `verify-windows-bridge.mjs`, generated `windows-bridge-smoke.ts`, `verify-windows-bot-sessions.ts`

Source process/log references: `%LOCALAPPDATA%\hermes\logs\desktop.log`, `agent.log`, and `profiles\solo\logs\agent.log`. Evidence JSON points to each disposable backend's persistent log. Secrets are excluded from published evidence.

Shared-memory handoff was submitted with receipt `family-4ee521f62e3dcdbd7c6d4abfdaa23ec946f5519d`; its checked status was queued/unverified, not centrally verified. The local report and evidence above are the completed handoff.
