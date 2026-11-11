# Chief customer installer and proactive operation — discovery

Date: November 3, 2026 (America/Los_Angeles).
Status: source research complete. The companion
[installer design](2026-11-03-chief-customer-installer-design.md) and
[proactive protocol](2026-11-03-chief-proactive-protocol.md) passed structured
design review; implementation and native acceptance remain pending.

## Owner requirements and decisions

- Install the whole Chief workflow, including preliminary dependencies, the
  personal environment, the shared workspace and required software.
- Let the customer select each Agency agent to install.
- Prepare and set up the workflow before producing a ZIP for transfer to a Mac
  through TeamViewer. A transfer ZIP is not itself proof of a working Mac release.
- Include the proactive operating behavior developed for Bacca and Solo in Chief.
- Reduce repetitive approval clicks while retaining meaningful user decisions.
- Use **CopilotKit/OpenDuet** documentation when refining that protocol; the
  owner explicitly selected that repository.
- Support **Windows and macOS**, as explicitly corrected by the owner. Both the
  personal and shared environments run locally on the installation computer.
- Make the result suitable for installation for customers, with their own data,
  identities, accounts and permissions.

Exact source: owner messages in Codex chat
`01a1a55e-f995-7950-9cf3-cf0b3a796c2e`, November 3, 2026. These requirements do
not authorize copying the owner's credentials, personal memory, live databases or
private conversations into customer packages.

## Verified Chief foundations

| Existing component | Evidence and practical limit |
| --- | --- |
| Personal Chief desktop packaging | `scripts/package-chief.mjs`, `scripts/build-chief-mac.sh`, `docs/CHIEF_MAC_BUILD.md`. Existing Mac script checks for dependencies and builds the standalone desktop; it does not install the complete shared-workspace/Hermes system. |
| Retained shared workspace | `integrations/platform/compose.json`, `image-lock.json`, `patches/`, `lifecycle/` and `docs/architecture/adr-platform-contacts.md`. The reference baseline retains 15 services before optional meeting/lifecycle overlays. Personal history and shared human-workspace membership remain separate boundaries. |
| Routine work with fewer cards | `docs/verification/hermes-routine-approvals.md`, `server/drivers/hermes-routine-approval.ts`. Auto turns can opt into a finite set of routine operations. The documented October 31 rollout included actual native document write/read with zero approval cards. |
| Command review | `docs/verification/hermes-command-review.md`, `server/drivers/hermes-command-review.ts`, `integrations/hermes-http-tools/command_review.py`. Fixed checkpoints precede tools-free model review; ambiguous commands and reviewer failures retain a checkpoint. This requires the matching external Hermes installation/plugin as well as Chief source. |
| Existing proactivity | `docs/notification-and-proactivity-qa.md`. Chief uses active tasks, configured Routines and Webhooks. An instruction to be proactive does not create an unconfigured background worker. |
| Durable deliverables | `docs/verification/durable-task-results.md`. Existing scoped result registration/lookup and attachment publication can support evidence of completed work, subject to the feature's documented limits. |
| Agent import | `server/team-manifest.ts`, `/api/teams/import` and the workspace's `CHIEF_AGENCY_IMPORT_HANDOFF.md`. Import must preserve existing agents, avoid duplicates and separately resolve models and workspace grants. Historical reference: 176 Agency specialists and five Council agents; this is not a release catalog or a guaranteed current count. |

The approval rollout retained Bacca as Chief of Staff. Making Solo a second Chief
would demote Bacca under the current team model, so the documented work explicitly
avoided that. Customer role templates must preserve the intended coordination
relationship rather than copying a conflicting pair of chief flags.

The current combined source baseline is commit
`fc5003a7807c83d737f3b4e28ed85f15ae8b3167` on
`codex/chief-unified-platform`. The preceding sync verified 654 Vitest passes,
two skips, eight Python passes, types, lint and locales. Those checks did not
validate a fresh customer installation or a Mac deployment.

## OpenDuet source research

The owner confirmed **CopilotKit/OpenDuet**. The other similarly named projects
below are retained only to document the initial disambiguation; their behavior
must not be attributed to the selected reference. OpenDuet is reference material,
not a decision to replace Chief or install an additional agent platform.

### CopilotKit/OpenDuet

Source: <https://github.com/CopilotKit/OpenDuet/blob/main/README.md>.
Reviewed README Git blob: `f0f2b04d4fce21fc0d4a6eab497d346df2175a61`.

Useful patterns: daily prioritization; background completion of assigned work;
explicit handling of consequential actions; durable tasks with working,
review-ready and input-needed states; a dependency checklist based on actual
connectivity checks. Its runtime and hosted thread/memory dependency differ from
Chief. Reusing the operating ideas does not imply adopting those dependencies.

### Studio1-OSS/OpenDuet

Source: <https://github.com/Studio1-OSS/OpenDuet/blob/main/README.md>.
Reviewed README Git blob: `0596b8182fe52c72319309526487744228a923fa`.

Useful patterns: explicitly enabled briefs and periodic checks; quiet hours;
silence when no meaningful change is found; a bounded missed-brief window after
sleep; background work in separate threads; additional checkpoints for external
or destructive actions initiated without a fresh user request. Its routing,
model provider and runtime are different from Chief and are not inferred to be
installed capabilities.

### gabrielekarra/openDuet

