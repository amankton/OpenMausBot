// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoreProvider, useStore, type AppState, type BotAnnouncement } from "./store";

class FixtureEventSource {
  static sources: FixtureEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string; lastEventId: string }) => void) | null = null;
  constructor() { FixtureEventSource.sources.push(this); }
  close() {}
  send(frame: object) { this.onmessage?.({ data: JSON.stringify(frame), lastEventId: `run:${++cursor}` }); }
}
const bot = { id: "bot", threadId: "thread", name: "Fixture", messages: [], tasks: [], modelSelection: { instanceId: "fake", model: "m" } } as unknown as BotAnnouncement;
const defaults: Record<string, unknown> = {
  "/api/bots?messages=200": { bots: [bot], groups: [] },
  "/api/instances": { instances: [] }, "/api/config": { language: "en" },
  "/api/routines": { routines: [], runs: [] }, "/api/webhooks": { webhooks: [], attempts: [] },
};
let root: Root | undefined;
let host: HTMLDivElement;
let state: AppState;
let cursor = 0;
let renders = 0;
const held = new Map<string, Array<{ signal?: AbortSignal | null; resolve: (response: Response) => void }>>();
const json = (body: unknown) => new Response(JSON.stringify(body));
function Probe() { state = useStore().state; renders++; return null; }
const settle = async () => { await act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); }); };
const send = async (frame: object) => { await act(async () => FixtureEventSource.sources[0]!.send(frame)); await settle(); };
const release = async (path: string, index: number, body: unknown) => {
  held.get(path)![index]!.resolve(json(body)); await settle();
};
beforeEach(() => {
  cursor = 0; renders = 0; held.clear(); FixtureEventSource.sources = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("EventSource", FixtureEventSource);
  vi.stubGlobal("fetch", (path: string, init?: RequestInit) => {
    const queue = held.get(path);
    if (queue) return new Promise<Response>((resolve) => queue.push({ signal: init?.signal, resolve }));
    return Promise.resolve(json(defaults[path] ?? {}));
  });
  host = document.createElement("div"); document.body.append(host);
  localStorage.clear();
});
afterEach(async () => {
  await act(async () => root?.unmount()); root = undefined;
  host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function mount() {
  root = createRoot(host);
  await act(async () => root!.render(createElement(StoreProvider, null, createElement(Probe))));
  await send({ kind: "hello", resumed: false, cursor: "run:0" });
}

describe("independent startup snapshots", () => {
  it("delivers chat with a pending peripheral and rejects its stale response after a live update", async () => {
    held.set("/api/config", []);
    await mount();
    expect(state.bots).toHaveLength(1);
    await send({ kind: "message", threadId: "thread", message: { id: "m", at: 1, role: "user", kind: "text", text: "ready" } });
    expect(state.bots[0]!.messages.at(-1)?.text).toBe("ready");
    await send({ kind: "config", language: "fr" });
    await release("/api/config", 0, { language: "stale" });
    expect(state.config?.language).toBe("fr");
  });

  it("aborts old snapshot lanes on replacement and ignores late chat/peripheral results", async () => {
    held.set("/api/bots?messages=200", []); held.set("/api/config", []);
    await mount();
    await send({ kind: "hello", resumed: false, cursor: "run:20" });
    expect(held.get("/api/config")![0]!.signal?.aborted).toBe(true);
    expect(held.get("/api/bots?messages=200")![0]!.signal?.aborted).toBe(true);
    await release("/api/bots?messages=200", 1, { bots: [{ ...bot, name: "New" }], groups: [] });
    await release("/api/config", 1, { language: "new" });
    await release("/api/bots?messages=200", 0, { bots: [{ ...bot, name: "Old" }], groups: [] });
    await release("/api/config", 0, { language: "old" });
    expect(state.bots[0]!.name).toBe("New");
    expect(state.config?.language).toBe("new");
    await send({ kind: "message", threadId: "thread", message: { id: "m", at: 1, role: "user", kind: "text", text: "live" } });
    expect(state.bots[0]!.messages.at(-1)?.text).toBe("live");
  });

  it("bounds startup requests and cancels pending work on disposal", async () => {
    const deadline = vi.spyOn(AbortSignal, "timeout");
    held.set("/api/config", []);
    await mount();
    expect(deadline).toHaveBeenCalledWith(12_000);
    const before = renders;
    await act(async () => root!.unmount()); root = undefined;
    expect(held.get("/api/config")![0]!.signal?.aborted).toBe(true);
    await release("/api/config", 0, { language: "after-disposal" });
    expect(renders).toBe(before);
  });
});
