# Chief enhancement and Email Triage implementation plan

Prepared November 4, 2026. Planning only: no installation, mailbox action, permission change or recurring schedule is authorized by this document.

## Outcomes and scope

**Chief enhancement:** Jon Jr advances authorized work, coordinates existing specialists, resumes after results, verifies outcomes, and surfaces meaningful changes without requiring Jon to manage the agents.

**Email Triage:** scans the two existing authorized personal/ministry mailboxes reliably, recognizes repeat messages and new replies, prioritizes actionable correspondence, prepares reply text and tracks follow-through through resolution.

Chief remains the executive owner and consolidated point of contact. Email Triage owns email retrieval, classification and mailbox evidence. Both consume the same authoritative work-item lifecycle. Avoid separate competing queues or duplicate notifications.

Deliver a prompt layer, focused skills and runtime support. Instructions cannot create a scheduler, transactional queue, account isolation, approval gate or duplicate-send protection.

## Current foundation and integration constraints

- `server/chief-of-staff.ts` already owns Chief coordination guidance and reachable rosters; `server/system-prompt.ts` composes runtime context.
- `server/routines.ts`, `server/routine-requests.ts` and their existing runner integration provide explicit scheduled/manual triggers and durable run receipts. Extend these rather than adding a hidden heartbeat or second scheduler.
- `server/room-handoffs.ts` and coordination dispatch in `server/index.ts` manage delegated outcomes. The working tree already contains changes in these files, `server/store.ts`, and new coordination-receipt files/tests. Establish their ownership and status before changing overlapping code; preserve and integrate them.
- Memory is appropriate for preferences, decisions and pointers. Use a dedicated typed operational store for work state, with transactional or atomic concurrency guarantees, rather than relying on model-written Markdown as the queue of record.
- Existing notification routing is bot/task-specific. Preserve preferences and exact click targets. Do not claim terminated-mobile-app delivery: repository documentation says that requires an APNs relay.
- The installed Chief app and this checkout may differ. Confirm installed version, source revision, routes, capabilities and build provenance before choosing a release target. Successful fixture tests do not establish installed-app compatibility.
- The current Email Triage profile is unchanged. The prior instruction candidate was prepared in `.omb-scratch/email-triage-upgrade/`; isolated persistence tests passed, but live installation was rejected by the desktop/paired-device boundary. Treat that candidate as requirements input, not a finished runtime implementation.

## Phase 0: baseline, ownership and acceptance

1. Capture the existing Chief and Email Triage profiles, enabled skills, reachable teams, model selections, approvals, connected-account identities and existing routines through supported read-only access. Retain minimal local backups with restricted access.
2. Inspect deployed capabilities and the pending coordination changes. Establish a clean baseline or isolated worktree; do not revert others' work.
3. Build a synthetic acceptance set representing personal, ministry and executive workflows. Record current behavior before changing prompts.
4. Define notification urgency, quiet hours, retention and execution authority as explicit settings. Leave recurring scans and external actions disabled until specifically configured through the normal owner flow.

**Exit:** documented baseline, version target, rollback artifacts, agreed lifecycle and fixtures. No live inbox is used for mutation testing.

## Phase 1: shared operational foundation

### Work-item and event contract

Reuse existing task/thread IDs and completion receipts where possible; add the missing domain metadata through one server-owned store/API. Choose the persistence implementation after inspecting the deployed store, preserving atomicity across the relevant records.

Required fields:

- Stable work-item ID, owner bot, coordinator bot, source bot/thread and account scope.
- Desired outcome, sanitized title, next action, status and dependencies.
- Explicit source deadline with timezone/precision, separate suggested review time, and provenance.
- Source message/thread identifiers and latest observed source version.
- Approval reference and the exact approved operation, target/revision and expiry, when applicable.
- Completion evidence, resolution actor/reason and last-surfaced version/time.
- Revision, event IDs, timestamps and idempotency keys for concurrent/retried requests.

Lifecycle: proposed → queued → working → ready-for-review → done, with waiting-on-human, waiting-on-other, blocked and dismissed branches. A tool success alone cannot transition an item to evidence-verified done. Track execution status separately from work-item status; an action may be simulated, partially completed, failed or outcome-unknown.

Implement guarded transitions, account isolation, optimistic concurrency, single-run leases, and durable event delivery. Repeated events must not create another item, wake-up or digest entry. A restarted process recovers pending work without replaying uncertain writes. Keep confirmed partial successes.

Use minimal retained source identifiers/tombstones for deduplication. Define retention explicitly; if history is pruned, surface the reduced duplicate-detection horizon. Never store full confidential email bodies in generic task or notification records.

**Exit:** synthetic restart, stale-write, duplicate-event and cross-account tests pass; durable state is accessible through verified bot tools.

