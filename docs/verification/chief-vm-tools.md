# Chief Local VM tools through Hermes

On 2026-10-10, Ailex's Hermes turn received the `computer` MCP descriptor but
its bridge could not connect to Podman. Chief's status API reported a ready
desktop while Hermes's MCP stderr reported a fallback to `/run/podman/podman.sock`.
Hermes sanitizes subprocess environments: the implicit parent connection did
not survive its stdio MCP launch.

`containerComputerMcp` now explicitly carries CLI discovery (`OMB_EXTRA_PATH`)
and Podman's selected connection (`CONTAINER_HOST`, `CONTAINER_SSHKEY`, and
`CONTAINER_CONNECTION`, when present). Provider credentials and provider homes
are not copied. The SSH identity remains a file reference; control credentials
remain in environment variables rather than command arguments. Other runtimes
do not receive Podman-specific settings.

## Verification

```powershell
npx vitest run server/container-computer.test.ts server/container-mcp.test.ts server/drivers/acp/hermes.test.ts
node --experimental-strip-types scripts/verify-chief-vm-tools.ts
npx tsc -p tsconfig.server.json --noEmit
```

129 tests passed; two POSIX-only bridge process tests are skipped on Windows.
Two pre-existing assertions were updated to the current Chief ownership-error
wording. The Windows fixture starts a disposable Chief backend, reproduces the
old sanitized-environment handshake failure, and then discovers the real Cua
tool catalog using the explicit environment. It asserts desktop state, click,
browser navigation, and browser state tools are present. See
`evidence/chief-vm-tools.json`.

This is read-only MCP discovery: no desktop tool calls, browser navigation,
paid model turns, owner chat messages, or container lifecycle changes occur.
It proves tool availability, not completion of Ailex's example.com task.
Restart personal Chief to load the fix, then resume Ailex's existing conversation.
