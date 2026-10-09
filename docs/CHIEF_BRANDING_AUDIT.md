# Chief branding and isolation audit — 2026-10-07

This independent source copy is **Chief Executive Suite**, with the owner's dotted `c.h.i.e.f.` wordmark. These are source modifications to the Apache-licensed core; no enterprise entitlement check or restricted white-label implementation was changed. Original LICENSE, NOTICE, LICENSING.md, upstream repository links and the separately licensed enterprise directory retain their provenance.

## Supplied assets

Source: `C:/Users/amank/Downloads/chief-logo-files/chief-logo-files` (originals untouched).
The 9 SVG/PNG pairs are copied to `public/brand`: avatar on ink; full lockup on ink/light, one-color ink and white-on-blue; full-color mark on ink/light, one-color ink and simplified small-size mark. No replacement logo was invented.

- Sidebar: original full-color dotted wordmark, switched with the active light/dark skin; avatar for collapsed navigation.
- Onboarding, browser favicon and About: original avatar on ink, readable on either theme.
- Desktop window, tray, splash and installers: supplied avatar, with raster icon/ICO/ICNS derivatives for platform sizes; originals remain intact.
- Primary accent: `#2F58FF`. The supplied dark avatar uses `#0B0C10`; existing user-selectable skins remain available.

## Application and prompt surfaces

Changed product display literals in React views, every shipped locale catalog, renderer/server default brands, page metadata, desktop startup/tray/window titles, permission/recovery messages and packaging metadata. Catalog edits changed values rather than localization keys; TypeScript/JavaScript edits used parsed display literals rather than renaming API identifiers. Reviewed English branding substitutions are reflected in locale source hashes.

Runtime prompt changes cover assembled system sections, Chief coordination, peer roster/provenance, delegation, recalled context, live-call identity, Codex standing-instruction updates, Claude/Codex/ACP timeout messages, tool descriptions and catalog wire fixtures. Named agents and their user-authored instructions are preserved. Both old and Chief peer-provenance envelopes remain readable. The main implementation owns the two persona assembly call sites in `server/index.ts`.

The About dialog explicitly identifies the OpenMausBot foundation and core/enterprise license boundary. Historical docs and source comments are retained as provenance, not presented as Chief product instructions. See the root README for this fork's launch instructions.

## Separate runtime identity

| Surface | Chief default |
| --- | --- |
| Server/CLI storage | `~/.chief-executive-suite` |
| Companion storage | `~/.chief-executive-suite-companion` |
| Electron userData | OS appData `/chief-executive-suite` |
| Desktop app ID | `com.chiefexecutivesuite.app` |
| Server | `127.0.0.1:8899` |
| UI development | `127.0.0.1:5299` |
| Companion listener/control | `8910`, `8911` |
| Compose project / HTTP | `chief-executive-suite` / `8089`; builds this source, separate named volume |
| Desktop fallback ports | `18899`, `28899` |
| Service units | `chief-executive-suite.service`, `com.chiefexecutivesuite.serve` |
| Linux executable/profile | `chief-executive-suite`, `chief-executive-suite-browser` |

Existing `OMB_*` environment variables remain compatibility interfaces: an explicit override still controls the path/port. Never point this fork at existing application data. No live data, agent histories, secret keys or phone pairings were copied by branding work. Chief does not register the existing `openmausbot://` protocol, so installation cannot claim the original app's links. Native speech helper bundle/display identity is distinct.

The application updater is hard-disabled and packaging has no upstream release feed. A signed Chief feed must be implemented and tested before enabling updates. Provider runtime downloads remain their actual upstream dependencies.

Upstream PostHog credentials were removed. Analytics default off, require a Chief `VITE_CHIEF_POSTHOG_KEY`, and require explicit local opt-in. The settings toggle is disabled without configuration. Onboarding email remains local when analytics are unconfigured/off.

## Intentionally remaining visible upstream names

| Name/location | Reason |
| --- | --- |
| OpenMausBot in About, LICENSE/NOTICE/LICENSING and source links | Required truthful attribution and licensing; links still target the actual upstream project. |
| OpenMausBot Cloud / Pro / OpenMaus Admin in settings, account errors and associated prompts | These are existing external upstream services and entitlements, not a Chief subscription service. Relabeling them would misidentify the destination or promise unavailable Chief billing. |
| OpenMausMobile / MausBot / OpenMaus on phone-app download/pairing instructions | These links install the existing upstream mobile clients. Chief native mobile distribution has not been created or published. |
| Upstream URLs, package names, API paths, environment variables, protocol IDs and import/module names | Compatibility and dependency provenance. These are not product display labels. |
| `apps/docs`, `android`, `ios`, `enterprise`, historical docs/evals/preview files | Separate upstream deliverables retained in the source archive. They are not this Chief web/desktop build. Native mobile packaging, upstream marketing/docs publication and licensed enterprise rebranding are outside this built slice. |

No Chief billing, release feed, mobile-store listing or support destination is invented. Product copy now calls the old About links “Upstream source/docs/releases” so users can identify them.

## Verification and limits

- Brand and analytics tests: 21 passed.
- Prompt composition/instruction/provenance tests: 68 passed.
- Desktop window identity, startup/tray and file-boundary tests: 32 passed; 3 Windows symlink cases skipped by the existing suite.
- Catalog wire tests: 40 passed after reviewing product-text-only fixture updates (tool names/schema remain unchanged).
- Locale validator: all 10 languages valid, 3,501 English strings.
- `pnpm exec tsc -b`: passed after the source/UI changes. Integration build and browser screenshots are owned by the main implementation.
- CLI/service/provenance/system-prompt/analytics regression pass: 78 passed, 4 platform skips.
- Installer execution, macOS signing/TCC, Linux AppArmor loading, native mobile builds and a signed auto-update flow were not exercised on this Windows machine. No installer or service was installed.

The requested source rebrand must not be mistaken for a deployed subscription service or a replacement for the original applications.