## Phase 2A: Chief enhancement

1. Integrate the companion Chief prompt addendum with the existing Jon Jr role. Preserve the CORE Council protocol, ministry-first criteria, download-only behavior and existing permissions. Remove duplicated/conflicting guidance rather than appending indefinitely.
2. Add focused skills: `executive-check-in`, `execute-and-verify`, `coordinate-and-review`, and `decision-brief`. Load only relevant procedures/tools for each turn. Do not embed mailbox implementation details in Chief's standing prompt.
3. Connect the work-item API to actual coordination callbacks. A result resumes the originating Chief task once; the Chief evaluates acceptance, requests bounded corrections if needed and returns consolidated evidence. Handle failure, cancellation and missing callbacks explicitly.
4. Add check-in execution through existing routines. Enforce read-only tool availability for unattended discovery at dispatch time, including remote callbacks and child-run paths. Unknown tool effects fail closed; prompts alone are insufficient.
5. Implement meaningful-change notification policy. Key notifications by work item and material state change, suppress unchanged scans, honor quiet hours and configured urgency, and route to the exact source task. Failure receipts remain available even when notifications are disabled.
6. Add a reviewable setup view: sources, scope, cadence, quiet hours, urgency rules, last successful run and gaps. Schedule suggestions are proposals, not active jobs.

**Acceptance:** an assigned task continues to a verified result; trivial work is not delegated; specialist output is reviewed; a stale completion cannot close newer work; duplicate callbacks do not cause loops; background discovery cannot send or mutate; unchanged runs stay quiet; notification clicks open the correct task.

## Phase 2B: Email Triage enhancement

1. Split the Gmail Ninja-derived candidate into a short standing role and focused skills: `scan-mail`, `classify-and-prioritize`, `prepare-reply`, and `reconcile-follow-ups`. Preserve the two existing mailbox identities, personal/ministry separation and specific approval requirements.
2. Implement a provider adapter over actual available tools. Verify account identity before each run. Expose capability facts for search, pagination, full-thread reads, incremental history, drafts, counts and mutations. Do not import Gmail Ninja-specific limits or tool names as assumptions about Chief.
3. Add a resumable scanner: fixed run-end timestamp; incremental history where supported; bounded overlapping date windows otherwise; persisted pagination; small inspectable pages; explicit truncation/failure handling; per-account checkpoints. Invalid cursors trigger recorded reconciliation rather than silently skipping mail.
4. Separate discovery coverage from review completion. Advance discovery checkpoints only when retrieved IDs and outstanding work are durably saved. Persist a separate review backlog so message budgets never hide unfinished work. Reconcile tracked unresolved threads, including new replies outside the current discovery window. Start with a configurable 15-new-message analysis budget across accounts, fairly allocated, while reporting the backlog.
5. Deduplicate by account plus provider message ID. Link distinct actions to account/thread/source evidence. Preserve one canonical work item across overlapping scans; a new reply updates relevant actions without reopening completed work automatically.
6. Store classification, reason, sender intent, concise summary, 1–5 priority, recommended action, optional reply text and proposed labels. Add ministry/pastoral classifications. Separate classification, actual provider labels and workflow status. Prioritize evidence and consequence over keyword urgency or presumed revenue.
7. Treat cleanup as recommendations initially. Use conservative rules for low-value newsletters/promotions; preserve ambiguous, sensitive, financial, legal, security, personal and ministry obligations for review. Do not equate a Gmail category or unsubscribe header with permission to remove mail.
8. Require adequate thread context for reply preparation. Store draft text with source revision and account. Provider draft creation, sending and mailbox changes use separately verified tool approval flows. Detect stale source/recipient revisions, duplicate requests and ambiguous delivery outcomes before retrying.
9. Publish sanitized actionable items into the shared queue. Chief receives the work-item ID and evidence reference, not a duplicate task. Email Triage reconciles source changes; Chief owns cross-domain coordination. External Tasks integration is optional and remains capability-gated; a local follow-up is never described as a Google Task.
10. Produce per-mailbox coverage receipts and a compact digest of new/changed priorities, drafts, due follow-ups and gaps. Preserve verified source IDs when usable URLs are unavailable. Do not invent account-position links or overwrite historical dashboard timestamps. Validate existing dashboard schema before integration; unresolved links remain explicitly unavailable.

**Acceptance:** read and unread messages in scope are covered; multiple pages and restart resume correctly; repeated scans create no duplicate work; identical IDs in different accounts stay separate; new replies update the right item; partial failures remain visible; drafts are not called sent; approval and recipient/account boundaries hold; unresolved work survives a restart.

## Phase 3: joint verification

Follow `docs/verification/README.md` and the `verify-omb` skill. Launch a fresh isolated fixture with fake engines and synthetic mail; never test mutations against the user's live app or data.

