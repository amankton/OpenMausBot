import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "./contracts.ts";
import { TurnTiming } from "./turn-timing.ts";

const event = (value: object): RuntimeEvent => ({
  eventId: "event", createdAt: "unused", provider: "hermesAgent", threadId: "thread", turnId: "turn", ...value,
}) as RuntimeEvent;

function fixture(capacity = 512, enabled = true) {
  let at = 0;
  const records: Record<string, number | string | null>[] = [];
  const timing = new TurnTiming(record => records.push(record), () => at, capacity, enabled);
  return { timing, records, at: (value: number) => { at = value; } };
}

describe("turn timing", () => {
  it("separates setup, measured stages, runtime, first text and silent gaps without payloads", () => {
    const f = fixture();
    f.timing.begin("thread", "generation");
    f.at(10);
    const end = f.timing.measure("thread", "generation", "checkpoint");
    f.at(110); end(); end();
    f.at(120); f.timing.dispatch("thread", "generation");
    f.at(125); f.timing.event(event({ type: "turn.started", raw: { payload: "secret" } }));
    f.at(200); f.timing.event(event({ type: "item.started", itemType: "tool", title: "private tool input" }));
    f.at(300); f.timing.event(event({ type: "content.delta", streamKind: "assistant_text", delta: "private reply" }));
    f.at(450); f.timing.event(event({ type: "turn.completed", ok: true, cost: null }));
    expect(f.records).toEqual([{
      trace: 1, outcome: "completed", totalMs: 450, setupMs: 120, checkpointMs: 100, recallMs: 0,
      runtimeMs: 330, firstEventAfterDispatchMs: 5, firstTextAfterDispatchMs: 180,
      maxEventGapMs: 150, events: 4, toolStarts: 1,
    }]);
    expect(JSON.stringify(f.records)).not.toMatch(/secret|private|thread|generation|hermes/);
  });

  it("ignores setup events, stale generation callbacks and another provider turn", () => {
    const f = fixture();
    f.timing.begin("thread", "old");
    const endOld = f.timing.measure("thread", "old", "recall");
    f.timing.event(event({ type: "turn.completed", ok: true, cost: null }));
    expect(f.records).toHaveLength(0);
    f.at(10); f.timing.begin("thread", "new");
    f.at(20); endOld(); f.timing.finish("thread", "old", "released");
    f.timing.dispatch("thread", "new");
    f.timing.event(event({ type: "turn.started", turnId: "new-turn" }));
    f.timing.event(event({ type: "turn.completed", ok: true, cost: null }));
    expect(f.records).toHaveLength(1);
    f.at(40); f.timing.event(event({ type: "turn.completed", turnId: "new-turn", ok: false, cost: null }));
    expect(f.records[1]).toMatchObject({ outcome: "failed", totalMs: 30, recallMs: 0 });
  });

  it("bounds abandoned records and cleans released/setup-failed turns", () => {
    const f = fixture(1);
    f.timing.begin("thread", "one");
    f.at(20); f.timing.begin("other", "two");
    expect(f.records[0]).toMatchObject({ outcome: "evicted", totalMs: 20, runtimeMs: null });
    const endCheckpoint = f.timing.measure("other", "two", "checkpoint");
    f.at(50); f.timing.finish("other", "two", "released");
    endCheckpoint();
    f.timing.finish("other", "two", "setup_failed");
    expect(f.records).toHaveLength(2);
    expect(f.records[1].checkpointMs).toBe(30);
    f.timing.begin("third", "three");
    f.timing.finish("third", "three", "setup_failed");
    expect(f.records[2]).toMatchObject({ outcome: "setup_failed", firstTextAfterDispatchMs: null });
  });

  it("ignores synthetic replies and supports opt-out and failing diagnostic sinks", () => {
    const f = fixture();
    f.timing.begin("thread", "g"); f.timing.dispatch("thread", "g");
    f.timing.event(event({ type: "turn.started" }));
    f.timing.event(event({ type: "item.completed", itemType: "assistant_text", text: "error", synthetic: true }));
    f.timing.event(event({ type: "turn.completed", ok: false, cost: null }));
    expect(f.records[0].firstTextAfterDispatchMs).toBeNull();
    const disabled = fixture(1, false);
    disabled.timing.begin("thread", "g"); disabled.timing.finish("thread", "g", "released");
    expect(disabled.records).toEqual([]);
    const broken = new TurnTiming(() => { throw new Error("log unavailable"); });
    broken.begin("thread", "g");
    expect(() => broken.finish("thread", "g", "released")).not.toThrow();
  });
});