Source: <https://github.com/gabrielekarra/openDuet/blob/main/README.md>.

This is another independent Python-based project with a Mac background-service
quickstart, private Telegram pairing and on-demand application access. The Mac
must remain awake and its service running. These are source-specific behavior
claims, not evidence of Chief's corresponding Mac behavior.

## Proposed protocol requirements for review

These are acceptance targets, not claims that every item is implemented.

1. An agent starts from an assigned objective or a customer-enabled event or
   schedule. The initiating authority and scope remain visible.
2. It inspects relevant permitted context, identifies the next useful step,
   performs authorized routine work, and delegates to selected installed
   specialists when appropriate. Missing specialists must be reported rather
   than fabricated.
3. It verifies the actual output, records the result and its location, and keeps
   track of unfinished work. A model's successful turn alone is not delivery.
4. It resumes authorized work after a recoverable interruption without replaying
   a completed external action or losing a previous successful artifact.
5. It notifies the customer for a useful completion, meaningful change, blocker
   or decision. Unchanged background checks should remain quiet.
6. Routine reads, research, internal drafts, approved document work and in-scope
   coordination should not require a card for every step. Exact grants remain
   enforced at the tool boundary and through delegation.
7. Actions beyond the customer's grant, consequential external actions, unclear
   intent and failed policy evaluation require an actionable checkpoint. A
   prior specific authorization should not be needlessly requested again, but
   must not become an unrelated blanket grant.
8. The installer must verify the effective conversation mode and the loaded
   Hermes plugin/policy, rather than merely writing Auto into a bot default.
9. Customers receive portable roles and a reviewed operating protocol, not the
   owner's personal history, private Hindsight connection or existing services.

The newer protocol must be implemented through the scheduler, delegation,
approval and result surfaces where needed. Prompt text alone cannot enforce
authority, prevent duplicate effects, start a sleeping Mac or establish that a
dependency works.

## Mac and customer packaging gaps found

- `scripts/configure-chief-platform.mjs` currently rejects non-Windows startup
  at its host/Docker memory gate (around line 174). A Mac launcher must obtain
  real Mac/Docker metrics and retain a capacity check; removing the gate is not
  a port.
- The Platform setup expects pinned images to exist and uses `pull_policy:
  never`. A customer installer needs a tested acquisition/build path and must
  verify architecture support and compatible Chief overlays. A ZIP of the
  current source alone does not supply those images.
- The standalone desktop source transfer does not install external Hermes or
  its customer profile. The tested HTTP/plugin/command-review combination needs
  its own reviewed version and native Mac acceptance.
- Native Mac app creation, signing, notarization and launch/permission checks
  must run on a Mac. The current Windows machine cannot certify those results.
- The Mac login LaunchAgent currently supervises the Chief server, not the
  entire collection of workspace, companion and external agent services.
  Closing Terminal, restart/login, service recovery and sleep/wake need
  end-to-end tests for the combined installation.
- The intended Agency catalog needs an explicit, versioned customer-safe
  payload. The import handoff contains no roster payload; it is not sufficient
  to reconstruct each specialist's full role from its display name.
- The customer should choose required components and agents, see which
  dependencies and account connections those choices need, and receive honest
  readiness states. Selection is not an access grant or a promise that every
  optional external integration is available.

Official Mac dependency reference reviewed:
<https://docs.docker.com/desktop/setup/install/mac-install/>. It provides separate
Apple Silicon/Intel packages, supported-OS requirements and first-launch/license
steps. Its Docker minimum is not a measured resource requirement for the full
Chief stack. No minimum full-stack memory, install-time or concurrency claim has
yet been established.

## Working assumptions and open decisions

Confirmed scope: **Windows and macOS; both spaces local on each computer**.
TeamViewer is the Mac transfer/support channel, while Chief's own services provide
operation. An earlier Mac-only first-pilot framing is superseded. Each supported
architecture/hardware target and load limit must be checked before making a
release promise. A hosted shared workspace is outside this first installation
scope.

Customer data remains separate per installation and personal agent history stays
private from shared organizational work. Reruns and updates must preserve user
edits and distinguish existing working services from newly owned test resources.
Setup should resume after interruption and expose failed or skipped components.

Decision log:

| Decision | Source/status | Alternative or unresolved point |
| --- | --- | --- |
| Install both personal and shared environments | Explicit owner requirement | A desktop-only package is insufficient. |
| Individual Agency agent selection | Explicit owner requirement | Catalog packaging and dependency handling remain to be designed. |
| Use existing proactive/approval work | Explicit owner requirement; verified October 31 evidence | Do not regress to per-step Ask or substitute an unrestricted grant. |
| Produce ZIP after setup preparation | Explicit owner requirement | A documentation/source handoff must be labelled if native installer work remains. |
| Use CopilotKit/OpenDuet as the protocol reference | Explicit owner selection | Other same-name repositories are not the chosen protocol source. |
| Support Windows and macOS, both spaces local | Explicit owner correction and local-topology confirmation | Supersedes earlier Mac-first framing; native architecture acceptance is still required. |
| Customer-safe profiles and data separation | Required by existing project handoff and memory boundary | No owner credentials, private shared-memory connection or live profile export. |

No new installer, ZIP, runtime policy, customer agent import, scheduled routine,
permission change, deployment or Mac verification was performed during this
discovery step.
