import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { BackgroundWork } from "./background-work.ts";
import { RoutineManager } from "./routines.ts";
import type { RuntimeEvent } from "./contracts.ts";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const fixture = () => { const dir = mkdtempSync(join(tmpdir(), "chief-budget-test-")); dirs.push(dir); return dir; };
const event = (threadId: string, type: string, extra = {}) => ({ threadId, type, ...extra }) as RuntimeEvent;

it("shares twenty durable physical request reservations across descendants", () => {
  const file = join(fixture(), "ledger.json"), ledger = new BackgroundWork(file);
  ledger.open("root", "routine", "coordinator", "bacca"); ledger.inherit("coordinator", "worker", "solo"); ledger.inherit("worker", "reviewer", "specialist");
  for (let n = 0; n < 20; n++) ledger.reserve(n % 2 ? "reviewer" : "worker");
  expect(() => ledger.reserve("coordinator")).toThrow(/request.*budget exhausted/);
  expect(JSON.parse(readFileSync(file, "utf8")).roots[0].requests).toBe(20);
  expect(ledger.snapshot()).toHaveLength(1);
  expect(ledger.actors("root")).toEqual(["bacca", "solo", "specialist"]);
});

it("pauses only at authoritative human requests and keeps the root budget after resuming", () => {
  let now = 1000; const ledger = new BackgroundWork(join(fixture(), "ledger.json"), () => now);
  ledger.open("one", "routine", "root", "one"); ledger.reserve("root"); now += 60_000;
  ledger.event(event("root", "request.opened", { requestId: "card" }));
  expect(ledger.activeRoot()).toBeUndefined(); now += 60 * 60_000;
  ledger.open("two", "other", "other", "two");
  expect(() => ledger.resume("root")).toThrow(/active slot/);
  ledger.finish("two", "done"); ledger.resume("root");
  expect(ledger.reserve("root").remainingRequests).toBe(18);
  expect(ledger.snapshot()[0]!.activeMs).toBe(60_000);
  now += 9 * 60_000; expect(ledger.expired()).toEqual(["one"]);
});

it("does not pause a root whose descendant is still executing", () => {
  let now = 1000; const ledger = new BackgroundWork(join(fixture(), "ledger.json"), () => now);
  ledger.open("one", "routine", "root", "one"); ledger.inherit("root", "child", "two");
  ledger.event(event("root", "request.opened", { requestId: "card" }));
  expect(ledger.activeRoot()).toBe("one"); now += 600_000; expect(ledger.expired()).toEqual(["one"]);
});

it("never moves an old turn's capability or requests into a later workflow reusing its thread", () => {
  const ledger = new BackgroundWork(join(fixture(), "ledger.json"));
  ledger.open("old", "routine", "worker", "one"); const old = ledger.handle("worker")!; ledger.finish("old", "completed");
  ledger.open("new", "routine", "parent", "two"); ledger.inherit("parent", "worker", "one");
  expect(() => old.reserveRequest()).toThrow(/binding changed/); expect(ledger.snapshot()[1]!.requests).toBe(0);
});

it("recovers interrupted work conservatively and refuses replay and corrupt ledgers", () => {
  let now = 1000; const file = join(fixture(), "ledger.json"), ledger = new BackgroundWork(file, () => now);
  ledger.open("one", "routine", "thread", "one"); ledger.reserve("thread"); now += 120_000;
  const restart = new BackgroundWork(file, () => now);
  expect(restart.snapshot()[0]).toMatchObject({ activeMs: 120_000, requests: 1, terminal: true });
  expect(() => restart.resume("thread")).toThrow(/restart/);
  expect(() => restart.open("one", "routine", "new", "one")).toThrow(/replayed/);
  writeFileSync(file, "broken"); expect(() => new BackgroundWork(file)).toThrow(/recovery/); expect(readFileSync(file, "utf8")).toBe("broken");
});

