# Durable task results: implementation evidence

Date: 2026-11-03. Implementer: Dex/Codex. This is a local, reviewable first increment; no deployment, live migration, push or production service restart has occurred. Reported independent-review findings were reproduced and corrected below. Independent re-review/clearance remains pending.

## Review corrections: current evidence

Request `e9109fc2-14e4-470e-8e6d-cf0bcfa34757` supplied two reproduced P2 findings. Earlier green suites did not clear these defects. No full independent report or report locator was supplied in this conversation's accessible artifacts; the supplied findings were sufficient to reproduce both. No independent re-review result is claimed.

**Pinned VM ownership:** `server/index.ts:16198` now returns a post-copy ownership predicate capturing the exact VM from attachmentVmForTurn and reusing internalCapabilityIsActive with the full original capability plus localVmTarget, matching the existing attach_file fence. `server/routes/task-results.ts:26` combines it with the ordinary generation/task/cloud scope gate. `server/task-results.ts:112` checks validity again inside the synchronous receipt-backed registration command immediately before metadata mutation. Expiry, lease reassignment or replacement of the pinned target cannot become a committed registration. No lease, capability, security or computer setting implementation was replaced.

**Growing source:** `server/task-results.ts:86` streams the already containment/symlink-checked descriptor into existing saveFile storage with one reused 64 KiB source buffer, incremental SHA-256 and per-file/aggregate accounting. Each read is at most the remaining budget plus one detection byte, capped at 64 KiB. The extra byte is rejected before hashing/yielding it to storage. Source byte count/mtime/size checks execute inside the producer before saveFile can commit its partial file. This is a bounded read, not a full read followed by a restat. Existing attachment quota enforcement remains in use.

The growing-source regression first consumed **27,262,969 bytes** with the old readFile code. The corrected test observes **26,214,401 bytes** consumed (25 MiB plus one detection byte), one 65,536-byte source buffer, maximum read request 65,536 bytes and zero whole-file reads. Registration rejects with 413, its partial/prepared copies are removed, and prior committed result B and its attachment remain. A separate aggregate-growth test leaves two MiB of the 50 MiB budget and confirms a later growing source stops after 2,097,153 bytes. Exact 25 MiB success checks the expected content hash; an under-limit source mutation rejects with 409 before attachment commit.

`server/task-results-ownership.test.ts` executes the **actual source-extracted index.ts dependency wiring and capability validator**, with a real LocalVmLease, real isolated SQLite and real streamed attachment copies. It expires/reassigns the lease or replaces the pinned target between source read and storage write. It verifies that the agents generation remains active while the VM-bound capability fails, no result commits or publishes, only newly prepared bytes are cleaned, and prior B survives. This is not a live VM/provider test. The real HTTP/tool/restart path remains covered by `server/task-results.e2e.test.ts`.

Exact corrective file surface: `server/index.ts`, `server/routes/task-results.ts`, `server/task-results.ts`, `server/task-results.test.ts`, new `server/task-results-ownership.test.ts`, this report and `docs/plans/2026-11-03-durable-task-results.md`. No schema, migration, tool schema, model routing, approval rule or rollout change was required.

Current evidence in `docs/verification/evidence/durable-task-results/`:

| Log | Actual command/result |
|---|---|
| `review-red.log` | `node node_modules/vitest/vitest.mjs run server/task-results.test.ts server/task-results-ownership.test.ts --cache=false`: exit 1, five expected failures / 19 passes, 2.60 s. Three ownership races committed incorrectly; final commit fence was missing; growing read exceeded its bound. |
| `review-green.log` | Same command after production fixes: exit 0, 24 tests passed, 2.52 s. |
| `review-final-focused.log` | `node node_modules/vitest/vitest.mjs run server/task-results.test.ts server/task-results-ownership.test.ts server/task-results.e2e.test.ts --cache=false`: exit 0, three files / 27 tests passed, 17.27 s, including strengthened allocation/aggregate/identity and during-copy ownership assertions. |
| `review-regressions.log` | Command below: exit 0, 15 files / 256 tests passed, 227.25 s. |
| `review-typecheck-app.log` | `node node_modules/typescript/bin/tsc -b`: exit 0. |
| `review-typecheck-server.log` | `node node_modules/typescript/bin/tsc -p tsconfig.server.json`: exit 0. |
| `review-lint.log` | `node node_modules/oxlint/bin/oxlint --deny-warnings server/task-results.ts server/task-results.test.ts server/task-results-ownership.test.ts server/routes/task-results.ts server/index.ts`: exit 0. |
| `review-build.log` | `node node_modules/vite/bin/vite.js build`: exit 0; 5,765 modules, 27.68 s. Existing CSS ::highlight and chunk-size warnings remain. |

