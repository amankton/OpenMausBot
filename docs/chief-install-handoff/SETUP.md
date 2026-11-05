# Reviewed setup

Start with [HANDOFF.md](HANDOFF.md). All requests below use the normal authenticated owner interface. A bot/internal capability is not authority to approve its own configuration.

1. Discover the current roster and choose an existing Chief and correspondence reviewer. One identity may fill both roles. Keep its model, personality, custom instructions, teams, grants and existing schedules.
2. Request the enhancement setup preview. Inspect the exact target IDs, current/proposed instruction text, all eight skill documents, assignment differences, conflicts, preview hash and catalog fingerprint. An installer must not substitute example IDs or another owner's accounts.
3. Resolve missing roles through the existing reviewed team/agent setup flow. Resolve same-name skill conflicts explicitly. A preview does not mutate a profile, install a skill or create an agent.
4. Apply only the exact reviewed preview using its hashes and `reviewed: true`. The server must recheck current profile and skill states before writing. A stale preview requires another preview; never force an overwrite.
5. Read back every changed profile and skill assignment/content. A retry must recognize already applied content and avoid duplicate addenda or skills. Failed writes must retain a concrete diagnostic and roll back only the installer's exact unchanged writes.
6. Open Chief work. Select existing Composio accounts only after current account-bound profile verification, assign reviewer/coordinator and contexts, and save. No accounts means unconfigured. Scans, schedules and notifications remain off until separately selected.
7. Review bounded mailbox trust for the selected agent: current identities, exact read operations/tools and any write operations marked Ask each time. Saving a trust policy does not enable a tool absent from the agent's existing grants. Revoke in this panel without requiring a healthy provider; a revoked policy stays denied.

Do not make bulk profile edits or assignments outside the reviewed supported flow. The historical owner-specific activation helper is not part of this neutral setup procedure.

The Chief work panel exposes this flow. Its owner-authenticated endpoints are `GET /api/chief-enhancement-setup`, `POST /api/chief-enhancement-setup/preview`, and `POST /api/chief-enhancement-setup/apply`. Preview accepts existing `chiefBotId` and `reviewerBotId`; apply additionally requires the exact `previewHash`, `catalogFingerprint` and `reviewed: true`. A connector capability cannot authorize setup. The exact appended paragraphs are [CHIEF-ADDENDUM.md](CHIEF-ADDENDUM.md) and [MAIL-ADDENDUM.md](MAIL-ADDENDUM.md); the preview is authoritative for each selected target and current source state.

## Operational acceptance

With the owner-selected accounts and unchanged model, perform a bounded read-only profile/list/full-thread check. Do not send, create provider drafts, change labels, mark read, delete, create external tasks or enable recurring work as a test. Report incomplete context or authentication failure as an unresolved operational gate. Real-model quality evaluation uses synthetic mail and enforced tool-free execution, separately from this mailbox contract check.
