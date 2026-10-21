# Hermes HTTP migration

The built-in `hermesAgent` now defaults to backend HTTP `/v1/runs` admission and
`/v1/runs/{run_id}/events` SSE. The React app still uses the existing chat routes,
runtime events and `/api/events` connection. No Hermes key or Hermes connection
is needed in the browser. Runs preserve tool events, approval answers, Stop and
live steering; basic chat-completions would lose those lifecycle controls.

## Configuration

Set these in the **application backend's** environment (see root `.env.example`):

```dotenv
HERMES_API_BASE_URL=http://127.0.0.1:8642
HERMES_API_KEY=<same secret as Hermes API_SERVER_KEY>
HERMES_API_MODEL=hermes-agent
HERMES_API_TIMEOUT_MS=900000
HERMES_TRANSPORT=http
```

The existing server reads environment variables. For a local `.env` file use
`node --env-file=.env --experimental-strip-types server/index.ts`; `pnpm dev:server`
requires the variables already exported. Root Compose forwards these settings.
Other deployment manifests need equivalent service environment entries. Secrets
belong in a local ignored file or secret manager, never `VITE_*` variables or a
checked-in config. The key is also classified as a provider credential so
unrelated ACP/MCP probes and engines strip it from their child environments.

Use the model advertised by `GET /v1/capabilities` if your server's virtual model
name differs from `hermes-agent`. The verified local server advertised
`gpt-6-luna`. Base URL trailing slashes are removed. Invalid URL/key/timeout
configuration makes the provider unavailable with a startup diagnostic through
the existing registry shadow mechanism; it does not prevent other engines
starting. Health/capabilities check transport/auth and required run features.

In separate containers, `127.0.0.1` means the application container. Configure
the Hermes service name or reachable host address instead; also configure Hermes
to listen on the required interface with authentication and appropriate network
access controls. The root Compose defaults alone do not expose a host service.

If Hermes API is not enabled, inspect its existing `.env` before adding:

```dotenv
API_SERVER_ENABLED=true
API_SERVER_KEY=<strong-secret>
```

Restart with `hermes gateway restart`, then check `/health` and authenticated
`/v1/capabilities`. Server-to-server requests need no CORS. If deliberately
supporting a direct browser client elsewhere, use a narrow origin such as
`API_SERVER_CORS_ORIGINS=http://localhost:3000`.

## Previous integration inventory

| Concern | Existing location | HTTP replacement |
| --- | --- | --- |
| Hermes selection and model probe | `server/drivers/acp/hermes.ts` (`spawnArgs: ["acp"]`, `fetchHermesAcpModels`) | `server/drivers/hermes-http.ts`; no CLI model probe |
| Spawn, stdio JSON-RPC, initialize | `server/drivers/acp/core.ts`, shared with other engines | persistent external Hermes API server |
| `session/new`, load, prompt | ACP core's `sendTurn` | authenticated `POST /v1/runs` with stable `session_id`, current `input`, persona `instructions` |
| Stream normalization, tools | ACP core runtime event emitter | `HermesHttpClient.events` and HTTP driver's event mapping |
| Approvals and interrupt | ACP core `respondToRequest`, `interruptTurn` | run approval and stop endpoints |
| Persistence | harness runtime `session.started`/resume cursor | signed, thread-scoped HTTP session cursor through same harness mechanism |
| Frontend | `server/index.ts` runtime bus → `/api/events`; `ChatView`/`PartialReply` | same public contracts and components |
| Configuration | `server/config.ts`, registry instance config/environment | validated backend environment in `hermes-http-client.ts` |
| Old tests | `acp/acp.test.ts`, `approval-matrix.test.ts`, local-inject tests | retained as explicit legacy coverage; new HTTP tests are separate |

## Event mapping

| Hermes API event/action | Existing application contract |
| --- | --- |
| accepted `run_id` | internal run control handle; `session.started` persists scoped cursor |
| `message.delta` | immediate `content.delta` / `assistant_text` |
| `message.interim` | complete current assistant item; don't replay already-streamed text |
| `reasoning.available` | `content.delta` / `reasoning_text` |
| `tool.started`, `tool.completed` | `item.started`, `item.completed` / tool, matched FIFO by tool name |
| `approval.request` | `request.opened` with exact request ID and offered choices |
| allow once, session allow, deny | `POST /v1/runs/{id}/approval` with `once`, `session`, `deny` |
| composer steering | `POST /v1/runs/{id}/steer` with `input`; ambiguous network result is indeterminate |
| Stop | `POST /v1/runs/{id}/stop` then abort the event reader |
| `run.completed` | one assistant final item and one `turn.completed`; final output is a fallback only when no deltas arrived |
| failed/cancelled/interrupted run | controlled error or interrupted completion |
| malformed/broken event stream | recoverable runtime error, stop known server run, release reader |

