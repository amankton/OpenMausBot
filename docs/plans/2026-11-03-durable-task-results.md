# Durable task results — first increment

Status: saved before implementation on 2026-11-03; the narrow local direct-task register/lookup/settlement slice is implemented and verified. Owner: Dex; Bacca owns final scope/review. No reviewer participation claimed. The verification report records partial/deferred parts of the broader discovery proposal.

## Workspace and baseline

- Original repo: `C:/Users/amank/Documents/ChatGPT/CHIEF SOFTWARE WORKSPACE/chief-executive-suite`.
- Implementation worktree: `C:/Users/amank/AppData/Local/Crewframe/Chief/data/tmp/durable-delivery-20261103`.
- Branch: `codex/durable-delivery-v1-20261103`, base `22d5d4cf827159433bbb55587450f359b899b7ba` (0.1.98).
- Original checkout has unrelated uncommitted phone/Hermes edits. They remain untouched. Its index.ts hunks concern phone route wiring and Hermes account settings; this increment uses separate modules and other wiring seams.
- Git requires owner-context execution: sandbox identity triggers dubious ownership. Use approved owner-context Git, never safe.directory changes. First worktree creation in the long task folder failed on two Windows filenames; the partial worktree was left alone. The shorter path above completed cleanly.
- Discovery: `C:/Users/amank/AppData/Local/Crewframe/Chief/data/task-workspaces/7155d19e-dadc-419f-9b76-d7a461045e4d/e9867415-d01b-418a-8613-d19c5bdadd3e/chief-harness-discovery-2026-11-03.md` (all 12 acceptance cases consulted).

## Narrow contract

One task-result module over the existing messages.db command/receipt transaction seam. Versioned execution results, explicit bounded file registrations, verification claims, and notification intent. Execution outcome, delivery outcome and notification outcome are independent. A successful provider turn without registration is unverified; consultations need no artifacts. Prior delivered versions survive a later failure. Registration checks the live generation before and after async file reading. No URL probing, directory crawling, external effect replay, new model routing, permission changes, or live owner database access.

Read scope mirrors list_threads: own tasks plus tasks opened by the caller on peers it can currently reach. Result IDs confer no access. Revocation is rechecked for lookup and notification. Store artifact content identity, explicit host/VM scope, observation time, and fixture/real/unspecified flag. Model verification statements are claims, never harness-observed test passes. The harness can attest only the file bytes it read. Remote/URL locators are deferred rather than pretending to verify them.

Direct coordinated work is the first end-to-end target. Persist result references in thread summaries and coordination result context. Reconcile notification cards without waking models; stopped requesters remain stopped. Existing parent synthesis remains the only automatic coordination wake. Explicit manual retries preserve source references where possible and never restart services.

## Test-first implementation steps

1. Save this plan. Set up dependencies by a local node_modules junction to the original checkout; disable test cache. All test homes/data are disposable through existing testing/setup.ts and fake-provider fixtures.
2. Add failing `server/task-results.test.ts` tests for versioned schemas, run A failure / B registration / later failure / reopen, scoped access/revocation, malicious file paths, active-generation races, receipt idempotency and notification crash reconciliation. Run with `node node_modules/vitest/vitest.mjs run server/task-results.test.ts --cache=false`. Expected RED: module missing, then real assertions while filling implementation.
3. Add `shared/task-result.ts`, additive messages.db accessors/tables, and `server/task-results.ts`. Reuse `runCommand`, hardened openMessageFile and existing attachment storage. Keep filesystem preparation outside SQLite; persist result/outbox atomically, then publish replay-safe cards. Run unit tests to GREEN.
4. Add a route module and agents tools `register_task_result` / `task_results`, active capability and caller scope wiring. Extend wire summaries and room handoff result references conservatively. Add fake-provider integration tests before wiring settlement/reconciliation. Run targeted tests RED then GREEN.
5. Cover cancellation/no-wake, stale registration, unverified completion, fixture-v-real flags and the A/B/later-failure/restart incident using the real isolated harness fixture. No paid providers or live app calls.
6. Add a runnable synthetic onboarding example exercising the same result API (fixture transcript + SOP -> sourced packet; owner/deadline unresolved). It may use the same isolated fixture test rather than a parallel demo backend. No customer data or external contacts.
7. Run targeted regressions for commands, attachments/path guards, direct coordination, room handoffs, recovery, tool catalog/call paths; update intentional catalog goldens and measured budgets if required. Run `node node_modules/typescript/bin/tsc -b`, `node node_modules/typescript/bin/tsc -p tsconfig.server.json`, and `node node_modules/vite/bin/vite.js build` (local worktree output only). Record actual commands, exit codes, failures/fixes and outputs. Review final diff and original checkout status with owner-context Git; no push/deploy/migration against production.

## Expected files

