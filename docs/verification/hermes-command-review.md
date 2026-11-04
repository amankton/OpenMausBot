# Hermes command review and owner checkpoints

The owner explicitly authorized improvement of command review on October 31,
2026: "Go ahead and improve the command review so Solo and the other agents can
handle routine work without me. Keep my approval for important checkpoints."

The earlier finite routine policy remains. A separate default-off `commandReview`
setting adds model-assisted review of complete native terminal and built-in VM
commands for Auto conversations. A native tools-free auxiliary completion
evaluates routine internal work; conservative mandatory checkpoint patterns run
first. Ask, questions, scope, custom MCP and computer controls remain unchanged.
See [approval levels](../approval-levels.md#hermes-command-review-opt-in).

## Automated verification

```sh
pnpm exec vitest run server/drivers/hermes-command-review.test.ts server/drivers/hermes-command-review-bridge.test.ts server/drivers/hermes-routine-approval.test.ts server/drivers/hermes-tool-bridge.test.ts server/drivers/hermes-http.test.ts server/claude-accounts.test.ts
python -m unittest discover -s integrations/hermes-http-tools -p 'test_*.py'
pnpm exec tsc -p tsconfig.server.json --noEmit
```

The selected TypeScript suite passed 58 tests with one existing platform skip;
the plugin/auxiliary suite passed eight Python tests. Checks cover fixed
checkpoints against a reviewer that approves everything, real scoped MCP
execution and denial, Ask, custom-server impersonation, workspace/symlink
boundaries, missing-workdir correction, malformed model answers, timeout,
provider failure, no cached grants and Stop followed by late approval.

## Real model and server acceptance

```sh
node --experimental-strip-types scripts/verify-hermes-command-review-model.ts /absolute/path/to/hermes
node --experimental-strip-types scripts/verify-hermes-routine-approvals.ts /absolute/path/to/hermes
node --experimental-strip-types scripts/verify-hermes-routine-live.ts /absolute/path/to/hermes --commands
```

The first recipe submits twelve synthetic cases for review without executing
them. Four benign cases (inline Python, compound draft generation, bounded
inspection, syntax checking) were approved. Opaque scripts, unknown dynamic
commands, obfuscated deletion, indirect private-data upload, comment injection,
remote push, deletion and credential reads were held. This is a small behavior
sample, not a safety guarantee for every possible command. Receipt:
`evidence/hermes-command-review-model.json`.

The second uses a real disposable Chief server/MCP proxy with scripted Hermes
transport and the real native auxiliary reviewer. It approves a compound
routine command through the actual broker; consequential commands still open
a human card and respect denial. Ask and disabled-policy reads remain gated.
Receipt: `evidence/hermes-command-review-server.json`.

The final recipe uses real Hermes execution in a disposable Chief workspace and
temporary working folder. It writes and reads one synthetic draft using native
terminal, with no owner chat/data mutations. Receipt, when passed:
`evidence/hermes-command-review-live.json`. No fixture automatically approves a
pending human request. Every fixture stops its exact server and reviewer.

## Operational scope

The local source runtime and installed Chief Hermes plugin receive this change.
No new installer, external publish, customer rollout, Full Access grant or
agent/model/role reassignment is part of it. The ignored local recovery and
rollout receipts preserve previous config/plugin files and record runtime
identity plus independent preservation checks. The gateway's existing
supervisor must continue watching the replacement process after its supported
restart.

## Completed local rollout

Both `routineApprovals` and `commandReview` are enabled on the existing local
Hermes instance. The real execution recipe passed: native terminal generated
and read a synthetic draft, with zero approval cards and an approved
`command-review` receipt. The source server was gracefully restarted after the
final policy changes; the Hermes gateway used its supported restart and its
original supervisor watches the replacement PID. Both HTTP surfaces responded
200 and no owner bot or Hermes API run was left active by the checks.

Independent comparisons preserved all 194 bot IDs, models, personas, roles,
tool/computer scopes and approval modes. Team instructions are byte-identical
to the pre-rollout snapshot. The local operational receipt is
`.chief-local/command-review-rollout.json`; it includes exact recovery/runtime
identities without credentials. No user conversation was used as a mutation
test, and Full Access remains ungranted.

Windows cleanup left small fixture remnants at
`C:/Users/amank/AppData/Local/Temp/openmausbot-verify-data-9oWeVd` and
`C:/Users/amank/AppData/Local/Temp/openmausbot-verify-data-HZXOll` after EPERM
errors (including a native proxy log). A subsequent cleanup attempt was rejected
by automatic approval review with only "blocked by policy"; no alternate delete
was attempted. These paths are disposable test data, not owner runtime data.
Fixture Chief servers and their reviewer workers exited; the remnants do not
affect the active system.
