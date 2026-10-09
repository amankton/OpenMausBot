# Chief Stage 0: canonical records and member execution contract

Date: October 9, 2026. Status: implementation design established by source audit; migrations and member dispatch are not implemented.

This extends `workspace-agent-dispatch.md` and `../plans/CHIEF_SHARED_WORKSPACE_IMPLEMENTATION.md`. Source root below is `.chief-local/platform-source`, HEAD `03b7aad7dc562f4f9769c51a4df08191a0393997`, with the preserved Chief patch stack. Source inspection does not attest every deployed binary. Reproducible evidence and qualifications are in `../plans/CHIEF_STAGE0_COMPLETION_2026-10-09.md`.

## Actual schema and canonical ownership

All retained record references must include `(workspaceUuid, classRef, recordId)`. A workspace URL is a locator, not a tenant identity. A Person reference, AccountUuid and social identity are different identifiers. Never infer identity from display name or email.

| Record | Existing source and fields | Owner and Chief integration |
| --- | --- | --- |
| Workspace/member | `server/account/src/collections/postgres/postgres.ts`: workspace and workspace_members; account operations resolve current role. Core `AccountRole` includes READONLYGUEST, DocGuest, GUEST, USER, MAINTAINER, OWNER, ADMIN. | Accounts remains authority for membership; Chief stores references, never an independently editable membership copy. |
| Space/access | `foundations/core/packages/core/src/classes.ts:500`: Space has private, members AccountUuid[], owners, archived; TypedSpace adds type and restricted; Role permissions and RolesAssignment bind accounts. | Platform owns space ACLs and typed-role configuration. Chief must apply both workspace and record access. |
| Human identity | `plugins/contact/src/index.ts:149,187`: Person; Employee adds active, personUuid AccountUuid, informational role. | Contacts owns records. Resolve active Employee by verified account, not its informational role or UI-selected personId. |
| Project | `plugins/task/src/index.ts:47` Project extends TypedSpace; `plugins/tracker/src/index.ts:114` adds identifier, sequence, defaults. | Retain Tracker Project as the first lifecycle project's identity. Chief ProjectLifecycle extension owns objective, stage, accountable owner reference and current confirmed brief pointer. No second editable project name/task board. |
| Task | `plugins/task/src/index.ts:54`: kind, status, isDone, number, assignee Person/null, dueDate, identifier, rank. Tracker Issue at `plugins/tracker/src/index.ts:256`: title, description MarkupBlobRef, space Project, blockedBy, relations, parents, estimates. | Tracker owns collaborative task content/status. Chief Assignment references the Issue and owns runtime agent, allowed scope, input versions, acceptance criteria and source decision. Do not put a bot UUID into a Person assignee field; accountable human stays a Person. |
| Card/current content | `plugins/card/src/index.ts:58`: Card has content MarkupBlobRef, blobs, parent/rank and VersionableDoc. `foundations/core/packages/core/src/versioning.ts`: baseId, version, isLatest, readonly. | Platform owns Cards and content. Use typed Cards for first shared outputs and explicit version references. Chief owns provenance/review and a separately named accepted-version pointer, not a second body or competing current-version flag. |
| Document/history | `plugins/document/src/types.ts:23,42`: Document has content, space Teamspace, parent, lockedBy and snapshots count; DocumentSnapshot has title, content and parent. | Platform owns Documents/snapshots. Snapshot existence is not a confirmed brief, review approval or automatic immutability guarantee. Do not treat lockedBy as Chief authorization. |
| File | `plugins/attachment/src/index.ts:29`: Attachment extends AttachedDoc (attachedTo/class/collection), file Blob, name/type/size; core Blob includes provider, etag, version/null and size. | Platform owns metadata and bytes. Chief ArtifactVersion references exact record/blob/version and content hash; require parent ACL before download. A mutable blob URL alone is not an immutable version. |
| Meeting | `plugins/love/src/types.ts:185`: MeetingMinutes extends AttachedDoc, has status, description, transcription/recording state, access, timestamps and attachment counts; attachedTo is its Room. | Love owns meeting/room/attendance. Chief MeetingProjectLink adds project reference. CaptureStore owns capture sessions/transcript segments; reviewed import currently appends a private draft. |
| Chat/calendar | Chunter/Communication and Calendar/Time retain their existing models. | Keep human messages and schedules in Platform; personal Chief conversations remain private. Persist explicit meeting/run links and only approved shared outputs. |
| BriefVersion | No complete Chief confirmation lifecycle found; Card versions and DocumentSnapshot are partial primitives. | Chief owns confirmation, exact input version, assumptions and confirmedBy/time. Content remains a permission-checked Platform artifact. |
| AgentTeam/Assignment/AgentRun | Personal Store has bots/tasks; no retained member-bound executor established. | Chief lifecycle service owns shared assignment/run IDs and policy. Personal runtime owns local bot/conversation/provider state, referenced by runtimeId/botId/taskId. |
| Decision/ChangePlan/Approval/Review | No complete unified implementation found. | Chief owns versioned decisions/plans, exact action/version approval, review result and revocation. Shared views project these records; model text never changes authority. |
| MetricObservation/ActivityEvent | Existing activity/usage are partial primitives. | Chief owns lifecycle event IDs, correlations, metric definitions/periods/sources and acceptance state. Platform activity is a linked projection, not another authority. |

