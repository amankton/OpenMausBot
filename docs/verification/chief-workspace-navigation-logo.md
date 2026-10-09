# Workspace navigation and white login wordmark — October 9, 2026

**Owner correction after deployment:** the requested result is the existing
“Chief Executive Suite” text with only its icon replaced by a specific all-white
icon. The wordmark was an incorrect interpretation. The owner supplied the icon;
the corrective patch 0011 is now deployed and verified. Read
`chief-login-icon-title.md` for the current result and memory profile. The
navigation fix remains complete. Verification below describes the superseded
wordmark deployment, not the current visual design.

## Navigation: live and verified

The in-app browser did not open the named-window target on the Shared workspace
sidebar link. The sidebar and Team map now use ordinary same-tab navigation to
`/workspace`. Personal-return and direct-workspace links in the Chief menu also
use the current tab; direct navigation retains the no-referrer relationship.

42 focused tests passed across SidebarFooterNav and SharedWorkspacePage. Changed
React files passed lint. An isolated real Chief host verified sidebar entry,
personal return, and Team map entry. The owner's current sidebar link also
successfully opened the retained Chief sign-in page. No messages were sent and
no owner configuration was changed. A screenshot is saved in chat outputs as
`chief-workspace-navigation-fixed.jpg`.

## Login wordmark: deployed and verified

Owner requested the existing white version of the Chief logo in place of the
sign-in page's title block. The actual current route uses LoginApp.svelte, which
still contained the inherited LoginIcon; the previous branding patch changed
LoginAppBase.svelte but did not cover this separate route.

Both components now reference the existing white-lettered Chief lockup, copied
byte-for-byte from `public/brand/chief-lockup-full-color-on-ink.svg` to the retained
public asset `/chief/wordmark-white.svg`. It retains the colored mark, uses its
transparent background, displays at 232 × 42 CSS pixels and has accessible alt
text. No image generation or alteration was used.

New patch 0010 and `chief-login-logo-provenance.json` preserve all nine previous
patches. Ordered reconstruction verifies 64 files, including the previous
branding hashes at their correct point before the incremental logo change.
Four Svelte components compile. The image assembler includes logo provenance;
the rollout script now verifies every patch hash and the exact served wordmark.

After the owner closed applications, 5,724,692 KiB free RAM was available and the
unchanged 4,608 MiB guard passed. Both production configurations completed with the
2,048 MiB heap. Exact-build consent, recording, capture, templates and embedded
playback checks passed. Image assembly verified their receipt hashes. Frontend-only
rollout and deployed playback passed; all storage mounts and the other 16 Chief
container identities remained unchanged.

Current image: `sha256:2939c8ddef20e8557e2bf6d9ddc9c66838014e0b3c4c719ff1e7d05a9a5e66b5`.
Rollout evidence: `docs/verification/evidence/chief-branding-rollout.json`.
Previous assets, build receipts, evidence and image metadata remain backed up in
`work/chief-login-logo-baseline`. No installer change, commit or push.

A fresh, separate browser tab verified the actual deployed login route contains
the loaded Chief wordmark at 232 × 42 CSS pixels, replacing the old icon/title.
A temporary tab-only responsive override also confirmed the logo fits a measured
300 CSS pixel viewport without horizontal overflow; the override was cleared.
The owner's original tab was left alone after they asked to sign in. Existing
pages may need a reload to fetch the new frontend; do not interrupt unsaved input.
Desktop evidence is `chief-white-logo-live.jpg` in chat outputs. This is the
deployed app, not synthetic login content.
