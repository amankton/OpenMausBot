# Chief shared workspace implementation plan

Date: October 9, 2026
Status: Structured implementation backlog. No feature completion implied.
Stage 0 continuation: baseline/build-map gate completed October 9; see [completion evidence and remaining acceptance gaps](CHIEF_STAGE0_COMPLETION_2026-10-09.md) and [canonical records/member execution/storage contracts](../architecture/chief-stage0-contracts.md). M1 CON-01 is deployed and verified on the local workspace as of October 10. Cloud/TLS deployment and real specialist dispatch remain pending. See [M1 progress](CHIEF_M1_PROGRESS.md).

October 9 delivery update: consumer branding, full-frame workspace controls,
same-tab workspace navigation, the exact white icon with its title, and embedded
login persistence are deployed. These foundation improvements do not complete
M1. Local secure member pairing is complete; entitlement/product integration and real recoverable specialist dispatch remain next.
See [login/session verification](../verification/chief-session-persistence.md)
and [current branding verification](../verification/chief-login-icon-title.md).
Source: C:/Users/amank/Desktop/Chief_Executive_Suite_Codex_Handoff.md and owner review in this conversation.

## Delivery objective

Prove one complete project lifecycle: confirmed brief → specialist work → evidence-backed recommendation → meeting → confirmed decision → targeted revisions → human acceptance → measured next cycle.

First demonstration: a food hall membership program changes from annual to monthly. Use synthetic customers and test payments. Preserve the full product scope while delivering increments that each work end to end.

## Product boundaries

Owner clarification, October 9: support three product configurations—standalone Chief agent interface, workspace extension, and a unified Chief platform. These configurations are distinct from the three commercial program levels. Internal service boundaries must not force a split product experience. The owner accepts the milestone sequence below as the first implementation path toward this unified objective.

In unified mode, agent feedback, recommendations and authorized edits participate throughout projects, documents, tasks, meetings and reviews. All surfaces resolve the same current record/version and receive updates. Revisions create new versions; previous outputs remain accessible history, not a user-facing category of stale work. Preserve comments and decisions against their exact historical versions while presenting the current version consistently. Work in progress is shown as a pending revision until a replacement is ready under the applicable review policy.

- Chief standalone remains an independently installable Windows/Mac agent interface. Workspace outages must not prevent ordinary questions or local authorized tasks. Preserve calls, mobile pairing, existing agents, credentials and upgrades.
- The workspace extension adds shared projects, human collaboration, meetings and coordinated agent work. It has separate operational dependencies and release gates.
- The three program levels determine enabled capabilities through server-side entitlements. The Agency belongs to the $5K program. Do not invent the other two levels' feature allocations; leave the commercial matrix pending owner confirmation. Development fixtures may exercise all levels explicitly.
- Agency use is opportunistic: use specialists when they help, but answer directly and continue permitted work when routing is unnecessary or unavailable. Explicitly Agency-only tasks may wait with an actionable explanation.
- Installation does not bundle the owner's personal agents, credentials or shared memory into customer packages. Customer memory and email identities remain isolated.

### Full agent roster and selective workspace participation

Owner clarification, October 10: "I intend to add all of my Agency Agents and my
decision agents into Chief. That's not to say they'll be active in the workspace."
The game development division is the concrete example: when assigned real work,
its agents must be able to interact with workspace projects, issues, cards and
tasks. The current Huly game examples are context, not authorization to modify
those records or a replacement for the existing demonstration scenario.

Implementation direction for CON-02, UI-01, RUN-02 and PRJ-01:

- Keep the personal Chief roster independent from workspace participation and
  execution. Adding an agent must not automatically grant workspace access or
  start work. The current pilot's fixed allowlist and pairing selection are not
  the final roster management experience.
- Add a manageable list of participating agents, with project/resource scope and
  allowed actions. Preserve the runtime pairing when the roster grows; explicitly
  approve changes to workspace grants without requiring a complete re-pairing.
  Recheck membership, entitlements and grants on each operation.