`VersioningMiddleware` defaults version-enabled class queries to `isLatest=true` unless querying `_id`, `baseId` or explicit isLatest; its version update path includes additional transactions. Existing version fields alone do not prove atomic Chief promotion, approval invalidation or protection against a late run. Implement and test those explicitly before M2 acceptance.

## Existing authentication and API paths

1. Chief `server/routes/shared-workspace.ts` is GET-only, admin loopback, independent Platform sign-in, with origin checks and no forwarded credentials. This is a host entry point, not the new dispatch API.
2. Accounts JSON RPC (`foundations/core/packages/account-client/src/client.ts`) exposes `getLoginInfoByToken`, `selectWorkspace`, `getWorkspaceMembers`. `server/account/src/operations.ts:2057,2469` verifies token and current database membership. System/admin/grant paths exist: the new adapter must constrain accepted token kinds and may not mint administrator authority for a normal member.
3. `services/love/src/client.ts` resolves the transactor endpoint for the caller token. `foundations/core/packages/api-client/src/rest/rest.ts` sends bearer credentials to `GET /api/v1/find-all/:workspace`, `POST /api/v1/find-page/:workspace`, `GET /api/v1/account/:workspace`, `POST /api/v1/tx/:workspace`, and fulltext/domain operations. Namespace these beneath the deployment's configured transactor endpoint.
4. For writes use `createRestTxOperations` (`rest/tx.ts:47`) or the permission-checked WebSocket TxOperations client with the caller's identity. `pods/server/src/rpc.ts:154,344` explicitly reserves direct create/update/remove/mixin shortcuts for system accounts; regular clients use `session.txRaw`. **Do not implement a member adapter using the direct low-level CRUD shortcuts.**
5. `foundations/server/packages/middleware/src/spaceSecurity.ts` constrains queries to allowed spaces. `spacePermissions.ts` checks transactions, typed-space restrictions and nested TxApplyIf. Guest permissions and private/fulltext middleware are additional boundaries. Chief policy is an intersection with these checks, not a replacement ACL implementation.
6. `server/front/src/index.ts:432` resolves workspace via Accounts and checks the workspace path for `/files`. The inspected read path then accesses storage by blob ID. It does not establish parent-document permission in that handler. Chief must resolve Attachment/Card/Document plus parent access before delivering a blob or issuing a short-lived download capability. Same-tenant restricted files require live adapter tests; workspace validation is insufficient evidence for them.
7. Love capture routes resolve current Accounts membership, caller-scoped MeetingMinutes and Room, then capture participation. Worker credentials are separate. The synthetic cross-workspace test exercises this actual route and engine with mocked Accounts/ACL/RTC boundaries, including identical record IDs and revocation.

