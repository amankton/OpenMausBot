# Chief Stage 0 audit completion

Later October 9 update: the branding recommendation at the end of this historical
audit was subsequently authorized and deployed, followed by navigation and login
persistence fixes. See `../verification/chief-login-icon-title.md` and
`../verification/chief-session-persistence.md`. Image/patch counts in this audit
describe its earlier baseline; M1 remains the next implementation milestone.

October 9, 2026. Stage 0's **baseline and build-map gate is complete**, with the implementation and release gaps below explicitly retained. This is not shared-platform lifecycle acceptance, a security certification, or distribution clearance. Member pairing and live specialist dispatch remain M1 work.

Read alongside [the implementation plan](CHIEF_SHARED_WORKSPACE_IMPLEMENTATION.md), [the original bounded audit](CHIEF_CAPABILITY_AUDIT_2026-10-09.md), and [the canonical schema/API/worker design](../architecture/chief-stage0-contracts.md). The original audit's observations remain historical evidence; this report supplies its missing Stage 0 mapping.

## Completion checklist

| Package | Completed evidence | Qualification |
| --- | --- | --- |
| AUD-01 repository inventory | Chief/source revisions, instructions, submodules, source-change hashes, baseline test commands and installed/source distinction | No existing edits, source patches, installer branch or runtime data reset |
| AUD-02 capability map | Updated classifications below and all 15 lifecycle acceptance criteria mapped | Live provider/media/load acceptance remains pending |
| AUD-03 contracts | Concrete schema, API/auth flow, canonical ownership, member connection, run envelope, storage/worker ADR and migration/recovery design | Design only; no new service or migration applied |
| AUD-04 distribution inventory | 17 image identities, base lock comparison, local receipt correspondence, eight-patch reconstruction, source/installed package manifest and notice inventory | Missing binary attestations and distribution SBOM are release blockers, not silently marked verified |
| AUD-05 baseline fixtures | Two actual disposable Chief servers; distinct synthetic members/bots/files; fake agent execution; actual capture routes across two synthetic Platform workspaces; existing fake-media/recording tests | Retained Accounts/transactor/RTC are mocked in capture fixture; no live two-tenant Platform qualification or member-to-agent binding claimed |

## Preserved baseline

- Chief branch: `codex/chief-unified-platform`, HEAD `45cf3e6fc77330c3097b3db753ef713a3a07105f`.
- Separate installer baseline: `codex/chief-executive-suite`, `139a1de48749b6cf1d45e98212063791a8c73011`. Neither branch was switched, committed, pushed or reset by this audit.
- Remotes: `chief` is the owner's `amankton/OpenMausBot`; `origin` is upstream `milind-soni/OpenMausBot`. No publishing.
- Chief package `0.1.96`; verification used Node `v24.21.0`, pnpm `10.33.0`.
- Retained source HEAD `03b7aad7dc562f4f9769c51a4df08191a0393997`; 56 pre-existing status entries, including staged additions, modified dependency lock and untracked capture files. Their inventoried bytes remained unchanged through verification.
- Instructions inventoried: root `AGENTS.md`, `apps/docs/AGENTS.md`, `.chief-local/platform-source/AGENTS.md`. Parent directories checked had no additional AGENTS.md. No populated submodules: Chief submodule status empty; retained `.gitmodules` and submodule status empty. The retained source is an independent ignored checkout, not a Chief git submodule.
- The desktop, source preview and 17-container `chief-platform` deployment are different surfaces. Container inspection was read-only and restricted to identity/status/provenance labels; no credentials, environment values or owner records were read. No runtime restart, install build or migration performed.
- Existing untracked `.validate/` and verification evidence remain in place. New changes are audit docs, inventory/fixture scripts and one isolation test. Production application code remains unchanged.

## Capability classification after mapping

