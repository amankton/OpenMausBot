# Installed Chief 0.1.99 — November 1, 2026

Owner instruction: “Let's update the installed Chief app too so it has the same fixes and remote control settings.”

Updated the existing Windows installation at `C:/Users/amank/AppData/Local/Programs/chief-executive-suite` from 0.1.98 to **0.1.99** using a locally built NSIS installer. Reopened the registered application normally and verified its native Settings window. No new upstream release integration or account/pairing migration was performed.

## Included changes

- The previously reviewed companion resilience and routine-deletion backports described in [the selective update record](UPSTREAM-UPDATE-2026-11-01.md).
- A shared `PhoneComputerAccessSettings` component used by native desktop and Crewframe/source settings. Native **Settings → Computers → Remote access** now shows **Paired phones and remote control** outside the collapsed Advanced section. Per-phone computer view/control grants still use the existing native companion bridge. Browser control and device removal remain separate Advanced controls.
- The existing source-workspace phone shortcut continues to open its phone controls without a download popup.

Build checkout: sibling `chief-desktop-selective-20261101`, branch `codex/chief-desktop-selective-20261101`, based on `22d5d4cf827159433bbb55587450f359b899b7ba` plus the two reviewed selective-update patches and native settings adaptation. Candidate package version is 0.1.99. In-progress Hermes approval changes in the primary source checkout were preserved and not included in this installed update.

The shared UI changes and extended desktop acceptance script were retained in the primary source checkout. Its source UI was rebuilt with receipt `.chief-local/ui-build.json`; the source package version remains its existing 0.1.98 selective baseline. No source backend or Platform container restart was needed for this renderer change.

## Validation

- **481 focused tests passed, 3 skipped**: companion, routines, native settings helpers, Crewframe settings and renderer interactions.
- Ten focused native companion/package-policy tests passed.
- `pnpm package:win` passed type checking, frontend/server/companion builds, native helper staging, the packaged-server smoke outside the checkout, proxy/MCP/encrypted-backup checks, and installer/ZIP creation.
- Standalone package policy passed: legal notices retained; enterprise output, source runtime data and upstream update feed excluded.
- Real packaged Electron acceptance passed in a disposable profile: Chief onboarding, saved profile, OSS navigation, restart persistence, and a synthetic paired phone. The visible native checkbox successfully granted and revoked computer access through the real isolated companion. Owner application data and credentials were never used for these mutation tests. Evidence: `C:/Users/amank/AppData/Local/Temp/chief-desktop-acceptance-bbybJX/receipt.json`.
- Silent installation returned exit code 0. Installed file version is **0.1.99**. Installed `app.asar`, server entry, companion proxy/viewer relay, and UI index hashes match the tested package.
- All **129 protected data/profile files** were byte-for-byte unchanged immediately after installation. Following normal launch, `bots.json`, `config.json` and encrypted credentials remain unchanged. The saved one-bot local workspace loaded and its backend was healthy.
- Native UI inspection after reopening confirmed **Paired phones and remote control** under Computers/Remote access, outside Advanced. No phone permission was toggled against the owner's installed workspace during verification.

Existing CSS optimization and bundle-size warnings remain. The installer is **unsigned (`NotSigned`)**, consistent with the prior private Windows release; signing log labels are not evidence of a publisher signature.

Windows displayed a firewall prompt during the isolated companion test. No firewall setting was accepted or changed. A launch attempt with a temporary debugging flag was rejected by automatic approval review; it was replaced with a normal launch through the registered Chief app. Native UI and backend checks completed without a debugging interface.

## Phone/workspace preservation

The installed desktop has its own workspace at `C:/Users/amank/.chief-executive-suite` and profile at `C:/Users/amank/AppData/Roaming/chief-executive-suite`. It currently has no phones paired to its native companion. The new UI accurately reports **No phones paired yet** there.

The existing iPhone and Galaxy S23 Ultra remain paired to the source/Crewframe workspace on companion port **18910**, not the standalone desktop companion on **8910**. Readback confirmed all four existing entries retained, with computer access enabled for both current phones. Their connection remains valid and no re-pairing is required to keep using that source workspace's VM. No credentials, phone grants or VM directories were copied between installations. The standalone desktop's local VM status was not repaired or recreated as part of this app update.

## Artifacts and recovery

- Installer: `release/Chief-Executive-Suite-0.1.99-setup.exe`.
- ZIP and blockmap are alongside the installer; earlier release artifacts were retained.
- Installer SHA-256: `ec4e2927a239772452fae3266e57f2b50c22d637a15a0eaa85880ac79b612f93`.
- Checksums: `release/SHA256SUMS-0.1.99.txt`.
- Verification report: `release/Chief-Windows-verification-0.1.99.json`.
- Private complete stopped-app/data/profile backup: `.chief-local/recovery/desktop-selective-20261101/`. Copied message database passed SQLite integrity checking. Native companion storage did not exist before the upgrade.
- Scoped UI patch and readback: `.chief-local/updates/chief-desktop-selective-20261101/`.

For rollback, first stop the installed application gracefully and assess any newer owner data. Restore the prior application from the private backup or the retained 0.1.98 installer; no schema migration was introduced. Do not overwrite newer healthy workspace data merely to reverse application files. No push, publication, recurring updater, Mac package or Platform deployment occurred.

## Full workspace is now the installed app's default

Later November 1, the owner requested that the installed app open the full 194-agent setup and existing phone connections by default. Used the app's supported saved-environments format to save **Chief — Full workspace**, origin `http://127.0.0.1:5299`, as the active environment in the desktop profile's `environments.json`. No existing saved environments were present. Gracefully closed the idle desktop before writing the setting and reopened the registered installed application normally.

Native window title and rendered document confirmed the app opened the saved full workspace. Readback confirmed 194 agents, four retained phone entries, and computer access on both current iPhone and Galaxy entries. This connects to the original source workspace; it does not copy agents, credentials, conversations, phone tokens or VM files into the standalone data folder. **This computer** remains available in the workspace/server selector for the original one-bot local workspace. The full workspace's existing independent runtime must be running for its saved address to load; no new startup task or Windows logon trigger was added by this setting change.

Ten existing environment serialization/navigation tests passed. Configuration and readback receipts: `.chief-local/updates/chief-desktop-selective-20261101/full-workspace-default.json` and `full-workspace-readback.json`.

## Shared workspace Chief dropdown repair

Later November 1, the owner reported that the Chief dropdown above the shared workspace's Unplanned view did not open. The embedded Platform header declares `-webkit-app-region: drag` across that area. The host's clickable overlay preceded the iframe in DOM order, allowing Electron's native drag-region hit testing to swallow its clicks, although the same control worked in a browser.

Moved the host header after the iframe in DOM order and explicitly marked it `no-drag`; CSS flex ordering preserves its fallback position. Added a DOM-order/style regression test and a focused `--menu-only` mode to the isolated shared-workspace verifier. Thirty-nine focused tests, lint, production UI build, and the isolated fake-engine browser menu fixture passed. The broader existing host fixture stopped at its old expectation that the Shared workspace link automatically opens a separate tab; no full host-suite pass is claimed.

After the owner confirmed their event draft was closed, reloaded the installed app's full-workspace page. A native mouse click on the Chief header successfully opened the menu, displaying Open personal workspace, Apps / Connections and Reload workspace. This updates the full workspace UI served on port 5299; no second installer or Platform image rebuild was required. The installed default, agent data and phone connections were unchanged.
