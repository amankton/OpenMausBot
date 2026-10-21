import { performance } from "node:perf_hooks";
import type { RuntimeEvent } from "./contracts.ts";

type Outcome = "completed" | "failed" | "released" | "setup_failed" | "superseded" | "evicted";
type Phase = "checkpoint" | "recall";
type Sample = {
  generation: string;
  trace: number;
  started: number;
  dispatched?: number;
  turnId?: string;
  firstEvent?: number;
  firstText?: number;
  lastEvent?: number;
  maxEventGap: number;
  events: number;
  toolStarts: number;
  checkpoint: number;
  recall: number;
  phaseStarts: Partial<Record<Phase, number>>;
};

/** Metadata only, one record per admitted direct turn. Provider phase includes
 * driver startup and tools; canonical events do not prove model inference time.
 * No timer, transcript retention, synchronous file writes, or per-delta output. */
export class TurnTiming {
  private readonly active = new Map<string, Sample>();
  private sequence = 0;
  private readonly emit: (record: Record<string, number | string | null>) => void;
  private readonly now: () => number;
  private readonly capacity: number;
  private readonly enabled: boolean;

  constructor(
    emit: (record: Record<string, number | string | null>) => void,
    now: () => number = () => performance.now(),
    capacity = 512,
    enabled = true,
  ) {
    this.emit = emit;
    this.now = now;
    this.capacity = capacity;
    this.enabled = enabled;
  }

  begin(threadId: string, generation: string): void {
    if (!this.enabled) return;
    const previous = this.active.get(threadId);
    if (previous) this.finish(threadId, previous.generation, "superseded");
    if (this.active.size >= Math.max(1, this.capacity)) {
      const oldest = this.active.entries().next().value;
      if (oldest) this.finish(oldest[0], oldest[1].generation, "evicted");
    }
    this.active.set(threadId, { generation, trace: ++this.sequence, started: this.now(),
      maxEventGap: 0, events: 0, toolStarts: 0, checkpoint: 0, recall: 0, phaseStarts: {} });
  }

  measure(threadId: string, generation: string, phase: Phase): () => void {
    const sample = this.active.get(threadId);
    if (!sample || sample.generation !== generation) return () => {};
    const started = this.now();
    sample.phaseStarts[phase] = started;
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      if (this.active.get(threadId) === sample) {
        sample[phase] += Math.max(0, this.now() - started);
        delete sample.phaseStarts[phase];
      }
    };
  }

  dispatch(threadId: string, generation: string): void {
    const sample = this.active.get(threadId);
    if (sample?.generation === generation) sample.dispatched ??= this.now();
  }

  event(event: RuntimeEvent): void {
    const sample = this.active.get(event.threadId);
    // Compaction/setup may run another provider turn before our dispatch.
    if (!sample || sample.dispatched === undefined || !event.turnId) return;
    if (!sample.turnId) {
      if (event.type !== "turn.started") return;
      sample.turnId = event.turnId;
    }
    if (sample.turnId !== event.turnId) return;
    const at = this.now();
    sample.firstEvent ??= at;
    sample.maxEventGap = Math.max(sample.maxEventGap, at - (sample.lastEvent ?? sample.dispatched));
    sample.lastEvent = at;
    sample.events++;
    if (event.type === "item.started" && event.itemType === "tool") sample.toolStarts++;
    if (!event.synthetic && (
      (event.type === "content.delta" && event.streamKind === "assistant_text" && event.delta.length > 0) ||
      (event.type === "item.completed" && event.itemType === "assistant_text" && event.text.length > 0)
    )) sample.firstText ??= at;
    if (event.type === "turn.completed") this.finish(event.threadId, sample.generation, event.ok ? "completed" : "failed");
  }

  finish(threadId: string, generation: string, outcome: Outcome): void {
    const sample = this.active.get(threadId);
    if (!sample || sample.generation !== generation) return;
    this.active.delete(threadId);
    const at = this.now();
    for (const phase of ["checkpoint", "recall"] as const) {
      const started = sample.phaseStarts[phase];
      if (started !== undefined) sample[phase] += Math.max(0, at - started);
    }
    const ms = (value: number) => Math.round(Math.max(0, value) * 10) / 10;
    // Explicit allowlist: never spread a runtime event or caller input here.
    const record = {
      trace: sample.trace, outcome, totalMs: ms(at - sample.started),
      setupMs: ms((sample.dispatched ?? at) - sample.started),
      checkpointMs: ms(sample.checkpoint), recallMs: ms(sample.recall),
      runtimeMs: sample.dispatched === undefined ? null : ms(at - sample.dispatched),
      firstEventAfterDispatchMs: sample.firstEvent === undefined ? null : ms(sample.firstEvent - sample.dispatched!),
      firstTextAfterDispatchMs: sample.firstText === undefined ? null : ms(sample.firstText - sample.dispatched!),
      maxEventGapMs: ms(sample.dispatched === undefined ? 0 : Math.max(sample.maxEventGap, at - (sample.lastEvent ?? sample.dispatched))),
      events: sample.events, toolStarts: sample.toolStarts,
    };
    try { this.emit(record); } catch { /* Diagnostics must never fail a turn. */ }
  }
}
