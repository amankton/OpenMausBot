import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { CONNECTOR_TRUST_CATALOG_FINGERPRINT, type ConnectorTrustAccountFact } from "../shared/connector-trust.ts";
import { ConnectorTrustStore } from "./connector-trust.ts";
import { prepareTrustDispatch, type PreparedTrustTransport, type TrustDispatchDependencies } from "./connector-trust-dispatch.ts";

const fixtures: Array<{ store: ConnectorTrustStore; dir: string }> = [];
afterEach(() => { for (const { store, dir } of fixtures.splice(0)) { store.close(); rmSync(dir, { recursive: true, force: true }); } });
const frame = (write = false) => ({ jsonrpc: "2.0", id: "request", method: "tools/call", params: { name: write ? "GMAIL_CREATE_EMAIL_DRAFT" : "GMAIL_FETCH_EMAILS", arguments: { connected_account_id: "test-account", body: "Synthetic content" } } });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
function fixture(active = true) {
  const dir = mkdtempSync(join(tmpdir(), "chief-dispatch-independent-")), store = new ConnectorTrustStore(dir);
  fixtures.push({ store, dir });
  const facts = (): ConnectorTrustAccountFact[] => [{ accountId: "test-account", identity: "mailbox@example.test", status: "active", verifiedAt: Date.now() }];
  const review = () => store.review("reviewer", { catalogFingerprint: CONNECTOR_TRUST_CATALOG_FINGERPRINT, expectedRevision: store.get("reviewer")?.revision ?? 0, reviewed: true, grants: [{ accountId: "test-account", identity: "mailbox@example.test", operations: ["search-mail", "create-draft"] }] }, facts(), "owner", () => true);
  if (active) review();
  let live = true, allowed = true, sent = 0;
  const deps: TrustDispatchDependencies = {
    store, facts: vi.fn(async () => facts()), toolAllowed: () => allowed,
    transport: vi.fn(async (): Promise<PreparedTrustTransport> => ({ execute: async beforeEach => { const gate = await beforeEach(); gate(); sent++; return { status: 200, bytes: Buffer.from("synthetic success"), contentType: "application/json" }; } })),
  };
  const assertLive = () => { if (!live) throw new Error("turn stopped"); };
  return { store, deps, facts, review, assertLive, stop: () => { live = false; }, deny: () => { allowed = false; }, sent: () => sent };
}

