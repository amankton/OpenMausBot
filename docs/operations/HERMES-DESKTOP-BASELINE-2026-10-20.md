# Hermes Desktop baseline: test isolation and remaining runtime dependency

The owner supplied `hermes-desktop-parity-disposition.txt` under Chief task workspace `68b115df-b58b-448d-803f-18ae360e9506/a691ffe8-5932-480b-a5c0-dda4b29c7a29`. This follow-up independently inspected that report and the WSL source. It does not establish full Desktop parity or identify the installed, running Desktop build.

## Fixed test-startup side effect

Source: `/home/amon/hermes-workspace/vite.config.ts` in Ubuntu WSL.

The `workspace-daemon` plugin's `configureServer` hook treated Vitest's Vite initialization as development service startup. Its callback could launch a gateway and the workspace daemon, perform health probes, register shutdown handlers and attempt stale-daemon cleanup.

Added an early return when `mode === 'test'` or `process.env.VITEST === 'true'`. Ordinary development behavior remains available. No gateway, credential or production-service configuration was changed; no Desktop deployment was performed.

New regression file: `/home/amon/hermes-workspace/src/vite-startup-isolation.test.ts`.

The regression safely mocks subprocesses, sockets, fetch and plugin factories. An isolated Vite configuration prevented the original bug from launching real services during reproduction. Before the fix, the two isolation cases failed and the ordinary-development case passed. After the fix, all three passed. The ordinary-development test confirms healthy existing-service reuse; test/custom-mode cases assert no service launch, health probe, daemon socket or shutdown-handler registration.

The original five focused files plus the new regression then passed through the normal project Vite configuration: **6 files, 37 tests, exit 0**. No gateway-start, invalid-OAuth or close-timeout/open-handles messages appeared in this run. Existing gateway-discovery and token-fallback diagnostics still appeared in the capability tests; these tests do not establish live gateway authentication. Installed Vitest reports version 3.2.4.

Evidence in Chief's `.chief-local/`:

- `desktop-vitest-safe.config.mjs`
- `desktop-startup-isolation-before.log`
- `desktop-startup-isolation-after.log`
- `desktop-baseline-focused-after.log`

`git diff --check` passed in the WSL checkout. Existing user changes were retained. A Windows UNC hash read of `src/routeTree.gen.ts` failed with a semaphore timeout; the reported hash comparison is therefore invalid and must not be used as evidence of a content change or preservation.

## Actual runtime remains unverified

Read-only WSL checks found:

- `/home/amon/.local/bin/claude` resolves to `/home/amon/.local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe`.
- `/home/amon/.local/bin/hermes` points to `/home/amon/.hermes/hermes-agent/venv/bin/hermes`; `test -x` fails because the target is unavailable.
- The current Vite fallback list accepts the Claude executable and passes `gateway run` to it. The test guard prevents that path during Vitest; ordinary development discovery was not changed in this repair.

Consequently, the earlier Claude OAuth failure is not evidence that the intended Hermes provider authentication has expired. Identify the actual Desktop installation/build and its intended backend first. Repair or explicitly configure that installation's Hermes launcher/backend before a same-input live comparison. Do not substitute Claude login, another model, the Windows host or a VM merely to obtain a passing comparison.

## Acceptance status

The test-startup leak is fixed. The 37-test result is regression evidence, not live Desktop operation. The HTTP Bridge's documented capability limits remain. Same-input live Desktop comparison, installed runtime identity and broader parity remain unverified. Full Desktop parity remains separate from the owner's current bounded-workflow rollout requirement.
