# CON-01 local deployment — October 10, 2026

The owner selected **Current local Chief workspace** and explicitly authorized
the isolated Playwright release tests. This is the existing loopback installation,
not a Google Cloud or production TLS release. Shared specialist dispatch remains
disabled. M1 as a whole is not complete.

The frontend and Accounts containers were replaced with verified immutable images.
The remaining 15 original containers and all 17 original storage mount sets were
preserved. A separate `chief-lifecycle-local` Compose project adds one non-root,
read-only, capability-dropped service on the existing private network. It publishes
no host ports. Nginx routes `/chief/v1/` through its existing loopback port 18087.

Evidence:

- `evidence/chief-member-pairing-workbench.json`: full compiled UI, including the
  outage/retry bug fix in Settings sign-out. A failed revocation now retains the
  workspace so the member can retry instead of navigating away early.
- `evidence/chief-con01-local-rollout.json`: account/service images, before/after
  containers, storage mounts and the database backup location.
- `evidence/chief-con01-deployed.json`: actual deployed Accounts membership epochs,
  active Employee checks, browser confirmation, reload, member isolation,
  account switching, stale-tab behavior and logout. The actual cross-site sandboxed
  iframe also retains its partitioned pairing cookie on reload and revokes it on
  sign-out. Synthetic members only;
  no authority stubs in this deployed test.
- Current-build consent, recording, meeting capture, template and embedded playback
  receipts passed. Embedded playback also passed after deployment.

The personal preview on 5299 was restarted with `--with-local-media
--with-chief-pairing`, retaining its original data directory, provider home and all
nine agent IDs. Its private pairing origin is saved in `.chief-local/preview.json`
and reused on later starts. The installed desktop baseline remains separately
maintained. No owner connection was automatically paired or approved.

## Local configuration and recovery

Private files live under `.chief-local/m1-pairing/deployment`, protected for the
Windows owner and SYSTEM. This includes the fresh pre-migration Cockroach backup,
an independent copy of its files, previous proxy configuration, personal preview
data recovery copy, encryption key and separate migration/runtime SQL credentials.
No credentials or private configuration belong in Git or shared memory.

The local service uses the explicit staging mode for the existing loopback HTTP
and private Docker SQL transport. Production mode still requires HTTPS and verified
database TLS. The runtime role has table DML plus read-only migration-ledger access;
the migration role owns the dedicated lifecycle schema.

`policy/grants.json` allows the one existing owner to select from their nine local
agents, with `workspace:read` only. The two existing synthetic acceptance members
have only their synthetic specialist IDs. These eligibility grants expire
**November 9, 2026**; the file records the exact UTC expiry. Eligibility alone does
not establish a connection: both personal-runtime selection and workspace approval
are still required. Replace this operator policy through CON-02; it is not a
commercial-tier allocation.

`scripts/deploy-chief-con01-local.mjs --apply` refuses to overwrite an existing
preparation or pre-existing database roles. `--resume` validates the saved state
and completes a prepared rollout. Inspect the saved checkpoint before resuming.
The persistent `.chief-local/platform/con01-account.compose.json` contains only
the verified Accounts image; standard starts and frontend rollouts validate and
include that override. Do not remove it or restart an old Accounts writer over
the upgraded membership schema.

The health probe uses `node:http` so the exact Host header reaches the service;
Node 24 `fetch` silently dropped the custom Host and incorrectly returned 403.

For emergency disable, stop lifecycle writers, revoke its sessions using the
restricted runtime credentials, restore the saved proxy configuration and reload
nginx. Keep the epoch-aware Accounts image, schema, backups and owner volumes.
Do not use a pre-epoch binary as rollback. A database restore must first be tested
in separate storage; no in-place database restore was performed during rollout.

Current verification command (synthetic accounts only):

```powershell
node --experimental-strip-types scripts/verify-chief-con01-deployed.mjs
```

Gmail Ninja's `Crewframe G Ninja` scheduled task remains disabled at the owner's
request. Deployment did not re-enable it. No commit or push was performed in this
deployment turn.
