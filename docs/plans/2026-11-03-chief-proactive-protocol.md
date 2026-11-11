# Chief proactive operation — customer protocol candidate

Status: **APPROVED in structured design review; implementation pending**, for
the Windows/macOS complete local installer.
This document does not change a running agent or grant permissions.

The customer establishes an objective, connected sources, allowed working folders,
selected agents and explicit schedules. Within that scope, Chief should inspect
what matters, take the next useful step, coordinate selected specialists, verify
the result and make it available. It should not wait for the customer to repeat
the same authorization for each routine operation.

## Work lifecycle

`assigned or enabled trigger → inspect → prioritize → perform/delegate → verify →
deliver → reconcile unfinished work`

Execution requires an assignment, enabled routine/event or another specific grant.
Discovery may propose new work, but a suggestion does not create authority for an
external action. Meaningful status includes working, waiting for input, waiting
for an external dependency, delivered and failed, with the actual task/result ID.

The coordinator and operator are explicit capability bindings. Bacca coordinates
and Solo executes in the reference team; customers may bind other selected,
compatible profiles. Both slots must be configured before the full proactive
workflow is ready; deselection never silently installs or promotes a replacement.
Selected specialists provide their roles when available.
An unavailable agent or integration is a real limitation to disclose. An agent
must not silently change its role, provider, customer scope or computer to evade
that limitation.

## Routine execution

Perform connected-source reads, bounded research, internal drafting, approved
document edits and in-scope coordination through the tools actually granted.
Correct routine missing arguments or paths without turning each correction into
a human decision. Keep customer-edited instructions and protected configuration
outside ordinary document-edit grants.

Use the existing finite Hermes routine rules and command reviewer where supported.
Before enabling reduced-approval native reads for customers, enforce explicit
document/workspace and published skill/reference roots at the actual read
boundary, including path/symlink escape checks and protected credential,
provider-home and private-configuration exclusions. The current routine read
allowlist does not perform those checks by itself. A connected-source grant
does not grant raw access to its stored credentials. Missing enforcement leaves
that adapter unready for reduced-approval execution.
The reviewer must evaluate complete commands; it is not permission for unknown
scripts or an unrestricted shell. Missing/failed/uncertain review retains its
checkpoint. Verify provider-native controls as well as Chief's own controls.

## Decisions and approval cards

Prepare a concrete action before requesting a decision. Show its destination,
content or change, relevant scope and practical consequence. Let the actual
enforcement boundary request approval once; do not precede its card with a second
chat confirmation. Group related business decisions when the action model allows
it, without replacing exact action grants with a blanket approval.

Outbound communication, financial commitments, public release, destructive work,
permission/security changes and actions outside a grant retain their implemented
checkpoints. A specific prior grant should be recognized only within its actual
scope and supported policy. Standing external-action grants are not introduced
by this document. A denial must not be routed around; expiration, Stop and scope
revocation apply to pending, delegated and resumed work too.

## Background operation

Make the customer-enabled schedule, source scope, notification preference and
execution limits visible. Use bounded concurrent work and provider spending/run
limits appropriate to the actual integration. Missing required limits or broken
policy block affected background execution rather than silently removing them.
For the initial release, admission requires all of the following to be enforced:
at least 15 minutes between firings, no more than 20 enabled routines for the
local customer, one background run at a time per installation, a 10-minute
active-execution budget and a maximum of 20 provider requests per run (including auxiliary
reviews and delegated background calls). These defaults are enforced in the November 4 customer testing engine
(`server/background-work.ts`, the scheduler and the patched Hermes request guard). A runtime whose calls or cancellation
cannot be counted/bounded cannot be admitted to unattended execution. The wizard
states that request/time limits are not a guaranteed monetary ceiling; a currency
cap can be advertised only when the provider adapter can actually enforce it.

Here a run means the **root background workflow**, not each agent turn. Its
coordinator, operator, specialists and auxiliary reviewers share one durable
workflow ID, request counter and active-execution budget. Descendants do not claim another root
slot or receive a fresh budget. Reserve/count requests atomically before dispatch;
an unknown response still consumes its reserved request. Persist original start
time, accumulated active time, remaining budget and pending effects so process
restart or delegation cannot reset limits. Account for running-state time
conservatively after an unclean stop. Stop, timeout and grant revocation propagate to descendants.
Reaching a human checkpoint persists `needs input` and releases the active work
slot. Only a server-recorded waiting state pauses the active-time budget; it does
not reset its prior consumption or the request counter. The authoritative card's
own expiry/cancellation still applies. A valid later answer revalidates current
scope, action inputs and remaining root budget before resuming. An expired or
stale card shows that it expired and nothing was executed, with an explicit
refresh/review path; it never silently resumes an old effect. Approval received
is not displayed as completed execution. No agent can create a waiting state
merely to avoid the deadline.