- Use authorized adapters for the existing canonical projects, issues, cards and
  tasks: read context, comment, create/update permitted records, attach results and
  change permitted workflow states. Confirm which cards are views of underlying
  records before implementation; do not create a second independent task store.
- Attribute each operation to the initiating member, executing agent and run.
  Decision agents may review and recommend; catalog membership alone must not
  confer final approval authority. Apply explicit review rules and version checks.
- Acceptance must distinguish available, permitted and running agents: adding an
  unselected agent preserves the connection without granting access; granting a
  game specialist access to one synthetic project permits only approved actions
  there; another project is denied; revocation blocks subsequent operations;
  returned updates appear on the same records used by people. Follow M1 recovery
  requirements so retries do not duplicate comments, tasks or other effects.

This is a recorded requirement and proposed implementation direction, not a
claim that workspace record operations or editable agent grants are deployed.

## Responsibilities and proposed ownership

| Component | Responsibility | Boundary |
| --- | --- | --- |
| Chief interface / lead agent | Intake, conversation, coordination, progress and review | Does not grant itself permissions or approvals |
| Hermes / other supported runtime | Execute authorized assignments and return actual results | No independent copy of shared project truth |
| Custom Agency catalog/router | Discover and invoke entitled specialists | Catalog availability is not proof of executable delegation |
| Jev | Optional routing recommendations with bounded timeout and fallback | Not an authorization authority; current documented room routing is narrower than proposed project routing |
| Shared platform | Proposed owner of workspace membership and existing project/task/file records | Confirm actual schemas and APIs in Stage 0 |
| Lifecycle service | Versioned briefs, decisions, impact plans, runs, approvals and activity where absent | One canonical owner per entity; references rather than independently editable duplicates |
| Execution worker | Durable scheduling, leases, retries, cancellation and reconciliation | Recheck initiating member access before operations |

Stage 0 must decide where the lifecycle service persists records using existing durable infrastructure. Do not select a new database or queue by default.

For multi-user operation, shared jobs must be owned by a persistent workspace service. A member's desktop can be an explicitly connected execution endpoint: if offline, its jobs wait visibly or fail recoverably; they must never silently move to another member's credentials. This deployment proposal requires audit confirmation before implementation.

## Milestones and work packages

Every package produces code or an evidence artifact, relevant tests, and a stated limitation. Suggested responsibility areas below are work boundaries, not agent dispatch instructions.

### M0 — Verified baseline and build map

1. **AUD-01 Repository inventory:** record remotes, exact revisions, dirty files, nested instructions, installed versus source versions and build commands. Preserve existing changes.
2. **AUD-02 Capability matrix:** classify identity, project/task/file storage, dispatch, agents, meetings, recording/playback/download, transcription, approvals, Jev and memory as verified, partial, absent or untested. Link each verdict to evidence.
3. **AUD-03 Architecture contracts:** map canonical entity owners, authentication flows, deployment boundaries and current APIs. Inspect existing dispatch and meeting architecture notes before proposing replacements.
4. **AUD-04 Distribution inventory:** document source/image provenance, inherited licenses/notices and unresolved source-delivery obligations. This is an inventory, not legal clearance.
5. **AUD-05 Baseline fixtures:** create two isolated workspaces, distinct members and agents, synthetic files and fake media. Record baseline failures separately from regressions.

Gate: a reproducible baseline, capability matrix, proposed record ownership and prioritized gaps. No claim of production readiness.

### M1 — Secure member connection and real dispatch

Depends on M0. Responsibility: identity/integration and runtime.

