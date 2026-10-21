# Chief compatible update record — October 11, 2026

Owner request: latest official OpenMaus updates that do not interfere with Chief customization.

## Source and scope

Official release: [v0.1.107](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.107), published October 10, 2026; commit `978993c84e2ec17144fcf46e7bfa1e04c9f32a4b`.

Chief committed baseline: `7a33fa5`, branch `codex/chief-unified-platform`, plus existing local work. Candidate checkout: sibling directory `chief-upstream-compat`. The application-managed worktree tool could not resolve the reference for this nested repository, so an isolated native Git worktree was used. The candidate has no production runtime data.

The whole upstream-to-Chief diff spans 895 files in server, companion, Electron and UI. This operation backports four reviewed fixes; it does not claim complete v0.1.107 parity. Chief's displayed package version remains 0.1.96. The patch and this record identify the additional content.

| Upstream commit | Included behavior |
| --- | --- |
| `a0ae1e1af1172c444129b945328c120b41aa355c` | Refuse writes that would overwrite unreadable routines/webhooks storage with empty state. |
| `1c7ee1615a30eff194fc4c14f974ca9f1b97a77e` | Preserve stored routines with invalid schedules instead of silently deleting them on a later save. |
| `01109fb4cada309d182bc946bbfb3993f3cddbbe` | Refresh signed-in MCP server tokens concurrently before a turn. |
| `b2476bbf6f7957d24baf5b993dc4c85a080a3a23` | Distinguish a missing working folder from a missing provider executable. |

Twelve source/test files changed in `server`: routines, webhooks, MCP OAuth, process errors, and four driver call sites. Resolved the webhook field conflict without importing an unrelated bad-secret aggregation feature. Combined new process-error tests with Chief's existing Windows launch tests. Corrected one stale routine-test expectation to Chief's product name; the runtime branding was already correct.

Deferred: upstream UI/sidebars/composer, updater interface/feed, data viewer and other feature/dependency migrations, memory/ACP architectural changes, full release integration, native desktop installer rebuild/distribution, Platform image rebuilds and native mobile distribution. These are not declared incompatible forever; their customization and dependency effects have not been validated by this batch. Do not label them installed.

## Validation

- Isolated candidate: 228 focused tests passed across routines, webhooks, MCP OAuth, process handling, server/UI branding and analytics.
- Candidate type checking, focused lint, and six package-policy tests passed.
- Candidate isolated phone fixture passed: synthetic pairing, authenticated roster, denied anonymous access and denied owner controls.
- Actual source tree after patch: the same 228 tests passed; type checking and six package-policy tests passed alongside existing local modifications.
- Actual source tree's isolated phone/gateway fixture passed Host/Origin/CSRF/rate controls, authenticated private-pipe access, endpoint refresh/withdrawal and fail-closed behavior.
- Documentation links/fences were checked. No live chat was used for mutation testing.

## Deployment and recovery

The reviewed patch was applied to the primary source tree after `git apply --check`; these twelve target files had no pre-existing tracked edits. Other local changes were retained. A private recovery snapshot was created under `.chief-local/recovery/2026-10-12T02-40-27-570Z`; the UTC directory timestamp falls on October 11 in America/Los_Angeles. SQLite backup integrity passed. The snapshot covers this source workspace; it is not a blanket backup of every installed desktop or Platform service.

Patch and pre-restart hashes are under `.chief-local/updates/openmaus-v0.1.107-compatible`, protected for the owner and SYSTEM. That folder also contains the private phone-registry recovery copy; do not share or commit it.

Only the owned `Chief Local Workspace` task is restarted after activity and process/task ownership checks. The existing phone supervisor follows the backend's new port. No Platform containers are restarted and no desktop installer is replaced. Final readiness and preservation readback is recorded in [the deployment receipt](../verification/evidence/chief-upstream-compatible-20261011.json); inspect its booleans before claiming deployment success.

To roll back these source backports, wait for idle, verify ownership and unchanged patch-target files, run `git apply --reverse --check` against the private patch, then reverse only that patch and restart the owned source runtime. Do not use `git reset --hard`. No schema migration is introduced by this batch. Restore a data backup only if necessary and after assessing newer writes; reversing source does not require replacing healthy live data.

No standalone installer or other computer has been updated by this record. Cellular messaging should be retested by the owner after deployment; local fixture/health checks do not substitute for it.

Final deployment readback passed: new backend PID, same data directory, unchanged bots/config/device-registry hashes, one paired phone, the expected MagicDNS name, UI HTTP 200 and healthy companion. No source commit or remote push was created. The candidate worktree and reversible local patch are retained for review.