Background checks without a meaningful change remain quiet. Surface a useful
completion, new material issue, blocker or decision at the correct task. Record
the scheduler's actual last successful sweep and execution, so a configured next
run is not mistaken for a functioning worker. On wake/restart, reconcile the run
ledger and apply a declared missed-window policy; do not replay a backlog of
external effects or stale briefs. Notify once per ongoing failure, with an
actionable repair path, rather than one alert per retry. Initially, a missed
routine may run once if at most 30 minutes late; older occurrences are skipped
and the next run advances. Multiple missed occurrences never produce a burst.
Consecutive failures notify on the first failure and disable the routine after
three failed firings, with one final repair notification. A successful firing or
explicit customer re-enable resets that count. Retry only pre-dispatch transient
failures, at most twice; a provider timeout after dispatch is not proof that no
effect occurred. An interrupted/unknown external effect requires verified
idempotency/readback reconciliation or a human checkpoint before any replay.

Work can continue while the UI is closed only while the required backend/provider
services run. A sleeping or signed-out computer is not an always-on server.

## Delivery and truthful status

Create the requested usable artifact or state change, verify the result through
an appropriate readback or test, and register/link it through the existing result
surface. Distinguish a draft from an external send, model completion from task
delivery, and recorded evidence from a fresh availability check. Keep earlier
successful artifacts discoverable after later failures.

Report concise outcomes with links to the work. Do not claim to have checked mail,
a calendar, a workspace or a connected app without a successful relevant tool
result. Preserve evidence and unfinished work across delegation/restart without
claiming universal checkpoint or exactly-once external effects.

## Acceptance scenarios

- A selected agent reads permitted context, creates a synthetic local document,
  verifies it and delivers a registered result without routine approval cards.
- A consequential action produces one authoritative card with the exact action;
  refusal, Stop and access revocation prevent execution, including delayed replies.
- A scheduled synthetic run fires with the correct customer scope; UI closure
  does not stop a healthy backend. Missing worker health is visible.
- An unchanged check emits no customer notification; a continued failure produces
  bounded alerts. Wake/restart does not replay completed external actions.
- Delegation preserves requester scope and fails clearly for a missing specialist.
- A restart retains the last delivered result and reports incomplete work honestly.
- Removing a selected agent or disconnecting an app does not silently substitute
  another customer identity, computer or account.

## Selected reference and existing implementation

CopilotKit/OpenDuet is an inspiration and comparison source, not Chief's runtime.
Its tenant agent separates task work from quick chat, avoids conversational
pre-approval before the enforced tool card, and distinguishes suggestions from
starting work. Its architecture records initiating authority and evaluates policy
at the action boundary. Its routine worker documentation makes worker health,
failure notification and stale-run handling explicit. These are concepts to map
to Chief's own supported APIs, not instructions to copy its tools or dependencies.

Reviewed sources:

- [OpenDuet agent configuration](https://github.com/CopilotKit/OpenDuet/blob/main/openbot/examples/openduet/agents.yaml), blob `010598f9b02a1a4b01b60dbc9a9d16bbf09d1be9`.
- [OpenDuet architecture](https://github.com/CopilotKit/OpenDuet/blob/main/openbot/docs/architecture.md), blob `8d1f8f206ab66af31a9f5319e9ce8e1f4d518764`.
- [OpenDuet routines](https://github.com/CopilotKit/OpenDuet/blob/main/openbot/docs/routines.md), blob `d903eb8f533e50f388890af8aaca78c97094db3d`.
- Chief: `docs/verification/hermes-routine-approvals.md`,
  `docs/verification/hermes-command-review.md`,
  `docs/notification-and-proactivity-qa.md`,
  `docs/verification/durable-task-results.md`.

Customer role instructions must remain portable. No source examples, fictional
identities, proprietary credentials or owner-specific memory are customer facts.
