# Chief complete local installation — design

Status: **APPROVED design; member provisioning and background enforcement implemented for engineering testing.**
The Windows/macOS testing package is being assembled. See
[`installer/BUILD-REPORT.md`](../../installer/BUILD-REPORT.md) for implemented
scope and the remaining native, lifecycle and background-control work.
Owner scope confirmed November 3, 2026: **Windows and macOS**, with the personal
space and shared workspace both running locally. CopilotKit/OpenDuet is the
selected protocol reference. See the companion discovery document for verified
source paths and gaps.

## Product outcome

One guided installation prepares a customer computer, installs and connects both
Chief spaces, installs only the Agency specialists selected by that customer,
and establishes proactive work with fewer repetitive approval prompts. Completion
requires a demonstrated workflow, rather than files copied or a green process.

Customer accounts, conversations, memory and workspace data are new or explicitly
reused customer state. The owner's running installation is never a deployment
template. Ordinary use should require no terminal commands.

## Approach and alternatives

**Selected engineering approach for review: one versioned installation engine
with native Windows/macOS entry points and a local setup wizard.** The engine
owns planning, verification, resumable steps, catalog selection and receipts.
OS adapters own prerequisite acquisition, installation paths, service startup,
permissions and native package verification. This keeps the product behavior
consistent while acknowledging real OS differences.

Alternative: independent scripts/installers for each OS. Less initial shared
structure, but the agent catalog, approval defaults, repair behavior and readiness
checks would drift. Rejected for the complete workflow.

Alternative: one large offline archive containing every binary and container
image for every architecture. Useful as a later distribution option, but it adds
substantial transfer, signing, redistribution and stale-artifact work. For this
first connected installer, a small native bootstrap acquires only the locked
artifacts needed by the current OS/architecture. A release ZIP is the transfer
envelope, not evidence that acquisition or installation succeeded.

## Setup experience

1. **Check this computer.** Detect OS/architecture, available resources, existing
   Chief/services and occupied ports. Show what is reusable, missing or blocked.
   Existing unrelated applications are not stopped to make room.
2. **Choose the team.** Search and filter a versioned Agency catalog; select
   agents individually or select a division's individual entries. Show each
   role and required provider/tool connections. Bacca/Solo coordination roles
   are visible recommended choices, not hidden additions. Proactive readiness
   requires explicitly selected profiles bound to coordinator and operator role
   slots, with their required capabilities. Customers can select other suitable
   profiles; removing a reference profile does not silently replace it. With a
   required slot empty, both spaces can be installed but the complete proactive
   workflow is `needs configuration`, not ready. Do not silently install a
   missing division chief or specialist merely because a selected agent mentions
   one; offer its dependency or report the unavailable capability.
3. **Choose account providers.** Collect provider choices and identify which
   software and sign-ins are missing. Perform a customer-owned sign-in here only
   when its prerequisites already work; otherwise defer it to the installation
   phase. Resolve actual available models after sign-in, without silently
   substituting a model. Tool connections and workspace membership are separately
   granted, rather than inherited from selecting a role.
4. **Choose the operating scope.** Explain routine Auto work, consequential
   checkpoints, approved working folders, background schedules and any costs or
   concurrency limits. A customer can see and revise these choices later.
5. **Review and install.** Show components, downloads, storage and local services.
   Install missing prerequisites through verified native distributions, then
   perform deferred provider sign-ins and model resolution before configuring
   dependent profiles. Pause for OS permission, license acceptance or sign-in
   only where necessary, then resume the same installation after restart or
   cancellation. Distinguish missing software from an unconnected account.
6. **Prove readiness.** Test both spaces, selected-agent import, provider routing,
   effective approval behavior, a real disposable scheduled run, artifact
   delivery and service restart. Provide repair actions for failed components.

States are `not installed`, `installed`, `needs connection`, `needs permission`,
`checking`, `ready` and `failed`. A skipped optional integration can remain
unconnected without blocking the installed core; a required missing dependency
cannot be shown as ready. A provider health response is not a tested agent task.

## Component and artifact model

The release defines an exact component graph: Chief personal host/desktop;
retained collaboration services with the Chief-compatible Accounts and frontend
overlays; required lifecycle bridge; Hermes runtime and matching HTTP/plugin
integration for the full proactive workflow; provider CLIs; selected agent profiles; and explicitly
selected optional computer, media or remote-access components. Do not equate all
software on the owner's machine with a customer dependency.

Every release component has a version, supported OS/architectures, source/license
provenance, expected hash or container digest, dependencies, installation probe,
readiness probe and repair procedure. Native executable signatures are checked
where the distributor supplies them. Downloads use allowlisted official or
Chief-controlled origins and reject unexpected redirects or checksum mismatch.
The release manifest is authenticated separately from its payload checksums.

Personal runtime, application profile, shared workspace storage and credentials
remain distinct. Use a stable installation ID for service/network/volume names
and a registry of owned paths and ports. Reject collisions with another install.
Never use this machine's fixture workspace IDs, source `.chief-local` manifests,
account tokens or fixed customer identity as template configuration.

