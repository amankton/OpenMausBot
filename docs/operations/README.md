# Chief installation and update operations

Owner standard, adopted October 11, 2026: use Tailscale for private remote phone access, and incorporate compatible official OpenMausBot updates while preserving each Chief white-label build.

1. [Install and repair remote phone access](TAILSCALE-SOP.md).
2. [Update Chief without losing its customization](WHITE-LABEL-UPDATES-SOP.md).
3. [Give the next Codex or Claude agent this handoff](AGENT-HANDOFF.md).
4. [Complete one installation record per deployment](INSTALLATION-RECORD.md).
5. [October 11 compatible upstream update record](UPSTREAM-UPDATE-2026-10-11.md).
6. [Agency and Decision Council import handoff](../../../CHIEF_AGENCY_IMPORT_HANDOFF.md) — earlier additive import procedure, final model choices, duplicate prevention, and verification requirements.

Mac workflows:

1. [Mac + iPhone Tailscale installation and background operation](MAC-TAILSCALE-SOP.md).
2. [Mac updates preserving Chief branding, signing and data](MAC-WHITE-LABEL-UPDATES-SOP.md).
3. [Copy-ready Mac handoff for Codex or Claude](MAC-AGENT-HANDOFF.md).
4. [October 11 branding audit and open Mac release gates](CHIEF-BRANDING-AUDIT-2026-10-11.md).

The Mac procedures are source/documentation reviewed and require execution on a Mac. The older Mac source ZIP predates the latest backports; its historical signature problem still needs final-artifact verification. See the audit before distributing a replacement.

Portable Mac Codex handoff: `release/Chief-Mac-Codex-Handoff-2026-10-11.zip`. Extract the entire folder on the Mac and start with `START-HERE.md`. It continues the Mac agent's already-running branding audit and includes 136 supporting Markdown documents with their local links preserved. Application source, installers and historical binary evidence are not included; unavailable code/evidence references are explicitly labelled. Package generation is in `scripts/package-chief-mac-handoff.mjs`; it refuses to overwrite an existing bundle. The ZIP's contents were verified against its checksum manifest.

These are operating procedures, not an installer that has been distributed to every machine. Windows host + iPhone is the verified reference configuration. Other operating systems and each packaged release require their own acceptance checks. This standard does not enable automatic upstream application updates.
