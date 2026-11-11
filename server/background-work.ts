import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "./atomic.ts";
import type { RuntimeEvent, SendTurnInput } from "./contracts.ts";

export const CUSTOMER_BACKGROUND_LIMITS = Object.freeze({ requests: 20, activeMs: 10 * 60_000, intervalMinutes: 15, enabledRoutines: 20, catchUpMs: 30 * 60_000, failureLimit: 3 });
const threadSchema = z.object({ botId: z.string(), state: z.enum(["running", "idle", "waiting"]), requests: z.array(z.string()) });
const recordSchema = z.object({ id: z.string(), routineId: z.string(), startedAt: z.number(), activeMs: z.number().nonnegative(), activeSince: z.number().nullable(), requests: z.number().int().nonnegative(), terminal: z.boolean(), reason: z.string().optional(), pendingEffects: z.array(z.string()).default([]), actors: z.array(z.string()).default([]), threads: z.record(z.string(), threadSchema) });
const diskSchema = z.object({ version: z.literal(1), roots: z.array(recordSchema) });
type Root = z.infer<typeof recordSchema>;

/** One process owns this ledger. Every reservation is synchronous and durable
 * before dispatch. Restart never replays effects or restores a fresh budget. */
export class BackgroundWork {
  private roots: Root[] = [];
  private file: string;
  private now: () => number;
  constructor(file: string, now = Date.now) {
    this.file = file; this.now = now;
    try { this.roots = diskSchema.parse(JSON.parse(readFileSync(file, "utf8"))).roots; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw Error("Background ledger needs recovery; unattended work is disabled"); }
    for (const root of this.roots) if (!root.terminal) {
      this.account(root);
      root.terminal = true; root.reason = "Interrupted by restart; reconcile effects before running again";
      root.activeSince = null;
    }
    this.save();
  }
  private save() { mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 }); writeFileAtomic(this.file, JSON.stringify({ version: 1, roots: this.roots }), { mode: 0o600 }); }
  private account(root: Root) { if (root.activeSince !== null) { root.activeMs += Math.max(0, this.now() - root.activeSince); root.activeSince = this.now(); } }
  private root(thread: string) { return this.roots.findLast(r => Object.hasOwn(r.threads, thread)); }
  rootId(thread: string) { return this.root(thread)?.id; }
  live(id: string) { return this.roots.some(r => r.id === id && !r.terminal); }
  activeRoot() { return this.roots.find(r => !r.terminal && r.activeSince !== null)?.id; }
  open(id: string, routineId: string, thread: string, botId: string) {
    if (this.roots.some(r => r.id === id)) throw Error("This background run already has a durable receipt; it cannot be replayed");
    if (this.activeRoot()) throw Error("Another background workflow owns the active slot");
    this.roots.push({ id, routineId, startedAt: this.now(), activeMs: 0, activeSince: this.now(), requests: 0, terminal: false, pendingEffects: [], actors: [botId], threads: { [thread]: { botId, state: "running", requests: [] } } });
    this.save();
  }
  inherit(parent: string, thread: string, botId: string) {
    const root = this.root(parent); if (!root) return;
    this.assert(parent);
    const previous = this.root(thread);
    if (previous && previous.id !== root.id && !previous.terminal) throw Error("This thread belongs to another background workflow");
    if (previous && previous.id !== root.id) delete previous.threads[thread];
    root.threads[thread] ??= { botId, state: "running", requests: [] }; if (!root.actors.includes(botId)) root.actors.push(botId); this.save();
  }
  detach(thread: string) { const root = this.root(thread); if (root && !root.terminal) throw Error("Stop this background workflow before starting independent work in its thread"); if (root) { delete root.threads[thread]; this.save(); } }
  actor(thread: string, botId: string) { const root = this.root(thread); if (root && !root.actors.includes(botId)) { root.actors.push(botId); this.save(); } }
  actors(id: string) { const root = this.roots.find(r => r.id === id); return [...new Set([...(root?.actors ?? []), ...Object.values(root?.threads ?? {}).map(t => t.botId)])]; }
  assert(thread: string) {
    const root = this.root(thread); if (!root) throw Error("Missing background workflow provenance");
    this.account(root);
    if (root.terminal) throw Error(root.reason || "Background workflow has ended");
    if (root.activeMs >= CUSTOMER_BACKGROUND_LIMITS.activeMs) throw Error("Background active-work budget exhausted");
    const active = this.activeRoot(); if (active && active !== root.id) throw Error("Another background workflow owns the active slot; retry this checkpoint after it finishes");
    return root;
  }
  resume(thread: string) { const root = this.assert(thread); root.threads[thread]!.state = "running"; root.activeSince ??= this.now(); this.save(); }
  reserve(thread: string) {
    this.resume(thread); const root = this.assert(thread);
    if (root.requests >= CUSTOMER_BACKGROUND_LIMITS.requests) throw Error("Background provider-request budget exhausted");
    root.requests++; this.save();
    return { workflowId: root.id, requests: root.requests, remainingRequests: CUSTOMER_BACKGROUND_LIMITS.requests - root.requests, remainingActiveMs: CUSTOMER_BACKGROUND_LIMITS.activeMs - root.activeMs };
  }
  handle(thread: string): SendTurnInput["backgroundWork"] {
    if (!this.root(thread)) return undefined;
    this.resume(thread);
    const workflowId = this.root(thread)!.id;
    const bound = () => { if (this.root(thread)?.id !== workflowId) throw Error("Background workflow binding changed; the old turn cannot resume"); return this.assert(thread); };
    return { workflowId, assertActive: () => { bound(); }, resume: () => { bound(); this.resume(thread); }, reserveRequest: () => { bound(); return this.reserve(thread); }, beforeEffect: identity => { const root = bound(); const key = `${thread}:${identity}`; if (!root.pendingEffects.includes(key)) root.pendingEffects.push(key); this.save(); } };
  }
  event(event: RuntimeEvent) {
    if (!event.threadId) return;
    const root = this.root(event.threadId); if (!root || root.terminal) return;
    this.account(root);
    const thread = root.threads[event.threadId]!;
    if (event.type === "item.started" && event.itemType === "tool") {
      const id = `${event.threadId}:${event.itemId}`; if (!root.pendingEffects.includes(id)) root.pendingEffects.push(id); this.save(); return;
    }
    if (event.type === "item.completed" && event.itemType === "tool") {
      if (event.ok === true) root.pendingEffects = root.pendingEffects.filter(id => id !== `${event.threadId}:${event.itemId}`); this.save(); return;
    }
    if (event.type === "request.opened" && typeof event.requestId === "string") { if (!thread.requests.includes(event.requestId)) thread.requests.push(event.requestId); thread.state = "waiting"; }
    else if (event.type === "request.resolved" && typeof event.requestId === "string") { thread.requests = thread.requests.filter(id => id !== event.requestId); thread.state = thread.requests.length ? "waiting" : "running"; }
    else if (event.type === "turn.started") thread.state = "running";
    else if (event.type === "turn.completed") thread.state = "idle";
    else return;
    const unsettled = Object.values(root.threads).filter(t => t.state !== "idle");
    // Delegation waits remain active work. Only actual authoritative requests
    // may release the slot, and only when no descendant is still running.
    const waiting = unsettled.length > 0 && unsettled.every(t => t.state === "waiting" && t.requests.length > 0);
    const other = this.activeRoot();
    root.activeSince = waiting || (root.activeSince === null && other && other !== root.id) ? null : root.activeSince ?? this.now(); this.save();
  }
  finish(id: string, reason: string) { const root = this.roots.find(r => r.id === id); if (!root || root.terminal) return; this.account(root); root.terminal = true; root.activeSince = null; root.reason = reason; if (reason === "completed") root.pendingEffects = []; this.save(); }
  expired() { return this.roots.filter(r => { this.account(r); return !r.terminal && r.activeMs >= CUSTOMER_BACKGROUND_LIMITS.activeMs; }).map(r => r.id); }
  snapshot() { return structuredClone(this.roots); }
  members(id: string) { return Object.entries(this.roots.find(r => r.id === id)?.threads ?? {}).map(([threadId, t]) => ({ threadId, botId: t.botId })); }
}
