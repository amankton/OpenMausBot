# Chief lifecycle service — CON-01

**October 10 deployment update:** CON-01 is deployed and verified in the existing
local loopback workspace. See `docs/verification/chief-con01-local-deployment.md`
from the repository root and `chief-con01-deployed.json` in its evidence directory.
That update supersedes the earlier local build/deployment blockers below.
Google Cloud/production TLS deployment and specialist dispatch remain pending.

This service pairs an existing authenticated workspace member with their personal
Chief. It provides authorization probes only. It cannot dispatch specialists or
write workspace content. Pairing is enabled in the owner's local preview;
individual connections still require explicit two-sided approval.

## Deployment boundary

`main.mjs serve` checks the schema ledger before listening; it never migrates.
The container runs as `node`, with a read-only root filesystem, no Linux
capabilities, and no published port. Include `nginx-location.conf` inside the
workspace proxy server only after validating the candidate in isolation. Preserve
the exact original Host, including its port, and Origin. No bearer or cookie logs.

`compose.yaml` is an opt-in production overlay. It requires an immutable verified
image, an existing reviewed network, exact HTTPS origin, trusted private Accounts
and Transactor endpoints, restricted database URL secret, dedicated encryption key
and private policy directory. Production requires database `sslmode=verify-full`.
The isolated verifier explicitly permits insecure SQL only on its disposable
staging network. The current localhost owner deployment is not a production TLS
acceptance target.

Never print resolved Compose configuration or secret file contents. URL and key
files are mounted read-only. Provision them through the deployment secret manager
with read access only for the service identity and recovery operator. Keep them
out of Git, workspace exports, browser responses and model-visible folders.

## Schema and credentials

1. Snapshot the selected database with its supported backup tooling and record
   the current proxy configuration and deployed image IDs.
2. Use a dedicated migration role with CREATE permission on the selected
   database. Run the exact candidate image with `node main.mjs migrate` and its
   migration-role URL secret. Re-running checks the migration checksum.
3. Grant the runtime role USAGE on `chief_lifecycle`, SELECT on `schema_version`,
   and SELECT/INSERT/UPDATE/DELETE on `member_session`, `connection_challenge`,
   `member_connection` and `runtime_nonce`. Do not grant DDL or ledger updates.
4. Generate a separate random 32-byte encryption key, stored as base64url in a
   service-only secret file. This is not the Accounts signing key.
5. Start the candidate behind an isolated proxy, verify status, real member
   authorization, paired-runtime restart, logout and rollback before rollout.

Key rotation requires all lifecycle writers stopped. Mount the current key at
`CHIEF_LIFECYCLE_ENCRYPTION_KEY_FILE` and the new key at
`CHIEF_LIFECYCLE_NEW_KEY_FILE`; run `node main.mjs rotate-key`. The operation
re-encrypts all non-revoked credentials in one transaction, preserving the
workspace/account/session binding. Atomically switch the deployment secret to the
new key before restarting writers. Keep the previous key in the recovery secret
store until validation completes. To reverse rotation, stop writers and run the
same operation using the new key as current and the retained original as target.
Do not restore an old key without reversing the data rotation.

For an emergency disable, stop writers and run `node main.mjs revoke-all` using
the restricted runtime role. This permanently revokes sessions and capabilities;
members must pair again. Restore the prior proxy/frontend image and retain the
schema and database for diagnosis. Do not drop the schema or any owner volume.

## Operator-managed entitlements

The commercial permissions matrix is undecided. This release has no implicit
grants based on a browser checkbox, role, or tier label. Missing policy denies
pairing; malformed, expired or wrong-environment policy returns unavailable.
The service reads the file on every authorization, so an atomic policy-file
replacement takes effect without restarting. Mount the directory, not one file,
to allow atomic replacement. A document has this shape:

```json
{
  "version": 1,
  "mode": "production",
  "validUntil": "<UTC expiry>",
  "grants": [{
    "workspace": "<authoritative workspace UUID>",
    "account": "<authoritative member UUID>",
    "pairing": true,
    "bots": ["<explicit personal agent ID>"],
    "scopes": ["workspace:read"],
    "expiresAt": "<UTC expiry>"
  }]
}
```

