# Chief member-scoped Huly Tracker tools — 2026-10-21

Status: implementation and isolated integration verification passed; deployed locally. Owner-approved Tracker pairing is active. Bacca's Chief task created LEARN-1 in the existing owner project; independent Huly browser readback and reload verified persistence.

## Implemented scope

Chief can explicitly request Tracker read/write access for selected agents through the existing two-sided member pairing flow. Existing connections are unchanged. Pending selection is Solo - Chief and Bacca - Chief, in `chiefexecutivesuite`, with `workspace:read`, `tracker:read`, and `tracker:write`.

New MCP tools list connections, find projects/issues, read a saved issue, create an issue in an existing project, and update title/status. There is no deletion, project creation, moving, membership, permission, arbitrary endpoint, or description update tool. Credentials remain in the lifecycle vault and never enter agent prompts or tool responses.

Each operation binds its arguments into the signed request and checks the paired bot, scopes, current member session, membership epoch, policy, and project access. Writes use a durable request ledger and deterministic object ID. Repeated and uncertain requests cannot silently create a second issue. Access is revocable and remains subject to the existing session expiration policy.

## Fresh verification

- Lifecycle/security tests: 15 passed.
- Focused pairing runtime, routes, and UI tests: 24 passed after correcting checkbox selectors for the added grant option.
- Server TypeScript and complete TypeScript build passed.
- Packaged server build and smoke checks passed, including all 14 proxy paths.
- Native Chief UI compiled and published with retained content-hashed assets.
- Isolated Chief server fixture completed a fake-provider conversation and doctor checks; no owner conversations used as fixtures.
- Real synthetic Huly member integration verified Transactor and Collaborator creation, persisted description, restart/repeat deduplication, packaged MCP broker mounting, private-project/member/bot separation, policy removal, authorized update, signature tampering rejection, uncertain-response recovery, and logout revocation.

Exact synthetic receipt: `.chief-local/m1-pairing/tracker-fixture-0CGyad/receipt.json`. The synthetic workspace is separate from the owner workspace. Its clearly named test records remain for inspection.

## Local deployment and preservation

Lifecycle image: `sha256:9c5bc5536d403e4c7ba4c5a1be8376fb3dcbb71b75a7ce97baeae4f04cb5a25a`.

Database backup, prior compose/policy, and rollout receipt: `.chief-local/m1-pairing/pre-tracker-1792594084431/`. The additive Tracker ledger was migrated with the dedicated migration role. Only the lifecycle container was recreated; all 17 original platform containers remained present/running. Nginx was reloaded to resolve the replacement lifecycle container address after an initial stale-upstream failure.

Chief native server was gracefully restarted after checking idle turns and copying private data snapshots. Bot/config hashes and data directory were preserved. Recovery copy: `.chief-local/m1-pairing/native-pre-tracker-1792594131763/`. UI remains on port 5299. WSL, Hermes profiles and unrelated applications were left alone.

Compatibility rollback uses the new lifecycle image with Tracker configuration disabled and the prior eligibility policy restored. The old binary cannot be substituted directly after the additive schema ledger advances. No database restore was performed.

## Actual owner workflow — verified

Owner explicitly confirmed the Tracker read/write grant. An earlier approval had connected only a separate read-only pairing while the intended Tracker record was revoked; neither was silently upgraded. A fresh exact Tracker request was confirmed, and Chief checked its active state. Connection `cac99701-9fb0-45c7-86a9-9ba9c75cb07b` expires 2026-10-21 19:57:19 America/Los_Angeles. Selected agents are Solo - Chief and Bacca - Chief. Native provider approvals remain enforced; the owner authorized only the exact test actions once.

Target project: `LEARNING CHIEF WORKSPACE`, ID `6ad66f922b70fd2da0dec246`.

Target title: `TEST: Crewframe to Chief real-work verification 2026-10-21`.

Target description: `Owner-authorized end-to-end test: Crewframe Bacca delegated through Chief to create this saved Huly issue. Verification marker: CREWFRAME_HULY_REAL_WORK_20261021. Leave this issue in place for owner inspection.`

