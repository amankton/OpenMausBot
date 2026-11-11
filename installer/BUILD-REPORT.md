# Windows / macOS workflow test build

Version `0.2.0-test`, November 4, 2026. Automatic member provisioning and unattended-work budgets are implemented. This remains an engineering candidate pending native Mac acceptance. It includes source/build inputs and compiled Linux workspace overlays, with Windows x64 and Intel/Apple Silicon Mac launchers. Internet is required; newly signed NSIS/DMG artifacts are not included.

## Automatic member provisioning

Setup initializes fresh workspace/lifecycle databases, runs checksum-verified migrations, and grants the lifecycle runtime restricted schema access. The migration identity is not mounted in the running service. Lifecycle runs behind the local workspace proxy.

An authenticated member with a current membership epoch and active Employee receives a profile from the selected operator template. Each workspace/account has a stable identity and separate working folder. A private signed broker journals creation and reconciles retries, lost acknowledgements and service restarts without replacing customer edits. Deleted or ambiguous profiles remain visible for repair; they are not silently recreated.

The personal connection panel selects the profile assigned to the invitation's workspace/account. Both sides still confirm the connection. Default Tracker access is read only. Writes require the optional selection and matching workspace confirmation, then normal consequential action checkpoints. Provisioning policy is an entitlement ceiling, not an automatically active write connection.

Provisioned profiles require renewable 60-second membership leases. Authority outages do not renew them. Expiry or revocation stops affected background workflows and descendants. Workspace tools additionally recheck membership per request. Customer workspaces never receive the install owner's credentials or memory connection.

## Unattended-work enforcement

- Maximum 20 enabled routines and at least 15 minutes between firings.
- One active background root workflow per installation.
- Shared maximum of 20 provider requests and 10 minutes of active work across coordinator, specialists, room turns, continuations and auxiliary reviews.
- Durable reservations before physical provider HTTP dispatch, including SDK retries. Unknown responses still consume their reservations.
- Fail-closed admission hooks in the pinned Hermes source, plus an HTTPX request guard. Uncounted transports and workers missing Chief context cannot dispatch unattended provider calls. Request/time limits are not a guaranteed monetary cap.
- Only real server-recorded human requests pause active time; running descendants keep it active. Resume checks the root slot, remaining budget, membership lease and current model/folder/tool grants. Cards retain expiry.
- Stop, exhaustion and revocation close the root and interrupt descendants. Potential effects are durably recorded. Interrupted routines are disabled for review instead of automatically replayed.
- Firings over 30 minutes late are skipped, without backlog replay. Ordinary failures notify on the first failure and disable after three, with a final repair notice. Successful execution or explicit re-enable resets the streak.
- Sweep attempts, successful sweeps and successful executions are reported separately.

Setup does not silently enable a schedule. Customers choose schedules in Chief after connecting their own provider and testing draft delivery.

## Evidence and limits

See `VERIFICATION.json` for final check counts. Regression coverage includes the scheduler, Hermes HTTP/approval/command-review bridges, budget ledger, member broker, pairing UI, workspace-backup boundaries, TypeScript and lint. The personal frontend built successfully.

The combined smoke uses the actual Chief API, lifecycle image, nginx and fresh CockroachDB storage. It verifies repeat migrations, restricted runtime DDL, two distinct profiles, read-only pairing, cross-member denial, confirmation, service restart, duplicate prevention and membership revocation. Accounts/Employee responses are explicitly synthetic; this is not a clean real-Accounts/native-workbench installation test.

The exported patched Hermes agent completed a real agent turn in a fresh locked Python 3.14 environment against an owned loopback synthetic provider. Its provider generation received a reservation first. Separate SDK tests cover retries, async calls, 21st-call refusal and missing worker context. No paid model or owner account was used.

Clean OS dependency installation, actual Accounts signup/Employee creation, native provider login, real artifact delivery, Apple Silicon amd64 emulation, reboot/login, sleep/wake and native signing/packaging still require target acceptance. Optional meeting/capture services are outside the base installation.

The bounded credential scan distinguishes bare PEM format markers from encoded key material; it is not a general security audit. No owner databases, runtime profiles, signing keys or credentials are transferred.
