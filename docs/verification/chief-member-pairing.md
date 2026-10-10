# Chief member pairing backend verification

This is CON-01 development evidence, not full M1 or production acceptance.

Run from the repository root:

```sh
npm ci --prefix integrations/platform/lifecycle --ignore-scripts
npm test --prefix integrations/platform/lifecycle
node scripts/verify-chief-member-pairing.mjs
node --test integrations/platform/patches/chief-session.test.mjs
node integrations/platform/patches/verify-chief-pairing-source.mjs
node integrations/platform/patches/verify-frontend-patch-stack.mjs
pnpm exec vitest run server/chief-pairing.test.ts server/routes/chief-pairing.test.ts src/components/SharedWorkspacePage.test.ts server/workspace-backup-policy.test.ts scripts/testing/index-route-ratchet.test.ts
```

The integration runner requires the existing synthetic acceptance, partner and
outsider browser-state files in ignored `.chief-local/platform`, plus the retained
Platform endpoint on localhost port 18087. Those credentials never enter evidence.
It verifies current identities through Accounts and caller-scoped Contacts reads.
It does not write to the owner's Platform workspace or database.

The runner creates a labelled, disposable CockroachDB container using the existing
pinned image. SQL is published to a random host-loopback port; the database is
in-memory with a 1 GiB container limit. The fixture invokes the database binary
directly because the image's initialization wrapper restricts listen addresses.
Insecure SQL is confined to this disposable fixture; this is not a production
database configuration. Schema setup uses the fixture administrator; all pairing
operations use a service role with table DML permissions and no admin grant.
Cleanup verifies ownership and absence of mounts before removing the fixture.

The receipt at `evidence/chief-member-pairing.json` reports actual coverage:
two-member/two-workspace isolation, signed two-sided pairing, challenge concurrency,
replay and scope rejection, encrypted credential persistence, a fresh service and
database client, expiry, logout, HTTP origin/cookie binding and account switching.
The runner also removes the ordinary synthetic partner through Accounts, using
an exact `chiefacceptance` workspace guard, pre-created email-bound single-use
restoration invitation and a private recovery record. Its `finally` restores the
same member and role. Membership restoration must succeed before acceptance;
the old runtime must remain denied. Entitlement loss still uses explicit doubles.
Security unit tests cover privileged-token rejection, authoritative
identity mismatch, active-person requirements, unavailable authorization and
encrypted credential binding/tamper rejection.

The personal runtime adapter is in `server/chief-pairing.ts`, its owner-only HTTP
route is `/api/chief-pairing`, and it is disabled unless `CHIEF_LIFECYCLE_ORIGIN`
is configured. That exact HTTPS origin (loopback HTTP only for local development)
is deployment configuration, never invitation-controlled. The new workspace
component and logout/account-switch hooks are frozen in native patch 0012.
Personal credentials use an atomic file inside `.chief-pairing-private`, excluded
from portable backups; they are not OS-keychain encrypted. On Windows its DACL
allows only the current owner and SYSTEM, with parent inheritance disabled before
any secret is written. Atomic temporary files inherit that private directory ACL.
On Unix the directory/file modes are 0700/0600. Startup rejects links, hard-linked
files and conflicting stores. A pre-existing root-level pairing file is checked
and moved by rename, preserving its identity. No parent data-folder ACL is changed.
ACL operations use the Windows access-control APIs; see the
[Microsoft access-control reference](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/set-acl?view=powershell-5.1).

This boundary excludes other ordinary OS accounts, remote workspace members and
browser clients. It does not isolate credentials from administrators or agents
given arbitrary shell/file access as the same owner. Do not mount the private
directory into specialist containers or offer it as a tool resource. RUN-01/02
must use a constrained worker identity/container if untrusted shared work can
execute code; a hidden path, mode bits or DPAPI alone do not provide that boundary.
Workspace bearer tokens never cross the
workspace iframe into personal Chief. Logout can revoke its own HttpOnly session
without membership or entitlement still being present; exact Origin is required.

For the separate component browser fixture, run:

```sh
node scripts/verify-chief-member-pairing.mjs --browser
```