```sh
node node_modules/vitest/vitest.mjs run server/task-results.test.ts server/task-results-ownership.test.ts server/task-results.e2e.test.ts server/bot-attachment.test.ts server/attachments.test.ts server/message-file.test.ts server/local-vm-lease.test.ts server/auto-vm-claims.test.ts server/commands.test.ts server/room-handoffs.test.ts server/direct-coordination.e2e.test.ts server/automatic-recovery.test.ts server/automatic-recovery.e2e.test.ts server/turn-context.test.ts scripts/testing/index-route-ratchet.test.ts --cache=false
```

Counts overlap and are not additive. All test state is disposable; no owner DB, real model, paid provider, container service or real lease was changed. Scope, migration/rollback and previously deferred interfaces below remain unchanged. Full monorepo/Electron packaging/live VM verification and independent re-review are not claimed.

## Location and scope

Implementation worktree: `C:/Users/amank/AppData/Local/Crewframe/Chief/data/tmp/durable-delivery-20261103`.

Branch: `codex/durable-delivery-v1-20261103`; base `22d5d4cf827159433bbb55587450f359b899b7ba`; package version 0.1.98. Changes remain uncommitted for review. Original checkout: `C:/Users/amank/Documents/ChatGPT/CHIEF SOFTWARE WORKSPACE/chief-executive-suite`, branch `codex/chief-unified-platform`; its unrelated phone/Hermes edits were preserved.

The pre-code plan is `docs/plans/2026-11-03-durable-task-results.md`. The discovery report remains at `C:/Users/amank/AppData/Local/Crewframe/Chief/data/task-workspaces/7155d19e-dadc-419f-9b76-d7a461045e4d/e9867415-d01b-418a-8613-d19c5bdadd3e/chief-harness-discovery-2026-11-03.md`.

Direct task executions now have a durable result identity independent of provider success and bounded coordination prose. Explicit registration copies at most four permitted files (25 MiB each, 50 MiB total) through existing attachment storage and path guards. Results distinguish execution outcome, declared delivery outcome, requester notification and attachment publication. Older successful deliveries remain discoverable after later failed attempts and beyond the recent 50-result window.

This solves a visibility gap: an old failed attempt is no longer the only durable signal for later completed work. It does not repair transport availability or turn a delivery declaration into proof that the artifact meets its requirements.

## Changed surface

| Files | Behavior |
|---|---|
| `shared/task-result.ts`, `shared/wire.ts` | Version-1 TaskResult, ArtifactVersion, VerificationRecord; optional wire result references/summary. |
| `server/message-db.ts` | Additive task_results table/indexes, scoped and work-pending queries, task deletion cleanup. |
| `server/task-results.ts` | Receipt-backed begin/register/seal, bounded immutable byte copies, scoped lookup, interrupted recovery and idempotent projection reconciliation. |
| `server/routes/task-results.ts` | Internal GET lookup / POST explicit registration behind existing capability, body and live-generation gates. |
| `server/index.ts` | Direct dispatch/settlement provenance, explicit retry linkage, scoped result authorization, own-task attachment message and requester reference card, list_threads/task summaries. Projection errors remain pending and cannot strand coordination settlement. |
| `server/room-handoffs.ts`, `server/store.ts` | Persist result IDs/rework intent and permit derived wire summary. Existing coordination state machine is retained. |
| `server/drivers/agents-catalog.ts`, `server/drivers/agents-call.ts`, `server/agent-tool-policy.ts` | register_task_result and read-only task_results tools. Only lookup enters the reviewed read-only policy. External runtime catalog remains unchanged. |
| Catalog goldens, catalog-wire/proxy/policy tests | Intentional schema/profile updates and manually reviewed measured budgets. |
| `server/task-results.test.ts`, `server/task-results.e2e.test.ts` | Isolated fault, path/access, provenance and fake-provider incident/restart tests. |
| `server/task-results-ownership.test.ts` | Actual production wiring/capability validation with isolated real lease/copy races. |
| `examples/durable-results/*`, plan, this report, evidence logs | Runnable sourced synthetic onboarding example and review evidence. |

## Truth and permission boundaries

The harness attests only the saved file's observed bytes, SHA-256, byte count, location scope and observation time. User-supplied test descriptions, synthetic/real labels and delivery classifications remain agent claims. A provider completing successfully without registration is `succeeded/unverified`; brief consultations need no artifact registration.

Lookup is limited to a bot's own task or a peer task it opened, with current team/peer access rechecked. A result ID confers no authority. Revoked/deleted requester targets produce durable suppression; the source card contains references/status, not copied artifact content. Own-task files are published through existing authored message/attachment guards. No arbitrary URLs are probed, directories crawled, or computer permissions granted. Host/claimed-VM roots and observation times remain explicit. Remote URL registration is deferred.

