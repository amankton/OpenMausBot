# Room interaction increment

Patch `0003-room-interaction.patch` applies to the pinned Platform release after
the explicit media-consent and member-admission patches. Its five source files
and hashes are recorded in `room-interaction-provenance.json`.

RoomPreview is shared by full and compact Office. It now exposes native keyboard-
reachable room-entry and invitation buttons and a member picker, accepts workspace-bound person
tile drags, and reports failures instead of implying a person was moved. A self
drop follows the existing authorized meeting join. Another person's drop creates
or reuses the authoritative Platform meeting and sends an invitation through
Love. It does not join that person, create a separate room store, or acquire
devices. Contacts without an active employee/account cannot be invited as members.

Companion room entry and meeting acceptance preserve the main Card/document/
contact route. Full Office retains meeting-detail navigation. Existing invitation
state, acceptance and connected-presence updates come from patch0002; explicit
device activation comes from patch0001. A pending invitation is not a joined user.

```powershell
node --test integrations/platform/patches/room-interaction.test.mjs
```

Six source behavior tests cover workspace drag binding, malformed payloads,
inviting without joining, normal self-join, reuse of meeting IDs, DND/unknown
member/foreign-office denial, surfaced server denial and route preservation.
An additional behavioral check preserves the selected Office, Calendar, or
closed companion when joining from a Card, while registering meeting controls.
Compact floor previews explicitly enable interaction separately from visual
layout. Their keyboard-accessible Room actions menu keeps the avatar cell clear.
They execute the edited source with controlled service boundaries. Incremental
package builds, TypeScript validation and Svelte checks pass. Real two-member
drag/keyboard/meeting tests must also pass before
calling the interaction complete. The initial new picker copy is English;
localized release needs corresponding translation entries.
