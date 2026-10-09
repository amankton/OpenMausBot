# Retained Platform acceptance

The tests use the independent `chief-platform` project on `http://localhost:18087`
and the synthetic **Chief Acceptance** organization (`chiefacceptance`, UUID
`b3ece3dc-e200-41c7-a9d8-2cb86c8c9fdb`). They never load the owner's browser profile
or mutate the owner's `chiefexecutivesuite` organization.

## Established fixtures

The first synthetic account signed up through the actual retained form and
created Chief Acceptance with sample data disabled. A one-use, one-hour invite
then admitted **Chief Meeting Partner** as an ordinary User through Sign Up & Join.
Both accounts use generated `example.test` addresses. Random passwords were not
retained. Playwright session files live only in ignored `.chief-local/platform`:
`acceptance-state.json` and `acceptance-partner-state.json`. They contain credentials;
do not print them, commit them, or use them in the owner's visible browser.

The following records were created through the actual UI, then checked from fresh
browser contexts. IDs are fixture provenance, not a blanket deletion allowlist.

| Record | ID or stable route |
| --- | --- |
| Chief Acceptance person | `6ac6a722f2bac8b54dff7fbd` |
| Synthetic Ada Chief Fixture | `6ac6a7555ab6380ca5be8f5b` |
| Chief Synthetic Company | `6ac6a909aa620efbb1bb9e83` |
| Chief Synthetic Card | `6ac6aa185b1567fb393c76f2` |
| Channel message/thread root | `6ac6abb492587335b11188b5` |
| Chief Synthetic Issue | `tracker/TSK-1` |
| Chief Synthetic Document | `6ac6ac15ec1dc7ce12045dc6` |
| Two-member direct chat | `6ac6ad4922224d41ae744a58` |

Other synthetic records are the Chief Synthetic Teamspace, Chief Synthetic
Calendar Event (created at 15:00), and Person attachments. No existing owner or
CES contacts, accounts or sample records were imported. The current scripts
verify these established seeds; they do not bootstrap an empty replacement
organization automatically.

## Repeatable checks

Run from this repository with the independent deployment ready and private
synthetic sessions present:

```powershell
node scripts/verify-chief-platform-contacts.mjs
node scripts/verify-chief-platform-cards.mjs
node scripts/verify-chief-platform-modules.mjs
```

Contacts checks persisted Person/location edits, real search and location
filter/reset, original attachment download bytes, and Company rich description.
Cards checks persisted title/body/table, Calendar/Office/closed companion changes
with the Card still open, a controlled two-minute advance of the actual now-line,
and a click-created event's persistence in a new context. The event check is tied
to today's calendar; on a new day it creates a same-named event in this fixture.
Module checks persisted channel/thread content, Tracker issue and Document,
then sends new synthetic direct messages to prove recipient Inbox delivery,
live bidirectional updates and reload persistence. No real recipients are used.

Receipts and screenshots are in `evidence/chief-platform-{contacts,cards,modules}.json`
and the adjacent PNG files. The separate `chief-shared-workspace-host.json`
tests the actual Chief host against a disposable service for frame isolation,
unavailable/retry behavior and desktop/narrow layouts.

## Remaining coverage

The first complete production compilation (2026-10-07, 2,560 MiB heap) is not a
browser acceptance result. Its native minifier emitted shared top-level helpers
across asynchronous chunks; the source-overlay check exposed runtime collisions.
No frontend image passed the consent gate or deployed from that artifact. Keep
compilation receipts distinct from browser validation and deployed behavior.

The corrected build scopes native minifier helpers inside each chunk. Both
production configurations passed on 2026-10-07; the fifteen-service baseline
was restored at 21:25:50 UTC with healthy queue startup ordering. Browser
consent validation subsequently passed seven workflows, and the guarded
seventeen-service meeting deployment became ready at 21:28:18 UTC. See
`evidence/chief-platform-consent.json` for explicit fake-device controls and
cleanup. Opening the recorder was tested; recording/upload was not.

