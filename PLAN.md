# Chief Executive Suite implementation

Final selected local scope verified on 2026-10-08 at 00:44 UTC. The retained
Shared Workspace is deployed, all selected module gates passed, and the latest
deployed meeting export passed the isolated private-agent review/draft/explicit
Send gate. `docs/verification/evidence/chief-selected-scope.json` binds 17 evidence
receipts and records remaining items outside this scope. HR/Processes and external
integrations are not claimed complete. The retired `/office` route redirects to
`/workspace`; Chief's private agent workspace, Routines and Team map remain.

- [x] Verify real runtime, stop Crewframe gracefully, keep live data untouched.
- [x] Independently clone runtime source and preserve existing source customizations.
- [x] Add independent office human identities, persisted invitations, acceptance, room membership and participant-scoped records. Keep private agent APIs inaccessible to office credentials.
- [x] Build the initial custom Office prototype (subsequently retired from navigation in favor of Shared Workspace).
- [x] Wire LiveKit room-scoped tokens and client audio/video/screen sharing with explicit unavailable state without configuration.
- [x] Apply supplied Chief assets and user-facing branding in this independent clone; preserve licensing and upstream service identities.
- [x] Run unit/API permission tests, build, isolated fixture UI checks and document remaining setup.
- [x] Resolve provider report: owner confirmed other providers were not configured; support unchanged, no fake credentials.
- [x] Review specific Huly presence/meeting reuse candidates and record dependencies and license boundaries.
- [x] Restore original Team map visibility in Simple mode; replace the initial Shared Office entry with Shared Workspace and verify desktop/narrow navigation.
- [x] Preserve newly configured preview state, fix Vite private-runtime watcher crash, deny runtime-file HTTP access, and resume the same preview workspace without resetting settings.

Ownership: main implementation handles shared/office.ts, server/office*, server/routes/office*, OfficePage and media, integration in server/index.ts and TeamMapPage. Branding specialist owns branding assets, static product copy, packaging/default paths and branding audit; coordinate App/main integration before editing. No changes to live installations or sales website. No production publishing or real invitations.

## Platform source reuse (owner walkthrough, 2026-10-07)

- [x] Fix Windows Hermes launcher resolution, preserve argv and environment, verify installed version and isolated setup route; restart only Chief on its existing workspace and validate actual Managed Accounts probe.
- [x] Verify My cards filters against UI/source: Assigned = unfinished personal to-dos attached to cards; Created = creator identity; Subscribed = collaborator subscription.
- [x] Map actual source and runtime dependencies for Office, personal offices/meeting rooms, Cards/Spaces/Types, Contacts, human Chat/Threads, Tracker, editable Documents, persistent day calendar and Team planner. Preserve Chief Routines and agent Team map. HR/Processes deferred.
- [x] Inspect Contacts UI and retained-source implementation boundary first, without copying real contact records or secrets. Owner accepted retained Platform subsystem.
- [x] Update reuse recommendation and record source revision, provenance/licenses, acceptance checks and proposed versus implemented state.
- [x] Prepare independent pinned deployment, fresh private configuration and separate volumes/network; verify boundary tests.
- [x] Implement authenticated separate Shared workspace window and verify actual Chief host against an isolated synthetic service, including credential isolation, unavailable recovery and narrow layout.
- [x] Gracefully pause only owner-approved Twenty, Baserow, ERPNext and Odoo containers; preserve volumes and exact restart manifest.
- [x] Start retained subsystem after both resource guards pass; verify real fresh synthetic organization and Contacts create/edit/filter/attachment workflows.
- [x] Verify Contacts avatar crop/save/cancel and cross-member image bytes; Tracker assignment/status across members.
- [x] Complete selected Contacts Employee/Guest permissions and restart-persistence acceptance (synthetic Guest join/elevated-invite denial; member Contact/Tracker persistence after service restart).
- [x] Verify initial Card rich-text/table persistence, independent Calendar/Office companion, moving now-line, human Chat/Threads/DMs, Tracker issue, Documents and Inbox across fresh synthetic sessions.
- [x] Complete Card Spaces/Types, files/mentions/templates and Team planner acceptance.
- [x] Verify explicit device activation and cleanup in the retained recorder and Office controls.
- [x] Build and verify bounded Card Activity recording through authenticated file storage, including deployed playback, cancellation and access checks; stock Stream was rejected after source review.
- [x] Verify authoritative Office invite acceptance/admission, drag and keyboard invitation, shared compact/full state, real AV/screenshare and Card-open conversation workflow with two synthetic members.
- [x] Implement and verify selected meeting capture and reviewed private-agent follow-up, including deployed capture and isolated explicit-Send acceptance.

2026-10-07 meeting-notes implementation checkpoint: the consent API/private store,
shared capture/review/export UI, native offline worker and personal reviewed
import are implemented. Backend authorization/state tests, worker lifecycle tests,
personal import tests and scoped type/component checks pass. The pinned tiny.en
CPU model transcribed generated synthetic speech correctly. The new production
frontend build passed after a graceful retained-backend maintenance window.
All 17 services were restored with exact IDs/mounts preserved. The capture backend
and native worker are deployed. Synthetic end-to-end checks reached successful
local transcription, cross-member review authorization, listener removal and raw
audio deletion. A delayed capture-stop response cancelling already-authorized ASR
was fixed and covered by two regression cases (19 worker tests now pass). Compact
Meeting controls and an explicit review-selector label were added; the revised
production frontend build passed at 00:00 UTC on October 8. Shared review/export,
frontend promotion and the complete private-agent handoff gate were then run.
The revised compiled capture gate passed at 00:03 UTC. The new frontend was
deployed at 00:06:54 UTC; deployed capture passed at 00:07:55, raw recorder
regression at 00:08:29, and the personal import of that exact deployed export
passed at 00:09:04. Nine pre-Send checkpoints recorded zero message requests or
fake-engine turns; explicit Send produced exactly one synthetic reply. The rollout
receipt confirms all original mounts and 15 unchanged service containers/images.