it("keeps unconfigured legacy calls outside bounded facts/transport and rejects opt-in while waiting", async () => {
  const f = fixture(false), prepared = await prepareTrustDispatch("reviewer", "task", frame(), f.deps, f.assertLive);
  expect(prepared.verdict.bounded).toBe(false); expect(f.deps.facts).not.toHaveBeenCalled(); expect(f.deps.transport).not.toHaveBeenCalled();
  f.review(); expect(prepared.checkCurrent).toThrow(/changed/); await expect(prepared.dispatch()).rejects.toThrow(/no bounded/);
});
it("refuses a durable revocation before any identity or transport preparation", async () => {
  const f = fixture(); f.store.revoke("reviewer", 1, "owner");
  await expect(prepareTrustDispatch("reviewer", "task", frame(), f.deps, f.assertLive)).rejects.toThrow(/revoked/);
  expect(f.deps.facts).not.toHaveBeenCalled(); expect(f.deps.transport).not.toHaveBeenCalled();
});
it("does not run final dispatch closures during preparation", async () => {
  const f = fixture(), gate = vi.fn(); let prepared: Awaited<ReturnType<typeof prepareTrustDispatch>>;
  prepared = await prepareTrustDispatch("reviewer", "task", frame(), f.deps, f.assertLive, () => { expect(prepared.verdict.bounded).toBe(true); gate(); });
  expect(gate).not.toHaveBeenCalled(); await prepared.dispatch(); expect(gate).toHaveBeenCalledTimes(1); expect(f.sent()).toBe(1);
});
it("revocation during identity preparation prevents transport creation", async () => {
  const f = fixture(), waiting = deferred(); f.deps.facts = async () => { await waiting.promise; return f.facts(); };
  const preparation = prepareTrustDispatch("reviewer", "task", frame(), f.deps, f.assertLive);
  f.store.revoke("reviewer", 1, "owner"); waiting.resolve();
  await expect(preparation).rejects.toThrow(/changed/); expect(f.deps.transport).not.toHaveBeenCalled();
});
it("stopping during transport preparation prevents delivery", async () => {
  const f = fixture(), waiting = deferred(); const transport = f.deps.transport; f.deps.transport = async (...args) => { await waiting.promise; return transport(...args); };
  const preparation = prepareTrustDispatch("reviewer", "task", frame(), f.deps, f.assertLive);
  await Promise.resolve(); f.stop(); waiting.resolve(); await expect(preparation).rejects.toThrow(/stopped/); expect(f.sent()).toBe(0);
});
it.each(["revoke", "stop", "tool"])("rechecks %s in the synchronous gate after the final asynchronous wait", async change => {
  const f = fixture(); let gate!: () => void;
  f.deps.transport = async () => ({ execute: async beforeEach => { gate = await beforeEach(); if (change === "revoke") f.store.revoke("reviewer", 1, "owner"); else if (change === "stop") f.stop(); else f.deny(); gate(); throw new Error("unreachable dispatch"); } });
  const prepared = await prepareTrustDispatch("reviewer", "task", frame(), f.deps, f.assertLive);
  await expect(prepared.dispatch()).rejects.toThrow(/changed|stopped|tool/); expect(f.sent()).toBe(0);
});
it("binds the approval and transport to an immutable copy of the exact frame", async () => {
  const f = fixture(), input = frame(true), prepared = await prepareTrustDispatch("reviewer", "task", input, f.deps, f.assertLive);
  input.params.arguments.body = "Changed after card";
  expect((prepared.payload as typeof input).params.arguments.body).toBe("Synthetic content");
  expect(Object.isFrozen((prepared.payload as typeof input).params.arguments)).toBe(true);
  await prepared.approve(); await prepared.dispatch(); expect(f.store.actions("reviewer")[0]?.state).toBe("succeeded");
});
it("refuses writes without fresh approval and blocks an already successful dispatch retry", async () => {
  const f = fixture(), prepared = await prepareTrustDispatch("reviewer", "task", frame(true), f.deps, f.assertLive);
  await expect(prepared.dispatch()).rejects.toThrow(/approval/); expect(f.sent()).toBe(0);
  await prepared.approve(); await prepared.dispatch(); await expect(prepared.dispatch()).rejects.toThrow(/used|pending|confirmed completed/); expect(f.sent()).toBe(1);
});
it("rechecks revocation after the owner approves but while fresh facts are pending", async () => {
  const f = fixture(), prepared = await prepareTrustDispatch("reviewer", "task", frame(true), f.deps, f.assertLive), waiting = deferred();
  f.deps.facts = async () => { await waiting.promise; return f.facts(); };
  const approval = prepared.approve(); f.store.revoke("reviewer", 1, "owner"); waiting.resolve();
  await expect(approval).rejects.toThrow(/changed/); expect(f.store.actions("reviewer")).toHaveLength(0);
});
it("records partial batch delivery as unknown and denies further children after revocation", async () => {
  const f = fixture(); let delivered = 0;
  f.deps.transport = async () => ({ execute: async beforeEach => { (await beforeEach())(); delivered++; f.store.revoke("reviewer", 1, "owner"); (await beforeEach())(); delivered++; throw new Error("unreachable"); } });
  const prepared = await prepareTrustDispatch("reviewer", "task", frame(true), f.deps, f.assertLive);
  await prepared.approve(); await expect(prepared.dispatch()).rejects.toThrow(/changed/);
  expect(delivered).toBe(1); expect(f.store.actions("reviewer")[0]?.state).toBe("outcome-unknown");
});
it("journals a provider failure conservatively after the final dispatch gate", async () => {
  const f = fixture(); f.deps.transport = async () => ({ execute: async beforeEach => { (await beforeEach())(); throw new Error("synthetic transport lost its response"); } });
  const prepared = await prepareTrustDispatch("reviewer", "task", frame(true), f.deps, f.assertLive);
  await prepared.approve(); await expect(prepared.dispatch()).rejects.toThrow(/lost/); expect(f.store.actions("reviewer")[0]?.state).toBe("outcome-unknown");
});