| Capability | Classification | Evidence and next boundary |
| --- | --- | --- |
| Personal agents, tasks, files | Verified in isolated current server | Real fake-engine turns, persisted bots, synthetic text/image uploads and byte readback; distinct data directories and cross-runtime isolation |
| Personal request auth/visibility | Focused tests passing | request-auth, bot-visibility, office route tests; not retained Platform membership |
| Shared host entry | Verified narrow implementation | GET-only local-owner host boundary; no member dispatch or credential exchange |
| Retained identity/projects/tasks | Source-mapped; deployed integration untested this run | Accounts membership; Space/TypedSpace; Tracker Project/Issue; permission-checked transaction APIs |
| Retained files and versioning | Partial primitives | Attachment/Blob, Card VersionableDoc, DocumentSnapshot; no proven Chief immutable acceptance/promotion protocol. File adapter must check parent ACL. |
| Member-to-personal-agent connection | Absent at inspected boundary | Revocable pairing contract designed; no connection or dispatch endpoint implemented |
| Shared durable execution | Absent as complete feature | CockroachDB lifecycle schema and SQL worker selected; lease/outbox/effect reconciliation not implemented |
| Capture consent/auth/recovery | Verified in synthetic tests | Existing actual engine/routes, plus two-workspace collision/revocation case. Single global worker slot; Accounts/record ACL/RTC synthetic. |
| Meeting media/recording/playback | Partial; broader fixture tests pass | 164 Platform tests cover consent, recording/cancellation, playback helpers and deployment invariants. Previous rollout evidence contains historical playback proof; no new live devices/media session. |
| Meeting import | Verified focused component behavior | Reviewed selection appends private draft; not a confirmed project decision or automatic dispatch |
| Agency / Jev | Existing routing, live dispatch unverified | Preserve custom agents and Jev. Catalog/router does not establish execution or parent context. |
| Decisions, impact plans, revisions, approval invalidation | Missing integrated lifecycle | Ownership/contracts written; M2–M4 acceptance pending |
| Commercial entitlements | Partial business definition | Agency included in $5K program; other tier allocations unresolved. Distinct from three product configurations. |
| Customer memory/email isolation | Not accepted | Never ship owner's memory connection/credentials; requires customer-specific provisioning and tests |

Important source findings: regular members must use the permission-checked transaction route, not low-level system CRUD; Person IDs must not be confused with AccountUuid or bot IDs; raw file workspace validation is not proof of parent-document access; existing versioning is not a Chief approval/confirmation state machine. Exact paths and fields are in the contracts document.

## Verification results

| Check | Result |
| --- | --- |
| Nine selected Vitest files (command below) | **138 passed, 1 pre-existing failure** |
| Existing `integrations/platform/*.test.mjs` and `patches/*.test.mjs` at start of this continuation | **164 passed** |
| New `integrations/platform/stage0-isolation.test.mjs` | **1 passed**, cross-workspace read/consent/delete/history and credential boundaries, revocation/ACL change, disk reload |
| `scripts/verify-chief-stage0.ts` | **8 named checks passed** across two real isolated Chief servers; both servers cleaned up successfully |
| `pnpm typecheck` | Passed |
| oxlint on all three new scripts/tests | Passed, no warnings |
| Frontend patch reconstruction | Passed, eight ordered patches, 56 files |
| Retained source modification hashes before/after | Unchanged |

Total selected unit/route/deployment tests: **303 passed, 1 known failure**, plus the eight end-to-end fixture assertions. The failure remains `server/chief-of-staff.test.ts:87`: its exact prompt expects “OpenMausBot” where current implementation says “Chief Executive Suite”. This audit reproduced and preserved it; it is not a newly introduced runtime failure. Correct the expectation in the branding change after confirming the intended product wording.

The new fixture initially assumed the upload response returned a URL and that text files used the image attachment route. Inspection established the real contract: `/api/files` returns a local path, and `/api/attachments/:name` serves allowed images/audio. The fixture now checks text bytes in its own temporary directory and tests HTTP download with a synthetic one-pixel PNG. No production change was needed.