SQLite result writes and command receipts are atomic. Filesystem preparation precedes registration; message projection follows sealing with separate durable idempotency keys. This is not a transaction across SQLite, filesystem, coordination JSON and broadcasts. A crash after message commit/before acknowledgement reuses its receipt. A hard kill after a file copy/before result commit can leave an unreferenced file consuming the existing attachment quota; this increment deliberately does not sweep committed files. Recoverable preparation/commit errors remove their own unretained copies. No committed delivery is fabricated by that orphan window.

Restart marks in-flight results interrupted and reconciles local messages only. It never restarts tools, services, sends, publishes or provider turns. A stopped requester stays stopped. Normal existing parent synthesis remains governed by coordination, rather than a second result-notification wake mechanism. A projection failure is logged and retried on later settlement/restart; there is no timer-based universal retry service.

## Earlier implementation commands and observed results (before review)

Commands run from the implementation worktree using existing dependencies via a local node_modules junction. Tests disable cache and use existing isolated temporary homes/data and fake providers. No live owner database or conversations were opened by tests.

Evidence logs are in `docs/verification/evidence/durable-task-results/`. Final combined regression: **17 files / 472 tests passed, exit 0, 213.88 seconds** (`final-regressions.log`). Final focused result/download run: **two files / 19 tests passed, exit 0, 9.72 seconds** (`final-result-download-tests.log`), adding concurrent-registration/deletion coverage and actual guarded file downloads before and after restart. Counts overlap; they are not additive. Earlier independently completed evidence:

- `core-tests-final.log`: seven files, 298 tests passed (result core, commands, attachment/path guards, policy/proxy).
- `coordination-regressions.log`: seven files, 116 tests passed (room/direct coordination, recovery, context, timeline, route ratchet).
- `result-api-final.log`: five files, 117 tests passed (result core/integration, room handoffs, tool catalog wire and calls).
- `attachment-projection-green.log`: two files, 16 tests passed after the integration test exposed missing authored attachment publication. A further attachment commit/ACK crash test was added to the final run.
- App/server typecheck commands and changed-file lint exited 0. Silent commands did not create their Tee-Object-only log files; the current review logs above explicitly record commands and exit codes even with no output.
- `build-final.log`: `node node_modules/vite/bin/vite.js build`, exit 0, 5,765 modules, 27.64 seconds. Existing CSS ::highlight optimizer and large-chunk warnings remain. Windows PowerShell renders stderr warnings as NativeCommandError records; the process still exited 0.

The combined regression command is:

```sh
node node_modules/vitest/vitest.mjs run server/task-results.test.ts server/task-results.e2e.test.ts server/room-handoffs.test.ts server/direct-coordination.e2e.test.ts server/automatic-recovery.test.ts server/automatic-recovery.e2e.test.ts server/turn-context.test.ts server/task-timeline.test.ts scripts/testing/index-route-ratchet.test.ts server/agent-tool-policy.test.ts server/drivers/agents-proxy.test.ts server/drivers/agents-catalog-wire.test.ts server/drivers/agents-call.test.ts server/commands.test.ts server/bot-attachment.test.ts server/attachments.test.ts server/message-file.test.ts --cache=false
```

No full monorepo test, Electron packaging/GUI smoke, live provider evaluation or production migration test is claimed.

## Failures found and resolved

- Sandbox Git identity triggered ownership guard. Approved owner-context execution worked; no safe.directory or security changes.
- First worktree checkout at the longer task-folder path failed on two Windows filename lengths. A shorter worktree succeeded. The partial worktree was left untouched, without resets/deletes/moves.
- Restricted native esbuild execution failed; approved owner-context fixture commands worked.
- Node strip-only boot rejected a constructor parameter property; replaced it with an explicit field.
- Initial read-only policy/proxy/catalog assertions failed because the intentional new tools changed exact lists/budgets. Updated schemas, goldens, expected lists and manually measured budgets; external profile stays 3,030 bytes. Direct-full is 50,503 and room-full 48,952 bytes.
- A retention test first lost delivery B after 55 failures; query now includes the newest usable delivery alongside recent history.
- Retry provenance assertion first lacked retryOfExecutionId; persisted explicit rework intent now links the new attempt to its predecessor.
- Attachment integration assertion first found saved bytes without an authored message; added idempotent own-task publication using existing guards and a crash/ACK test.
- The log named restart-projection-red.log actually passed; it records the added before-report restart test, not a failed run.
- Catalog bundle tests emit Node MODULE_TYPELESS_PACKAGE_JSON warnings for their temporary proxy bundle outside the package root. They pass; no owner package.json or runtime settings were changed to suppress warnings.
- Hindsight recall returned partial errors because its configured config.json path is missing. No memory write or centrally saved handoff is claimed; this filesystem report is the handoff.

## Discovery acceptance matrix

The full twelve discovery cases were consulted. Coverage is for this first local direct-task slice, not general completion of the original harness proposal.