The setup entry point should be packaged and signed for its OS. A protected
loopback setup session launches the local wizard and disappears when setup ends.
If a browser-based wizard is used, bind loopback only, validate Host/Origin,
require a per-session unguessable capability for mutation, and prevent unrelated
websites or LAN clients from changing setup state. No credentials in URLs or logs.

## Agent catalog and customer profiles

Create a release-pinned catalog of reviewed portable role definitions, with
stable catalog IDs, revisions, divisions, source/license references, description,
instructions, provider capability requirements and separately displayed optional
tools. The owner-authorized roster is the source of the existing customization;
do not replace it with a fresh generic download.

Discovery found 181 candidate Agency/Council roles in the reference roster. A
bounded scan found owner-specific naming in the five Council instructions, so
the live roster cannot be bundled untouched. Preserve approved role meaning in
customer templates while reviewing every exported field; exclude live bot/task
IDs, chat history, OAuth material, grants, computer assignments, paths and memory.
Do not infer full specialist instructions from display names.

Reuse the supported team-manifest import API for its portable fields. Store a
catalog-ID/revision-to-target-ID mapping separately. Resolve model assignments,
division chief flags, approval policy and optional workspace access through their
actual supported APIs; the manifest does not encode these. Re-running setup adds
no duplicates and never resets customer-edited instructions. Existing matching
names are reconciliation candidates, not proof of identity. Show created,
existing, conflicting and failed profiles independently.

The current team model permits one Chief of Staff: Bacca remains coordinator in
the reference role template and Solo is the execution counterpart. Selecting
Solo must not silently demote Bacca. Core roles, specialists and optional Council
roles remain visible installation choices, with coordination requirements shown.
The product binds the coordinator and operator capabilities to two explicitly
chosen profiles, rather than relying on their names. Empty or incompatible
bindings leave proactive setup incomplete. Changing an existing Chief of Staff
is a visible configuration change, not a side effect of selecting another agent.

## Proactive operation and approvals

Use the companion protocol as the product contract. The main rule is to perform
routine authorized work and deliver its verified result, interrupting the person
for a useful decision rather than each tool operation. Preserve the tested Hermes
routine/command-review work as the baseline; verify the actual loaded runtime,
plugin and active conversation modes. Writing Auto to a bot default is insufficient.
For the first full-workflow release, the coordinator/operator use the reviewed
Hermes HTTP/plugin combination. Omitting it leaves that workflow unready even
if both spaces run. Native Codex/Claude specialists may receive only scopes and
approval modes validated by their adapter tests; generic Auto does not establish
equivalence with Hermes command review. Every advertised runtime/provider pair
needs its own allowed-work and consequential-denial acceptance cases. Unsupported
combinations remain clearly unverified and cannot be used for unattended work.

The existing routine native-read allowlist does not itself validate file paths.
Customer reduced-approval mode therefore requires an adapter-level read boundary
before it can be admitted: selected document/working roots and explicitly
published skill/reference roots, resolved at the read boundary with escape and
symlink protections. Credential stores, provider homes, private configuration,
signing material and other customers' data are excluded from automatic raw reads.
Connected-source reads retain their connector/member authorization. An adapter
without this enforcement must remain unready for that reduced-approval contract;
the current allowlist is not presented as already satisfying it.

One important OpenDuet pattern is avoiding a double request: when the tool already
opens the authoritative action-approval card, the agent should prepare the exact
action and call that tool rather than first asking permission in chat. A denied
action remains denied; it cannot be retried through another agent, shell or tool.

Use Chief's own Routines, Webhooks, delegation and result machinery. OpenDuet's
framework, hosted memory dependency and tool names are not transplanted.
Background suggestions are separate from permission to execute an external
action. An enabled schedule carries an identified customer and scope; delegated
and resumed work retain that provenance and recheck current grants.

## Reliability, capacity and maintenance

Assumed first-release scale: one signed-in OS user and one local Chief
installation per pilot machine, with its own shared-workspace organization.
Multi-machine collaboration or fleet management is not implied by local setup.
Start heavy steps sequentially. Establish actual memory, storage and concurrency
limits from clean native pilots; do not publish guessed full-stack minimums.
Docker's minimum is not Chief's complete resource requirement.

The engine persists an atomic step ledger with inputs/version hashes, ownership,
verification results and only non-secret recovery references. A lock prevents
simultaneous setup/repair processes. After interruption, probe effects already
performed before retrying; do not replay account creation or other non-idempotent
effects on a missing acknowledgement. Stage software before activation, keep old
artifacts and use consistent supported backups for any data-affecting update.

Installation permission does not grant permanent admin authority to agents.
Updates are a separate user-visible operation preserving customer customizations.
An uninstall or rollback affects only owned software/services; retaining customer
data is the default. No broad container cleanup, volume deletion or profile reset.

Windows uses supported native installation and startup mechanisms; its container
backend must be confirmed operational. Mac uses native packages and login services
with Keychain-compatible credential storage. The whole required service graph
must be supervised, not just the desktop process. OS sign-in, computer sleep and
model-provider availability remain real limits; no before-login or always-on
promise follows from a login service.