2026-10-07 21:53 UTC checkpoint: the repaired retained backend passed a
two-member full Office diagnostic for self-drag, shared room placement,
invitation decline/acceptance, explicit fake camera/microphone, actual received
WebRTC audio/video, generated screen sharing, leave cleanup and rejoin. Compact
Office and Card-preserving meeting controls still await the combined frontend
build and full browser acceptance. The owner's subsequent explicit correction
required removing the old Shared Office surface immediately: navigation and the
Team map now open Shared Workspace, and `/office` redirects to `/workspace`.
Forty focused tests and the isolated browser navigation/isolation checks passed;
the owner's already-open tab was verified on the new Shared Workspace surface.
The combined source-built frontend is deployed as image `c79fa3251ded…`;
its eight consent/compact-control browser checks passed. After restart, ICE
failure was traced to duplicate rewritten loopback/container candidates retaining
the wrong media multiplexer. Disabling loopback candidates is the permanent,
single-setting fix. The original loopback-only published ports are retained;
all temporary host-only/TCP diagnostics were removed. The complete two-member
compact/Card meeting acceptance passed at 22:37 UTC, including real received
audio/video and generated screen sharing, invitation decline/acceptance, leave
cleanup and rejoin. Current configuration exactly matches the reviewed generator.
Host-frame device permission integration passed isolated browser verification,
29 unit tests, typechecks and scoped lint at 22:44 UTC. Permissions are limited
to the retained frame origin; devices require explicit activation, and a
successful availability retry preserves the frame and unsaved draft. Recorder
patch0004 now passes 30 focused checks and package validation. Its first
production build stopped at the host memory guard without changing deployment.
Native WebM duration repair passes isolated normal/paused playback and seeking.
The guarded rebuild passed at 22:51 UTC and all 17 services are running again;
search was restored with exact IDs/mounts preserved. Eight compiled consent
checks pass. The compiled raw recording gate passed at 23:00 UTC: cancellation
before/during/after upload, explicit Activity comment Send, persisted WebM
dimensions/bytes, reload/playback/finite duration/seeking, and 12 unauthorized
GET/POST/DELETE cases with member positive controls. Recording is in Card
Activity; the main Card body does not expose a recorder action. The new recording
frontend `aabe5fc9fb59…` is deployed at 23:02 UTC. All 17 services are ready;
only the frontend container changed, with every mount and other container ID
preserved. Deployed recording acceptance passed at 23:06 UTC without asset
overrides: all six checks and twelve authorization denials passed. The
transport-held cancellation test now waits for an explicit successful abort
before removing its route interceptor, fixing a test-only race without relaxing
the expected missing-blob response. Meeting capture/transcription and reviewed
agent follow-up progress is tracked in the newer checkpoint above.

The owner prioritized Chief completion and said the other apps need not run,
including Postiz with no active schedules. Postiz, its PostgreSQL and Redis
were gracefully stopped with volumes preserved. Keep them stopped unless the
owner requests restoration. Further non-Chief app shutdowns are recorded in
private exact-container receipts; they are not data deletion or schedule edits.

Latest selected requirements: Inbox/notifications; Cards rich editor with files,
recording option (actual media type to verify), tables, mentions, emoji and text
templates; a collapsible companion panel with independent Calendar/Office modes;
shared full/compact Office room state; optional drag-person-to-room invitations
with acceptance, explicit devices and keyboard alternatives. Personal agent and
shared organization workspaces must coexist in two windows/two screens for a
single member of an organization. HR and Processes remain deferred.

Owner clarification: retained Platform Office replaces the earlier custom Chief
Shared Office. Preserve the original agent Team map and its data. Its Office
entry and Shared Office navigation must converge on the validated retained Office,
with one authoritative room/presence/meeting state shared with compact Office.
The latest owner correction supersedes the temporary old-Office navigation:
use Shared Workspace throughout. Preserve old data without an active competing
Office surface or a destructive state migration.

Architecture options are reviewable in `docs/architecture/adr-platform-contacts.md`.
Owner chose retained Platform collaboration services. The independent service
configuration and retained workbench are running. Local meetings, raw recording,
selected audio capture and reviewed agent follow-up have passed. Card body
template acceptance passed on the deployed six-patch frontend at 00:41 UTC on
October 8, including real focus/click and fresh-member persistence. Test mutations use synthetic data only; no
collaboration data was imported.

Preparation ownership: main owns live read-only inspection, Hermes closeout and final integration map/ADR; office_ui owns Contacts source dependency audit and source manifest only; chief_branding owns cross-module dependency audit and selected-scope note only. Existing work must not be reverted. Running Platform stays reference-only; all future mutation tests use disposable data.

Current implementation ownership: main owns host integration and synthetic module
acceptance; office_ui owns retained Love admission, invitation model/trigger and
meeting deployment; chief_branding owns explicit media consent and the serial
source build. Owner workspace `chiefexecutivesuite` is now in use. All test
mutations target the separately created `chiefacceptance` organization.