1. **CON-01 Member pairing:** bind a verified workspace member to that member's Chief runtime through revocable, scoped capabilities. Handle logout, account switching and membership removal.
2. **CON-02 Entitlement policy:** enforce feature and specialist access at the server; use explicit fixtures for the three levels until the commercial matrix is confirmed.
3. **RUN-01 Durable assignment:** persist dispatch identity, initiating member, project, allowed tools/resources, input versions, runtime and task status before scheduling.
4. **RUN-02 Runtime adapter:** perform one real specialist task through the actual router/runtime, preserving parent context and returning honest execution status. Reproduce the previously reported missing-parent-context error before claiming it fixed.
5. **RUN-03 Recovery:** leases, bounded retries, cancellation, budget limits and operation receipts. On ambiguous external outcomes, reconcile or request intervention rather than blindly replay.
6. **UI-01 Dispatch and status:** agent selection, scope preview, queued/running/waiting/failed status, output and open-conversation action.

Gate: one entitled member dispatches real work and retrieves a real artifact; another member cannot reuse the connection. Duplicate submission and worker restart do not duplicate completed effects. If provider access is unavailable, deterministic fixtures can pass development tests but live acceptance remains pending.

### M2 — Shared project and specialist investigation

Depends on M1. Responsibility: lifecycle records and project UI.

1. **PRJ-01 Project references:** connect existing human and agent views to the same records and permissions.
2. **BRF-01 Brief versions:** objective, owner, assumptions, constraints, metrics and unknowns; explicit human confirmation with optimistic version checks.
3. **TEAM-01 Assignments:** at least three real specialists initially, with architecture supporting research, finance, marketing, product, engineering and QA. Parallelize only independent assignments within configured budgets.
4. **ART-01 Artifact versions:** immutable version references, producing run, input versions, evidence and review state. Agent completion and human acceptance stay distinct.
5. **SYN-01 Decision brief:** recommendations, alternatives, conflicts, evidence and unresolved questions. Clearly separate retrieved facts from assumptions and simulation.

Gate: a confirmed brief yields three traceable artifacts and a linked synthesis; changing the brief identifies required revisions, retains prior versions and exposes revision progress. New current versions appear consistently in both human and agent surfaces.

### M3 — Meeting to confirmed decision

Depends on M2. Responsibility: meeting integration and decision UI.

1. **MTG-01 Project-linked meeting:** reuse verified meeting/media capabilities; preserve explicit device activation, consent, participant authorization and retention rules.
2. **MTG-02 Agent assignment:** separately authorize an agent to receive permitted meeting content. Support notes and a meeting-linked follow-up conversation without exposing private agent conversations to everyone.
3. **TRN-01 Transcript adapter:** live transcription when verified; clearly labeled transcript import otherwise. Preserve source and version; handle late arrival and corrections.
4. **DEC-01 Decision drafts:** extract proposed wording, scope, owner, source passages and unresolved ambiguity. Speech alone never authorizes execution.
5. **DEC-02 Confirmation:** authorized human confirms an exact version; support supersession and concurrent-edit conflicts.

Gate: a verified meeting or labeled imported transcript produces a draft decision, followed by human confirmation. Revoked membership prevents future transcript delivery and follow-up access.

### M4 — Impact plan and coordinated revisions

Depends on M3. Responsibility: dependency graph, execution and review.

1. **IMP-01 Dependency provenance:** connect decisions and brief versions to tasks/artifacts. Combine explicit dependency edges with agent-proposed impacts; expose uncertain or omitted impacts for human editing.
2. **IMP-02 Reviewable plan:** annual-to-monthly change identifies finance, product, checkout, onboarding/renewals, marketing and QA changes, with reasons and estimated work.
3. **APR-01 Scoped approval:** bind approval to exact plan version, permitted actions and relevant artifacts. One approval authorizes its internal tasks; material scope/cost/external-action changes require a new decision.
4. **EXE-01 Task expansion:** approval creates dependent tasks exactly once; revise affected outputs and retain previous versions. Unaffected work remains valid.
5. **REV-01 Review loop:** reject an exact artifact version, attach feedback, request revision, compare versions and accept the result. Failed acceptance tests block completion.

