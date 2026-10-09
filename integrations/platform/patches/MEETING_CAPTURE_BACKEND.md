# Meeting notes backend — increment 0005 fragment

This is prepared source, not a deployment or capture acceptance claim. The agreed
wire contract is `docs/architecture/chief-meeting-capture.md`. The backend changes
only Love `capture.ts`, `captureRoutes.ts`, `main.ts`, and `config.ts`; deployed
patches0001–0004 remain frozen. `capture-backend-source/` and the fragment patch
preserve exact inputs for the combined0005 export owned by the coordinator.

The state machine uses an immutable person/account/LiveKit identity+SID snapshot,
unanimous explicit votes, a single serialized private metadata store, short RTC
tokens and renewable worker leases. It stops on verified attendance webhooks and
two-second fresh roster checks. Account service `getLoginInfoByToken` resolves the
current database workspace role; `getWorkspaceMembers` independently confirms it.
Active Employee and caller-scoped meeting/room reads remain required. Restricted
room history also requires the existing unexpired signed acceptance. Historical
membership in a capture does not override current workspace/room revocation.

Only exact worker identities recorded in this store are excluded from the human
snapshot. Worker grants cannot publish tracks/data or update metadata. Revocation
persists stopping before removing the exact listener; removal failure cannot
report processing. Reconnects after stop are evicted. Restart invalidates active
jobs and removes stale listener identities before routes become available.

The worker secret is distinct from Platform and LiveKit credentials. Metadata
contains no tokens. The configured directory must be a private persistent mount
owned by the single Love instance (the store is not a multi-replica database).
Snapshots use mode0600, fsync and atomic rename. Corrupt/oversized stores fail
closed; capacity is 200 durable session/tombstone entries and 16MiB metadata.
Before allocating a session, acknowledged deletion tombstones are compacted only
after their issued RTC token and lease window expire. Unacknowledged cleanup
receipts always remain, so a capacity limit cannot silently discard raw-audio cleanup.
Transcript output is capped at4000 segments/512KiB; speaker names/IDs are stamped
from the frozen roster. Deleted content is immediately inaccessible; cleanup
commands remain pending across restart until acknowledged. No automatic retry
joins a room: requester-approved retry only reprocesses retained audio.

Verification: 21 new fixture-only core/real-Express route cases plus27 existing
admission/presence cases pass. Scoped Love TypeScript no-emit validation passes.
Run `node --test integrations/platform/patches/meeting-capture*.test.mjs`.
No owner records, devices, running services, images or schema were changed.
Production worker/UI integration, actual generated-audio transcription and
participant consent/late-join end-to-end gates remain required.

Rollback disables capture configuration and restores the prior Love image while
retaining the private metadata/audio directories for authorized recovery/deletion.
There are no workspace migrations or changes to existing member meeting controls.