These are operator-provisioned grants, not a billing integration. Fixture levels
exercise denied/read-only/expanded permissions without defining commercial tiers.
Current Accounts membership and active caller-scoped Employee are still required
on every request, independently of policy.

## Verification and remaining release gates

Run `node --test integrations/platform/lifecycle/*.test.mjs` and
`node scripts/verify-chief-lifecycle-release.mjs` from the repository root after
building `chief-lifecycle:con01-candidate` from this directory. The integration
script uses only existing synthetic acceptance identities, unique labelled test
containers/network/volume, and the actual candidate image and nginx configuration.
It verifies restart persistence, policy loss/outage, key rotation, concurrent
session replacement and emergency disable; it removes only its owned resources.

The full compiled native workbench multi-tab/logout/outage UX, authoritative
membership epochs for removal/re-addition between checks, production TLS/secret
provisioning, and personal-runtime Windows ACL/model-tool access review remain
release gates. Browser component fixtures and container acceptance do not replace
those checks. Do not interpret this candidate packaging as production readiness.

## October 10 membership upgrade — supersedes pre-epoch release instructions

The service now requires `membershipEpoch` from authenticated Accounts results.
Apply the separate `chief-accounts-membership-epochs.patch` to the pinned Accounts
source and test its image in staging first. Its additive SQL migration backfills
existing memberships; each join and changed role receives a new UUID. Unread and
unchanged-role updates preserve it. All Accounts writers must be upgraded before
pairing is enabled. Legacy Mongo Accounts cannot provide the required field.

Lifecycle migration 002 retains 001 unchanged, adds the stored epoch and revokes
pre-epoch sessions/connections. Browser operations, invitation completion and
runtime authorization enforce it. Removal/re-addition and role downgrade/restore
between requests require fresh pairing. An outage or missing epoch fails closed.

Do not enable a pre-epoch lifecycle binary as rollback after this upgrade. Disable
proxy routes and revoke sessions instead; preserve both databases and recover with
an epoch-aware image. Production has no setting to bypass epoch enforcement.

Build the new lifecycle image as `chief-lifecycle:con01-epochs`. The release runner
now selects that image and requires epoch-enabled staging Accounts and synthetic
states; it refuses the owner's old authority before creating resources. Do not
upgrade the owner service just to run tests. The earlier pre-epoch receipt is
historical evidence for that earlier image only.

`node scripts/verify-chief-membership-epochs.mjs --account-image` verifies the real
`chief-account:con01-epochs` container and authenticated RPC, complete native SQL
migrations and strict lifecycle checks in disposable CockroachDB. Active Employee
and outage adapters are explicit fixtures. The legacy pairing regression runner
disables epoch enforcement only in its test objects; it cannot certify a release.

Full combined upgraded-service/proxy/workbench acceptance, production TLS/secret
provisioning and the private runtime credential boundary review remain open.

## October 10 combined-service and credential verification update

The upgraded Accounts and lifecycle candidates have now passed together behind
nginx. From the repository root run
`node --experimental-strip-types scripts/verify-chief-membership-epochs.mjs --release-image`.
The runner creates both synthetic identities in disposable Accounts storage and
uses an explicit Employee lookup stub. It invokes the complete container suite
through a private, labelled fixture manifest; no owner authority upgrade or token
is needed. See `docs/verification/evidence/chief-lifecycle-epochs-release.json`.
All existing container IDs remain unchanged after owned-resource cleanup.

Personal runtime Windows credentials now use a dedicated protected directory
with owner/SYSTEM access, inherited private atomic files, link rejection and
identity-preserving migration. These permissions isolate ordinary OS accounts;
full-access agents running as the owner share that trust boundary. Untrusted
shared code must execute in a constrained worker before RUN-01/02 is enabled.

Remaining release gates are full compiled-workbench browser acceptance,
deployment TLS/secret provisioning and rollout. The current machine has
insufficient free Windows memory for the approved frontend build profile.
Do not deploy based only on component or container checks.
