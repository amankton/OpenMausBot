# Independent Chief Platform deployment

Current deployment (2026-10-08 00:41 UTC): the 17-service meeting profile runs
frontend `sha256:7f1249e6e368e9bea05f41e65605354ab5f3ed7c42fbfb8b7939e64c766c9939`
and Love `sha256:9507248f82c2402c40fe679f622c7c1533774c9f7e0d99384f0551edef14aaa9`.
The native local transcription worker is running. Shared Workspace is Chief's
collaboration entry; `/office` redirects to `/workspace`. The original agent
Team map remains available separately. The dated baseline below records the
initial deployment; current acceptance is in `docs/verification/chief-platform.md`.

Launched on 2026-10-07 at 20:08 UTC. **All 15 services running, declared health checks healthy; actual front and configuration reachable.** Initial capacity checks blocked startup. After owner-authorized graceful suspension of legacy services, the successful startup preflight measured 9.86 GiB available in Docker and 4.52 GiB on Windows. The unchanged guards require **5 GiB available in Docker Desktop and 2 GiB available on Windows**, with no bypass. These are conservative startup guards informed by the reference stack using approximately 4.8 GiB, not a measured peak-load qualification.

The only published endpoint is `http://localhost:18087`, bound as `127.0.0.1:18087:80`. The project is exactly `chief-platform`; its network and five named volumes use the same prefix. The reference Platform stack and Chief preview remain separate. The launcher itself stops no existing service. Owner-authorized resource cleanup was performed separately with exact container-ID/mount records and restart scripts in ignored `.chief-local/`: all 16 Twenty/Baserow/ERPNext/Odoo containers stopped gracefully; the old Platform reference services were also requested to stop, with one account process still draining at this checkpoint. No volumes were removed, no Docker allocation changed, and no original data copied. The deployment is local-only; remote hosting and shared authentication are separate work.

The synthetic acceptance account created a new `Chief Acceptance` organization with sample content disabled. Actual browser checks now verify Contacts editing/filtering/attachments, Card rich body/table persistence, independent Calendar/Office companion modes, calendar event persistence and advancing now-line, human channel/thread messages, Tracker issue, editable Document, and two-member DM/Inbox delivery. Exact scope and remaining checks are in [the acceptance record](verification/chief-platform.md). The owner's separately created `chiefexecutivesuite` organization is in use and is excluded from test mutations. Host isolation is separately verified in `docs/verification/evidence/chief-shared-workspace-host.json`; that synthetic host test alone is not Contacts acceptance.

## Commands

The member-meeting profile is prepared separately and has not been implied by
the baseline service readiness above. It adds Love and LiveKit and replaces only
the reviewed front/transactor/workspace images. Its guarded entry point is:

```powershell
node scripts/configure-chief-platform.mjs --preflight --meetings
node scripts/configure-chief-platform.mjs --start --meetings
```

Do not start it until compatible source builds, synthetic browser consent checks,
and read-only model compatibility checks have completed. The launcher requires private
`front-image.json`, `love-image.json`, `transactor-image.json` and
`workspace-image.json` receipts with exact locally installed image IDs and the
pinned source revision. It derives a private image environment from those
receipts, preserves existing credentials/volumes, and permits only the original
HTTP port plus loopback RTC ports18088/TCP and18089/UDP. No guest or recording
endpoint is enabled by this first meeting profile. After activation, ordinary
`--status` automatically checks the17-service profile. Preparation and preflight
failures do not hide an already-ready baseline workspace.

Starting also requires a private `meeting-model-validation.json` receipt tied to the
exact tool/transactor/workspace image IDs and admission patch hash. Both existing
workspace identities must have passed backups, read-only model loads and preservation checks;
the launcher reads and hashes their backup receipts. The model change adds only
optional `admission` and `joined` fields to existing invitations through the model
bundled in the transactor image. It requires no persisted model migration. The
upstream `upgrade-workspace` command reruns historical data migrations and must
not be used for this change. One attempted run in the synthetic organization
failed; its backup and diagnostic log were preserved and no owner upgrade ran.
An application rollback must disable the new meeting routes/media and retain
any optional invitation data; it must never restore an unrestricted Love token
endpoint or reset data.

Run from the Chief repository root. Preparation and checking do not start containers:

```powershell
node scripts/configure-chief-platform.mjs --configure
powershell -NoProfile -File scripts/start-chief-platform.ps1 -CheckOnly
node --test integrations/platform/deployment.test.mjs
```

After the resource issue is resolved and deployment is authorized, this explicit command performs the same preflight and then starts only the independent project:

```powershell
powershell -NoProfile -File scripts/start-chief-platform.ps1
```

