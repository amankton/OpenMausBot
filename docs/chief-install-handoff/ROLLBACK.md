# Upgrade and rollback

Before replacement, record the actual installed version and architecture, active runtime/work status, current configuration/profile hashes and saved workspace selection. Preserve the complete application and an appropriate consistent workspace/database backup. Keep credentials in their normal protected store.

Use the platform's supported installer/service controls. Do not terminate an unknown process, start two servers on one data directory, restore another owner's workspace or repeat an action rejected by automatic review through another mechanism. A source runtime hosted separately from the desktop may need its own normal owner-controlled stop and restart; closing the desktop is not proof that source runtime stopped.

After upgrade, compare installed executable/version and critical resources with the exact tested package. Confirm profiles/models/permissions and saved workspace choices remain intact. Read back the feature routes from each intended runtime, including a separately hosted Full workspace; renderer changes alone do not activate new backend code.

If application rollback is needed, restore the previous application through supported installer controls. Retain newer healthy owner data, pending work, deduplication tombstones and unknown-action receipts. Never restore entire older bot records over newer user work merely to revert an instruction addendum. Revert only the specific reviewed revision when its current hash still matches the installer's own write.

Reviewed trust policies and one-use action capabilities are machine/provider-specific authentication state. Portable workspace exports omit `connector-trust.db` and its SQLite journals. A receiving owner must authenticate and review new grants. Local stopped-application recovery is distinct from distributing a portable template; protect its private data accordingly.

An unknown mailbox action outcome is not permission to clear its journal or retry. This release deliberately has no owner reset/replay endpoint for an uncertain action. Preserve the receipt and inspect authoritative provider evidence; a separately reviewed reconciliation feature is required before authorizing a replay. A rollback must never replay an uncertain send/delete/draft operation.
