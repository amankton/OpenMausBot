import { expect, it, vi } from "vitest";
import type { ProviderInstance, ProviderSnapshot } from "../contracts.ts";
import { makeFakeDriver } from "../testing/fake-driver.ts";
import { ProviderRegistry } from "./registry.ts";

function gate() {
  let resolve!: (value: ProviderSnapshot) => void;
  const promise = new Promise<ProviderSnapshot>(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture() {
  let now = 0;
  const fake = makeFakeDriver();
  const registry = new ProviderRegistry([fake.driver], { now: () => now, npmAvailable: () => false });
  await registry.load({ a: { driver: "fake" } });
  return { registry, fake, instance: registry.get("a")!, at: (time: number) => { now = time; } };
}

it("coalesces concurrent initial probes without returning an incomplete discovery", async () => {
  const f = await fixture();
  const pending = gate();
  f.instance.snapshot = vi.fn(() => pending.promise);
  const first = f.registry.describe();
  const second = f.registry.describe();
  let settled = false;
  void first.then(() => { settled = true; });
  await Promise.resolve();
  expect(f.instance.snapshot).toHaveBeenCalledTimes(1);
  expect(settled).toBe(false);
  pending.resolve({ state: "available", version: "first" });
  expect((await first)[0].snapshot).toMatchObject({ version: "first" });
  expect((await second)[0].snapshot).toMatchObject({ version: "first" });
  await f.registry.describe();
  expect(f.instance.snapshot).toHaveBeenCalledTimes(1);
});

it("returns bounded stale data while a single refresh runs, then waits after the limit", async () => {
  const f = await fixture();
  const pending = gate();
  f.instance.snapshot = vi.fn().mockResolvedValueOnce({ state: "available", version: "old" }).mockImplementation(() => pending.promise);
  await f.registry.describe();
  f.at(30_000);
  expect((await f.registry.describe())[0].snapshot).toMatchObject({ version: "old" });
  expect((await f.registry.describe())[0].snapshot).toMatchObject({ version: "old" });
  expect(f.instance.snapshot).toHaveBeenCalledTimes(2);
  f.at(120_000);
  let settled = false;
  const beyondLimit = f.registry.describe().then(rows => { settled = true; return rows; });
  await Promise.resolve();
  expect(settled).toBe(false);
  pending.resolve({ state: "available", version: "new" });
  expect((await beyondLimit)[0].snapshot).toMatchObject({ version: "new" });
  expect(f.instance.snapshot).toHaveBeenCalledTimes(2);
});

it("replaces stale availability after failed refresh and retries failures promptly", async () => {
  const f = await fixture();
  f.instance.snapshot = vi.fn().mockResolvedValueOnce({ state: "available", version: "old" })
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ state: "available", version: "recovered" });
  await f.registry.describe();
  f.at(30_000);
  await f.registry.describe();
  // Drain the background probe's rejection and normalized-result continuation.
  await Promise.resolve(); await Promise.resolve();
  expect((await f.registry.describe())[0].snapshot).toMatchObject({ state: "unavailable", reason: "offline" });
  expect(f.instance.snapshot).toHaveBeenCalledTimes(2);
  f.at(35_000);
  expect((await f.registry.describe())[0].snapshot).toMatchObject({ state: "unavailable" });
  await Promise.resolve(); await Promise.resolve();
  expect((await f.registry.describe())[0].snapshot).toMatchObject({ version: "recovered" });
  expect(f.instance.snapshot).toHaveBeenCalledTimes(3);
});

it("refreshes unavailable probes after five seconds without blocking warm descriptions, but bounds stale failures", async () => {
  const f = await fixture();
  const pending = gate();
  f.instance.snapshot = vi.fn().mockResolvedValueOnce({ state: "unavailable", reason: "not installed" })
    .mockImplementation(() => pending.promise);
  await f.registry.describe();
  f.at(4_999);
  await f.registry.describe();
  expect(f.instance.snapshot).toHaveBeenCalledTimes(1);
  f.at(5_000);
  expect((await f.registry.describe())[0].snapshot).toMatchObject({ state: "unavailable" });
  f.at(30_000);
  expect((await f.registry.describe())[0].snapshot).toMatchObject({ state: "unavailable" });
  expect(f.instance.snapshot).toHaveBeenCalledTimes(2);
  f.at(120_000);
  let settled = false;
  const beyondLimit = f.registry.describe().then(rows => { settled = true; return rows; });
  await Promise.resolve();
  expect(settled).toBe(false);
  pending.resolve({ state: "available", version: "installed" });
  expect((await beyondLimit)[0].snapshot).toMatchObject({ state: "available", version: "installed" });
});

