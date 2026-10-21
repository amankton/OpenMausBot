# Chief 0.1.97 release record — October 20, 2026

## Source and scope

Chief's outstanding application, mobile, integration, launch and operational changes were committed and pushed to the owner's `amankton/OpenMausBot` fork on `codex/chief-unified-platform`. Commit `146631d` consolidated them; `f308333990a98487875158b736f4aec2ff24a4b1` repaired packaging and refreshed the Mac transfer procedure. Subsequent acceptance changes align test fixtures with Chief's existing identity, data directory and Windows Podman policy; they do not change production behavior.

This is an independent Chief release number, not a claim that upstream OpenMausBot 0.1.97 was integrated. The standalone Agent package excludes the shared workspace and restricted enterprise layer. It preserves Chief's app ID, branding, license notices and disabled upstream update feed. No live installation was replaced. WSL was untouched.

## Fresh verification

- Lint, TypeScript and locale checks passed.
- Affected-feature run: 53 files passed; the API file initially had 15 failures. Correcting stale branding assertions and fixture paths, plus supplying a synthetic Podman command on Windows, resolved them. The full API rerun passed 276 tests with one platform-specific skip. Together, the affected set has 1,478 passed and three skipped tests across 54 files; these results span the original run and the final API rerun.
- Electron suite: 565 passed, 14 skipped. The first run caught a stale product-name assertion and lacked Git's Unix utilities for two Linux AppImage tests; the corrected run passed with those existing utilities on its process-local PATH.
- Platform lifecycle/theme tests: 12 passed. Hermes tools plugin: five passed. Standalone packaging policy: six passed.
- The first packaging attempt exposed `ws` calling a Node built-in through CommonJS from an ESM bundle. An ESM-safe `createRequire` banner fixed it. The actual bundled server then started outside the checkout with no `node_modules`, resolved all 13 proxy entry points, served MCP and exported an encrypted backup.
- `pnpm package:win` completed. The actual packaged resources passed Chief policy checks. The app archive contained 96 entries, version 0.1.97, and none of the forbidden runtime/credential paths checked.
- The actual Windows packaged executable launched in a disposable profile with an isolated home and no owner credentials. Native UI inspection confirmed Chief branding, standalone navigation and settings. A synthetic profile name saved through Settings and remained visible after terminating and restarting the fixture's process tree. This was a forced restart, not a graceful-quit test. Fixture processes were removed afterward.

## Artifacts and limits

The local `release` folder contains `Chief-Executive-Suite-0.1.97-setup.exe`, its blockmap and `Chief-Executive-Suite-0.1.97-x64.zip`. Authenticode reports **NotSigned**. Acceptance launched the unpacked application; it did not execute NSIS against the owner's account. The old 0.1.96 installer/ZIP remain available, and its unpacked directory was retained separately.

Toolchain: Windows x64, Node 24.21.0, pnpm 10.33.0, Electron 43.4.0, electron-builder 26.15.3. The lockfile SHA-256 is `f9a89416106a00a7329f7c74e0d83cd2bb2f31eb97563e4c524c68c38db8e867`. Exact artifact hashes and final source-transfer provenance are recorded in `release/SHA256SUMS.txt` and `release/Chief-Windows-verification-0.1.97.json`.

`Chief-Mac-Source-0.1.97.zip` is a source transfer, **not a Mac installer**. Its export includes tracked build inputs, a source commit and per-file hashes; it excludes enterprise, runtime data and credentials. Build on macOS with `bash scripts/build-chief-mac.sh`, then sign/notarize and verify on the target architecture. Windows checks cannot establish Mac installation, permission or Keychain acceptance.

The Windows Hermes terminal repair lives in the separate external Hermes installation. Chief's installer and source transfer do not bundle or update that installation. Existing production provider timing evidence is documented separately; these release checks make no new latency guarantee.

## Mac update and data preservation

Follow [Mac build and update instructions](../CHIEF_MAC_BUILD.md) and the [Mac update SOP](MAC-WHITE-LABEL-UPDATES-SOP.md). Back up the idle workspace using the supported export/backup and retain the prior app. Replace only the application, under the same macOS account, preserving `com.chiefexecutivesuite.app`, the customer's signing identity and any custom data-path configuration. Do not use an app cleaner or delete the application data.

Preserve the default Electron profile at `~/Library/Application Support/chief-executive-suite`, server workspace at `~/.chief-executive-suite`, and any configured external Hermes workspace. Keychain/provider access and phone pairing must be verified on the target Mac. Data-preserving update behavior is the intended procedure; it has not been certified on a Mac by this Windows release run.