## Concrete member-to-agent design for M1

Keep a persistent Chief lifecycle service beside the retained services. A personal desktop is an explicitly connected execution endpoint. Its offline state must never transfer work to another member's agents or credentials. Standalone Chief remains usable independently.

Proposed new API contract (none of these endpoints exists yet):

| Endpoint | Preconditions and result |
| --- | --- |
| POST /chief/v1/connections/challenges | Authenticated current Accounts member plus entitlement. Create expiring single-use challenge, server nonce and initiating session binding. Browser receives no runtime/provider secret. |
| POST /chief/v1/connections/complete | Explicit approval in authenticated personal Chief; runtime proves challenge possession over an authenticated outbound channel. Verify account/workspace/session/nonce binding, one-time consume and expiry; store connection and scoped capability hash atomically. |
| DELETE /chief/v1/connections/:id | Owner of this connection or authorized administrative revocation. Increment connection generation; cancel queued leases and future delivery. Logout/account switch invalidates the paired session generation; re-pair before reuse. |
| POST /chief/v1/runs | Server derives member/workspace; caller submits connection, agent selection, permitted record references, exact input versions, budget, intent and idempotency key. Persist assignment/run/outbox before acknowledgement. Same key+same payload returns the same run; changed payload returns 409. |
| GET /chief/v1/runs/:id and events | Recheck member, connection owner, project access and scope. Shared progress omits private conversation content; personal conversation opens only for its owner. Reconnect resumes by event cursor. |
| POST /chief/v1/runs/:id/cancel or retry | Check current authority and version. Retry creates an attempt on the same logical run; do not replay ambiguous effects. Cancellation records requested/completed effects separately. |

Connection record: workspaceUuid, accountUuid, personRef, runtimeId, scoped bot references, capabilityHash, sessionGeneration, scopes, createdAt, expiresAt, revokedAt and version. Runtime credentials and provider tokens stay outside lifecycle artifacts; store encrypted credentials only in the service secret boundary if required. The owner Hindsight connection and personal Agency agents are never customer defaults.

Run envelope: schemaVersion, runId, assignmentId, workspace/project refs, initiating account, connectionId/generation, runtime/bot/task refs, allowed actions/resources, inputVersions, entitlement snapshot for audit, deadline, cost/iteration limits and correlationId. Re-evaluate current entitlement before execution; the stored snapshot grants no lasting permission. Bind result submission to the exact run, attempt and lease fencing generation. A model-selected agent name is not authority.

Pairing and execution must deny wrong member, wrong workspace, replayed/expired challenge, account switch, removed membership, revoked agent access, stale generation, unentitled specialist and arbitrary callback endpoints. Workspace tokens never enter model context, artifacts or logs. The runtime polls/dials the service; avoid opening customer desktops to inbound browser requests.

First real slice: one current member dispatches one specialist against a confirmed synthetic project reference, reads one permitted Tracker Issue, and returns a versioned draft file/Card with operation receipt and linked conversation. Verify real runtime parent context before expanding modules. Agency catalog search and deterministic fixture replies are not live dispatch proof. Jev remains optional routing advice with bounded timeout and direct-work fallback.

## ADR-001: storage and worker choice

Status: chosen implementation direction for local development; no service/schema deployed and no hosting spend approved.

Requirements: restart-safe jobs, tenant scope, duplicate delivery, optimistic versions, bounded retries, cancellation, visible ambiguous outcomes; reuse installed infrastructure and retain personal data.

