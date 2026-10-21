# Chief branding audit

October 11, 2026 · Scope: current Chief source, bundled brand assets, local Windows package resources, Mac transfer and build configuration. This supplements the [October 7 audit](../CHIEF_BRANDING_AUDIT.md).

## Decision

The reviewed source preserves Chief's primary identity, original assets, private update policy and third-party notices. All 18 bundled logo files match the owner's originals byte-for-byte. The 29 focused tests run for this audit passed, and the existing Windows unpacked resources passed the Chief package policy.

Mac distribution is **not yet verified for standard rollout**. No current Mac app/DMG was available here, the source transfer is behind the updated checkout, and the older handoff documents a signing defect without final-artifact evidence of a build-pipeline fix. Customer-specific rebrands also need a full surface manifest: runtime brand.json alone does not replace every Chief identity.

This audit made no application/runtime changes and did not replace branding assets. It is an engineering and asset-consistency audit, not a trademark clearance or a complete live visual/accessibility review.

## Findings, in priority order

| ID / priority | Evidence and impact | Required disposition |
| --- | --- | --- |
| B-01 / high, Mac release gate | [Prior Mac handoff](../../release/CHIEF-MAC-MOBILE-HANDOFF.md) records an invalid app/DMG code signature and a local ad-hoc repair. [Builder configuration](../../electron-builder.yml) disables automatic notarization. No `.app` or `.dmg` is present in the local release directory for fresh validation. This is missing release evidence, not a claim that every current Mac install is broken. | Build from the reviewed candidate, preserve Developer ID/helper identities, notarize the final deliverable and verify the app in the DMG and after installation. Capture native launch and permission results. Keep the gate open until those results exist. |
| B-02 / high, stale transfer | `release/Chief-Mac-Source-0.1.96.zip` matches current package.json, builder configuration and frontend brand defaults, but its routines and MCP OAuth source hashes differ. Its own handoff dates it October 8, before the [October 11 backports](UPSTREAM-UPDATE-2026-10-11.md). Reusing it would omit reviewed fixes while showing the same 0.1.96 version. | Generate a fresh, sanitized transfer from the reviewed source with a distinct build identifier, included-commit list and checksum. Do not silently overwrite an identically named archive. |
| B-03 / medium, multiple customer brands | [Runtime brand loader](../../server/brand.ts) applies brand.json only with the whitelabel entitlement. [Frontend branding](../../src/lib/brand.ts) can change title/favicon/accent and onboarding reads the brand; [ChiefBrand](../../src/components/ChiefBrand.tsx), [About](../../src/components/AboutDialog.tsx), [app links](../../src/lib/app-links.ts) and [Electron identity](../../electron/main.mjs) remain Chief-specific. A runtime rename can therefore leave mixed identities. This does not undermine the default Chief brand. | For each non-Chief customer brand, retain a build manifest covering UI, About, icons, package/helper IDs, support destinations and signing. Test that actual artifact. Do not describe organization-logo upload or brand.json as a complete native rebrand, and do not bypass entitlements. |
| B-04 / medium, version traceability | Current source includes selected upstream fixes while package version remains 0.1.96. Old Windows artifacts and the Mac ZIP share that version. About shows the package version through [appVersion](../../src/lib/app-links.ts); it is insufficient by itself to distinguish builds. | Record source SHA plus patch/commit set and artifact hash for every release; assign a distinct Chief build/release identity when rebuilding. Do not label the current selective backport as full v0.1.107. |
| B-05 / low, misleading maintenance comments | [electron-builder.yml](../../electron-builder.yml) still contains upstream comments saying automatic updates work and suggesting `OpenMausBot-setup.exe` / `OpenMausBot.dmg` release aliases. [analytics.ts](../../src/lib/analytics.ts) says analytics are on by default, while its implementation requires a configured Chief key and explicit opt-in. | Correct comments in a scoped maintenance change so future agents do not restore an upstream feed, publish wrongly named files or misunderstand consent. Functional behavior is currently correct in the inspected source. |
| B-06 / pending, visual and native acceptance | Fresh live UI inspection was blocked by browser-tool policy. No Mac hardware, built app, current Dock/Finder rendering or native permission dialogs were available. | Complete the visual/native checklist below on the actual candidate. Historical screenshots or unit tests cannot close it. |

## Verified controls

