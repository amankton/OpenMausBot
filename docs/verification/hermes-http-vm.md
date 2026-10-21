# Hermes HTTP Local VM verification

Verified October 20, 2026 against the installed real Hermes API and Podman VM.
Transport remains HTTP/SSE; no ACP process is used.

The disposable app fixture creates its own per-bot VM, opens a terminal with a
random marker, and asks Hermes to inspect the desktop without giving it that
marker. Hermes discovers the existing `computer_get_desktop_state` MCP tool,
requests permission through the normal app card, receives the screenshot, and
returns the marker correctly. The fixture approves only its own request through
the normal response route. The live owner's chats and VM are not used.

Result: passed, streaming observed, one approval card, successful desktop tool
start/completion, marker matched. Cleanup stops the fixture and removes its VM.
Evidence: [hermes-http-vm.json](evidence/hermes-http-vm.json).

```sh
node --experimental-strip-types scripts/verify-hermes-http-vm.ts /absolute/path/to/hermes
```

Requires the configured local Hermes home/API, installed plugin and working
Podman image. See the script's arguments and [setup](hermes-http.md).

Automated checks: 105 TypeScript tests across the driver, broker, MCP tools,
approvals, images and startup helpers; five Python plugin tests; server TypeScript
check and scoped lint passed. The bridge tests exercise authentication, schemas,
tool restrictions, human denial, duplicate calls and revocation on cancellation.


Chief was then restarted through its existing scheduled task. Read-only rollout
checks returned UI HTTP 200, Hermes available/authenticated, and VM/tool/image
capabilities enabled. The durable data directory, config hash and bots hash were
unchanged; Solo - Chief still has `computer=vm`. The local rollout receipt is
`.chief-local/hermes-http-vm-restart.json` (ignored operational state).
Server bundle build also passed.
