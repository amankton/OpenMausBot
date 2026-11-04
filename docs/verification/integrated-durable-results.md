# Integrated-tree acceptance evidence - final phone reconciliation

The authorized isolated candidate passes all requested integrated checks. Independent review of this phone correction and the final artifact remains pending with Bacca. No activation/deployment, owner-checkout edit, live DB migration, real phone pairing/permission change, commit, push or service restart occurred.

Candidate: `C:/Users/amank/AppData/Local/Crewframe/Chief/data/tmp/durable-integration-20261103`. Branch: `codex/durable-integration-20261103`, uncommitted; base `22d5d4cf827159433bbb55587450f359b899b7ba`. Source package 0.1.98.

## Exact reconciliation

- `src/components/CompanionSection.reveal.test.ts`: obsolete button assertion replaced by three browser-flag cases, each checking false/true/absent saved computer access as a native checkbox outside advanced details, with the separate browser switch inside. Existing focus/reveal coverage retained.
- `src/components/CompanionSection.permissions.test.ts`: five new mounted React cases use the real component, controller and callbacks with a synthetic two-device companion bridge. They exercise closed/open/closed advanced settings, saved flags, correct-device grants/revocations, separate browser permission, persistence across remount, disabled controls during pending save, rejected save preserving state and explicit retry. External fetch and all pairing/lifecycle operations are asserted unused. Ada remains a synthetic name.
- `src/components/PhoneComputerAccessSettings.tsx`: exactly one extra EOF blank line removed; all remaining original bytes, including CRLF, are preserved. No product behavior changed.

RED command: `node node_modules/vitest/vitest.mjs run src/components/CompanionSection.reveal.test.ts src/components/CompanionSection.permissions.test.ts --cache=false`. Two failures / seven passes reproduced the old button expectation and a new test expecting raw exception text. Source inspection confirmed the controller deliberately maps errors to a safe user-facing message; the regression now checks that exact existing message and still verifies failed-save state/retry. Neither test was skipped or weakened to accept a different permission model.

## Actual verification

| Log under `docs/verification/evidence/integrated-durable-results/` | Result |
|---|---|
| `phone-reconcile-focused.log` | Exit 0; 7 passed (7); 77 passed (77); 6.35s (transform 1.55s, setup 1.44s, import 1.77s, tests 297ms, environment 1.48s). |
| `phone-reconcile-harness.log` | Exit 0; 23 passed (23); 541 passed (541); 240.11s (transform 1.21s, setup 2.14s, import 3.65s, tests 231.40s, environment 1ms). |
| `phone-reconcile-owner.log` | Exit 0; 24 passed (24); 454 passed | 2 skipped (456); 186.93s (transform 24.25s, setup 18.03s, import 41.23s, tests 111.50s, environment 10.21s). |
| `phone-reconcile-python.log` | Exit 0; eight Python unittest cases, mocked clients, Python 3.11.9, -B. |
| `phone-reconcile-app.log`, `phone-reconcile-server.log` | Both TypeScript checks exit 0. |
| `phone-reconcile-lint.log` | Exit 0; all 55 changed TS/TSX/MJS paths, deny warnings. |
| `phone-reconcile-build.log` | Exit 0; Vite 7.3.6, 5,766 modules. Existing CSS/chunk warnings retained. |
| `final-provenance.json` | Full diff, task-owned diff, combined-patch reverse, test-overlay reverse and phone-correction reverse checks all exit 0. |

The two full groups have disjoint file lists: 47 files, 995 Vitest passes plus two existing Windows skips. Python contributes eight separate passes. The 77 focused phone passes overlap the owner group; earlier/reviewer/control runs are not added. Skips remain POSIX mode bits in companion/test/devices.test.ts and POSIX sign-in shell in server/claude-accounts.test.ts. No new skip was introduced. Happy DOM disabled-iframe messages, catalog package-type warnings and Git LF/CRLF notices remain nonfatal. PowerShell NativeCommandError formatting reflects stderr; actual exits are zero.

The first broad harness attempt was not green: 539 passes and two failures in direct-coordination.e2e.test.ts (ECONNRESET while inspecting a completed task; fixture readiness deadline while testing self-opened authority), 379.94 s. Exact failure output is retained in phone-reconcile-harness-first-attempt.log. The named startup log server-1793755339934-34300.log was inspected and empty. The first run overlapped owner tests/typechecks/build; vite.config.ts explicitly disables parallel fixture files to avoid load-sensitive flakes. Load is a plausible contributor, not a proven root cause. The whole unchanged 23-file harness was rerun alone with no timeout, test or product changes. A subsequent pass establishes the recorded rerun, not absence of intermittent transport risk. Both attempts remain in evidence and are not added together.

Exact runnable commands and sanitized child environment are in each log header and `verify-phone-reconciliation.ps1` in the task handoff folder. Hermes bridge override variables were cleared in child test shells only. Fixture providers/homes/databases are disposable; no billable model/customer calls. Logs were normalized from PowerShell mixed UTF-8/UTF-16 append encoding to readable UTF-8 after completion; outputs and exits were preserved.