`node scripts/configure-chief-platform.mjs --status` checks an existing deployment. Status `ready` requires all 15 containers running, declared health checks healthy, and front HTML plus JSON configuration responding. It does not mean application workflows, workspace creation, account sign-in, search indexing, or any selected module has passed acceptance testing. Failed readiness preserves containers and volumes for diagnosis. There is no purge, reset, automatic cleanup, or reference-stack shutdown command in the launcher.

The launcher refuses remote Docker contexts, occupied port 18087, unexpected project ownership, foreign named volumes/networks, changed service sets, unpinned images, additional published ports, host mounts, and common privileged overrides. It neither pulls images nor builds source. Elasticsearch's retained startup command may download the upstream ingest-attachment plugin if absent; pinned container images alone do not provide an offline runtime guarantee. Initial startup readiness passed; sustained-load and recovery qualification remain separate.

Queue clients (`transactor`, `account`, `workspace`, `fulltext`) now wait for
Redpanda's healthy state before startup. During the build-maintenance restoration,
the transactor started too early and retained a failed Kafka producer connection,
leaving both original and source-built UIs at their shell. The broker itself later
passed TCP and cluster checks; a scoped graceful transactor restart was required.
Container/HTTP readiness alone therefore does not establish workspace recovery.

## Private configuration and shell integration

`scripts/configure-chief-platform.mjs` creates new cryptographically random service, database, storage, and queue credentials once in ignored `.chief-local/platform/platform.env`. Existing credentials are preserved on subsequent runs. Windows directory permissions are restricted to the current account and SYSTEM. No live environment file or reference credentials are read. The script captures and suppresses Compose output that could contain expanded credentials. Do not print resolved Compose configuration or commit/copy this private file into documentation. Queue SASL remains disabled in the retained development configuration; the generated queue password is not a claim that queue authentication is enabled. Database TLS settings and internal networking are retained for this loopback deployment.

The public metadata file `.chief-local/platform/manifest.json` contains no credentials:

```json
{
  "url": "http://localhost:18087",
  "project": "chief-platform",
  "sourceRevision": "03b7aad7dc562f4f9769c51a4df08191a0393997",
  "selfhostSourceRevision": "42fdd73311843cea76fb7f9dade9d7397b358368",
  "release": "s0.7.426",
  "status": "blocked-resources",
  "blockers": ["Resource checks explain the measured shortage here."]
}
```

It also records `updatedAt` and the latest `resourceCheck` metrics. Statuses are `prepared`, `blocked-resources`, `starting`, `ready`, or `unavailable`. Chief's integration can read this metadata and explain unavailable services without pretending a subsystem is connected. The URL is fixed for this local profile, not an arbitrary public server override. Actual selected-module access and authentication remain the responsibility of Chief's integration routes/UI.

## Retained service closure and gaps

| Services | Purpose retained from upstream |
| --- | --- |
| nginx, front | Actual Platform UI, HTTP/WebSocket entry and routing |
| account, workspace, transactor | Accounts, workspace/model lifecycle, application transactions |
| cockroach, redpanda, minio (Silo image) | Database, queue, attachment/blob persistence |
| elastic, fulltext, rekoni | Full-text indexing/search and document extraction |
| collaborator | Shared rich-text document collaboration |
| print, stats, kvs | Retained print, runtime telemetry API, key/value services |

Full-text search is deliberately retained. `MODEL_ENABLED=*` and the complete release UI remain: the source audit found cross-module dependencies that do not justify casually removing services or packages. This is a service baseline for incremental integration of Contacts, flexible Cards/Spaces/Types, Explore, Inbox, human Chat, Tracker, Documents, calendar/Planner and Office, while Chief Routines and agent Team map remain. It is not evidence that all those workflows are already integrated or tested.

The current `meetings` profile adds Love and LiveKit, for 17 running services.
Two-member meeting and companion-panel acceptance has passed. Bounded Card
Activity recording uses authenticated file storage, with deployed playback,
cancel and access tests; Stream is absent. Consented meeting notes use an
additional private metadata volume and a native Windows worker with a pinned
local English transcription model. The deployed capture/review/export gate
passed on 2026-10-08 at 00:07 UTC. These are separate opt-in workflows, and
neither opening Shared Workspace nor joining a room starts capture.

External calendar, Gmail, Telegram, and other optional integrations remain
unconfigured. Inherited endpoint hints are not working-feature claims. The
print container remains, but its proxy route is commented out and printing
through the front is unverified. Selected Guest access, advanced Cards and Team
Planner checks passed; destructive Guest lifecycle and broader private-calendar
visibility are outside that coverage. The exact scope is tracked in `PLAN.md`.

See [module map](CHIEF_PLATFORM_MODULE_MAP.md), [Contacts architecture decision](architecture/adr-platform-contacts.md), and [retained source/license notice](../integrations/platform/NOTICE.md). The release source pin is verified; exact source-to-installed-binary attestation remains unproven.

