# Direct-turn latency diagnostics

The server writes one `[turn-timing]` JSON line for an admitted direct turn
when it completes, fails setup, or releases its generation (including Stop).
Set `OMB_TURN_TIMING=0` before starting a server to disable this diagnostic.
There is no new endpoint, database, or transcript log. Records contain only a
process-local numeric trace, a fixed outcome, durations and counts. They omit
bot/thread identities, model names, prompts, replies, tool inputs and credentials.

- `setupMs`: admission to adapter dispatch, including local preparation.
- `checkpointMs` and `recallMs`: measured portions of setup, not extra time.
- `runtimeMs`: adapter dispatch to completion or release. This includes driver
  initialization, provider work, tool execution, human waits and delivery delays;
  it is not an inference-time measurement.
- `firstEventAfterDispatchMs` and `firstTextAfterDispatchMs`: first canonical
  provider event and nonempty, nonsynthetic assistant text after dispatch.
  Missing measurements are `null`. Canonical text batching can add up to 50 ms.
- `maxEventGapMs`: longest observed canonical-event silence, including the
  dispatch-to-first-event and last-event-to-release intervals. Silence does not
  identify its cause. `events` and `toolStarts` provide activity counts only.

The collector uses a monotonic clock, holds at most 512 active samples, and
emits no per-delta diagnostics. A superseded/evicted sample is marked explicitly.
Release or failure removes its sample; no expiry timer or shutdown work is added.
Generation and provider-turn correlation reject stale callbacks. In-flight
checkpoint time is included if a turn is released while the snapshot is pending.

This first slice covers direct turns, including nested direct conversations;
it does not instrument the separate group dispatch path, HTTP arrival/queue time,
raw ACP handshake phases, SSE rendering, or event-loop delay. Its anonymous
process-local traces are useful for controlled reproductions, not per-bot reports.

## Verification

```sh
pnpm exec vitest run server/turn-timing.test.ts server/turn-timing.e2e.test.ts
pnpm exec tsc -p tsconfig.server.json --noEmit
```

The end-to-end test launches the standard isolated fake-engine fixture, sends
two consecutive chats through `control:omb`, verifies settled replies and
transcripts, then checks complete timing rows and absence of the synthetic
message canary. It retains the command/results and timing rows beside the
fixture log as `.timing.json`. No real provider or running user server is used.