The first actual meeting run connected from full Office with devices off, but
failed broader acceptance. Compact Office's visual preview flag disabled drag;
the shared room placement helper accepted negative coordinates; and invitation
writes used a system-only REST endpoint. Backend fixes were deployed at 21:47 UTC.
A subsequent synthetic two-member full Office diagnostic passed at 21:53 UTC:
self-drag, valid room placement visible to both members, invitation rejection and
acceptance, explicit fake microphone/camera acquisition, real received audio and
decoded video, generated screen-share transport, leave cleanup and rejoin.
Connection/media polling allows 30 seconds for the actual asynchronous transport;
the earlier five-second assertion deadline was insufficient. No owner device was
acquired. This diagnostic does not cover compact Office or Card preservation.
The combined frontend image `sha256:c79fa3251ded2d6e6a3ff6e949e9c2d3138dd939b47ad393401a29b3b111cec7`
was built and deployed at 22:11 UTC. Its eight compiled-browser consent checks
include the compact room menu and an unobstructed drag target while the Card
stays open. After restart, both full and compact meeting tests failed their
initial ICE connection. Scoped transport diagnostics isolated a duplicate mapped
candidate issue. Disabling container loopback candidate gathering restored the
connection; the original loopback-only published ports then passed the complete
two-member compact/Card acceptance at **22:37:08 UTC**. See
`evidence/chief-platform-meetings.json`: received audio/video and screen frames,
both invitation paths, leave/rejoin, and Card preservation. Temporary host-only
WSL bindings and forced TCP were removed. The permanent setting is
`rtc.enable_loopback_candidate:false`; advertised IP and published TCP/UDP ports
remain `127.0.0.1`, with no forced transport or global network changes.

