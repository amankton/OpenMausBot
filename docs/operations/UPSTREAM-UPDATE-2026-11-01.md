# Chief selective update and phone VM access — November 1, 2026

Chief source workspace update: **0.1.98 + selective-20261101**. Deployed to the existing source runtime at `http://127.0.0.1:5299`. This is a named backport build, not complete upstream 0.1.137 parity.

## Reviewed source

Latest official stable release checked through GitHub on November 1: [v0.1.137](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.137), commit `db1ed62ab9b400c736bb0810e1973e4347050f67` (published October 31, 23:20 PDT).

Chief baseline: `22d5d4cf827159433bbb55587450f359b899b7ba`, with the existing uncommitted Hermes approval work preserved. Candidate: sibling worktree `chief-selective-20261101`, branch `codex/chief-selective-20261101`, containing those existing source changes before integration.

| Source | Included behavior |
| --- | --- |
| `af449299b4872475af6df69aceba83ffaabdf6d3` | Reject malformed phone requests without crashing; validate pairing input; handle viewer socket errors; close upgraded viewers at shutdown; report failed device-removal persistence and retain the retryable device. |
| `13957cf62c13cfbe7c12973b61ddef98197cea12` | Deleting a routine clears that routine's unseen failed/missed indicators, preserves other history, and rolls back the whole deletion if saving fails. |
| Chief adaptation | Show per-phone VM viewing/control permissions in Crewframe's phone settings and the source workspace; route each runtime to its own companion; check companion identity before changes; open existing phone controls directly from the profile shortcut. |

The companion patch was adapted without importing unrelated gzip or per-launch control-token migrations. Reviewed startup end-date, notification, goal-wait, and desktop blank-window changes depend on newer features/architecture absent from this Chief baseline and are deferred. Upstream updater, hosted plans, dependencies, packaging, branding, storage and migrations were not wholesale imported. Chief's upstream updater stays disabled.

## Phone activation and settings

The source workspace's companion is port **18910**, with owner controls on loopback **18911**. The separate Crewframe Agent Crew variant uses **8820/8821**. The standalone installed desktop has its own native phone bridge and profile. These are distinct installations; the task did not replace their identities or merge their registries.

The most recently connected **iPhone** entry had computer access off. Enabled its existing `cloudDesktopAccess` grant through the supported owner API. Existing pairing IDs, token hashes, names, creation times, and browser-control grants were preserved; the Galaxy entries were unchanged. No new phone was paired and no network exposure was added. The old iPhone entry already had computer access, which remains unchanged.

On the source workspace, open **profile menu → Connect your phone**, or **Settings → Computers → Remote access** in Simple mode. The **Paired phones and remote control** section now shows each device's **Allow computer view and control** checkbox and last connection time. Advanced mode retains its Remote access section. “Get the phone app” remains available as a separate button.

Tailscale reported Running/Online with no health warnings. The Local VM reported running, ready, and desktop-ready. On the iPhone, retain its existing connection and open a bot's Computer view; use Take control when offered. An actual iPhone screenshot/control interaction remains owner acceptance, not something proved by server readback.

## Verification and deployment

- Candidate: **494 tests passed, 3 skipped**, across the companion, routines, phone routes/UI, branding, and analytics. Type checking passed. Six package-policy tests passed on the primary baseline.
- Isolated real backend/companion/private-origin fixture passed authentication, owner-control refusal, endpoint refresh/withdrawal and fail-closed shutdown. No live conversations were used for mutation tests.
- New renderer interaction test covers grant, revoke, failed save and the shortcut without a download popup. Targeted primary tests passed after applying the patch; the final shortcut follow-up also passed focused tests and lint.
- Production UI builds passed. Existing CSS `::highlight` optimization and large-chunk warnings remain; no new build error.
- Read-only browser inspection confirmed four phone controls, the active iPhone enabled, and no download popup on the shortcut. Controls fit 1440, 768 and 375 pixel viewports. Screenshots mask device names and connection times. This is a focused layout inspection, not a full accessibility audit or visual regression baseline.
- Activity check found zero busy agents, running delegations or queued work. Gracefully stopped only the owned source backend/launcher and restarted the same source runtime. Its existing supervisor automatically started a new companion generation.
- Readback: **194 agents**, unchanged `bots.json` and `config.json`, same data directory, all **four pairings** retained, iPhone computer permission on, settings API addressing the correct companion, anonymous phone API returning 401, and UI returning 200.

Final UI receipt: `.chief-local/ui-build.json`; source hash `9f786fcf3b09a2686d0370060a5e2a65a6e923eb9a80c1d3e8a35e7b3103c6a6`, artifact hash `31efb8ebf50e3e7483b914bca1f49ce798fc4317fb2eddebb4d2d87fbea950d3`.

No installed standalone executable, installer, Platform image, native phone application, remote repository, or other computer was updated. Existing local Hermes edits remain in place. No commit or push was created.

## Recovery and review artifacts

Local artifacts are in `.chief-local/updates/chief-selective-20261101/`: `selective.patch`, the subsequent `phone-shortcut.patch`, source hashes, build log, deployment/readback receipts, and masked responsive screenshots. Private recovery is in `.chief-local/recovery/selective-20261101/`.

The application-state snapshot contains 785 files and an online SQLite backup of `messages.db` with a passing integrity check. It excludes caches, runtime/provider binaries/homes and the unchanged live VM filesystem. The phone registry was privately copied before the permission change. This is not a whole-machine or Platform-volume backup.

To reverse source changes: wait for idle, verify no intervening edits, reverse-check and reverse `phone-shortcut.patch` first, then `selective.patch`; rebuild with `node --experimental-strip-types scripts/build-chief-ui.ts`; use the owned graceful restart. Do not reset the checkout or replace healthy data. To revoke this phone grant, use its unchecked setting or the matching owner API; do not replace the entire registry and discard newer pairings. No database schema migration was introduced.

## Owner clarification — both phones

On November 1 the owner answered **“Both phones”** to the pending device-selection question. Also enabled computer view/control for the most recently connected Galaxy S23 Ultra pairing. Readback confirmed both current iPhone and Galaxy grants enabled, all four pairing identities and token hashes preserved, and all browser-control permissions unchanged. The older Galaxy pairing remains unchanged. The activation request timed out after the grant had persisted; direct disk and subsequent healthy companion-state readback confirmed success without repeating the grant. Private before-state and receipt: `.chief-local/recovery/selective-20261101/both-phones/`. Actual viewing/control on each physical phone remains owner acceptance.
