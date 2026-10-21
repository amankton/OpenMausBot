# Installed Chief startup investigation — 2026-10-21

Owner clarified that the affected surface is the installed desktop app, not Chief at port 5299. This investigation uses the Windows install on this machine. No WSL state or owner data was changed by the diagnostic fixtures.

## Verified findings

- Desktop shortcut targets `%LOCALAPPDATA%/Programs/chief-executive-suite/Chief Executive Suite.exe`. Its installed profile last ran 0.1.96; resources were last updated October 17. No Chief desktop process was running during inspection.
- Installed server log shows 28–35 second intervals between child spawn and server readiness on October 17. These historical timings are not a new measurement of the current native window.
- Installed desktop's default data folder is `C:/Users/amank/.chief-executive-suite`; Crewframe's development server uses `C:/Users/amank/AppData/Local/Crewframe/Chief/data`. They are separate workspaces. Browser/development changes do not update installed app resources or merge their data.
- Both old and current server bundles start in approximately 0.46–0.50 seconds in empty synthetic profiles. Version age alone does not explain a slow startup.
- Server initialization unconditionally awaited provider discovery to select a first-run default before listening, even when saved bots already existed. A slow CLI availability/auth probe therefore delayed opening saved conversations.

## Targeted fix

`seedNewWorkspace` skips first-run default discovery when bots already exist. Existing bots retain their selections; APIs that create new bots still resolve defaults explicitly. Fresh, empty workspaces retain their original discovery-before-seeding behavior. Provider authentication, availability checks, and permission rules are unchanged.

A provider-readiness condition initially investigated in the renderer belongs to the Connections panel, not the native splash. That renderer change was reverted; it is not part of the desktop fix.

## Fresh verification

`scripts/benchmark-chief-packaged-startup.mjs` copies each server outside the checkout and uses isolated synthetic homes with no owner credentials. A fake Claude executable deliberately takes five seconds to return its version. It never calls an upstream provider or real CLI.

| Reopening an existing synthetic profile | Installed bundle | Fixed bundle |
| --- | ---: | ---: |
| Server/config ready | 5592 ms | 464 ms |
| Five subsequent config requests | 1–8 ms | 1–3 ms |
| Separate provider discovery | 5111 ms | 5169 ms |

The slow provider check still executes and reports availability; it no longer gates server readiness. Receipt: `C:/Users/amank/AppData/Local/Temp/chief-startup-comparison-E5okLs/receipt.json`.

Focused tests verify that an indefinitely pending provider discovery cannot block initialization of an existing workspace, saved model selections remain unchanged, and a new workspace still waits for its initial model before seeding. Default-selection, hydration and live-frame regressions: 34 passed. TypeScript checks passed.

## Packaged and installed

The complete Windows packaging pipeline passed, including the offline packaged-server smoke test, all 14 proxy paths, native helper staging and standalone package policy. The NSIS installer and ZIP were rebuilt from the current working tree, without publishing. These are private unsigned artifacts, as before.

Before installation, the old application, desktop profile and entire data directory were copied to `.chief-local/desktop-startup/installed-before-20261021-082042`. The desktop was not running. Silent NSIS update completed with exit code 0; installed executable file version is now 0.1.97. The installed `app.asar`, server entry and UI index hashes exactly match the packaged candidate. All 45 existing data files have identical hashes after installation. Existing desktop and Crewframe workspaces were not merged; no credentials, provider/model settings or permissions were changed.

Installed receipt: `.chief-local/desktop-startup/installed-receipt.json`. Updated Windows artifact hashes and bounded verification report: `release/Chief-Windows-verification-0.1.97.json`. The superseded report and prior 0.1.97 installer are retained under `.chief-local/desktop-startup/release-before/`. The Mac archive was not rebuilt in this Windows task.

The owner was asked to open the normal installed shortcut for native-window verification. This check remains pending until that action is observed; installation and backend readiness are not a substitute.

This is backend startup evidence, not a measurement of full native-window paint time, provider response latency, or every kind of UI hang. Native UI control is unavailable in this session; do not claim an installed-window interaction test from browser or backend checks.

## Owner acceptance

On 2026-10-21 the owner confirmed after opening the normal installed shortcut: “It opens promptly now.” This verifies the reported opening experience by owner observation. No new timestamped startup entries were found in the inspected server log, so no new native startup duration is claimed. Native-window automation remains unperformed.