Gate: the monthly-membership change completes targeted revisions with provenance; duplicate events create no duplicate tasks. A run based on an earlier input version cannot silently overwrite newer work: retain its output as a version and reconcile or revise it before promoting it to current. Revoked/invalidated approvals block the affected operation.

### M5 — Pilot, outcomes and broader workspace actions

Depends on M4 for the pilot. Additional module adapters may follow M1 independently once authorization contracts are stable.

1. **PIL-01 Test integrations:** actual sandbox checkout and relevant test services, with explicit test credentials and setup instructions. No real charge or customer message in fixtures.
2. **MET-01 Outcome definitions:** baseline, period, source, observed value and uncertainty; include usage cost, human review effort and rework. Never imply renewal performance before the observation period exists.
3. **CYC-01 Next cycle:** results support proposed improvements that become a new confirmed decision/brief version.
4. **MOD-01 Module adapters:** progressively cover Contacts, Cards/Documents, Tracker, Chat, Calendar/Planner and files through member-scoped APIs. Each adapter needs read/write permission and retry tests.
5. **REL-01 Release readiness:** migration/backup recovery, resource measurements, installer upgrade checks, entitlements, customer isolation and distribution notices. Track workspace and standalone releases separately.
6. **SCH-01 Schedule, Planner and routine awareness (owner request, October 9, 2026):** make the workspace schedule and Planner and the routines in Chief Executive aware of each other. Track this with the Calendar/Planner module adapter, after M1 member pairing and authorization are available. The requested outcome is mutual awareness; automatic rescheduling, bidirectional edits and routine execution remain design decisions, not implied authorization. Define linked records, visibility, time zones, recurrence and change propagation during design. Proposed acceptance: an authorized member can see relevant scheduled commitments and routine timing across both surfaces; changes are reflected without duplicate work, and private routines remain within that member's permitted scope. Status: recorded for design; not implemented.

Gate: reproducible full demo with evidence; all handoff acceptance criteria mapped to tests. Public launch, commercial readiness and scale remain separate decisions backed by evidence.

## State and contract requirements

- Run states: queued → running → waiting/review-ready/succeeded/failed/cancelled. Record cancellation requests and already-completed effects separately. A successful run does not mean its artifact was accepted.
- Decision states: proposed → confirmed → superseded; rejected proposals retained where policy permits.
- Artifact review: pending → changes requested → accepted, tied to exact version. A new version has its own review state.
- Events carry schema version, tenant/project reference, actor, resource/version, event ID, correlation/causation references and timestamp. Avoid secrets and unnecessary transcript bodies.
- Every mutation validates current membership, resource scope, entitlement and expected version. Model output cannot substitute for these checks.
- Persist state changes and event publication intent atomically where supported; otherwise document and test reconciliation. Consumers deduplicate events. External actions need provider idempotency or recorded reconciliation, not an unsupported exactly-once promise.
- Input-version provenance identifies required revisions and concurrent-update conflicts; it does not discard or label historical outputs as stale. Current-version promotion updates all referencing surfaces while historical versions and their reviews remain accessible. Approval invalidation targets affected work, with the reason visible.
- Budgets, iteration/time limits and direct-execution fallback are runtime controls, not merely prompt instructions.

## Verification and handoff

Follow repository verification instructions. Mutation tests use isolated fixtures, never owner records or customer data. Run focused existing checks and add meaningful tests for member pairing/revocation, cross-tenant access, actual runtime dispatch, duplicate delivery, concurrent-version conflicts, historical-version retrieval, current-version propagation across surfaces, cancellation, worker restart, ambiguous effects, approval invalidation and artifact rejection/revision.

Maintain a matrix mapping all 15 source-handoff acceptance criteria to test/evidence paths and live/simulated/pending status. Read-only endpoint health is not workflow acceptance. Include desktop/mobile layout checks and actual UI navigation through the lifecycle.

Deliver incrementally:

