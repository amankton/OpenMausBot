# Chief standalone desktop release

Owner direction, October 8, 2026: deliver the rebranded personal agent interface for October 9. Chief Exec Workspace is a separate future release and is not a dependency.

## Release scope

- Reuse the existing Electron desktop runtime, UI, bundled server, browser, native helpers, and provider adapters.
- `pnpm package:win` on Windows x64; `pnpm package:mac` on macOS builds Apple Silicon and Intel artifacts.
- Both commands set `VITE_CHIEF_AGENT_ONLY=1` and `OMB_INCLUDE_ENTERPRISE=0`, clean stale generated server output, and run the packaged-server smoke before packaging.
- Personal release hides Exec Workspace entry points and upstream subscription/organization/phone-app offers. Help is bundled locally. Legal attribution remains under About → Third-party notices and in bundled license files.
- No owner runtime data, model credentials, shared workspace Docker volumes, or Hindsight connection is distributed.
- Updates remain disabled and no upstream update feed is packaged. Early delivery uses manual upgrades.

## Acceptance checklist

- [x] Windows installer and ZIP created from the final tree, with SHA-256 hashes.
- [x] Packaged resources pass `node scripts/verify-chief-package.mjs release/win-unpacked/resources`.
- [x] Bundled server and browser pass isolated smoke checks outside the checkout.
- [x] Real packaged Electron starts in a fresh private profile; initial setup, branding, settings, persistence, and shutdown checked.
- [x] Permission, private server authentication, startup, and supervisor tests pass.
- [x] Publisher signature status reported accurately.
- [ ] Mac artifacts built and tested on macOS; signing/notarization verified there.

No installer test may use the owner's active application profile. `CHIEF_PROFILE_DIR` accepts an absolute alternate Electron profile path; `OMB_DATA_DIR` selects a separate server workspace. Both must point at fresh fixture directories for acceptance runs.

## Distribution constraints

Core licensing is Apache 2.0, not MIT. Do not redistribute `enterprise/` through this OSS release. Dependencies retain their own notices. Do not relabel upstream hosted services as Chief services.

Windows signing requires publisher credentials; unsigned internal evaluation artifacts must be described as unsigned. Mac verification requires a Mac and Apple signing/notarization credentials for normal direct distribution. Do not bypass OS warnings or claim unrun platform tests passed.

## October 8 candidate results

Owner explicitly approved remaining unsigned for this release. Windows Authenticode status is `NotSigned`. The installer was built; acceptance launched its unpacked application in disposable profiles, not an installation into the owner account. Mac build and native acceptance remain pending on the owner’s Mac through TeamViewer.

151 Vitest tests passed (one platform-specific skip), 57 desktop/policy tests passed, and packaged UI onboarding/settings/restart, bundled browser, packaged server/proxies/MCP/backup, and native startup/tray checks passed. The packaged UI check caught and verified repair of a branded HTTP authentication header that had prevented configuration writes.