it("persists potential effects before dispatch and retains them for interrupted-work review", () => {
  const file = join(fixture(), "ledger.json"), ledger = new BackgroundWork(file);
  ledger.open("one", "routine", "thread", "operator"); ledger.handle("thread")!.beforeEffect!("native-write-fingerprint");
  expect(JSON.parse(readFileSync(file, "utf8")).roots[0].pendingEffects).toEqual(["thread:native-write-fingerprint"]);
  const restart = new BackgroundWork(file); expect(restart.snapshot()[0]!.pendingEffects).toHaveLength(1);
});

function scheduler() {
  const dir = fixture(); let now = new Date("2026-11-04T12:00:00Z").getTime(), count = 0;
  const ledger = new BackgroundWork(join(dir, "background.json"), () => now), notices: string[] = [];
  const make = () => new RoutineManager({ file: join(dir, "routines.json"), customerPolicy: true, now: () => now, botState: () => "ready",
    createTask: () => ({ threadId: `thread-${++count}` }), startTurn: async () => {}, canStartBackground: () => !ledger.activeRoot(),
    beforeStartBackground: run => ledger.open(run.id, run.routineId, run.threadId!, run.botId),
    onRunChanged: run => { if (["completed", "failed", "cancelled", "missed"].includes(run.status)) ledger.finish(run.id, run.status); }, onRunFailed: run => notices.push(run.error || "") });
  return { make, ledger, notices, advance: (ms: number) => { now += ms; }, now: () => now };
}
const input = (at: number) => ({ name: "Synthetic", prompt: "Draft synthetic result", botId: "bot", schedule: { type: "interval" as const, everyMinutes: 15, anchorAt: at }, enabled: true });

it("rejects fast schedules, uncounted targets and the twenty-first enabled routine", () => {
  const f = scheduler(), manager = f.make();
  expect(() => manager.create({ ...input(f.now()), schedule: { type: "interval", everyMinutes: 5, anchorAt: f.now() } })).toThrow(/15 minutes/);
  expect(() => manager.create({ ...input(f.now()), runOn: "cloud" })).toThrow(/local Hermes/);
  for (let n = 0; n < 20; n++) manager.create(input(f.now()));
  expect(() => manager.create(input(f.now()))).toThrow(/20 enabled/);
});

it("admits one root, skips stale firings and records its actual sweep", async () => {
  const f = scheduler(), manager = f.make(); manager.create(input(f.now())); manager.create(input(f.now()));
  f.advance(15 * 60_000); await manager.tick();
  expect(f.ledger.snapshot().filter(r => !r.terminal)).toHaveLength(1);
  expect(manager.backgroundHealth().lastSweepAt).toBe(f.now());
  expect(manager.backgroundHealth().lastSuccessfulSweepAt).toBe(f.now());
  await manager.cancelRun(f.ledger.activeRoot()!);
  await new Promise(resolve => setImmediate(resolve));
  f.advance(2 * 60 * 60_000); await manager.tick();
  expect(manager.listRuns().some(r => r.status === "missed")).toBe(true);
});

it("notifies once, disables after three failures across restarts, and resets on explicit re-enable", async () => {
  const f = scheduler(); let manager = f.make(); const definition = manager.create(input(f.now()));
  for (let n = 0; n < 3; n++) {
    f.advance(15 * 60_000); await manager.tick();
    const run = manager.listRuns().find(r => r.status === "running")!; expect(run).toBeDefined();
    manager.failThread(run.threadId!, "Synthetic provider outage");
    manager = f.make();
  }
  expect(manager.listRoutines()[0]!.enabled).toBe(false); expect(f.notices).toHaveLength(2);
  expect(f.notices[1]).toContain("disabled after three failures");
  manager.update(definition.id, { enabled: true }); expect(manager.listRoutines()[0]!.customerFailureCount).toBe(0);
});

it("disables an interrupted routine instead of replaying potentially unknown effects after restart", async () => {
  const f = scheduler(); let manager = f.make(); manager.create(input(f.now()));
  f.advance(15 * 60_000); await manager.tick(); expect(manager.listRuns().some(r => r.status === "running")).toBe(true);
  manager = f.make(); expect(manager.listRoutines()[0]!.enabled).toBe(false);
  expect(manager.listRuns().some(r => r.error?.includes("effects are reviewed"))).toBe(true);
});
