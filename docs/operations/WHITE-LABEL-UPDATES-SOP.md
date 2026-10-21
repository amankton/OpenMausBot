# SOP: update Chief while preserving each white-label build

Version 1.0 · October 11, 2026.

## Policy

Use official OpenMausBot release source as an input to the Chief fork. Install only a validated Chief artifact built from the reviewed integration. Never install the upstream binary over Chief or turn on the upstream update feed. Compatible fixes may be backported independently; label the result as a Chief build with named backports, not as complete parity with an upstream release.

The latest official release checked October 11 is [v0.1.107](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.107). Resolve the official repository's latest stable release again for each update and pin its tag and commit SHA. A cached version number is not an ongoing update policy.

## 1. Inventory and protect

Create one [installation record](INSTALLATION-RECORD.md) per host/customer and release variant. Distinguish the standalone Agent desktop package, shared-office source runtime, retained Platform services/containers, and upstream mobile client. These are separate delivery surfaces; changing one does not update the others.

Record exact fork commit, upstream base, local tracked/untracked changes, dependency lockfiles, release artifact hash, install path, app identity, data paths, phone port/pairing location and startup account. Discover remotes by URL, not by names: in this checkout `origin` is official upstream and `chief` is the owner's fork. Other checkouts may differ.

Before production changes, preserve:

- Full runtime data: conversations, attachments, agents, settings, routines, webhooks and relevant databases/volumes.
- Companion device registry, hosted credentials if used, desktop profile, provider login state and environment configuration, in private access-controlled backups.
- Brand assets and derivatives, source changes including untracked files, package/build manifests, deployment configuration and previous runnable artifact.
- Startup task/service definitions and exact data-directory mappings.

Use supported backup/export APIs or coordinated consistent snapshots. Do not copy a live SQLite main file alone while ignoring its WAL. The local `scripts/preserve-chief-preview.ts` understands this source preview's SQLite backup, but is not a complete backup of phone credentials, desktop profiles or Platform databases. Verify those separately. Never commit backups/secrets or ship them in an installer. Do not delete temporary-looking directories until ownership is proven.

## 2. Preserve the customization contract

Use [the branding audit](../CHIEF_BRANDING_AUDIT.md) and the actual installed variant as the baseline. Record per-customer overrides rather than imposing the owner's brand on everyone.

| Surface | Required invariant |
| --- | --- |
| Product appearance | Approved names, original logo assets, icons, colors, page/window/tray titles, locale text, About, prompts and help remain correct. |
| Install identity | App ID, package name, executable, installer identity, shortcuts, URL protocols and signing identity retain update compatibility. |
| Storage | Preserve explicit runtime paths and namespace isolation. Chief defaults include `.chief-executive-suite`, `.chief-executive-suite-companion`, and appData `chief-executive-suite`; overrides win. |
| Update/analytics | Chief updater remains disabled until a separate signed Chief feed is implemented and tested; no upstream feed or upstream analytics credentials reintroduced. |
| Workspace behavior | Member/tenant isolation, pairing, saved sessions, permissions, agent instructions, routes, tools and Chief shared-office/Platform integration survive. |
| Packaging/license | Retain attribution/notices and license boundaries; no entitlement bypass. Standalone Agent packaging excludes restricted enterprise output and shared-workspace entry points. |

Relevant source: `electron-builder.yml`, `electron/main.mjs`, `electron/updater.mjs`, `server/config.ts`, `public/brand`, `build`, `scripts/package-chief.mjs`, `scripts/chief-package-policy.mjs`, and `integrations/platform/patches`. Organization logo settings do not replace app/install identity branding.

## 3. Integrate outside the live checkout

1. Fetch the official release tag and record its SHA. Review release notes, migration requirements, dependencies and security changes.
2. Use an isolated branch/worktree from the exact Chief baseline. Carry relevant current local fixes deliberately; a new worktree contains committed state only. Never reset, clean, stash away or overwrite unrelated live work to make an upstream merge convenient.
3. Classify changes as compatible, requires adaptation, or deferred. Record source commits and reasons. Small data-integrity/authentication fixes can be backported with their tests. UI, updater, storage, packaging, identity and Platform changes need specific adaptation.
4. Resolve conflicts semantically. Keep both Chief-specific and upstream regression coverage; do not use blanket “ours/theirs” selection or global product-name substitution. Check automatically merged files too.
5. Record the actual included commit set. Do not bump the version to an upstream release number unless the intended release content and migrations have actually been integrated and validated. Assign a traceable Chief build identity under the project's release scheme.

## 4. Validate and package

Follow [repository verification](../verification/README.md) with isolated synthetic fixtures and no production credentials. Run affected unit/integration tests, type checking and relevant lint. Specifically check branding, analytics/update policy, Windows launch behavior, data loading/migration and companion authentication. Restore a sanitized backup into an isolated candidate and verify expected conversations, agents and pairing behavior with synthetic devices.

Existing baseline commands, when these files/scripts exist in the candidate:

```text
pnpm install --frozen-lockfile
pnpm exec vitest run server/brand.test.ts src/lib/brand.test.ts src/lib/analytics.test.ts
node --test scripts/chief-package-policy.node-test.mjs
pnpm typecheck
pnpm build
```

Add the affected feature suites; these commands alone are not a release gate. For modified phone infrastructure, this source checkout also has `scripts/verify-chief-phone-remote.mjs`, using disposable backend and companion fixtures.

Build Windows/macOS using `pnpm package:win` or `pnpm package:mac` on the matching native OS. Audit Linux's separate packaging route before treating it as equivalent. The current Windows/macOS wrapper sets `OMB_INCLUDE_ENTERPRISE=0` and `VITE_CHIEF_AGENT_ONLY=1`; do not substitute it for the shared-office release. Run `node scripts/verify-chief-package.mjs <actual-packaged-resources-directory>` on the actual artifact, plus installation/update smoke tests in a disposable profile. Retain artifact checksum, source SHA, toolchain, dependencies and signature status. Do not publish an unsigned artifact as signed.

## 5. Pilot, deploy and roll back

Use the identified owner-authorized pilot first. Check active work, take verified backups and choose a maintenance window before restarting. Install the Chief candidate without uninstalling/deleting its data. Preserve app identity and re-use the intended profile. Validate startup, brand, agents/history, provider sign-in, app-specific workspace features, phone pairing and cellular access. Check unattended expectations separately.

For source runtimes, source edits do not prove the running backend loaded them. Use the owned restart procedure after activity checks, then verify loaded revision and health. For installed desktops, a source patch does not update the installed executable. For Platform, a source patch does not rebuild/deploy its image. Report each surface separately.

If migration or functional checks fail, stop rollout. Restore the previous artifact plus its matching pre-upgrade data snapshot using the supported procedure. Do not run an old binary against newly migrated data unless backward compatibility is verified. Retain failed candidate evidence and preserve newer user data for recovery. Expand to the next install only after the pilot's acceptance record passes.

## Ongoing standard

Maintain the install inventory and per-brand customization manifest with every release. Review official updates regularly, but scheduling a recurring job is a separate action. No recurring updater or fleet deployment is created merely by adopting this SOP.
