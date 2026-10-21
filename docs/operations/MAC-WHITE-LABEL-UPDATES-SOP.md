# SOP: update Chief on Mac while preserving its brand

Version 1.0 · October 11, 2026. Companion to the [general update SOP](WHITE-LABEL-UPDATES-SOP.md) and [current branding audit](CHIEF-BRANDING-AUDIT-2026-10-11.md).

## Policy

Review the latest official OpenMausBot release, then incorporate compatible changes into the Chief source. Preserve the customer's build customization. A newer upstream DMG is not a Chief update. Keep upstream automatic updates disabled until a separately configured, signed Chief update channel is validated.

At the previous update review, the official baseline was v0.1.107; only four compatible fixes were incorporated into the local Chief source. The local package version remains 0.1.96. See [the exact included/deferred record](UPSTREAM-UPDATE-2026-10-11.md). Recheck the [official releases](https://github.com/milind-soni/OpenMausBot/releases) at execution time and pin the tag and commit. Do not present a selective backport as a complete upstream upgrade.

## 1. Capture the release and brand baseline

Use [one installation record](INSTALLATION-RECORD.md) per Mac. Record:

- Mac architecture, macOS, installation type, app path, version, source commit/patch set and artifact SHA-256.
- Product name, app ID, bundle ID, signing TeamIdentifier, helper IDs, icons, wordmarks, accent, support links and customer-specific overlays.
- Actual Electron profile, server data, companion data and startup paths. Preserve existing `CHIEF_PROFILE_DIR`, `OMB_DATA_DIR`, pairing and provider configuration.
- Current menu/Dock/About/onboarding/phone screenshots, theme variants and any approved deviations.
- Exact shared-office frontend/container revisions if used. The standalone Agent package intentionally excludes the shared workspace product; do not update both as one artifact.

Create an encrypted/private recovery backup and retain the old application. Quiesce app writers or use the database's supported consistent backup; do not copy an actively written SQLite file by itself. Check backup integrity and a restore into an isolated location. Keep credentials and Keychain material out of source transfers and general audit logs. File copies alone do not prove encrypted credentials will remain usable under a different signing identity or account.

## 2. Prepare a candidate without overwriting Chief

Work in a separate checkout/build directory. Review official release notes and diffs against the Chief baseline, including migrations, mobile protocol, native helpers, branding files and update mechanisms. Preserve local modifications and legal notices. Resolve conflicts intentionally; do not globally replace upstream names or bypass the runtime whitelabel entitlement.

The existing `release/Chief-Mac-Source-0.1.96.zip` is an older transfer. Its `server/routines.ts` and `server/mcp-oauth.ts` differ from the updated source as verified October 11. Rebuild the transfer from the reviewed candidate and give it a distinct build identifier and checksum; do not silently reuse that archive as current. Exclude customer data, `.chief-local`, credentials, environments and restricted enterprise code according to the existing release policy.

Preserve `com.chiefexecutivesuite.app`, the expected Chief profile path and helper/signing identities for an in-place update. For another customer's separate brand, use its existing manifest rather than imposing Chief defaults. Brand configuration, organization logos and a fully renamed native application are separate mechanisms.

## 3. Test and build on macOS

Read [Mac build instructions](../CHIEF_MAC_BUILD.md) and [verification instructions](../verification/README.md). The existing build script requires Node 24+, pnpm 10.33.0 and Apple Command Line Tools; check the candidate's own requirements if upstream changes them.

From the isolated candidate checkout:

```sh
pnpm install --frozen-lockfile
pnpm exec vitest run src/lib/brand.test.ts server/brand.test.ts src/lib/analytics.test.ts
node --test scripts/chief-package-policy.node-test.mjs electron/organization-branding.node-test.mjs
```

Run the tests/type checks appropriate to the selected upstream changes as well. Then:

```sh
bash scripts/build-chief-mac.sh
```

The current script invokes `pnpm package:mac` and verifies each produced app's resource policy. It builds standalone Agent artifacts for arm64 and x64. It does not establish native launch, valid signing, notarization, phone compatibility or matching-hardware acceptance. Windows cannot substitute for these Mac checks.

## 4. Sign, notarize and inspect the final deliverable

Normal distribution requires the organization's Developer ID signing and notarization workflow. Use credentials already secured on the build Mac. Preserve Electron/helper entitlements. The current builder has `notarize: false`, so packaging alone does not perform notarization. Follow the existing [manual notarization instructions](../CHIEF_MAC_BUILD.md#signing) with the actual candidate filenames.

Read-only checks, after substituting the actual app path:

```sh
chief_app='/absolute/path/to/Chief Executive Suite.app'
/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$chief_app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$chief_app/Contents/Info.plist"
codesign -dv --verbose=4 "$chief_app"
codesign --verify --deep --strict --verbose=2 "$chief_app"
spctl --assess --type execute --verbose=4 "$chief_app"
node scripts/verify-chief-package.mjs "$chief_app/Contents/Resources"
```

Validate notarization/stapling for the artifact actually submitted. Mount the final DMG and repeat app signature/resource checks on its contents; also test the installed copy. Record final DMG/ZIP hashes with `shasum -a 256`. Do not modify bundled resources after signing.

The older [Mac transfer handoff](../../release/CHIEF-MAC-MOBILE-HANDOFF.md) records a broken signature in a prior app/DMG. A local ad-hoc repair was not a proven packaging fix. Require new final-artifact evidence before declaring this resolved. A previously accepted unsigned pilot is not approval to ship an unsigned standard release. Do not use global Gatekeeper disablement or blanket quarantine removal as the SOP.

## 5. Pilot, replace and verify

1. Launch with a separate absolute `CHIEF_PROFILE_DIR` and separate server/companion data, following the release's supported isolation mechanism. Use synthetic test accounts, not copied personal agents or credentials. Verify the actual data paths before any test writes.
2. Check Chief name, Dock/Finder icon, menus, About, light/dark wordmarks, onboarding, mobile setup and permission prompts. Verify no unexpected upstream product identity replaces Chief. Retain third-party attribution and actual provider/mobile-app names.
3. Validate Tailscale pairing and a real phone message/reply using [the Mac remote-access SOP](MAC-TAILSCALE-SOP.md). Verify packaged phone resources and actual connection, not just a visible setup button.
4. During the target's agreed maintenance period, drain active work, quit only that Chief instance/supervisor, and replace the app after preserving the old version. Do not delete its data, uninstall Tailscale or recreate pairings.
5. Relaunch under the same account. Confirm existing agents, conversations, provider access, integrations, pairing, brand and startup settings. Permissions/Keychain access need direct verification on the Mac; investigate identity changes instead of instructing users to grant everything again.
6. Close the initiating terminal, lock the Mac, and repeat phone access. Restart/login and check automatic startup. Record cellular acceptance separately from local Wi-Fi success.

If the candidate fails, stop it and restore the previous app and startup configuration. If a data migration ran, restore the corresponding consistent pre-update data backup; never run an older binary blindly against a newer schema. Do not overwrite legitimate post-update user work without a recovery decision.

## Release record

Report: official baseline/tag/SHA; included and deferred commits; Chief build identifier; target architecture; artifact paths/hashes; signature and notarization results; brand comparison; data/pairing continuity; exact tests; native and phone acceptance; rollback location; unresolved items. Status must explicitly say documented, built, tested or deployed. No Mac was updated by creating this SOP.