Preparation diagnostics: an unqualified `git status --short` failed because Git was absent from the shell PATH; subsequent Git commands used C:/Program Files/Git/cmd/git.exe. The strict finalizer initially rejected the EOF edit: apply_patch had also converted its terminal CRLF to LF (before 1,195 bytes; edited 1,192; expected 1,193). check-phone-eof.mjs restored exactly the original bytes minus the one extra CRLF. A second finalizer rejection came from comparing a sorted discovered path list with an unsorted expected list; sorting both corrected the verification script. No product behavior, limits, tests or permissions were changed for either guard. All final provenance/patch checks then passed.

## Provenance and reproducibility

Final combined source patch: `chief-integrated-source-2026-11-03.patch`, SHA-256 `9d4af71696c3838ba2439e4acfe3884783898e900c42d23c9ff9d79ddb4d6ba0`; 69 source/doc/test paths.
Phone-only correction: `phone-reconciliation.patch`, SHA-256 `20f79cc3cf0c2910a6b23b74b33f89a2fa1e6b3f7585908478b923ce93dd2fe2`, exactly the three paths above.
Prior source patch preserved as `chief-integrated-source-before-phone-reconcile-2026-11-03.patch`, SHA-256 `0e1cc1613ecc5e4b9b336e94e828e3a7962b4190f0e66525fd06c2e59306c9b4`.
Reviewed durable-delivery patch remains unchanged: `b2a20337a5848d494c874d9936be0eef6b73e12077a33d99200e52af9ebb4edd`. Owner tracked diff: `d22499521d974c14fa124301dfaf68f4484ad9e090096daaa34707348376c348`; snapshot manifest: `e405c701aafa2d1719a55b75a18a3cd8031a964ca05d56a93258579cfea7cd21`.

All 43 captured files in the original owner checkout still match their captured hashes, HEAD and tracked diff. Forty-one owner files are byte-exact in the candidate; server/index.ts combines checked owner/delivery hunks and PhoneComputerAccessSettings.tsx has the exact authorized EOF trim. No other captured owner file changed. New-path and post-assembly assertions reject unexpected edits. Detailed per-file bytes/SHA/normalized-LF SHA, commands/log hashes and observation timestamps are in final-provenance.json.

Recreate only in a fresh empty isolated worktree at the recorded base, then `git apply --check` and `git apply` the final combined patch. It includes owner changes; never apply it over the dirty running checkout. Alternative layered reproduction: captured owner-tracked.patch + all 43 raw snapshot files, reviewed-durable-delivery.patch, test-retention-overlay.patch, then phone-reconciliation.patch. The phone overlay also applies after the preserved previous combined patch. Use existing local dependencies and the saved fixture runner. No production migration is needed to reproduce. Previous provenance/report and all failure logs are preserved under before-phone-reconcile-* for audit.

## Actual synthetic API evidence

The final harness run exercised register_task_result, scoped lookup, authenticated download and real fixture-server restart with fake providers. Failed A, delivered B, later failure/restart still retain B; cancelled requester stays stopped with no model wake, scoped/revoked access fails, and one result card reconciles. Actual downloaded packet and input transcript/SOP are retained under onboarding/ with non-secret evidence.json.
Packet: 687 bytes, SHA-256 `1fdb17ddb6583f38f9e7835c30fbe53b6a44ea550ed6d11a8c642fa523b4b089`. Owner and deadline remain unresolved; contact/publish authority absent. Fixture/real flags, host observation timestamp, test claims versus harness byte observation remain explicit. No credential/capability/config/runtime database is retained.

## Acceptance boundary, activation and rollback

Requested local reconciliation and integrated verification are complete. Bacca must obtain independent review of the phone correction and final artifacts before acceptance. No reviewer participation/clearance is claimed here. Real Electron/phone/VM GUI, live providers and full monorepo packaging were not exercised.

1. Review the three-file phone overlay and final source/evidence identities; recheck concurrent owner changes before future integration.
2. Prepare feature integration against then-current source while preserving owner phone/Hermes work. Do not apply the combined patch to the running dirty checkout.
3. Obtain the separate owner checkpoint before production integration, DB opening/migration, app restart or deployment. Use the normal approved backup/release process only after that checkpoint.
4. Result table creation is additive, without destructive migration/backfill or external-effect replay. After activation, verify through the normal app checks.

The running application needs no rollback because it was untouched. To undo this phone-only reconciliation in the isolated candidate, first check and reverse its exact overlay; retain original snapshot and reports. If feature activation is later rolled back, revert only delivery changes while preserving owner work; additive result tables can remain inert. Never drop tables, erase retained deliveries, replay sends/publishes or restart services as recovery. Hard-kill orphan-copy cleanup, room/UI/external-runtime/URL interfaces and broader retention/model continuity remain deferred.

## Historical pre-reconciliation record

The previous red report is preserved verbatim at docs/verification/evidence/integrated-durable-results/before-phone-reconcile-report.md, SHA-256 `a84eeee6127c3d989343371d2b159c96ce31abeaef82b9f18e97a107ebe63ac1`. Its pending UI/whitespace statements describe the earlier snapshot and are superseded by this final record.