The pinned LiveKit transport configuration rewrites gathered interface addresses
to the explicit `node_ip`. Pion registers TCP mux connections by their original
interface address, but deduplicates candidates by the rewritten transport
address. Including both `lo` and `eth0` can discard the connection that receives
Docker-forwarded TCP. This mechanism is supported by the exact source paths
[address rewriting](https://github.com/livekit/mediatransportutil/blob/f234b534b095/pkg/rtcconfig/webrtc_config.go),
[candidate gathering](https://github.com/livekit/ice/blob/v4.4.0-warp.3/gather.go),
and [candidate deduplication](https://github.com/livekit/ice/blob/v4.4.0-warp.3/agent.go).
The one-setting browser comparison establishes the configuration fix; no Pion
binary patch was needed. A deployment regression protects that setting and the
original loopback-only port boundary.
At the owner's subsequent explicit correction, Chief's obsolete Shared Office
navigation and Team map embed were removed. Both entry points now use Shared
Workspace, and `/office` replaces its route with `/workspace` without forwarding
old query/hash credentials. Forty focused tests and the isolated desktop/narrow
browser checks passed, including Team map preservation and the old-route
redirect. The owner tab was observed on the retained workspace at 22:10 UTC.

Raw recorder patch0004 passes 30 focused checks, affected package validation
and the prior Svelte validation (zero errors, 33 upstream warnings). It records
bounded WebM through retained authenticated file storage, with a pinned MIT
duration repair library. The production build passed at 22:51 UTC; eight consent
checks and six compiled recording checks passed. The latter cover cancellation,
Card Activity draft/send persistence, actual file bytes/dimensions, reloaded
native playback and seeking, and twelve unauthorized file operations denied
with member positive controls. This is Card Activity recording; the main Card
body exposes no recording action in the tested source.

Frontend image `aabe5fc9fb595726d9fdd5c49dfd0c3c29603942ca673f8ac9f6e8c43eadd7e7`
was deployed at 23:02 UTC. All 17 services are ready; only the frontend container
changed, with all mounts and other container IDs preserved. Deployed-asset
recording acceptance passed at 23:06 UTC with zero asset overrides: six checks,
twelve authorization denials, and a 94,344-byte recording with native playback,
finite 2.948-second duration and seeking. The test explicitly waits for its
held request to abort before removing interception; this fixes a test race and
retains the strict missing-blob assertion. The prior frontend image and exact
compiled receipts remain preserved. Stock Stream was
rejected after its authorization and storage dependencies were reviewed.

The retained baseline was temporarily stopped for build capacity, preserving
all data volumes. Restoration exposed a failed Kafka producer retained by an
early-started transactor; queue-health startup ordering is now required. Two
synthetic browser contexts also need Chromium's scoped local-network-access
permission when media permissions are overridden. Owner browser permissions
were not changed by these test-harness fixes.

Service restart/recovery, guest/outsider access, Contacts avatar/cancel flows,
Spaces/Types editing, advanced Card editor controls, Tracker assignment/status,
Team planner, selected meeting capture/transcription, and agent follow-up
are separate checks. Passing these scripts is not a claim of that coverage.

## Sample content replacement

The owner asked whether sample content can be replaced with Chief examples.
That capability is separate from permission to remove records now. Future seed
packs should create records with an explicit seed-pack manifest containing the
target workspace UUID, version, exact record IDs and content hashes. Preview
replacement against that manifest; preserve records that users edited or linked
into real work. An ordinary title prefix is insufficient proof of seed ownership.
The owner's organization is not included in this acceptance fixture or any
cleanup command. There is no destructive sample scrub in this increment.

## Consented local meeting notes — 2026-10-08

The source build, compiled capture gate and deployed capture gate passed.
`chief-platform-capture.json` records the deployed six-part gate at 00:07:55 UTC:
no initial media, explicit requester consent, late-join stop and history denial,
individual partner decline/consent/stop controls, generated microphone audio
over LiveKit, local English transcription with speaker attribution, exact
listener removal, raw-audio deletion after acknowledgment, access denials and
reviewed JSON export. No assets were substituted in the deployed run.

The worker's 19 focused tests include delayed capture-stop responses during
transition to ASR, processing authorization failure, lease expiry, bounded gaps,
disconnect cleanup and storage integrity. The corrected worker logs only error
classes/status/source locations. The local model is pinned and uses no hosted
provider. The personal importer separately verifies a second review and an
unsent draft, preserving existing text and attachments until explicit Send to
the repository's fake engine (`chief-meeting-import.json`).

`chief-platform-capture-rollout.json` verifies 17 running services, unchanged
original mounts and unchanged images/container IDs except `front` and `love`.
The added metadata volume is `chief-platform_capture_metadata`; no owner
workspace migration was performed. Images at that checkpoint:

- Front: `sha256:877e1daf9b7cf72b40c644c9d3dc9dca7ce3709a7f4c4738220ec9bd7ece252a`
- Love: `sha256:9507248f82c2402c40fe679f622c7c1533774c9f7e0d99384f0551edef14aaa9`

The existing raw-recording gate also passed against the new deployed frontend
at 00:08:29 UTC, including finite playback/seeking and twelve access denials.
All mutations use synthetic accounts in `chiefacceptance`; generated audio and
fake browser devices are mandatory. The owner's workspace was not a test target.

## Final Card actions and selected module acceptance — 2026-10-08

Frontend `sha256:7f1249e6e368e9bea05f41e65605354ab5f3ed7c42fbfb8b7939e64c766c9939`
was deployed at 00:40:55 UTC. Love remains unchanged from the capture checkpoint
above. All 17 services and the native worker are running; the rollout receipt
confirms original mounts and the other 15 service containers/images are intact.

Patch0006 wires the main Card body's template, mention and emoji actions. The
browser check exposed a focus transaction replacing a keyed toolbar button
between mouse-down and click. Stable action identities fix that behavior while
retaining read-only and stale-editor callback guards. Six focused checks and
component/package validation pass. Both production configurations pass; all
53 changed source files reconstruct from the six ordered patches against the
pinned upstream revision. Patches0001–0005 were preserved unchanged.

Compiled template insertion passed at 00:38:03 UTC. Deployed template acceptance
passed at 00:41:33: normal focus and mouse click open the picker, the main body
persists across reload and a fresh member, Activity remains unchanged, and the
deployed check does not insert duplicates. The exact build receipt hash is
`7060287280246df74dce6187085be3df2d6ca9d3c9eec39b0d49a663ee1ecc3d`.
The image includes the successful compiled consent, recording, capture and
template receipts. Deployed capture passed again at 00:42:35; deployed recording
passed at 00:42:57, both with zero substituted assets.

Selected extended module receipts cover Contacts Employee permissions, distinct
Guest join and elevated-invite denial, Card Spaces/Types, body file bytes,
document references and emoji, Team Planner scheduling/reschedule/restore, and
Contact/Tracker persistence after a service restart. Older phase receipts retain
their original planning notes; these are historical prerequisites, not additional
failed checks. Destructive member lifecycle, ReadOnlyGuest, cross-member private
calendar visibility, external integrations and printing remain outside this
acceptance scope. HR and Processes remain deferred.

Chief's collaboration entry is Shared Workspace. `/office` and `/office/` redirect
to `/workspace`; the old shared-office page is not a navigation destination.
The private agent workspace, Routines and original Team map remain separate.

The final personal import gate passed at 00:43:57 UTC using the exact deployed
capture export. All nine pre-Send checkpoints recorded zero fake-engine turns;
the verifier also required zero message requests before Send. Explicit Send
produced exactly one synthetic request/reply, with draft/attachment preservation.
Its browser, preview, fake server and scratch data were closed afterward. The
aggregate `evidence/chief-selected-scope.json` binds 17 receipts, checks deployed
build/image agreement and the exact export-to-import hash chain, and records
the exclusions above. This completes the selected local implementation scope.