Crewframe Bacca dispatched exactly one new task to Solo - Chief through Crewframe Gateway. Task ID: `069d4c93-e0e3-4030-8c73-5446a062ae38`; delegation key: `2f88c787-7e8d-42a8-9a6d-3248ce9c1010`; delegation request: `cd3f8cb5-536d-449f-b863-90e706ec45fc`; stable Huly write request: `e13052f8-9578-4d26-9a58-d6251e942f76`.

Solo used native `huly_projects`, `huly_issues`, `huly_create_issue`, and a separate `huly_issue` readback. Result: issue ID `34e7c3ecf5c6439999a4fcf1`, identifier **LEARN-1**, URL `http://localhost:18087/workbench/chiefexecutivesuite/tracker/LEARN-1`. Existing project display name is Learning Chief Workspace (sidebar LEARNING CHIEF WORKSPACE); ID matches the requested project. The project's configured default status is In Progress. No assignee or due date was added.

Independent owner-browser verification found the issue under that project, exact title and marker description, creator attributed to the paired member, no assignee/due date, and persisted content after reload. Screenshot: `.chief-local/m1-pairing/tracker-LEARN-1-persisted.jpg`. The issue remains for owner inspection.

Discovery, health checks, transport completion, and synthetic fixture success were not counted as owner workflow completion. The earlier owner task ended blocked without creating an issue; that remains historical evidence rather than a passing result.

## Approval UX follow-up

Owner requested color coding and less complicated interaction after confusion between approve/revoke and repeated old records. Deployed changes use a green primary approval, red revoke action separated under Manage connection, plain-language access descriptions, and collapsed inactive history. Native Chief uses its theme primary action and red local removal controls. Current approval policy is unchanged.

The actual Svelte component passed compilation/accessibility and isolated synthetic approval interaction, including the disabled-before-confirmed control and successful transition to Connected. Synthetic evidence: `.chief-local/m1-pairing/pairing-ui/browser-receipt.json` and `approval-green.jpg`. Session regression tests: 9 passed. Native component tests: 3 passed; native UI production build passed.

The first full Huly production build stopped at the existing 2 GiB running host-memory floor; no failed build was deployed. The existing constrained 2048 MiB heap profile then completed both production configurations with the built-in resource guard and without shutting down user apps. Receipt: `.chief-local/platform-build-logs/production-build-receipt.json`, completed 2026-10-21T15:04:30.793Z.

Scoped image builder `scripts/build-chief-pairing-ui-delta.mjs` proves that exactly one source input changed (ChiefPairing.svelte) and exactly six production assets differ (settings chunk, runtime hash reference, index, and gzip copies). The main runtime differs only in the changed settings chunk hash; index differs only in its runtime filename. It layers those six assets onto the verified running frontend image, retaining every other asset and the server bundle byte-for-byte, as well as old content-hashed assets. Prior media/capture/template evidence is inherited for unchanged assets, not claimed as fresh tests.

Deployed frontend image: `sha256:0dd859994dbb82ed38d80437cb031d88ea5c8facd832e8c4f9d8e198e595729b`. Existing frontend-only rollout validated the exact candidate Compose change, retained all persistent mounts and all 16 other platform containers, and retained rollback configuration. Receipt: `docs/verification/evidence/chief-branding-rollout.json`.

Live Huly browser reload verified the readable permission descriptions, green primary action, three collapsed old connections, and red revoke control only under expanded Manage connection. No live revoke or additional grant was performed for UI verification. Screenshot: `.chief-local/m1-pairing/pairing-ui/deployed-manage.jpg`. Live native Chief pairing panel verified the active Tracker connection and collapsed previous entries.

Latest native UI publish: 2026-10-21T15:08:05.330Z, source hash `97acf7200c091ba1b7fdc43edbf09df76d4433c84348d562814cbdaaed7f8174`. The existing Check/Forget controls remain available under connection history. The isolated UI fixture process was stopped after testing. On a fresh native shared-workspace load, the existing intermittent blank iframe reappeared; one Reload workspace restored Huly with the updated settings screen. This UI rollout does not establish a fix for that browser navigation cause.
