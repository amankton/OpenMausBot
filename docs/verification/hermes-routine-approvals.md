# Hermes routine approvals

October 31, 2026: owner reported more than 50 approval clicks. Read-only live
inspection found 97 permission cards in that day's decision log: repeated VM
inspection, file/skill reads, document writes, attachments and coordination.
Hermes Auto was still opening a card per broker/native operation; Ailex's
delegated conversation also retained Ask despite its bot default being Auto.

The fix is an explicit, default-off Hermes instance setting. It grants a finite
set of routine operations only for Auto source conversations. See
[approval levels](../approval-levels.md#hermes-routine-autonomy-opt-in) for the
exact boundary and remaining command/computer checkpoints.

Run:

```sh
pnpm exec vitest run server/drivers/hermes-routine-approval.test.ts server/drivers/hermes-tool-bridge.test.ts server/drivers/hermes-http.test.ts server/drivers/chat-mcp-tools.test.ts server/claude-accounts.test.ts
python -m unittest discover -s integrations/hermes-http-tools -p test_plugin.py
pnpm exec tsc -p tsconfig.server.json --noEmit
node --experimental-strip-types scripts/verify-hermes-routine-approvals.ts
```

The recipe launches a real disposable Chief server with its own data/home and
a scripted Hermes HTTP endpoint. It exercises the real built-in agents MCP
proxy and provider approval round-trip: opted-in Auto reads run without cards;
Ask and disabled-policy reads still require permission; a consequential command
still opens a real card and respects a human denial in all three cases. It
cleans up the fixture and keeps a redacted receipt in
`evidence/hermes-routine-approvals.json`. The Python checks verify native
argument forwarding and fail-closed behavior. Unit checks cover workspace
escape, symlink escape, instruction/config files, command injection, local
computer restrictions and spoofed custom MCP identities.

The provider is scripted. This proves harness enforcement, not a real model's
planning quality, account eligibility, or the installed plugin's loaded state.
Operational settings/recovery receipts belong under ignored `.chief-local`.

## Local rollout and real-provider acceptance

The local owner workspace was updated through its normal API: 191 agent
defaults now use Auto (188 changed), their selected conversations were aligned
where needed (188 changed), and new-bot defaults use Auto. Existing acceptance
fixtures and the scoped Crewframe Gateway were excluded. Nineteen existing
teams received an appended routine-execution/checkpoint brief. Bacca remains
Chief of Staff; making Solo a second Chief would demote Bacca, so that route
was deliberately not used. Models, identities, roles, tool scopes, computer
assignments and unrelated settings were independently compared with the
recovery snapshot and preserved. No Full Access grant was created.

Chief was restarted only while idle, through its graceful handlers. Hermes's
installed plugin was updated, followed by its supported gateway restart. The
gateway drained cleanly; its existing supervisor was reattached to the new
process. Cold startup took time to reconnect existing MCP integrations. Its
HTTP API and a real provider turn were then verified. Existing third-party
MCP authentication failures are outside this approval-policy change.

Run the optional real-provider recipe:

```sh
node --experimental-strip-types scripts/verify-hermes-routine-live.ts /absolute/path/to/hermes
```

It uses the installed Hermes API/plugin with a disposable Chief workspace,
explicit temporary working folder and synthetic document. Real native
`write_file` and `read_file` completed with **zero approval cards**, and both
routine grants appeared in the backend log. No owner chat was used. Receipt:
`evidence/hermes-routine-live.json`.

Validation: 85 selected TypeScript tests passed, one existing platform test was
skipped; six Python plugin tests passed. Server TypeScript, scoped lint,
whitespace checks, scripted end-to-end acceptance and real-provider acceptance
passed. Source preview/runtime and the installed plugin were updated; no new
standalone installer was built or published.