- M0: capability audit, ownership/contracts and evidence-linked backlog.
- M1–M2: migrations/adapters, real dispatch proof and project investigation walkthrough.
- M3–M4: meeting decision demo, impact-plan controls and revision/recovery tests.
- M5: reproducible seed, sandbox walkthrough, outcome evidence and release-readiness report.

Before merging each increment, record changed behavior, tests, rollback/recovery approach and known gaps. Preserve inherited notices and unrelated work.

## Decisions and blockers

### Mobile and Google Cloud — October 10 owner request

Track MOB-01 (Chief-branded MausBot companion), MOB-02 (mobile workspace connector)
and GCP-01 through GCP-03 (hosting design, isolated staging, controlled migration).
The owner plans to host Crewframe on Google Cloud and requested a Chief hosting
plan alongside it. See [Chief mobile and Google Cloud plan](CHIEF_MOBILE_GCP_PLAN.md)
for source inspection, proposed service placement, mobile scope, cost assumptions,
trade-offs and acceptance. No provisioning or migration has occurred. M1 remains
the active implementation milestone.

### Connected apps in workspace Integrations — October 10 owner request

**INT-01 Unified connections:** bring Chief's Composio connected apps into the
existing workspace Settings > Integrations surface. Depends on CON-01's verified
member-to-personal-runtime binding; do not expose the desktop connector API to
every workspace member or equate its runtime-level Composio user with a Platform
member. Reuse existing connected-account, authorization and tool-grant adapters.

Present one app entry with the member's account identities and separately accurate
capabilities/status for **Chief agent access** and **Workspace sync**. The existing
native Calendar/Gmail/GitHub/Telegram integration clients own their sync behavior;
a Composio connection does not automatically satisfy their configuration or OAuth
scopes. Group matching apps without merging different accounts or authorizations.
Allow connect/reconnect/disconnect for the selected account and capability through
its owning adapter, preserving existing per-agent tool grants and outbound approval
controls. A disconnect must make its affected capability clear and must not silently
disconnect the other adapter or another account. Provider secrets remain server-side.

Owner-selected interaction (October 10): each connected service account has
checkboxes for the surfaces allowed to use it: **Chief agents** and **Workspace**.
Permit either or both. These are per-member, per-account access choices, not
organization-wide sharing. Preserve existing per-agent grants within Chief access.
Checking a surface requests its required adapter setup/authorization; show a pending
or reconnect state until the backend confirms access. An OAuth cancellation or
failure must not leave a false successful checkmark. Unchecking revokes that
surface's access without removing the other surface's access or disconnecting the
provider account globally. Keep global account disconnection a separate action.
Unsupported surfaces are disabled with an explanation. Initially reflect verified
existing access; do not preselect new permissions. Server-side access checks enforce
each selection, including after reload and account switching. Add acceptance for
all four checkbox combinations, failed authorization, independent revocation and
cross-member isolation. This records the UI decision; no grants are changed now.

Initial acceptance: two synthetic members see only their own paired accounts;
native-sync and agent-access status are independently truthful; revoked pairing
blocks Composio access; an offline personal runtime shows unavailable/last-checked
state rather than presenting stale status as connected. OAuth callback/account
binding, reconnect and selective disconnect require isolated adapter tests before
rollout. No existing account migration or OAuth grant change is authorized merely
by grouping the UI. Status: integration points inspected; implementation pending
the browser/runtime portion of M1. This is not yet deployed.

Resolve through audit where possible: existing durable storage/queue, canonical entity schemas, authentication adapters, actual Jev/runtime interfaces and media readiness.

Owner input is needed only when implementation reaches an unresolved business boundary: exact three-level entitlement matrix; shared-worker hosting/cost policy; authorized provider/test integration accounts; customer retention defaults. These do not block the initial audit or isolated development.

Immediate implementation order: AUD-01 through AUD-05, then CON-01 and RUN-01 through RUN-03. Do not lead with a dashboard or a new scaffold. Demonstrate secure, recoverable execution first.