It prints a loopback URL and a stop-file path. Use CUA to drive the real compiled
Svelte workspace card and React personal panel. The surrounding shell, synthetic
sign-in controls and client API facade are fixture-only. No real specialist runs.
After closing the test tab, write the printed stop file to let the runner shut
down its own servers and remove its labelled database. Do not kill Docker or
remove unrelated containers. Receipt: `evidence/chief-member-pairing-browser.json`.
Current observed checks: invitation, pending denial, compare-code approval,
refresh persistence, switch member with no previous connections visible, explicit
revocation and sign-out with subsequent signed-runtime denial.

Remaining: production service/secret/proxy configuration, CON-02 entitlement
adapter, operational migration/key protection review, full compiled-workbench
acceptance and actual specialist execution/recovery. Test auth hooks directly
and in the component harness do not substitute for the complete native workbench.
The earlier development receipt predates membership epochs. The epoch-enabled
candidate additionally revokes removal/re-addition entirely between requests, as
verified below. Multi-tab transition
races and outage/rollback UX need release review. In an enabled paired workspace,
logout/switch waits for successful revocation; revoke sessions before disabling
the service for rollback. Ordinary personal tasks do not depend on this service.
Restart evidence recreates the service/client, not the
in-memory database. Do not run this migration against the active database based
on this development receipt. The new service is not deployed; existing services
and local runtime data remain in place. Rollback of development code requires no
runtime change.
# October 10 deployment-candidate verification

`node scripts/verify-chief-lifecycle-release.mjs` passes against the actual
candidate image behind nginx, with a disposable disk-backed CockroachDB volume
and the existing synthetic acceptance identities. See
`evidence/chief-lifecycle-release.json` and the operational runbook at
`integrations/platform/lifecycle/README.md` (repository-relative).

Coverage includes restricted SQL roles, repeat migration, real membership,
member isolation, partitioned cookie, service/database/runtime restarts,
operator policy changes and malformed-policy recovery, proxy outage, offline
encryption-key rotation and reverse rotation, concurrent stale-cookie replacement,
and emergency revocation. Existing running container IDs were identical before
and after; cleanup removed only uniquely named and ownership-labelled fixtures.

The latest native helper uses Web Locks and clears an ended cookie before creating
another session. Nine helper tests plus ten service security/configuration/policy
tests pass. The component browser receipt below is an earlier fixture checkpoint;
it does not certify these latest coordination changes in the full workbench.

The production build was attempted but refused to start: 822 MiB Windows memory
available versus 4096 MiB required by the already-approved constrained profile.
No production assets were overwritten. Production TLS/secrets, full native
multi-tab/logout/outage behavior, Windows private-key boundaries, and authoritative
membership removal/re-addition between requests remain open. No live rollout.


## October 10 combined epoch-enabled release verification

Run `node --experimental-strip-types scripts/verify-chief-membership-epochs.mjs --release-image`.
This creates an actual candidate Accounts container with disposable synthetic
identities, uses a narrowly validated Employee stub, and runs the lifecycle/nginx
release suite against a separate disk-backed fixture database. It never reads the
owner's credentials. The private manifest is accepted only beneath the ignored
pairing fixture directory and must identify a running, labelled candidate
Accounts container. Receipts: `evidence/chief-membership-epochs-container.json`
and `evidence/chief-lifecycle-epochs-release.json`.

The epoch-enabled images pass pairing, member isolation, restarts, restricted
SQL roles, policy loss/recovery, outages, key rotation/reversal, concurrent session
replacement and emergency revocation. The earlier pre-epoch receipt is historical.
Owner container IDs remained unchanged and only owned fixture resources were removed.

Windows private storage is now verified with the actual OS ACL implementation,
including inherited atomic writes and preservation of identity across restart
and migration. The credential threat boundary is described above. Focused tests:
`pnpm exec vitest run server/chief-pairing.test.ts server/routes/chief-pairing.test.ts server/workspace-backup-policy.test.ts server/atomic.test.ts`.
57 pass; one existing platform-specific atomic-write test is skipped on Windows.
Server TypeScript and 21 lifecycle/session Node checks pass.

Full native-workbench browser acceptance and deployment configuration/rollout
remain pending. The frontend build still requires more available Windows memory.
This checkpoint does not certify a live deployment or real specialist execution.