The capture fixture first encountered the service's intentional global busy response. It now asserts that second request returns 409, stops the first pending session, then checks two persisted tenant histories with identical meeting/person IDs. This records a capacity limitation rather than hiding it.

Not run: full `pnpm test` (broker/Electron/package suites), a new production build, installer upgrades, retained service rebuilds, real paid provider delegation, deployed two-tenant CRUD/file/search tests, live device/video/transcription, load testing or release packaging. Stage 0 baseline tests do not replace those later gates.

## Reproduction and evidence

Run from the repository root with its existing dependencies. No live URL is accepted by the new fixture; it launches and closes only its own randomly allocated servers and temporary data. The Platform boundary test uses installed Express from the retained Love source checkout, but loads the tracked capture source snapshot, whose hashes match the inspected source. Missing retained dependencies should fail setup, not silently contact a live service.

```powershell
node scripts/audit-chief-stage0.mjs
node --experimental-strip-types scripts/verify-chief-stage0.ts
node --test integrations/platform/stage0-isolation.test.mjs
node --test integrations/platform/*.test.mjs integrations/platform/patches/*.test.mjs
pnpm exec vitest run server/routes/shared-workspace.test.ts src/components/MeetingReviewImport.test.ts server/office-media.test.ts server/independent-task-store.test.ts server/chief-of-staff.test.ts server/request-auth.test.ts server/bot-visibility.test.ts server/routes/office.test.ts server/office.test.ts
pnpm typecheck
pnpm exec oxlint --deny-warnings scripts/audit-chief-stage0.mjs scripts/verify-chief-stage0.ts integrations/platform/stage0-isolation.test.mjs
node integrations/platform/patches/verify-frontend-patch-stack.mjs
```

Generated evidence under `work/`: `chief-stage0-inventory.json`, `chief-stage0-two-workspace.json`, `chief-stage0-capture-isolation.log`, `chief-stage0-platform-tests.log`, `chief-stage0-vitest.log`, `chief-stage0-typecheck.log`, `chief-stage0-patch-stack.json`. The Platform suite count on a future combined run is 165 because the new isolation file is now included. The fixture receipt retains its exact synthetic transcripts and launcher log locations; credentials are not serialized. Outputs are also copied to this chat's deliverables folder.

## Source, image and notice provenance

`integrations/platform/upstream/source.json` pins selfhost revision `42fdd73311843cea76fb7f9dade9d7397b358368`. All three recorded SHA-256s (compose, nginx source, LICENSE) match. The runtime contains 17 running services: 12 match base RepoDigests, front/transactor/workspace replace base images, Love is an added custom image, and LiveKit is separately pinned in meetings.compose.json.

| Custom image | Current image ID | Corresponding prior local receipt |
| --- | --- | --- |
| front | `sha256:ba0a3ac0c9908c2cef8d1068da62ec466539fa03f206e0e90a088e1437dce828` | `docs/verification/evidence/chief-embedded-playback-rollout.json` |
| love | `sha256:9507248f82c2402c40fe679f622c7c1533774c9f7e0d99384f0551edef14aaa9` | `docs/verification/evidence/chief-platform-capture-rollout.json` |
| transactor | `sha256:8d115eaa4250e3efff4399998171256274ff2bbd0a754a86e21151ff0a37ac64` | `docs/verification/evidence/platform-meeting-repair-build.json` |
| workspace | `sha256:1b6c679990a88306500467b08411b83f4acbd5959b25d5abe4e0e03a5b1e59ff` | Same repair-build receipt |

All four custom images expose the pinned Platform revision label. This plus local receipts establishes local traceability, **not** an independent build attestation or proof all bytes derive only from that revision. Eight-patch source reconstruction validates reviewed modified source, not image reproducibility. The modified retained lockfile is included in the source-change hash inventory and was preserved.

Distribution inventory findings:

