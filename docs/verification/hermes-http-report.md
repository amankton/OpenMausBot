# Hermes migration result — October 20, 2026

## Architecture

The primary built-in Hermes driver now submits runs over HTTP and reads their SSE
events. Runs were selected because the existing ACP driver exposes tool activity,
approvals and Stop. The app's existing HTTP chat commands, runtime event contract,
SSE frontend connection and React chat components remain in place. Explicit ACP
compatibility remains for features the public runs API cannot support.

## Files changed for this work

- `server/drivers/hermes-http-client.ts`: reusable authenticated client and incremental SSE parser.
- `server/drivers/hermes-http.ts`: primary driver, scoped conversation continuity, event normalization, approval/steer/stop and lifecycle handling.
- `server/drivers/hermes-http.test.ts`: deterministic transport and lifecycle tests.
- `server/drivers/builtIn.ts`: register the HTTP implementation for `hermesAgent`.
- `server/config.ts`: classify `HERMES_API_KEY` as a provider credential; Chief terminology in its credential comment.
- `server/config.test.ts`: Chief branding expectation and Hermes credential reservation coverage.
- `server/opencode-provider-keys.e2e.test.ts`: align the corresponding end-to-end expectation with Chief branding.
- `server/turn-log.ts`, `server/turn-log.test.ts`: replace private prompt prefixes with character counts.
- `.env.example`, `compose.yaml`: backend Hermes environment settings and Compose forwarding.
- `scripts/control-omb.ts`: explicit real-Hermes opt-in on an isolated fixture.
- `scripts/verify-hermes-http.ts`: real UI/HTTP streaming, continuity, cancellation, credential and process checks.
- `docs/verification/README.md`: recipe index entry.
- `docs/verification/hermes-http.md`: inventory, exact event mapping, configuration, limitations and reproduction instructions.
- `docs/verification/evidence/hermes-http.json`, `hermes-http.png`: measured real verification and chat screenshot.
- This report.

Existing uncommitted work, including the legacy ACP driver and other integrations,
was preserved. The initial text-only verification did not restart the live application. The subsequent VM extension installs a standalone plugin and restarts Chief; see the current VM report.

## ACP-to-HTTP mapping

ACP initialization/process ownership becomes a persistent external API server.
Sessions become stable server-owned, signed and scoped conversation IDs in
`session_id`. Prompts become `/v1/runs` admission; message deltas become existing
`content.delta` events; tools become existing item lifecycle events; approvals
become existing permission cards answered through `/approval`; steering uses
`/steer`; Stop uses `/stop` and reader abort. Terminal events are guarded against
duplicate final publication. See the recipe for the full mapping table.

## Configuration

`HERMES_API_BASE_URL`, `HERMES_API_KEY`, `HERMES_API_MODEL`,
`HERMES_API_TIMEOUT_MS` and explicit `HERMES_TRANSPORT=http|acp`.
HTTP is the default. Secrets stay on the backend. Missing/invalid settings are
reported by the existing provider registry at startup. The verified server uses
the advertised virtual model `gpt-6-luna`; the installation default is
`hermes-agent`. No actual key was added to tracked configuration.

## Verification

- Focused transport, privacy, credential isolation, CLI setup and registry run:
  **91 passed, 2 skipped** across five files.
- Direct final transport/privacy rerun: **26 passed**.
- Server TypeScript check: passed.
- Production `pnpm build`: passed. Existing CSS `::highlight` optimizer warnings
  and large chunk warnings remain.
- Scoped Oxlint and tracked-file whitespace checks: passed.
- Browser build scan: **384 files**, actual Hermes key absent.
- Initial broader regression run: **480 passed, 4 skipped, 1 failed**. The failure
  was the stale OpenMaus/Chief assertion identified during migration. Both the
  unit and corresponding end-to-end expectations were updated at the owner's
  explicit request; the combined final regression result is recorded below.
- Combined final regression (configuration, branding e2e, HTTP, privacy,
  registry, shared ACP, approvals, local-inject compatibility and credential
  isolation): **541 passed, 4 skipped across 10 files**. No failures.

## Real end-to-end smoke

Final evidence: `evidence/hermes-http.json`, checked at
2026-10-20 10:08:47 America/Los_Angeles. Hermes `/health` and authenticated
`/v1/capabilities` both returned HTTP 200. An isolated real application backend
and the actual React chat UI sent two real messages. The second response recalled
the first turn's synthetic code. A third long response was interrupted by Stop;
an authenticated run-status query subsequently confirmed `cancelled` (HTTP 200).

| Measurement | First message | Second message |
| --- | ---: | ---: |
| Backend dispatch delay | 2 ms | 0 ms |
| Hermes time to first content | 2,581 ms | 2,022 ms |
| Backend total duration | 3,220 ms | 2,469 ms |
| UI-path first-content event | 2,720 ms | 2,133 ms |
| UI/control settlement | 3,652 ms | 2,613 ms |

The first response arrived in six deltas. The DOM probe recorded live partial
reply lengths increasing through 13, 20, 44, 69 and 75 characters, before the
completed bubble appeared. This proves visible incremental rendering. Browser
requests/events and backend logs contained no Hermes key; the browser made no
direct Hermes API requests. Windows process inventory found zero Hermes ACP
processes before and after. The owned fixture/backend/browser were closed.

## Preserved features and limits

Preserved: current chat routes/components/events, visible streaming, persisted
conversation cursor, multi-thread isolation, tool chips, provider-raised approval
UI, Stop, steering, controlled error states and frontend reconnect/replay.
Approvals, steering, malformed events and concurrency were tested with mocked
Hermes; live smoke exercised text, continuity and cancellation.

The public runs API cannot accept app-owned per-turn stdio MCP mounts, images,
injected local provider settings, per-bot tool selectors or guest confinement.
Those capabilities are not advertised; explicit restrictions/images fail before
dispatch. Hermes server configuration owns available tools and approval policy,
so app Ask/Auto/Full does not override it. Explicit ACP is available for those
existing workflows. Equal-name tool events can only be paired FIFO because the
upstream schema omits call IDs.

API key rotation changes the signed conversation namespace; server history
deletion needs explicit recovery. Lost admission responses are uncertain outcomes
and are not automatically replayed. Background generations intentionally survive
one browser observer disconnect, preserving the multi-window/shared-workspace
behavior. These operational limits are detailed in the recipe.

Optional cleanup of empty directories created by an earlier incorrectly encoded
screenshot path was blocked by automatic command policy. The screenshot itself
was moved to the correct evidence path; only empty directories may remain under
`C:/Users/amank/Documents/ChatGPT/CHIEF%20SOFTWARE%20WORKSPACE`.


## VM capability extension

The initial compatibility limits above describe the text-only migration baseline.
App tools and Local VM now work through a standalone Hermes plugin and a scoped
HTTP broker, retaining existing MCP transports, approval cards and images.
See [current setup and verified VM result](hermes-http-vm.md).
