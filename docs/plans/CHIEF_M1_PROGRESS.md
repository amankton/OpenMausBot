# M1 implementation progress

Started October 9, 2026, following owner authorization after the published
foundation checkpoint `30cfcb2`. Work remains on `codex/chief-unified-platform`.
The standalone installer and existing runtime data remain separate.

Implementation order:

- [x] CON-01 (local deployment): persistent pairing service, member identity verification,
  two-sided approval, scoped capabilities and revocation.
- [x] CON-01 acceptance (local and isolated fixtures): two members, two workspaces, replay/expiry, account
  switching, logout, membership removal, restart and concurrency.
- [ ] CON-02: fail-closed server entitlement adapter with explicitly labelled
  fixture policies; no invented commercial feature allocation.
- [ ] RUN-01/03: durable assignments/outbox, leases, fencing, bounded retries,
  cancellation and effect reconciliation.
- [ ] RUN-02: personal runtime adapter and real specialist execution with parent
  context and a returned artifact. Deterministic fixtures are not live evidence.
- [ ] UI-01: explicit pairing approval, dispatch scope preview, status, result
  and owner-only conversation link.
- [ ] Live M1 acceptance and separately verified rollout.

October 10 owner clarification for the remaining work: Chief will hold the full
Agency and decision-agent roster, with selective workspace participation. See
[full roster and selective participation](CHIEF_SHARED_WORKSPACE_IMPLEMENTATION.md#full-agent-roster-and-selective-workspace-participation).
CON-02/UI-01 must separate roster availability, approved resource/action grants
and active execution, and allow grant updates without repeating runtime pairing.
RUN-02/PRJ-01 must support authorized operations against the existing workspace
projects, issues, cards and tasks. Game development is the owner's example;
verification must use synthetic project records. These capabilities are pending.

First implementation boundary: `integrations/platform/lifecycle`, isolated from
the retained checkout and personal server. Use Cockroach-compatible transactions
and a dedicated schema, as selected in the Stage 0 storage ADR. Exercise initial
migrations in a disposable database. Do not migrate the owner's active database
or enable dispatch in the deployed workspace during development verification.

Pairing requires both authenticated member confirmation and runtime key proof.
A copied pairing challenge must not silently activate someone else's runtime.
Credentials stay outside shared artifacts; stored member credentials, if needed
for current membership checks, belong in an encrypted service-only boundary.

Current status: implementation in progress; no M1 completion or deployment claim.

Verified backend foundation (October 9): the disposable CockroachDB integration
suite passes with a restricted SQL service role and read-only identity checks
against three synthetic Platform members (two in one workspace, one in another).
Evidence: `../verification/evidence/chief-member-pairing.json`. Tests cover signed
pairing, initiating-session confirmation, concurrent challenge consumption,
member/workspace isolation, request replay, scope/key/time/generation checks,
encrypted persistence, service-client restart, expiry, logout and HTTP account
switching. Membership removal and entitlement changes use explicit test doubles;
they are not live membership-removal acceptance. Five local security unit tests
also pass. The pinned image's initialization wrapper caused the fixture startup
failure; the fixture now invokes its database binary directly, publishing only
to host loopback. Session generations use explicit INT4 for numeric driver values.

October 10 CON-01 continuation:

- [x] Personal Chief runtime adapter: configured lifecycle origin, Ed25519 proof,
  explicit selected agents, private durable credentials, restart and revocation.
  Browser responses and portable workspace backups exclude private credentials.
- [x] Workspace invitation/fingerprint approval/revocation component and personal
  Chief panel. Native workbench logout and connection changes invoke the session
  boundary before clearing or replacing identity. Disabled installations preserve
  existing login behavior. A service outage blocks the transition for retry.
- [x] Real Accounts removal of the synthetic acceptance partner, exact role
  restoration, and proof that the old runtime remains revoked afterward. Confirmed
  membership loss revokes the stored session durably on its next verification;
  authority outages fail closed without permanently destroying the session.
- [x] CUA browser verification of the actual compiled Svelte/React components in
  a disposable service fixture: pending denial, matching-code approval, refresh,
  two-member switching, explicit revocation and logout. The fixture uses its own
  synthetic member controls, not the complete compiled native workbench.
- [x] 74 focused Vitest checks, 12 Node security/session-hook checks, root frontend
  and server TypeScript checks, native component compilation/accessibility, and
  all three affected native packages' build/validate commands. The package UI
  build commands report "Nothing to compile to UI"; they are not a production
  frontend build. Twelve ordered patches reconstruct 71 retained source files,
  preserving all eleven previously accepted patch hashes.

Remaining CON-01 release work: reviewed service startup/proxy configuration,
secret provisioning/rotation and database migration, the CON-02 entitlement
authority, full compiled-workbench account-switch/logout acceptance, and rollout.
Current membership is checked on requests; removal events that occur and are
reversed between checks still require event integration before stronger claims.
Multi-tab transition races and outage/rollback UX require full workbench review.
Private personal-runtime files use atomic writes and filesystem permissions, not
an OS keychain; Windows ACL and runtime tool visibility need operational review.
No shared dispatch, provider execution, live schema migration or rollout occurred.
The new pairing service remains unconfigured on the owner's runtime.

October 10 release-gate continuation (18:26 UTC container acceptance):

- [x] Built immutable lifecycle candidate
  `sha256:f6dedf270ed67464aacd56f96212e69120c64352e2c5e64b85e1c2f02c6c857d`.
  Actual non-root, read-only service container behind nginx passed isolated
  pairing/approval, member isolation, current Accounts authorization and cookie
  checks. Evidence: `../verification/evidence/chief-lifecycle-release.json`.
- [x] Separate migration/runtime SQL roles, repeat migration, denied runtime DDL
  and ledger updates, disk-backed database restart, service restart, runtime
  restart, live policy denial/recovery, malformed policy outage, proxy outage,
  offline key rotation/reverse rotation and emergency session revocation passed.
  All pre-existing running container IDs stayed unchanged; only uniquely labelled
  disposable test containers/network/volume were removed.
- [x] Added server-owned, environment-bound file entitlements. Missing policy
  denies access; expired/invalid policy fails closed. Three fixture permission
  levels are tested. This is an explicit operator grant mechanism; commercial
  tier allocation and billing integration are still undecided.
- [x] Added opt-in Compose/proxy configuration and migration/rotation/rollback
  runbook in `integrations/platform/lifecycle`. Compose validates. Production
  requires HTTPS and verified database TLS; production secret provisioning and
  actual TLS deployment remain unverified.
- [x] Added Web Locks coordination for browser session operations, including an
  invitation queued before its marker exists. Server rejects duplicate stale-cookie
  replacements: the actual proxy test produced one success and one conflict.
  The browser-lock unit tests are not full multi-tab native-workbench acceptance.
- [x] Current 19 Node checks, all three affected native package build/validate
  commands, native component compilation/accessibility, full service/runtime
  integration (including real synthetic member removal/restoration), and the
  12-patch/71-file reconstruction passed. Previously deployed patches 1–11 are
  unchanged. The unshipped patch 12 checkpoint was archived locally before refresh.
- [ ] Production frontend build: attempted with the already-approved constrained
  profile (2048 MiB heap, 4096 MiB starting headroom). It refused to start at 822 MiB
  available Windows RAM. Temporary Linux cache was released without stopping
  services, but sufficient host headroom did not return. Existing build outputs
  were untouched. Full compiled native-workbench acceptance is therefore pending.
- [ ] Authoritative membership incarnation/revocation events. Source review of
  Accounts SQL confirms `workspace_members` has no membership epoch and
  `getWorkspaceMembers` returns only person/role. Current request-time checks
  cannot distinguish a removal and re-addition entirely between checks. Add a
  durable Accounts-owned incarnation/event boundary and test this case before
  claiming revocation cannot revive. Do not use a polled Chief membership copy.
- [ ] Personal-runtime Windows ACL and model-tool boundary review remains open.

No owner schema migration, proxy reload, service enablement or deployment occurred.
CON-01 and M1 remain incomplete. The concrete next work is the Accounts-owned
revocation boundary, followed by production build/full browser acceptance when
memory permits, and the private runtime credential boundary review.

Follow-up recorded October 9, 2026: owner requested mutual awareness between the
workspace schedule/Planner and Chief Executive routines. See SCH-01 in the shared
workspace implementation plan. This depends on member-scoped connections and is
not a change to the current M1 acceptance gate.

October 10 membership-epoch checkpoint (18:54 UTC):

- Closed the removal/re-addition-between-checks gap in candidate code. Accounts owns a UUID per assignment, replaced on join and role change; unread and unchanged-role updates retain it. Lifecycle binds sessions to it, permanently revokes mismatches, and denies pending invitation completion after replacement. Missing epochs fail closed; there is no production opt-out.
- Added migration 002 without altering 001. Existing pre-epoch sessions are revoked. Migration/retry/backfill tests pass. Do not enable an older lifecycle binary as rollback after this upgrade.
- Actual Accounts candidate container authenticated RPC plus native SQL/migrations and strict lifecycle pass in disposable CockroachDB. Active Employee and outage adapters are fixtures. Receipt: docs/verification/evidence/chief-membership-epochs-container.json.
- Accounts image: sha256:ab29a21385208a501394eb0a91efebb467c593c39909751ec0c68d1f1abac692. Lifecycle image: sha256:892862ae149d4cfa1013f3ec9ba2b4bc0be4b00cd5fc58486829baae2de0b7b2.
- 45 native Accounts tests and 21 Node checks pass; Accounts package build/type validation and bundle pass. Missing local dependency declarations/workspace links were regenerated without manifest/lock changes. The separate Accounts patch and provenance are saved. The 12 frontend patches still reconstruct 71 source files unchanged.
- Full upgraded Accounts/lifecycle/proxy/native-workbench acceptance remains. Previous pre-epoch release evidence does not certify the new image. The release runner now requires epoch-enabled staging Accounts and refuses the owner's old authority before creating resources. The legacy pairing runner explicitly excludes epoch acceptance.
- Full frontend build is still memory-blocked: latest 931,724 KiB available (about 0.89 GiB) versus the approved 4096 MiB start requirement. No repeated build or owner service shutdown was attempted at that level.
- Credential review: the latest Windows fixture key has no Everyone/Authenticated Users/Users allow ACEs, but ACL inheritance is enabled. Mode 0600, backup exclusions and safe API responses do not isolate secrets from processes using the same OS account. This boundary review remains open.

All existing running containers and owner data were preserved; owned test containers were removed. No live migration, proxy reload, deployment, commit or push. CON-01/M1 remain incomplete.

October 10 credential and combined-service checkpoint (19:05 UTC; supersedes the open credential/container items above):

- Personal runtime credentials now live in `.chief-pairing-private` beneath the runtime data directory. Windows startup establishes and verifies a protected DACL limited to the owner and SYSTEM before writing credentials; fresh atomic files inherit it. Unix uses 0700/0600. Existing identity files migrate by rename after validation, with no replacement keys or parent-directory permission changes. Conflicting stores, junctions/symlinks and hard-linked files fail closed. The private directory and legacy credential path are excluded from portable backup export/import.
- This is an OS-account boundary, not isolation from arbitrary code executed as that owner. The current owner-only adapter never exports keys or workspace JWTs through its API. Shared specialist execution still requires a constrained worker boundary; no shared dispatch was enabled.
- The actual epoch-enabled Accounts and lifecycle images now pass together behind nginx. The new `--release-image` epoch fixture creates synthetic signed members and an explicit Employee lookup stub, then runs the full container suite against disposable databases. Pairing/approval, member isolation, restart persistence, restricted SQL roles, live policy denial/recovery, proxy outage, key rotation/reversal, concurrent session replacement and emergency revocation pass. Receipt: `docs/verification/evidence/chief-lifecycle-epochs-release.json`. The previous pre-epoch receipt remains historical.
- 57 focused Vitest checks pass, with one existing platform-specific atomic-write test skipped on Windows. The 21 lifecycle/native-session Node checks pass. Server TypeScript validation passes. Test resources were ownership-checked and removed; all pre-existing running container IDs were unchanged.
- Still pending: full compiled native-workbench multi-tab/account-switch/logout/outage acceptance, deployment secret/TLS provisioning and rollout. Windows free memory remains below the already-approved 4096 MiB frontend-build start requirement, so another build was not attempted. No live changes, commit or push occurred. CON-01 and M1 remain incomplete; real specialist assignment/recovery follows pairing acceptance.

October 10 19:16 UTC build retry after owner requested closing Gmail Ninja: stopped port3100 Next.js server and its Crewframe G Ninja scheduled-task watcher (current run only; startup configuration retained), after discovering that the watcher automatically restarted the first stopped child. Port3100 verified closed. Preserved previous frontend dist/receipt in .chief-local/m1-pairing/pre-build-e4c12aa9-13a9-4227-b9d8-e208d7632892. Retried approved constrained build unchanged (2048MiB old-space,4096MiB start,1280MiB runtime guard). First webpack configuration passed; main reached50percent/RSS1815MiB, then guard exited when host free memory measured996MiB. Log .chief-local/platform-build-logs/m1-frontend-build.log. No new successful build receipt or deployment. Runtime data/services unchanged except user-requested Gmail Ninja shutdown. Previous successful build receipt measured compiler peak2519MiB and minimum hostfree2055MiB; these are measurements, not a proven required minimum. Native full-browser gate remains pending.

October 10 successful build checkpoint after Gmail Ninja shutdown: its Windows task had a one-minute recurring trigger and restart policy, so stopping only the running watcher did not keep it closed. With the user's close request, exported the original task definition to work/gmail-ninja-task-before-stop.xml, disabled task Crewframe G Ninja, stopped its verified watcher/Next.js process tree, and verified port3100 closed and task Disabled. It can be restored explicitly with Enable-ScheduledTask -TaskName 'Crewframe G Ninja'; do not silently re-enable it. Retried the unchanged approved constrained build: both production webpack configurations now passed, source hashes stayed stable and a fresh production-build-receipt.json was written. Previous dist/receipt remain preserved in pre-build-e4c12aa9-13a9-4227-b9d8-e208d7632892. No live frontend/service deployment occurred. Memory is no longer the current build blocker; next gates are full compiled native-workbench browser acceptance and deployment configuration/rollout.

October 10 local deployment completed (19:40 UTC): owner selected current local workspace and authorized isolated Playwright release tests. Both frontend configurations and all five current-build release gates passed. Full compiled workbench test caught and fixed Settings sign-out navigating before revocation; outage/retry now passes. Frontend 04e556fd..., Accounts ab29a213..., lifecycle 892862ae... are deployed. Deployed synthetic browser acceptance uses actual Accounts epochs and active Employee lookup with no authority stubs; pairing, reload, member isolation, same-browser account switch, stale tab and logout pass. Embedded playback also passes deployed. All original persistent mounts and the other 15 original container IDs preserved; one separate private lifecycle service added. Fresh Cockroach pre-migration backup and private copy retained. Personal preview restarted with pairing enabled, same data/provider home and all nine bots. Operator policy is owner/synthetic-only, workspace:read, expires November9; no owner pairing or specialist dispatch automatically performed. Local CON-01 complete; CON-02 and RUN-01/02/03, UI run-status, full M1 and Google Cloud/TLS remain pending. See docs/verification/chief-con01-local-deployment.md and evidence/chief-con01-deployed.json. No commit/push.
Final deployed iframe check also passed (19:44 UTC): the cross-site sandboxed workspace stores the Secure partitioned Chief session, retains pairing through outer-page reload, and revokes the signed runtime on sign-out. This uses actual deployed authority and synthetic members. See the updated chief-con01-deployed.json receipt.

October 10 roster import completed (19:59 UTC): owner requested OpenMaus roster port and explicitly selected ChatGPT/Codex except Claude for Design. Added 176 Agency + 5 Decision Council agents in 16 sections through additive team import; preserved all original 9 Chief agents, total190. Names/titles/descriptions/standing instructions/colors/sections and15 division chiefs verified. 174 imported agents use chatgpt/gpt-6.1-sol;7 Design agents use a new Claude Design Division instance with the installed real Claude CLI and existing owner login (claude-sonnet-5), without copying credentials. Existing test-Claude entry and other config preserved. Imported agents use Ask, connected apps disabled; no messages sent or shared workspace grants added. Pairing and policy hashes unchanged. Synthetic181-agent import/repeat test passed; live API/disk readback and separate browser roster inspection passed. Recovery snapshot .chief-local/recovery/2026-10-10T19-58-46-408Z (database quick_check passed). Import receipt .chief-local/roster-import-2026-10-10/result.json; helper work/import-openmaus-roster.ts. Existing installed desktop baseline unchanged. No rebuild/deploy/commit/push. CON-02 and real dispatch remain pending.

October10 owner model correction: imported roster uses GPT-6.1-Sol for174 non-Design agents and Claude Opus5.5 (claude-opus-5-5) for all7 Design agents, superseding initial Sonnet5 selection. Applied through existing API; saved-model readback passes; all other agents unchanged. Evidence: .chief-local/roster-import-2026-10-10/model-correction.json. No provider task executed.

October 10 commit checkpoint: local CON-01 deployment is complete; full M1 still requires CON-02 entitlement integration and real specialist execution/recovery. Imported roster and provider credentials remain in local runtime storage. Windows sign-in startup is configured and verified without a reboot. Agent search now belongs inside Connect personal Chief > Agents to connect, with selections retained across searches; the earlier conversation-navigation search was removed following the owner's correction. Current checks: 80 focused Vitest tests, 22 lifecycle/session/overlay Node tests, frontend/server TypeScript, native pairing component checks, and reconstruction of all 12 frontend patches pass. Runtime data, credentials, scratch files and unreviewed screenshots are excluded from this checkpoint. Platform patch files preserve exact bytes in Git to retain verified provenance hashes.
