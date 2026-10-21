# Hermes Local VM control credentials

After the VM tools became available, Ailex's later Hermes turns kept reporting
human control even though the UI showed `Take control`. The installed Hermes
MCP registration code retains already-connected servers by name during live
`session/load`; fresh per-turn credentials in Chief's new descriptor did not
replace that running bridge. Chief correctly rejected the expired capability,
but the control client's fail-closed response used the human-control message.

Hermes now opts into the ACP runtime's existing `restartOnMcpChange` behavior.
Changed MCP inputs retire the old provider process and cold-load the same saved
conversation. Unchanged inputs still reuse it. Capabilities retain their normal
expiry; human holds are not bypassed. The control client now supplies a distinct
unavailable-connection reason for failed authorization, transport failures, or
malformed responses, while still refusing desktop actions.

Verification:

```powershell
npx vitest run server/drivers/acp/acp.test.ts -t 'rotating credentials'
npx vitest run server/control-client.test.ts server/mcp-bridge.test.ts server/drivers/acp/hermes.test.ts
node --experimental-strip-types scripts/verify-chief-control-expiry.ts
npx tsc -p tsconfig.server.json --noEmit
```

Four credential-rotation fixtures pass, including Hermes desktop control tokens
and agent tokens. Each uses synthetic credentials, three turns, and a fake CLI;
the tests assert process refresh, unchanged-input reuse, and conversation cursor
preservation. Eighty control/bridge/Hermes tests pass. The disposable-server
fixture confirms an invalid capability remains blocked with the distinct reason.
Typecheck and scoped lint pass. No owner messages or desktop actions are sent.

The actual Ailex continuation remains a user-driven acceptance check; these
results do not claim that example.com was opened.