- New: `shared/task-result.ts`, `server/task-results.ts`, `server/task-results.test.ts`, `server/routes/task-results.ts`, integration test and synthetic fixture/SOP.
- Additive changes: `server/message-db.ts`, `server/index.ts`, `shared/wire.ts`, `server/room-handoffs.ts`, `server/drivers/agents-catalog.ts`, `server/drivers/agents-call.ts`, `server/agent-tool-policy.ts`, intentional catalog goldens/tests.
- Verification record: `docs/verification/durable-task-results.md` with commands and acceptance matrix. Exact final file list comes from Git, not this estimate.

## Schema and compatibility

Create additive version-1 tables on opening a disposable/new database, using CREATE TABLE IF NOT EXISTS. No destructive migration, existing task/transcript rewrite, or production database opening in development. Results are immutable per execution except terminal sealing and notification state; receipt keys bind registration/settlement/reconciliation. Old tasks need no backfill and optional wire fields are absent for them. Public projections exclude native session cursors and raw capabilities. Store bounded metadata/evidence, with explicit retention/deletion behavior documented; no global artifact search.

## Rollback

The original checkout is untouched. Review/apply only this branch's patch. Revert this increment's source changes to remove tools/wiring; additive result tables can remain inert. Do not drop tables or delete artifacts from a live profile as an automated rollback. No model/tool actions are replayed during reconciliation. No commits/pushes or production updates unless separately requested.

## Acceptance checklist (discovery cases)

- [x] A fails; B delivers; later failure/restart preserves B and evidence.
- [x] Crash after result commit / before report and after report / before ACK projects exactly one card.
- [x] Recoverable failed preparation/commit does not create a delivered result or duplicate attachment; hard-kill orphan file reclamation is deferred.
- [x] Cancelled requester gets no model wake; stale generation cannot register.
- [x] Retry provenance and earlier usable result survive later failure.
- [ ] Changed/missing source remains distinct from retained artifact bytes and old verification.
- [ ] Host/VM scope and timestamps explicit; no URL probes.
- [x] Scope isolation, revoked peer access, traversal/symlink escape/forged IDs fail closed.
- [x] Claimed test success is not observed verification; empty completion unverified; fixture/real flags separate.
- [x] Results remain queryable independently of prose/coordination pruning; latest 50 plus last usable result and exact ID lookup; task deletion behavior documented/tested.
- [ ] Model/context recovery preserves result references and does not expand authority or replay effects.
- [x] Revoked/suppressed notifications remain auditable without leakage or duplicated execution.

Deferred interfaces must be named explicitly in the verification report. A coherent first slice does not constitute completion of every proposed interface in the discovery report.

Completed checks: combined regression 17 files / 472 tests; final result/download suite two files / 19 tests; app/server typechecks, changed-file lint and local Vite build passed. See `docs/verification/durable-task-results.md` and its evidence logs for exact commands, intentional RED failures/fixes and remaining limits. The unchecked broader surface/probing/model-continuity items are explicitly partial in its twelve-case matrix.

## Independent review corrections (planned before corrective code)

Request e9109fc2-14e4-470e-8e6d-cf0bcfa34757 reports two reproduced P2 findings. Earlier green suites did not cover either defect; integration remains pending independent re-review.

1. Add RED regressions for VM lease expiry/reassignment during attachment preparation, executing the actual index.ts route dependency wiring and capability validator with a real LocalVmLease and isolated SQLite/files. Preserve earlier delivered bytes/results, reject the new commit, and assert no new projection. Add a separate final synchronous commit-fence test.
2. Add a deterministic growing-source RED test: append after the pre-read stat, instrument descriptor read/readFile calls, assert maximum read allocation/request <= 64 KiB, at most limit+1 bytes consumed, 413 rejection and cleanup of only the new partial/prepared files. Include exact-boundary success.
3. Reuse the existing attach_file pattern: capture the claimed VM and validate the complete capability plus that pinned VM on every post-preparation/commit check. Keep this validation in the existing route dependency seam; no new permission, lease or VM implementation.
4. Stream from the already guarded descriptor into existing saveFile storage, with a fixed 64 KiB buffer, incremental per-file/aggregate caps and hash. Verify stat/observed byte identity inside the producer before saveFile can commit. No whole-file buffer and no restat-only fix.
5. Run the new ownership/core tests RED then GREEN; rerun API/restart/attachment/path/capability/coordination regressions, app/server typechecks, changed-file lint and local build. Save actual commands/output under the existing evidence folder with review-* names.
6. Update the report and exact changed-file manifest, regenerate the source/docs patch and thread handoff, check patch correspondence with git apply --reverse --check. No merge, push, deployment, live DB, service restart, security change or claim of reviewer clearance. Schema/migration/rollback remain unchanged.

Correction outcome: both defects reproduced before implementation (five failing assertions, 19 existing passes) and focused tests turned green. Final ownership/core/API/restart run: 27 tests in three files passed. Broader review regression: 256 tests in 15 files passed. App/server typechecks, changed-file lint and local build passed. The report records exact source anchors, fixed read/allocation bounds, cleanup assertions, commands and logs. Corrections are ready for independent re-review; no clearance or integration is claimed.