The SSE parser supports split UTF-8, LF/CR/CRLF, comments, multiline `data:`,
multiple events per chunk and `[DONE]`. Runs still require a terminal lifecycle
event; a bare `[DONE]`/EOF does not falsely report success. Stream events are
bounded to 4 MiB. Upstream error bodies are parsed to a bounded size but never
echoed to users or logs. Requests refuse redirects carrying the bearer token.

## Continuity and lifecycle

Conversation IDs are HMAC-derived from the backend workspace, provider instance,
bot and server-authorized thread. Resume cursors are signed for that same scope;
a foreign thread's cursor is never accepted. An explicit reset creates a fresh
UUID-backed session. Old ACP cursors rebuild from the harness's recovery text.
Steady-state prompts send only the current input; Hermes owns stored history.
API key rotation changes the signature namespace, so existing conversations
need a deliberate recovery/reset after rotation. Hermes owns durable history;
clearing that server's history cannot be repaired by reusing an ID alone.

Only one active generation per thread is admitted. Events check their owning
state/run before publication; terminal publication releases the slot before the
harness can dispatch a queued turn. Dispose/stopAll stops known runs and aborts
readers. Stop during admission waits for the ID and immediately stops that run.
JSON requests are bounded to 30 seconds, controls to 10 seconds, streaming to the
configured timeout. An admission accepted by Hermes whose response is lost
remains an uncertain outcome; no automatic prompt replay occurs.

The app intentionally keeps background work alive across browser tab disconnects:
several windows/people may observe one thread. Closing one `/api/events` client
must not cancel everyone's generation. Existing frontend reconnect/replay stays
in place; Stop or backend shutdown performs cancellation. A broken Hermes stream
produces a visible retryable error rather than automatically replaying the turn.

## App tools and Local VM over HTTP

The standalone `integrations/hermes-http-tools` plugin restores app-mounted MCP,
Local VM, host computer, browser, phone, assigned integrations and image access
while keeping `/v1/runs` and SSE. It uses the existing app tools and permission
cards; it does not invoke ACP or patch Hermes core.

Install into the explicitly selected existing Hermes home:

```sh
node --experimental-strip-types scripts/install-hermes-http-tools.ts /absolute/path/to/hermes
```

The installer backs up config/plugin files, preserves enabled tools/plugins, and
adds `chief_http_tools` to the API toolsets. Restart Hermes or use its supported
plugin reload control. Chief's local launcher detects the installed plugin.
Other launchers must set `HERMES_TOOL_BRIDGE_ENABLED=1` and
`HERMES_TOOL_BRIDGE_DIR=/absolute/path/to/hermes/chief-http-bridge`.
The driver checks that the API actually advertises the enabled tool.

Each run receives an authenticated loopback broker and an expiring local manifest.
The plugin derives the run identity from Hermes session context, discovers tool
names, fetches exact schemas, and calls existing MCP transports. App permissions,
tool selectors, VM ownership and cancellation remain enforced. Native Hermes
tools also pass the broker's policy hook. Tool images use Hermes's multimodal
result contract. Stop and turn completion remove the manifest and close transports.
No broker token or API key is sent to the browser. API keys are stripped from
MCP child environments.

This rendezvous currently requires Hermes and Chief on the same host with access
to the same directory and loopback listener. Separate containers/remote servers
need an explicitly designed shared rendezvous/network arrangement; setting the
flag alone does not provide that. Guest confinement and local injected providers
remain unsupported. Without the plugin, plain HTTP chat still works but app tools
and images are unavailable. There is no automatic ACP fallback.

See [real VM verification](hermes-http-vm.md). The user-provided
[community WebUI API](https://get-hermes.ai/api-docs/) documents a separate
`/api/chat/start` service; the installed Hermes server uses `/v1/runs`.

## Reproduce verification

```sh
pnpm exec vitest run server/drivers/hermes-http.test.ts server/turn-log.test.ts
pnpm exec tsc -p tsconfig.server.json --pretty false
node --experimental-strip-types scripts/verify-hermes-http.ts /absolute/path/to/hermes/.env
```

The opt-in real smoke reads only the server key from the chosen file, creates an
isolated app home, opens the real chat UI in headless Chrome and sends synthetic
prompts. It checks deltas, partial rendering, second-turn recall, Stop,
credential absence in browser requests/events and backend logs, and Windows ACP
process inventory. It does not change Hermes config or the user's running app.
It leaves only synthetic Hermes session history and redacted verification
evidence. Browser/headless Chrome must be installed. ACP process inventory is
implemented on Windows; other platforms need an equivalent process check.

Results are in `evidence/hermes-http.json` and `evidence/hermes-http.png`.
Timing logs contain IDs, stage, status/error category, dispatch delay, first
event/content delay and total duration, without prompts or keys. The existing
turn-start logger now records prompt length instead of prompt prefixes.
