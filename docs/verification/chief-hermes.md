# Chief Hermes Windows launcher verification

Verified 2026-10-07 after the owner completed a Hermes update. The current
`hermes.cmd` still produced synchronous `spawn EINVAL` through the original
Chief resolver. It is a Python/base64 bootstrap wrapper, not an npm shim.

Chief now recognizes only the exact two-line published wrapper shape and
executes its existing `python.exe -I -c <bootstrap>` with literal argv. The
bootstrap is preserved, re-read per launch, and no command shell is enabled.
Unrecognized batch scripts remain unsupported and failures reach the probe
callback with an actionable message. Both spawn and exec resolution respect
the caller's environment.

The installed CLI returned `Hermes Agent v0.21.5+8863.g6fa88c1 (2026.9.24)`.
A cold version check took 12.2 seconds; Hermes-specific setup and availability
probes now allow 30 seconds. Other provider budgets remain unchanged.

## Reproduce

```powershell
pnpm exec vitest run server/env-path.test.ts server/procs.test.ts server/drivers/acp/hermes.test.ts server/cli-probe-env.test.ts
node --experimental-strip-types scripts/verify-chief-hermes.ts 'C:\Users\amank\AppData\Local\hermes\bin\hermes.cmd'
pnpm exec tsc -p tsconfig.server.json --noEmit
```

The fixture tests the actual `/api/cli-test` route against a synthetic wrapper
using the installed Python, and verifies literal Windows quoting/empty argv.
Separately it resolves the installed launcher's `--print-runtime-command`
protocol and runs version-only validation in its existing Hermes home. It
does not send prompts, reauthenticate, copy credentials, or install packages.
The installed launcher hash is checked before/after. See
[chief-hermes.json](evidence/chief-hermes.json).

81 tests passed; 9 POSIX-only tests skipped on Windows. Server typecheck and
scoped lint passed. Tests also cover a rewritten launcher, missing interpreter,
rejection of extra batch commands, caller PATH/PATHEXT, and callback handling
of synchronous EINVAL.

## Interactive preview

The preview originally ran with an empty fixture HERMES_HOME, which lacks
the installed dependency generation. `scripts/chief-preview.ts` now supports
an explicit `--hermes-home <absolute-existing-home>` on a resumed preview;
the path persists in the ignored manifest. It points to existing Hermes
state without copying credentials into Chief. Default automated fixtures
remain sealed and disposable.

The owned Chief launcher was stopped using its verified exclusive console's
Ctrl-C handler, then resumed with the same data directory and unchanged
config.json. Current UI remains http://127.0.0.1:5299. After restart the actual
pre-save route returned HTTP 200 and `ok: true` for the owner's exact
`C:\Users\amank\AppData\Local\hermes\bin\hermes.cmd` path. Platform HTTP
also remained 200. Hermes gateway and Platform containers were not restarted.

This proves launch/setup validation; no paid turn, ACP generation or new
account configuration was performed.
