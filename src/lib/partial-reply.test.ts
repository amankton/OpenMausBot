import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeEvent } from "../../shared/runtime-events";
import type { ServerFrame } from "../../shared/wire";
import { createPartialReply, PARTIAL_REPLY_INTERVAL_MS, PARTIAL_REPLY_MAX_CHARS } from "./partial-reply";

let sequence = 0;
function event(data: object): ServerFrame {
  return { kind: "runtime", event: {
    type: "content.delta", streamKind: "assistant_text", delta: "Hello", provider: "fixture", threadId: "thread", turnId: "turn",
    eventId: `event-${++sequence}`, createdAt: "2026-10-19T00:00:01Z", ...data,
  } as RuntimeEvent };
}
afterEach(() => vi.useRealTimers());

describe("partial reply", () => {
  it("shows the first text immediately, coalesces later deltas and bounds text", () => {
    vi.useFakeTimers();
    const changed = vi.fn();
    const reply = createPartialReply("thread", changed);
    reply.onFrame(event({}));
    expect(changed).toHaveBeenLastCalledWith("Hello");
    for (let i = 0; i < 20; i++) reply.onFrame(event({ delta: "!" }));
    expect(changed).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(PARTIAL_REPLY_INTERVAL_MS);
    expect(changed).toHaveBeenLastCalledWith(`Hello${"!".repeat(20)}`);
    reply.onFrame(event({ delta: "x".repeat(PARTIAL_REPLY_MAX_CHARS * 2) }));
    vi.advanceTimersByTime(PARTIAL_REPLY_INTERVAL_MS);
    expect(changed.mock.lastCall![0]).toHaveLength(PARTIAL_REPLY_MAX_CHARS);
    reply.dispose();
  });

  it("never shows reasoning, synthetic text, raw input, another thread, or unscoped deltas", () => {
    const changed = vi.fn();
    const reply = createPartialReply("thread", changed);
    for (const data of [
      { streamKind: "reasoning_text", delta: "private reasoning" },
      { synthetic: true }, { threadId: "other" }, { turnId: undefined },
      { type: "item.started", itemType: "tool", input: "secret" },
    ]) reply.onFrame(event(data));
    expect(changed).not.toHaveBeenCalled();
  });

  it("deduplicates replay and fences completed or superseded turns", () => {
    const changed = vi.fn();
    const reply = createPartialReply("thread", changed);
    const first = event({});
    reply.onFrame(first); reply.onFrame(first);
    expect(changed).toHaveBeenCalledTimes(1);
    reply.onFrame(event({ type: "turn.started", turnId: "new", createdAt: "2026-10-19T00:00:02Z" }));
    reply.onFrame(event({ delta: "stale old turn" }));
    reply.onFrame(event({ delta: "New", turnId: "new", createdAt: "2026-10-19T00:00:03Z" }));
    expect(changed).toHaveBeenLastCalledWith("New");
    reply.onFrame(event({ type: "turn.completed", ok: false, turnId: "new", createdAt: "2026-10-19T00:00:04Z" }));
    reply.onFrame(event({ turnId: "new", delta: "late cancelled text", createdAt: "2026-10-19T00:00:05Z" }));
    expect(changed).toHaveBeenLastCalledWith("");
  });

  it("replaces transient items with the durable message and clears pending paints", () => {
    vi.useFakeTimers();
    const changed = vi.fn();
    const reply = createPartialReply("thread", changed);
    reply.onFrame(event({ itemId: "item" }));
    reply.onFrame(event({ itemId: "item", delta: " queued" }));
    reply.onFrame(event({ type: "item.completed", itemType: "assistant_text", itemId: "item", text: "Hello queued" }));
    reply.onFrame(event({ itemId: "item", delta: "stale item" }));
    vi.advanceTimersByTime(1000);
    expect(changed.mock.calls.map(([text]) => text)).toEqual(["Hello", ""]);
    reply.onFrame(event({ itemId: "next", delta: "Next" }));
    reply.onFrame({ kind: "message", threadId: "thread", message: { id: "m", at: 1, role: "bot", kind: "text", text: "Next", turnId: "turn" } });
    expect(changed).toHaveBeenLastCalledWith("");
    reply.dispose();
  });

  it("clears on retry, missed frames and disposal without firing a delayed paint", () => {
    vi.useFakeTimers();
    const changed = vi.fn();
    const reply = createPartialReply("thread", changed);
    reply.onFrame(event({}));
    reply.onFrame(event({ delta: " queued" }));
    reply.onFrame(event({ type: "turn.retrying", attempt: 1, delayMs: 1, reason: "retry" }));
    expect(changed).toHaveBeenLastCalledWith("");
    reply.onFrame(event({ delta: "Retry" }));
    reply.reset();
    expect(changed).toHaveBeenLastCalledWith("");
    reply.onFrame(event({ type: "turn.started", turnId: "next" }));
    reply.onFrame(event({ turnId: "next", delta: "next" }));
    reply.onFrame(event({ turnId: "next", delta: " pending" }));
    reply.dispose();
    const calls = changed.mock.calls.length;
    vi.runAllTimers();
    expect(changed).toHaveBeenCalledTimes(calls);
  });

  it("does not let an old turn's durable answer clear the current turn", () => {
    const changed = vi.fn();
    const reply = createPartialReply("thread", changed);
    reply.onFrame(event({ type: "turn.started", turnId: "current" }));
    reply.onFrame(event({ turnId: "current", delta: "Current reply" }));
    reply.onFrame({ kind: "message", threadId: "thread", message: { id: "old", at: 1, role: "bot", kind: "text", text: "Old reply", turnId: "old" } });
    reply.onFrame(event({ type: "turn.completed", turnId: "old", ok: true }));
    expect(changed).toHaveBeenLastCalledWith("Current reply");
    expect(changed).toHaveBeenCalledTimes(1);
    reply.dispose();
  });
});