| Case | Evidence and limits |
|---|---|
| 1 Incident A/B/recovery | Fake-provider integration: A fails, B registers sourced packet, requester stops, later task fails, lookup/restart returns B with evidence. Packet substitutes for dashboard; no dashboard rebuild. |
| 2 Crash/report reconciliation | Integration restart before source report; unit crash after report commit/before ACK and after attachment message commit/before ACK. One durable card/message, no new model turn. |
| 3 Preparation/commit | Injected transaction failure rolls back metadata/receipt, removes prepared copies, retry succeeds; repeat/concurrent receipt semantics preserve IDs. Hard-kill orphan reclamation is deferred as described above. |
| 4 Cancellation/generation | Integration stops requester while specialist finishes; no additional requester turn. Unit checks generation before/after asynchronous preparation and inside commit. Production-wiring regressions expire/reassign the pinned VM lease during copy and preserve earlier bytes/results. Existing cancellation/queued-work regressions also run. |
| 5 Later failure/retry | Integration and unit preserve prior usable B, source/request IDs, retryOf, provider turn ID; 55 later failures cannot hide B. |
| 6 Changed/missing source | Unit edits/deletes source and checks retained immutable bytes and old observation. Current mount availability/hash probing is deliberately absent, so lookup reports saved observation rather than a fresh availability claim. |
| 7 Surface truth | Unit registers a claimed VM workspace and rejects missing VM/host mislabeling; host timestamps/identity are explicit. Remote/local URL registration and accessibility observations deferred; no fetch occurs. |
| 8 Scope/path security | Unit and real API deny unrelated caller, revoked peers, forged IDs, traversal, outside roots, directories, symlink escape and malformed authority. Existing guards/attachment tests remain gates. |
| 9 Evidence truth | Unit/integration distinguish file identity observation from claimed tests, synthetic/real flags, unverified successful consultations. No reviewer or owner approval asserted. |
| 10 Retention | Dedicated durable table independent of bounded coordination prose; latest 50 plus last usable B; exact older ID lookup; task deletion removes rows and authorization denies absent tasks. Automatic attachment/receipt erasure and archive policy are not added. |
| 11 Provider continuity | Existing recovery/context tests plus result IDs in resumed coordination context. Full missing-cursor/model-switch scenario with new result-specific assertions deferred; no broad workflow checkpoint or automatic effect replay. |
| 12 Access race | Unit suppression after revoke/deletion before report; integration lookup denied after revoke; committed report/ACK failures retry without work repetition. Previously visible cards are not retroactively erased. |

## Schema, rollout and rollback

The additive task_results table and expression indexes are created with IF NOT EXISTS by the existing messages.db opener. Payload schemaVersion is 1. No backfill, existing transcript rewrite, destructive migration, dependency change or production DB mutation is included. Old wire consumers can ignore optional fields; old tasks need no results. This schema was exercised only on disposable fixture databases.

Review/apply the isolated branch before any separately approved rollout. Reverting source/tool/wire changes removes the feature; leave additive tables inert rather than dropping data. Do not automate deletion of registered files or command receipts from a live profile. Task deletion removes result rows along with its transcript; prior command receipts and bytes follow existing retention rather than a newly claimed erasure guarantee.

Deferred interfaces: shared-room registration, legacy delegation receipt/result API integration, external-runtime registration, directory manifests, remote preview/access probing, renderer-specific result views, observer-issued test receipts, artifact supersession/retention management, global search/backfill and universal checkpoint/replay machinery. No engine/model routing changes.

## Review handoff

Exact substantive changed paths: `docs/verification/evidence/durable-task-results/changed-files.txt`. The source/docs patch is also saved as `C:/Users/amank/AppData/Local/Crewframe/Chief/data/task-workspaces/7155d19e-dadc-419f-9b76-d7a461045e4d/e9867415-d01b-418a-8613-d19c5bdadd3e/chief-durable-delivery.patch`; raw evidence logs remain in this worktree and are not embedded in that patch. A full report copy is alongside it as `chief-durable-delivery-handoff-2026-11-03.md`.

The source/docs diff contains 25 substantive changed paths; intent-to-add records make new files visible to ordinary git diff, without staging their contents or making a commit. `git diff --check` passed. The original checkout still has its 30 pre-existing tracked phone/Hermes edits and unrelated untracked files on its original branch/base. This increment does not incorporate those owner edits, so final integration must preserve them and rerun relevant checks against the integrated tree. The new task-result wiring uses different index.ts seams from the owner's current phone/Hermes hunks.

Bacca can request independent re-review of the regenerated patch and twelve-case matrix. The original pre-correction patch is preserved alongside the current patch as `chief-durable-delivery-before-review.patch`; the canonical `chief-durable-delivery.patch` and handoff report contain the corrections. Receipt of review findings is not re-review clearance.