## Build and verification gates

1. Version and package a portable catalog with field review and provenance.
2. Establish a reproducible build/acquisition route for the complete compatible
   workspace service/overlay set. The current private Windows image IDs and
   fixture-bound rollout receipts are not distributable customer assets.
3. Implement shared setup state and probes with Windows/macOS adapters. Port
   the existing Windows-only Platform resource gate rather than deleting it.
4. Verify the wizard, import/reconciliation, credential handling, native startup,
   provider routing and proactive/approval contracts with disposable fixtures.
5. Run clean Windows and Mac installations on declared architectures. Test an
   interrupted install, repeat install, existing-user update, reboot/login,
   sleep/wake, dependency failure and repair without losing existing data.
6. Build/sign the native packages, check the final installed artifacts and
   customer account isolation, then create per-platform customer ZIP envelopes
   with integrity manifests, release identity and exact readiness evidence.

Before native Mac acceptance, a separately labelled **engineering transfer ZIP**
may carry the reviewed source/build inputs, setup candidate, role catalog and
test instructions to that Mac through TeamViewer. Its manifest states its exact
unverified gates. It contains no owner state and is not a customer installer.
The customer Mac package is produced only after its native acceptance succeeds.
Windows needs its own native package/acceptance, not a ZIP containing the Mac
launcher. Release can claim only the OS/architecture combinations actually
tested. No gate is cleared by this design document.

## Decision log

| ID | Decision | Alternative and rationale |
| --- | --- | --- |
| D1 | Windows and macOS, both spaces local | Explicit latest owner correction; supersedes Mac-only framing and server-hosted shared workspace. |
| D2 | CopilotKit/OpenDuet is the protocol reference | Explicit owner selection; similarly named repositories excluded as protocol authority. |
| D3 | Shared setup engine and native adapters | Chosen engineering proposal; avoids independent OS scripts drifting while keeping native lifecycle differences. |
| D4 | Connected bootstrap with locked artifacts | Proposed first release; full multi-architecture offline payload deferred due distribution/maintenance cost. |
| D5 | Individual, versioned role selection and additive import | Explicit owner requirement; name-only reconstruction and wholesale live-profile cloning rejected. |
| D6 | Existing routine Auto and command review, with consequential checkpoints | Explicit fewer-approval goal; per-tool Ask and blanket unrestricted execution rejected. |
| D7 | First-class triggers, provenance, budgets and verified deliverables | Proactivity is an execution contract; prompt-only behavior cannot satisfy it. |
| D8 | Engineering transfer before native tests; customer ZIP after native acceptance | Breaks the transfer/test circularity while keeping engineering inputs distinct from a verified customer installer. |

Implementation approval, review objections and their dispositions are recorded
in this document as review progresses. The owner's confirmed product scope is
not a claim that this engineering proposal has passed review or is implemented.

### Skeptic review disposition

Four design objections accepted and resolved: D8 now separates the pre-acceptance
engineering transfer from customer distribution; D6 makes the reviewed Hermes
path required for full proactive readiness and requires adapter-specific tests;
D5 defines explicit coordinator/operator bindings when reference roles are
deselected; D7 now has a concrete background admission/missed-window contract in
the protocol. None of these resolutions claims implementation or release proof.

### Constraint review disposition

Both objections accepted: D6 now requires scoped native-read enforcement before
customer reduced-approval admission, including protected credential/configuration
exclusions; D7 defines one root workflow slot with descendants sharing durable
budgets and deadlines. Restart cannot reset the budget. Native release evidence
remains an explicit future gate, not a condition for accepting the design itself.

### User advocate review disposition

Both objections accepted: provider selection can precede installation, but actual
sign-in waits for working prerequisites; software readiness and connection state
are distinct. The protocol now defines a persisted active-execution budget that
pauses only in recorded `needs input`, while the authoritative card retains its
own expiry. Expired cards visibly report no execution and cannot silently resume.

### Final arbitration — APPROVED

The Integrator/Arbiter accepted the revised design after the sequential Skeptic,
Constraint Guardian and User Advocate reviews. All eight objections were
accepted and resolved; none was rejected. Review task references in the current
Codex chat: `installer_skeptic`, `installer_constraints`, `installer_usability`
and `installer_arbiter`. The arbiter found no remaining material design
contradiction.

This is design-review approval, not owner production-rollout approval or evidence
of an implemented installer. Catalog sanitization, portable artifact acquisition,
the shared setup engine/native adapters, policy enforcement, native Windows/Mac
builds, signing and clean full-workflow acceptance remain open work. Customer ZIPs
cannot be labelled ready until their corresponding release gates pass.


## November 4 implementation update

Automatic authenticated-member profiles, lifecycle provisioning, fresh database bootstrap and durable shared request/time budgets are now implemented. The dated review above records the original design gate. See `installer/BUILD-REPORT.md` and its verification receipt for current evidence and remaining native target acceptance.