it("explicit install invalidates an unavailable snapshot immediately", async () => {
  const fake = makeFakeDriver();
  const create = fake.driver.create;
  let installed = false;
  fake.driver.create = async input => ({
    ...await create(input),
    snapshot: async () => installed ? { state: "available", version: "installed" } : { state: "unavailable", reason: "not installed" },
    installRuntime: async () => { installed = true; },
  });
  const registry = new ProviderRegistry([fake.driver], { npmAvailable: () => false });
  await registry.load({ a: { driver: "fake" } });
  expect((await registry.describe())[0].snapshot).toMatchObject({ state: "unavailable" });
  await registry.installRuntime("a");
  expect((await registry.describe())[0].snapshot).toMatchObject({ state: "available", version: "installed" });
});

it("invalidates direct authentication actions and ignores a pre-action probe's late result", async () => {
  const fake = makeFakeDriver();
  const create = fake.driver.create;
  const oldProbe = gate();
  let authenticated = true;
  let calls = 0;
  fake.driver.create = async input => ({
    ...await create(input),
    snapshot: async () => ++calls === 2 ? oldProbe.promise : { state: "available", authenticated },
    signOut: async () => { authenticated = false; },
  });
  let now = 0;
  const registry = new ProviderRegistry([fake.driver], { now: () => now, npmAvailable: () => false });
  await registry.load({ a: { driver: "fake" } });
  expect((await registry.describe())[0].snapshot).toMatchObject({ authenticated: true });
  now = 30_000;
  await registry.describe();
  await registry.get("a")!.signOut!();
  expect((await registry.describe())[0].snapshot).toMatchObject({ authenticated: false });
  oldProbe.resolve({ state: "available", authenticated: true });
  await Promise.resolve(); await Promise.resolve();
  expect((await registry.describe())[0].snapshot).toMatchObject({ authenticated: false });
  expect(calls).toBe(3);
});

it("refreshes after explicit catalog actions and does not reuse a disposed instance's cache", async () => {
  const f = await fixture();
  f.instance.snapshot = vi.fn().mockResolvedValue({ state: "available", version: "one" });
  await f.registry.describe();
  await f.registry.refreshModels("a");
  await f.registry.describe();
  expect(f.instance.snapshot).toHaveBeenCalledTimes(2);
  await f.registry.load({ a: { driver: "fake" } });
  expect((await f.registry.describe())[0].snapshot).toMatchObject({ version: "0.0.0-fake" });
  expect(f.fake.disposed).toContain("a");
});

it("preserves identity, private fields, mutable state and live getters on driver instances", async () => {
  const fake = makeFakeDriver();
  const create = fake.driver.create;
  let original: ProviderInstance;
  class Stateful {
    #authenticated = true;
    updates = 0;
    get models() { return { default: `model-${this.updates}`, options: [] }; }
    async snapshot(): Promise<ProviderSnapshot> {
      return { state: "available", authenticated: this.#authenticated, version: String(this.updates) };
    }
    async signOut() { this.#authenticated = false; this.updates++; }
  }
  fake.driver.create = async input => {
    const { snapshot: _snapshot, models: _models, ...members } = await create(input);
    original = Object.assign(new Stateful(), members);
    return original;
  };
  const registry = new ProviderRegistry([fake.driver], { npmAvailable: () => false });
  await registry.load({ a: { driver: "fake" } });
  expect(registry.get("a")).toBe(original!);
  expect((await registry.describe())[0].snapshot).toMatchObject({ authenticated: true, version: "0" });
  await registry.get("a")!.signOut!();
  expect(await original!.snapshot()).toMatchObject({ authenticated: false, version: "1" });
  const [row] = await registry.describe();
  expect(row.snapshot).toMatchObject({ authenticated: false, version: "1" });
  expect(row.models.default).toBe("model-1");
});
