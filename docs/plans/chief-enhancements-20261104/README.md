# Personal Chief enhancements — November 4, 2026

Owner requested the supplied standing-instruction addendum in the personal standalone and Crewframe installs, then explicitly confirmed adapting it to the existing identities and retaining Jon Jr's version as a template.

## Installed

- Standalone 0.1.99: Poppy, `a8642737-9367-4792-b73d-9d0077ce293b`. Saved through the installed desktop's Instructions editor.
- Crewframe personal source workspace: Solo - Chief, `30159ee3-44b9-4d4e-9b9d-86f84c18fc9d`, and Bacca - Chief, `68b115df-b58b-448d-803f-18ae360e9506`. Saved using the supported local profile API while both were idle. No desktop capability header, paired identity or Origin was fabricated.
- Prior standing instructions retained; the role-specific opening now preserves the current identity, principal and existing council/decision rules. References to Jon as principal were generalized to the owner. No Jon identity or ministry-first decision criteria were imposed on the owner's existing identities.
- [Reusable personal addendum](personal-chief-addendum.md); [unchanged Jon template](jon-template.md).

Three synthetic profiles passed isolated real-server API persistence and SOUL.md readback. All three installed profiles then matched the exact candidates after newline normalization. Name, title, model selection, approval mode, automatic approval, always-allow list, MCP selection, peers, Chief role, managed sections and notifications matched their baselines. This verifies installation, not model behavior or the larger runtime design.

Private previous profiles, candidates, hashes and receipts are in `.chief-local/enhancements-20261104/`. They are recovery artifacts, not customer package content. For rollback, re-read current profiles, assess later edits, and restore only the prior `soul` through the same supported settings path; do not restore whole bot records or overwrite newer settings.

The existing source UI failed its freshness check. `node --experimental-strip-types scripts/build-chief-ui.ts` completed successfully; its normal bundle-size warning remains. The saved-workspace startup command then reported the workspace already running. No backend process was replaced, permissions changed, or new startup trigger created. The installed desktop was opened normally for its native profile edit.

## Proposed runtime work

The [supplied Chief and Email Triage plan](implementation-plan.md) remains planning material. Its Jon-specific mailbox/profile assertions are unverified for these installs. No Email Triage profile was found in either inspected roster, and no new bot, mailbox access, scan, routine, provider draft, outbound action or notification schedule was created.

The typed shared queue, scanner, skills, read-only enforcement, callback integration, notification policy, model evaluation and staged runtime rollout are not implemented by this prompt installation. The prompt explicitly requires truthful capability fallbacks. Future implementation must inspect the current overlapping source changes and current platform capabilities rather than treating the supplied plan's historical statements as a verified baseline.

Verification command: `node --experimental-strip-types work/verify-personal-enhancement-20261104.ts`. Private fixture receipt records the temporary server URL, PID, data directory and retained log; the fixture was cleaned up after verification. No live mailbox or owner conversation was used for mutation tests.

The installed app was returned to its original **Chief — Full workspace** selection after the standalone edit. Durable bots.json readback matched all three candidates. Shared-memory receipt `family-0d4b7e7a9d93b95d1efda4de6ae969c5c23d3356` remained queued at the final check; central availability is not verified. The local installation report and receipts are saved.

## Runtime implementation follow-up

See [the 0.1.100 implementation and activation record](IMPLEMENTATION.md). Solo was selected for Composio email review; no new agent was created. The candidate is verified, with source activation and live mailbox/model acceptance explicitly tracked as remaining gates.
