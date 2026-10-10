# Chief connection checklist search

Verified 2026-10-10 on the local Chief source server.

User correction: search belongs inside Connect personal Chief, in Agents to
connect, to choose agents for workspace pairing. The earlier conversation-link
search and its navigation handler have been removed.

The checklist filters by case-insensitive partial name. Checked agents remain
selected across searches, with removable selection chips and a total count.
Clearing search restores the full checklist. Enter in the search field cannot
submit a connection request. The existing pairing approval flow is unchanged.

Validation:
- 31 tests passed across ChiefPairingPanel and SharedWorkspacePage.
- Frontend TypeScript build and focused lint passed.
- Tests verify selections survive filtering and are included in the request
  even when filtered out, removal of hidden selections, clear, and Enter handling.
- CUA isolated preview: select Bacca, search Game, select Game Designer, clear;
  both checkboxes remain checked. Pairing endpoint is synthetic and refuses writes.
- Read-only live check at port 5299: Bacca appears as a checkbox under the search
  within Connect personal Chief. No real connection was requested.

Reproducible isolated preview: node --experimental-strip-types scripts/preview-chief-agent-search.ts.
The local Vite host serves the change immediately; no Docker image was rebuilt.