| Option | Benefit | Limitation | Decision |
| --- | --- | --- | --- |
| Personal JSON task/capture stores | Existing and simple | Process-local serialization; no shared transactional leases/outbox; capture has one global worker slot | Preserve for their current responsibilities, not shared scheduling |
| New Redis/Postgres/queue service | Familiar worker patterns | More deployment and backup surface without demonstrated need | Do not add |
| Platform custom records for all job internals | Native views/permissions | Background lease and atomic publish semantics not established; tightly couples orchestration internals to model migration | Keep collaborative records there; not first run-state owner |
| Existing CockroachDB, dedicated Chief schema and SQL poller | Durable transactional run/outbox/effect records, no new database service | Needs explicit migrations, restricted service role, serialization retries and cross-system reconciliation | Selected |
| Existing Redpanda as sole queue/state | Already deployed | Queue availability does not establish transactional scheduling, effect receipts or durable lifecycle truth | Optional outbox transport after SQL correctness; never sole run authority |

Use a separate `chief_lifecycle` schema/service role on existing Cockroach infrastructure. No direct writes to Accounts or retained document tables. Existing PostgreSQL-compatible adapters and `server/account/src/collections/postgres/postgres.ts` show database use and retry handling; implement parameterized SQL and explicit transaction retry for Chief rather than assuming every PostgreSQL extension works. Validate on a disposable Cockroach database before M1 acceptance.

Proposed tables: connections, project_lifecycle, brief_versions, assignments, runs, attempts, effect_receipts, artifacts (references), artifact_provenance, decisions, change_plans, approvals, reviews, metric_observations, outbox and consumer_receipts. Every key/index/FK includes workspaceUuid where tenant-bound. Unique `(workspace, initiatingAccount, idempotencyKey)` and payload hash prevent duplicate dispatch. Separate `(run, operationKey)` effect receipts deduplicate completed effects. Include schema_version migration ledger and content/version checksums.

Worker claims use conditional SQL updates with lease expiry and incremented fencing generation in a transaction. Bound attempts, elapsed time, cost and renewal intervals. A result from an old lease cannot update run state or promote a current version. SQL state and outbox insertion commit together. Initially poll the outbox; Redpanda can later deliver wakeups, deduplicated by event ID. The existing QueueMiddleware publishes broadcast transactions; it is not evidence of a Chief transactionally coupled outbox.

Cross-system writes are not one database transaction: persist intended effect and expected version, call the member-scoped Platform adapter, then persist receipt/result. Use stable created record IDs where supported. After timeout/crash reconcile the exact intended record/version/hash; if the outcome is ambiguous, surface intervention instead of retrying an external action blindly. Never make provider calls inside retryable database transactions. Cancellation prevents new effects; it does not undo completed effects.

A pending output remains a draft artifact with input provenance until current inputs, permission, review policy and expected current pointer all pass promotion. Previous versions and exact-version reviews stay accessible. Emit versioned events to update both surfaces; clients re-read canonical records and resume from cursors rather than maintaining editable copies. Platform external edits must also invalidate affected Chief approvals and inputs; a reconciliation cursor is required if an event is missed.

Revisit this choice only after measured worker contention, database limits or a verified native Platform scheduler changes the trade-off. Shared hosting/cost, retention defaults and unresolved commercial tier allocations remain owner decisions at their implementation boundary.

## Migration and rollback contract

1. Add tables/indexes and service role in a disposable database first; test composite tenant keys, conditional leases, transaction retry, duplicate outbox delivery and backup/restore.
2. Link existing projects by stable references after read-only validation. No bulk copy or automatic migration of personal bots, meetings, credentials or owner memory.
3. Version every adapter envelope/event and maintain additive compatibility. Feature flags keep shared dispatch disabled until pairing and recovery acceptance pass.
4. Rollback disables new dispatch, drains/stops leases and retains records/receipts for reconciliation. Do not drop data or rewind completed external effects. Coordinate restoration of lifecycle data, platform records and blob references so old approvals cannot become valid again.

Next review gate: CON-01 + RUN-01/02/03 in isolated retained workspaces, then real permitted specialist execution and UI acceptance. This document does not mark those gates complete.
