# Chief branding and workspace layout — October 9, 2026

Owner request: “go ahead with the consumer facing branding” and expand the
workspace to the full frame, moving the existing host buttons into the work surface.

Later same-day update: sidebar navigation and the white login wordmark are now
fixed and deployed. See `chief-workspace-navigation-logo.md` for the current image
and verification. The image and nine-patch counts below describe the initial pass.

## Implemented

- The host's large header and two information strips become one compact Chief menu.
  Its actions are personal workspace, direct shared workspace and connection check.
  Sign-in and media guidance lives in that menu.
- A reserved slot in the retained application's native top bar lets the host
  controls sit inside the work surface. The iframe then fills the full frame.
  Older frontend images retain a compact 44 px fallback bar.
- Retained startup title, default configured title, login mark and default favicon
  use Chief Executive Suite and the existing Chief avatar. Customer workspace
  identity and inherited attribution remain intact.
- The previously failing exact Chief-of-Staff test now expects the existing
  Chief Executive Suite prompt text.

No identity, session or action permissions were added to the presentation bridge.
The frontend image pin was updated and only the frontend container was replaced.
All original storage mounts and the other 16 Chief containers were preserved.
Existing evidence was archived before the acceptance scripts generated current
receipts. No installer change, commit or push occurred.

## Verification

46 focused tests passed in `SharedWorkspacePage.test.ts`, `workspace-shell.test.ts`
and `chief-of-staff.test.ts`. Root typecheck, changed-file lint and Git whitespace
checks passed. Three native Svelte components compiled and platform entry syntax
passed. Nine patches reconstructed 62 source files from pinned upstream; previous
eight patches and their final source hashes remain unchanged.

Browser checks used a disposable real Chief server, the actual compiled native
ChiefBrand component, and synthetic work content:

| Check | Result |
| --- | --- |
| Desktop iframe at x=0, y=0, full viewport width/height | Passed |
| 390 × 844 CSS px, no host horizontal overflow | Passed |
| Menu, Escape, click back into iframe to dismiss | Passed |
| Unsaved draft and interaction count survive connection check | Passed |
| Invalid oversized slot cannot reposition host menu | Passed |
| Sandbox rejects iframe top navigation | Passed |
| Unavailable service removes frame; Retry restores it | Passed |

Screenshots of this **synthetic preview** are in the chat's outputs directory.
Those initial checks were followed by the compiled and deployed checks below.
The existing full host browser script was updated for the menu and new evidence
filenames but was not run during this pass; browser checks above used Codex's
browser tools against the isolated fixture.

## Completed production rollout

The earlier memory block is resolved. With 5,118,364 KiB free RAM, the existing
4,608 MiB guard passed and the 2,048 MiB production build completed both webpack
configurations. No guard was lowered. The previous 2,583 assets and production
receipt remain backed up in `work/chief-branding-baseline`.

Compiled consent, recording, capture, templates and embedded playback acceptance
passed against this exact build. Image assembly verified the build and acceptance
receipt hashes. Deployed embedded playback also passed. These tests use the
repository's isolated synthetic acceptance workspace, not owner work content.

- Deployed image: `sha256:a7e20d654f192646e6174770921fa3f2da027ce1e9801460a10a0d85e49d75a2`.
- Build receipt SHA-256: `ba6e0c32333c7f66d309f5179686c2da4efdb381d4ad2d00b4a77b257299e00d`.
- Rollout evidence: `docs/verification/evidence/chief-branding-rollout.json`.
- Deployed playback: `docs/verification/evidence/chief-embedded-playback-deployed.json`.
- The guarded rollout script validates that the only Compose change is
  `front.image`, preserves mounts and other container identities, and supports
  restoring the previous image on failure. Syntax and changed-file lint passed.

The source preview at http://127.0.0.1:5299/workspace is live against the updated
retained frontend. Its stopped launcher was restored using the existing data
directory, after a private recovery snapshot with SQLite integrity verification.
The configuration SHA-256 remained unchanged before and after startup. The
desktop backend at port 8899 and installer baseline were left intact.

Read-only live browser checks verified Chief branding and the menu in the native
top bar, iframe x=0/y=0 and full viewport dimensions at 1422 × 800 and 390 × 844
CSS pixels, no host horizontal overflow, and Escape dismissal. Screenshots are
`chief-workspace-live.jpg` and `chief-workspace-live-mobile.jpg` in chat outputs.
The owner preview was not signed in or used for mutation testing.

Full native package type checking was not run; production compilation, bounded
Svelte checks and the acceptance gates above passed. Broader unified member/agent
execution remains subsequent implementation work. Keep installer work on
`codex/chief-executive-suite` separate from this branch.
