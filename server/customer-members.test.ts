import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { CustomerMembers } from "./customer-members.ts";
// @ts-expect-error The lifecycle process is a separate native ESM service.
import { localMemberProvisioner } from "../integrations/platform/lifecycle/provisioning.mjs";

const dirs: string[] = [];
const timers: ReturnType<typeof setInterval>[] = [];
afterEach(() => { timers.splice(0).forEach(clearInterval); dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })); });
const member = () => ({ workspace: randomUUID(), account: randomUUID(), person: "synthetic-person", membershipEpoch: randomUUID(), role: "USER" as const });
function fixture(uncertain = false) {
  const root = mkdtempSync(join(tmpdir(), "chief-members-test-")); dirs.push(root); const bridge = join(root, "bridge"); mkdirSync(bridge);
  let now = Date.now(); const bots: Array<{ id: string; soul: string; name: string; cwd: string }> = []; const key = "a".repeat(64);
  const options = { directory: join(root, "private"), bridge, key, work: join(root, "work"), template: { name: "Operator", soul: "Synthetic portable role", modelSelection: { instanceId: "hermes", model: "fixture" } }, now: () => now, bots: () => bots, create: (p: { name: string; soul: string; cwd: string }) => { const bot = { ...p, id: randomUUID() }; bots.push(bot); if (uncertain) { uncertain = false; throw Error("Synthetic acknowledgement lost after profile commit"); } return bot; } };
  let manager = new CustomerMembers(options); timers.push(setInterval(() => manager.sweep(), 10));
  const client = localMemberProvisioner({ directory: bridge, key, now: () => now, timeoutMs: 300 });
  return { root, bridge, bots, client, manager: () => manager, advance: (ms: number) => { now += ms; }, restart: () => { manager = new CustomerMembers(options); } };
}

it("provisions verified members through the signed broker with isolated folders and narrow grants", async () => {
  const f = fixture(), one = member(), two = { ...member(), workspace: one.workspace };
  const grants = await Promise.all([f.client.ensure(one), f.client.ensure(two)]);
  expect(f.bots).toHaveLength(2); expect(grants[0].bots).not.toEqual(grants[1].bots);
  expect(f.bots[0]!.cwd).not.toBe(f.bots[1]!.cwd); expect(grants[0].scopes).toEqual(["workspace:read", "tracker:read", "tracker:write"]);
  // This is an entitlement ceiling. The pairing's requested scope and both
  // confirmations still determine whether an actual connection can write.
  expect(grants[0].bots).toHaveLength(1); expect(grants[0].scopes).not.toContain("admin");
});

it("reconciles a profile committed before its creation acknowledgement was lost", async () => {
  const f = fixture(true), identity = member(); const first = await f.client.ensure(identity);
  f.restart(); const repeated = await f.client.ensure(identity);
  expect(repeated.bots).toEqual(first.bots); expect(f.bots).toHaveLength(1);
});

it("reconciles retries and restart without resetting customer edits or recreating deleted profiles", async () => {
  const f = fixture(), identity = member(); const first = await f.client.ensure(identity);
  f.bots[0]!.soul += "\nCustomer edits"; f.restart(); const repeated = await f.client.ensure(identity);
  expect(repeated.bots).toEqual(first.bots); expect(f.bots).toHaveLength(1); expect(f.bots[0]!.soul).toContain("Customer edits");
  f.bots.splice(0); await expect(f.client.ensure(identity)).rejects.toThrow(/unavailable/); expect(f.bots).toHaveLength(0);
});

it("fails closed after authority loss and ignores revocation from an older membership epoch", async () => {
  const f = fixture(), identity = member(); const first = await f.client.ensure(identity), bot = first.bots[0];
  expect(f.manager().allowed(bot)).toBe(true); f.advance(61_000); expect(f.manager().allowed(bot)).toBe(false);
  const replacement = { ...identity, membershipEpoch: randomUUID() }; await f.client.ensure(replacement);
  await f.client.revoke(identity); expect(f.manager().allowed(bot)).toBe(true);
  await f.client.revoke(replacement); expect(f.manager().allowed(bot)).toBe(false);
});

it("rejects forged broker requests and stale receipts without creating an agent", async () => {
  const f = fixture(), identity = member(), id = createHash("sha256").update(identity.workspace + ":" + identity.account).digest("hex");
  writeFileSync(join(f.bridge, id + ".request.json"), JSON.stringify({ version: 1, operation: "ensure", member: identity, nonce: randomUUID(), issuedAt: Date.now(), expiresAt: Date.now() + 10000, signature: "f".repeat(64) }));
  f.manager().sweep(); expect(f.bots).toHaveLength(0);
  await f.client.ensure(identity); const file = join(f.bridge, id + ".response.json"), previous = readFileSync(file, "utf8");
  expect(previous).not.toContain("Synthetic portable role");
  f.advance(61_000); f.manager().sweep(); expect(f.manager().allowed(f.bots[0]!.id)).toBe(false);
});