Use existing routines, room-coordination, bot-continuity, notification and memory verification recipes where applicable. Extend the shared control surface for new operations and document the recipe only after it is runnable. Preserve exact commands, wait results, bounded transcripts, final state and persistent log paths.

| Scenario | Required evidence |
| --- | --- |
| Chief delegates and gets a result | One accepted handoff; callback; acceptance review; consolidated response |
| Specialist fails or needs approval | Correct blocked/waiting state, no false completion and no duplicate escalation |
| Repeated scans and notifications | One source-linked item; one notification per configured material transition |
| New reply changes an old obligation | Same canonical item updated or a justified distinct action; source version retained |
| Deadline without a time / ambiguous date | Precision or uncertainty preserved; no invented exact due time |
| Identical message IDs across mailboxes | Separate account-scoped records and approvals |
| Pagination truncation, quota or expired cursor | Partial coverage recorded, backlog retained, no false all-clear |
| Crash between execution and acknowledgment | Outcome unknown or reconciled; no automatic duplicate outbound action |
| Concurrent edits | Stale update rejected; newer state preserved |
| Prompt injection in mail or teammate output | No broadened scope, changed recipient or unauthorized operation |
| Hidden/dismissed suggestion | No resurfacing without policy-relevant new evidence |
| Disabled notifications or quiet hours | Receipts retained; alert suppression and allowed urgency behavior verified |

Evaluate model behavior separately from fake-engine wiring. Run the baseline and candidate on the same approved synthetic set, measure critical-item recall, false urgency, correct owner/deadline extraction, duplicate actions and unauthorized tool attempts, and inspect disagreements. Require no missed critical cases or unauthorized writes in the release set; report actual counts and limitations rather than treating that set as proof of real-inbox accuracy. Measure latency, token use and cost before choosing a default model or cadence. Use synthetic data for any live-provider evaluation.

## Phase 4: staged rollout and rollback

1. Install the new skills and Chief prompt through the supported desktop or paired-device path; preserve the previous revision for rollback. Never bypass the rejected API by forging headers or editing live profile storage behind the app.
2. Verify installed-version compatibility and exact saved configuration. Keep all existing models and permissions unless a separate change is explicitly chosen.
3. After the isolated tests pass, conduct a bounded read-only live acceptance run within Jon's authorized scope. This is operational acceptance, not live mutation testing. Verify both mailbox identities and compare the recorded results with source evidence while minimizing copied content.
4. Review the first digest and work-item lifecycle. Tune priorities using Jon's corrections. Only then configure a concrete routine with scope, cadence, timezone, quiet hours and interruption rules through the normal owner flow. No default schedule is silently enabled.
5. Keep provider drafts, mailbox cleanup, external Tasks and outbound communication outside unattended execution until their specific supported flows and account grants are verified and explicitly enabled.
6. Roll back prompts/skills independently of stored work. Pause new routines if needed, retain receipts and unresolved items, and use backward-compatible state migration. Do not erase the queue or replay in-flight actions during rollback.

**Release evidence:** saved profile revisions, schema/migration versions, fixture results, model-evaluation report, installed-app acceptance receipt, enabled-trigger configuration, notification limitations and a tested rollback procedure.

## Delivery order

Baseline → shared state/tools → Chief execution/verification → Email scan/reconciliation → shared check-in/digest → isolated joint acceptance → installed read-only acceptance → explicitly configured background operation.

Chief prompt improvements can ship earlier with truthful capability fallbacks. Persistent follow-through and background claims wait for their runtime dependencies. Email scanning and classification can progress independently once the shared contract is fixed, but both converge on one queue and one notification policy.

## Reference material

- Chief prompt: `2026-11-04-chief-enhancement-prompt.md` beside this plan.
- OpenDuet source reviewed at commit `f52288fff5ccdbd3de428d573d9f026fce5ff480`: [agent instructions](https://github.com/CopilotKit/OpenDuet/blob/f52288fff5ccdbd3de428d573d9f026fce5ff480/openbot/examples/openduet/agents.yaml), [background engine](https://github.com/CopilotKit/OpenDuet/blob/f52288fff5ccdbd3de428d573d9f026fce5ff480/openbot/server/src/proactive/engine.ts), [tool restrictions](https://github.com/CopilotKit/OpenDuet/blob/f52288fff5ccdbd3de428d573d9f026fce5ff480/openbot/server/src/proactive/restriction.ts), [triage evaluation](https://github.com/CopilotKit/OpenDuet/blob/f52288fff5ccdbd3de428d573d9f026fce5ff480/evals/triage/README.md).
- Jon's supplied Gmail Ninja instructions and the existing Jon Jr / Email Triage profiles.
- Repository verification and notification documentation; no imported claim establishes a deployed capability.