- Chief root declares Apache-2.0. Retained source and selfhost integration carry EPL-2.0; preserve all inherited notices and modification/source records.
- 508 tracked retained package manifests: 397 declare EPL-2.0, 110 omit the license field, and `services/rekoni/package.json` declares UNLICENSED. Do not infer missing declarations are permissive or treat the root license as a completed resolution of the Rekoni manifest conflict.
- 844 installed Chief dependency package/version entries inventoried, including development/transitive packages. These are the installed package inventory, not the exact contents of a shipped installer or browser bundle. `khroma` has no singular license field; `qrcode-terminal` uses the legacy `licenses` array (Apache 2.0). Resolve actual notices and distribution closure during release review.
- WebM duration repair has a separate pinned dependency manifest for `@fix-webm-duration/fix` and parser 1.0.1, with retained MIT license text at `patches/FIX_WEBM_DURATION_LICENSE.txt`.
- Containers such as CockroachDB, Redpanda, storage, Elasticsearch, LiveKit and Rekoni need their own image-level dependency/notice inventory. Their release names or root Chief license do not settle licensing for the image contents.
- Browser JS/CSS/assets, native installer payloads and redistributed container layers are distinct delivery surfaces. Prepare the actual shipped-file inventory, notices and corresponding source/build material for applicable components before distribution. This is a source/provenance inventory, not a legal determination.

Release gaps remain: reproducible binary/source correspondence, full image and installer SBOMs, license/notice resolution for exceptions and modified dependency resolution, and qualified distribution review. None required altering or inspecting owner runtime records during Stage 0.

## Source-handoff acceptance mapping

| # | Required outcome | Current evidence/status | Implementation gate |
| --- | --- | --- | --- |
| 1 | Confirm versioned project brief | Schema map only | PRJ-01/BRF-01 |
| 2 | Three traceable specialist outputs | Fake personal turns only; no shared binding | CON-01, RUN-01/02, TEAM-01 |
| 3 | Evidence-backed decision brief | Not implemented as shared lifecycle | SYN-01 |
| 4 | Project-linked human meeting | Meeting source/media fixtures; project link absent | MTG-01 plus live media acceptance |
| 5 | Transcript yields draft decisions | Reviewed private import passes; decision records absent | TRN-01/DEC-01 |
| 6 | Authorized monthly decision | No confirmed version/authority record yet | DEC-02 |
| 7 | Targeted impact plan | No complete shared plan | IMP-01/02 |
| 8 | Approval creates work once | No shared approval/outbox implementation | APR-01/EXE-01 |
| 9 | Revised outputs retain history | Versioning primitives mapped; lifecycle pending | ART-01/EXE-01 |
| 10 | Reject/revise/accept exact artifact | Not implemented | REV-01 |
| 11 | Recover run without duplicate effects | Personal persistence/capture recovery tests only | RUN-03 and effect reconciliation |
| 12 | Second tenant denied content/context | Two Chief servers and mocked-Platform capture boundaries pass; deployed Platform project/file/search/agent context pending | CON-01 and adapter integration tests |
| 13 | Block unauthorized actions/invalidate approvals | Existing personal auth only; scoped lifecycle approval pending | APR-01/REL-01 |
| 14 | Metrics label sources/periods/simulation | No integrated metric lifecycle | MET-01 |
| 15 | Next decision cycle | Not implemented | CYC-01 |

## Next work and branding

The owner asked whether it is time to unify branding during this continuation. Recommendation: yes, a scoped customer-facing pass under **Chief Executive Suite** is now well grounded. Record it as the next proposed change, not completed work or approval for a broader rebrand. Cover agent interface/workspace/unified navigation, sign-in, icons and package metadata; preserve required attribution. Keep baseline installer changes coordinated on `codex/chief-executive-suite` and shared-platform work on `codex/chief-unified-platform`. Fix the known prompt expectation there.

Following that scoped pass, the implementation priority remains CON-01 and RUN-01/02/03: revocable member pairing, one real permitted specialist assignment with full parent context, and recoverable effect handling. Then shared briefs/artifacts and the meeting decision loop. No commercial-tier allocations, hosting purchases, customer communications or publishing were authorized by this audit.