| Surface | Current evidence | Result and limits |
| --- | --- | --- |
| Original assets | SHA-256 comparison of every file in `public/brand` with `C:/Users/amank/Downloads/chief-logo-files/chief-logo-files` | 18 of 18 match: nine SVG/PNG pairs. Light wordmark and ink avatar PNGs were visually inspected as files. No logo redraw or alteration found in these files. |
| Brand vocabulary and palette | [Frontend defaults](../../src/lib/brand.ts), [server defaults](../../server/brand.ts), [index](../../index.html) | Chief Executive Suite; tagline “Your personal team of AI agents.”; accent `#2F58FF`; original Chief avatar. Browser title and brand fallback tests pass. |
| Sidebar and onboarding | [ChiefBrand](../../src/components/ChiefBrand.tsx), [Sidebar](../../src/components/Sidebar.tsx), [WelcomeFlow](../../src/components/onboarding/WelcomeFlow.tsx) | Source wires dark/light original wordmarks and compact avatar; onboarding reads the served brand. Actual rendered sizing/contrast across screens remains pending. |
| Native app identity | [electron-builder.yml](../../electron-builder.yml), [main.mjs](../../electron/main.mjs) | Chief product/artifact names, `com.chiefexecutivesuite.app`, Chief icon resources and permission descriptions, independent profile path. Source configuration verified; Mac binary identity unverified. |
| Update channel | [updater.mjs](../../electron/updater.mjs), [builder](../../electron-builder.yml), [package policy](../../scripts/chief-package-policy.mjs) | `CHIEF_UPDATES_ENABLED = false`, `publish: null`; packaged `app-update.yml` forbidden. No automatic upstream replacement path enabled by this work. |
| Analytics identity | [analytics.ts](../../src/lib/analytics.ts) and its tests | Requires `VITE_CHIEF_POSTHOG_KEY` and explicit opt-in; no default upstream key in the inspected source. Autocapture is disabled. This is a source review, not a network-traffic audit of every installed artifact. |
| Standalone scope | [package script](../../scripts/package-chief.mjs), [release profile](../../src/lib/release-profile.ts), [package policy](../../scripts/chief-package-policy.mjs) | Standalone Agent excludes enterprise/server and shared-workspace entry point and forbids selected local/config artifacts. Windows unpacked resources passed. The verifier is a bounded policy check, not a complete secret scanner. |
| Attribution | [About](../../src/components/AboutDialog.tsx), package notices | Chief is primary; OpenMausBot attribution is separately disclosed under Third-party notices. Core LICENSE and NOTICE resources remain present. |
| Organization imagery | [organization branding docs](../organization-branding.md), [desktop tests](../../electron/organization-branding.node-test.mjs) | Tests confirm bounded raster data/known fields and reject unsupported external/SVG/invalid payloads. Organization imagery does not change app IDs, signing or desktop product identity. |
| Shared office | [retained frontend branding record](../../integrations/platform/patches/CHIEF_BRANDING.md) | Historical accepted patch 0011 restores the visible Chief Executive Suite title with the original icon displayed white. Earlier full-wordmark patch 0010 is superseded. Preserve this correction during future rebuilds. No new container/runtime verification was performed in this audit. |

## Upstream references: retain or review intentionally

- Keep copyright, license, source attribution and actual third-party product names. Renaming those would obscure provenance or imply Chief owns another service.
- Keep API paths, protocol fields, import scopes and `OMB_*` environment compatibility names unless a separately tested migration changes them.
- Mobile links still identify the upstream companion; [app-links.ts](../../src/lib/app-links.ts) describes iOS as MausBot, while [English manual-pairing copy](../../src/locales/en.json) uses OpenMausMobile. Verify the current distributed client's name and harmonize guidance before customer rollout. A branded Chief desktop is not evidence of a Chief-branded mobile binary.
- OpenMausBot Cloud/Pro labels identify actual upstream services. The standalone release filters Cloud/organization settings through the release profile; office/source builds have different availability. Verify both variants independently.

## Fresh verification performed

```text
pnpm exec vitest run src/lib/brand.test.ts server/brand.test.ts src/lib/analytics.test.ts
  3 files, 21 tests passed

node --test scripts/chief-package-policy.node-test.mjs electron/organization-branding.node-test.mjs
  8 tests passed

verifyChiefPackage("release/win-unpacked/resources")
  passed: Chief identity marker, notices, forbidden resources, standalone entry-point policy

Original asset SHA-256 comparison
  18/18 matches

Mac source ZIP comparison
  matches: package.json, electron-builder.yml, src/lib/brand.ts
  differs: server/routines.ts, server/mcp-oauth.ts
```

These checks ran against the current dirty checkout without reverting unrelated changes. Historical broad test counts in previous audits were not rerun or presented as new results. No Mac build, notarization, native launch, full locale sweep, live visual audit or new phone test was performed here.

## Required visual/native release checklist

For each claimed brand and architecture, capture actual evidence using a clean synthetic profile:

1. Finder, Dock, installer title/icon, menus, About, version/build identity and Third-party notices.
2. First launch, light/dark mode, expanded/collapsed sidebar, Settings, help, error/empty states and mobile setup. Check the original asset shape, clipping, contrast and readable small-size icon.
3. Native microphone, speech, Accessibility and Screen Recording prompts. Check Chief identity and both grant/deny paths; do not automatically grant broad permissions.
4. Existing-profile upgrade: same data, agents, provider access, pairing and customer imagery; no fresh empty profile mistaken for migration success.
5. Phone UI accurately names the installed companion; actual cellular message/reply succeeds.
6. Signed/notarized final artifact; no upstream updater; expected legal notices; no customer data or owner-only credentials in delivery.

Use [Mac update SOP](MAC-WHITE-LABEL-UPDATES-SOP.md), [Mac remote access SOP](MAC-TAILSCALE-SOP.md) and [installation record](INSTALLATION-RECORD.md). Close each pending item only with evidence from the delivered artifact and target Mac.
