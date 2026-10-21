import { afterEach, describe, expect, it, vi } from "vitest";
import { HermesHttpClient, hermesHttpConfig, parseSse } from "./hermes-http-client.ts";
import { HermesAgentDriver } from "./hermes-http.ts";
import type { ProviderInstance, RuntimeEvent } from "../contracts.ts";

const encoder = new TextEncoder();
const stream = (chunks: string[]) => new ReadableStream<Uint8Array>({ start(c) { for (const chunk of chunks) c.enqueue(encoder.encode(chunk)); c.close(); } });
const sse = (events: unknown[]) => new Response(stream(events.map(e => `data: ${JSON.stringify(e)}\n\n`)), { headers: { "content-type": "text/event-stream" } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const config = () => hermesHttpConfig({ HERMES_API_KEY: "test-only-secret" });
const instances: ProviderInstance[] = [];
afterEach(async () => { for (const i of instances.splice(0)) await i.dispose(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function instance() {
  const i = await HermesAgentDriver.create({ instanceId: "test", enabled: true, displayName: "Hermes", config: HermesAgentDriver.defaultConfig(), environment: { HERMES_API_KEY: "test-only-secret", HERMES_TRANSPORT: "http" } });
  instances.push(i); return i;
}
async function turn(i: ProviderInstance, threadId = "t", extra = {}) {
  const events: RuntimeEvent[] = [];
  let resolve!: () => void;
  const done = new Promise<void>(r => { resolve = r; });
  const off = i.adapter.onEvent(e => { if (e.threadId !== threadId) return; events.push(e); if (e.type === "turn.completed") resolve(); });
  await i.adapter.sendTurn({ threadId, text: "hello", ...extra });
  return { events, done: done.finally(off) };
}

describe("Hermes SSE", () => {
  it.each([1, 2, 3, 7, 1000])("handles arbitrary %i-byte chunks, UTF8, comments, multiline and DONE", async size => {
    const text = ': heartbeat\r\nevent: message.delta\r\nid: 1\r\ndata: {"delta":\r\ndata: "hello 🌍"}\r\n\r\ndata: [DONE]\n\ndata: ignored\n\n';
    const bytes = encoder.encode(text);
    const body = new ReadableStream<Uint8Array>({ start(c) { for (let n = 0; n < bytes.length; n += size) c.enqueue(bytes.slice(n, n + size)); c.close(); } });
    const results = [];
    for await (const event of parseSse(body)) results.push(event);
    expect(results).toEqual([{ event: "message.delta", id: "1", data: '{"delta":\n"hello 🌍"}' }]);
  });
  it("handles CR-only boundaries, multiple events and ignores incomplete EOF", async () => {
    const result = [];
    for await (const event of parseSse(stream(['data: one\r\rdata: two\r\rdata: incomplete']))) result.push(event.data);
    expect(result).toEqual(["one", "two"]);
  });
  it("cancels the reader on early consumer exit", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(encoder.encode('data: x\n\n')); }, cancel });
    for await (const _event of parseSse(body)) break;
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe("Hermes HTTP client", () => {
  it("validates configuration and normalizes base URLs", () => {
    expect(() => hermesHttpConfig({})).toThrow("HERMES_API_KEY");
    expect(() => hermesHttpConfig({ HERMES_API_KEY: 'x', HERMES_API_BASE_URL: 'file:///tmp' })).toThrow();
    expect(() => hermesHttpConfig({ HERMES_API_KEY: 'x', HERMES_API_TIMEOUT_MS: 'NaN' })).toThrow();
    expect(hermesHttpConfig({ HERMES_API_KEY: 'x', HERMES_API_BASE_URL: 'http://localhost:8642///' }).baseUrl).toBe('http://localhost:8642');
  });
  it.each([401, 403, 500])("sanitizes non-2xx status %i", async status => {
    const client = new HermesHttpClient(config(), vi.fn(async () => json({ error: { message: 'test-only-secret private prompt' } }, status)));
    await expect(client.json('/health')).rejects.toMatchObject({ status, category: status < 500 ? 'unauthorized' : 'upstream_error' });
    await expect(client.json('/health')).rejects.not.toThrow('test-only-secret');
  });
  it("sends bearer auth only to the configured backend", async () => {
    const fetcher = vi.fn(async () => json({ ok: true }));
    await new HermesHttpClient(config(), fetcher).json('/v1/runs', { input: 'hi' });
    expect(fetcher.mock.calls[0]).toMatchObject(['http://127.0.0.1:8642/v1/runs', { redirect: 'error', headers: { Authorization: 'Bearer test-only-secret' } }]);
  });
  it("handles timeout and abort", async () => {
    const fetcher: typeof fetch = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true })));
    const client = new HermesHttpClient({ ...config(), timeoutMs: 10 }, fetcher);
    await expect(client.json('/health')).rejects.toMatchObject({ category: 'timeout' });
    const abort = new AbortController(); const pending = client.json('/health', undefined, abort.signal); abort.abort();
    await expect(pending).rejects.toMatchObject({ category: 'cancelled' });
  });
  it("reports malformed event JSON", async () => {
    const client = new HermesHttpClient(config(), vi.fn(async () => new Response(stream(['data: broken\n\n']), { headers: { 'content-type': 'text/event-stream' } })));
    await expect((async () => { for await (const _e of client.events('r', new AbortController().signal)) { /* consume */ } })()).rejects.toMatchObject({ category: 'malformed_event' });
  });
});

describe("Hermes runtime mapping", () => {
  it("forwards a delta while the upstream response is still open", async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>;
    vi.stubGlobal('fetch', vi.fn(async url => String(url).endsWith('/v1/runs') ? json({ run_id: 'r' })
      : new Response(new ReadableStream<Uint8Array>({ start(c) { source = c; c.enqueue(encoder.encode('data: {"event":"message.delta","delta":"now"}\n\n')); } }), { headers: { 'content-type': 'text/event-stream' } })));
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const i = await instance(); const run = await turn(i);
    await vi.waitFor(() => expect(run.events.some(e => e.type === 'content.delta')).toBe(true));
    expect(run.events.some(e => e.type === 'turn.completed')).toBe(false);
    source.enqueue(encoder.encode('data: {"event":"run.completed","output":"now"}\n\n')); source.close();
    await run.done;
    expect(run.events.filter(e => e.type === 'content.delta')).toHaveLength(1);
  });
  it.each(['data: broken\n\n', 'data: [DONE]\n\n', 'data: {"event":"message.delta","run_id":"foreign","delta":"leak"}\n\n'])("fails closed and stops on invalid run stream %s", async payload => {
    const stop = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async url => {
      if (String(url).endsWith('/v1/runs')) return json({ run_id: 'r' });
      if (String(url).endsWith('/stop')) { stop(); return json({}); }
      return new Response(stream([payload]), { headers: { 'content-type': 'text/event-stream' } });
    }));
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const i = await instance(); const run = await turn(i); await run.done;
    expect(stop).toHaveBeenCalledOnce();
    expect(run.events.some(e => e.type === 'runtime.error')).toBe(true);
    expect(run.events.filter(e => e.type === 'turn.completed')).toHaveLength(1);
    expect(run.events.some(e => e.type === 'content.delta')).toBe(false);
  });
  it("stops an admitted run when Stop was pressed before admission returned", async () => {
    let admit!: (value: Response) => void;
    const stop = vi.fn();
    vi.stubGlobal('fetch', vi.fn(url => {
      if (String(url).endsWith('/v1/runs')) return new Promise<Response>(resolve => { admit = resolve; });
      stop(); return Promise.resolve(json({}));
    }));
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const i = await instance(); const run = await turn(i);
    const stopped = i.adapter.interruptTurn('t');
    admit(json({ run_id: 'r' })); await stopped; await run.done;
    expect(stop).toHaveBeenCalledOnce();
    expect(run.events.some(e => e.type === 'turn.completed' && e.stopReason === 'interrupted')).toBe(true);
  });
  it("resets the scoped conversation and never resumes a foreign bot", async () => {
    const sessions: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      if (String(url).endsWith('/v1/runs')) { sessions.push(JSON.parse(init.body).session_id); return json({ run_id: 'r' }); }
      return sse([{ event: 'run.completed', output: 'ok' }]);
    }));
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const i = await instance(); const a = await turn(i, 't', { botId: 'a' }); await a.done;
    const session = a.events.find(e => e.type === 'session.started');
    const reset = await turn(i, 't', { botId: 'a', sessionReset: true }); await reset.done;
    expect(sessions[0]).not.toBe(sessions[1]);
    const foreign = await turn(i, 't', { botId: 'b', resumeCursor: session?.type === 'session.started' ? session.sessionId : null }); await foreign.done;
    expect(sessions[2]).not.toBe(sessions[0]);
  });
  it("streams immediately, completes once, reuses and scopes conversations", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      if (String(url).endsWith('/v1/runs')) { bodies.push(JSON.parse(init.body)); return json({ run_id: `r${bodies.length}` }); }
      return sse([{ event: 'message.delta', delta: 'Hel' }, { event: 'message.delta', delta: 'lo' }, { event: 'run.completed', output: 'Hello' }, { event: 'run.completed', output: 'Hello' }]);
    }));
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const i = await instance();
    const first = await turn(i, 't', { model: 'hermes-default' }); await first.done;
    expect(bodies[0].model).toBe(i.models.default);
    expect(first.events.filter(e => e.type === 'content.delta').map(e => e.delta)).toEqual(['Hel', 'lo']);
    expect(first.events.filter(e => e.type === 'item.completed' && e.itemType === 'assistant_text')).toHaveLength(1);
    expect(first.events.filter(e => e.type === 'turn.completed')).toHaveLength(1);
    const started = first.events.find(e => e.type === 'session.started')!;
    const second = await turn(i); await second.done;
    const other = await turn(i, 'other', { resumeCursor: started.type === 'session.started' ? started.sessionId : null }); await other.done;
    expect(bodies[0].session_id).toBe(bodies[1].session_id);
    expect(bodies[2].session_id).not.toBe(bodies[0].session_id);
    expect(bodies[1].input).toBe('hello');
    const restored = await instance();
    const resumed = await turn(restored, 't', { resumeCursor: started.type === 'session.started' ? started.sessionId : null }); await resumed.done;
    expect(bodies[3].session_id).toBe(bodies[0].session_id);
  });
  it("maps tools, reasoning, approvals and steering, and stops on disconnect", async () => {
    const controls: { url: string; body: Record<string, unknown> }[] = [];
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      const path = String(url);
      if (path.endsWith('/v1/runs')) return json({ run_id: 'r' });
      if (path.endsWith('/events')) return new Response(new ReadableStream<Uint8Array>({ start(c) {
        streamController = c;
        for (const event of [{ event: 'tool.started', tool: 'read' }, { event: 'tool.completed', tool: 'read', error: false }, { event: 'reasoning.available', text: 'Thinking' }, { event: 'approval.request', request_id: 'q', command: '<write_file> (plugin approval rule)', choices: ['once', 'deny'] }]) c.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      } }), { headers: { 'content-type': 'text/event-stream' } });
      controls.push({ url: path, body: JSON.parse(init.body) });
      return json({ accepted: true });
    }));
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const i = await instance(); const run = await turn(i);
    await vi.waitFor(() => expect(run.events.some(e => e.type === 'request.opened')).toBe(true));
    expect(run.events.find(e => e.type === 'request.opened')).toMatchObject({ tool: 'write_file', summary: 'Hermes requests permission to use write_file', choices: ['once', 'deny'] });
    expect(await i.adapter.respondToRequest('t', 'q', { behavior: 'allow' })).toBe('allowed-once');
    expect(await i.adapter.steer!('t', 'continue')).toBe('steered');
    streamController.error(new Error('disconnect'));
    await run.done;
    expect(controls.map(c => c.url.split('/').pop())).toEqual(['approval', 'steer', 'stop']);
    expect(controls[0].body).toEqual({ request_id: 'q', choice: 'once' });
    const tools = run.events.filter(e => e.type.startsWith('item.') && 'itemType' in e && e.itemType === 'tool');
    expect(tools[0].itemId).toBe(tools[1].itemId);
    expect(run.events.some(e => e.type === 'runtime.error')).toBe(true);
  });
  it("does not expose arbitrary approval commands as tool names or summaries", async () => {
    vi.stubGlobal('fetch', vi.fn(async url => String(url).endsWith('/v1/runs') ? json({ run_id: 'r' })
      : sse([{ event: 'approval.request', request_id: 'q', command: '<write_file> (plugin approval rule) extra private data', choices: ['once', 'deny'] }, { event: 'run.completed', output: 'ok' }])));
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const i = await instance(); const run = await turn(i); await run.done;
    expect(run.events.find(e => e.type === 'request.opened')).toMatchObject({ tool: 'Hermes', summary: 'Hermes requests permission for an action' });
    expect(JSON.stringify(run.events)).not.toContain('extra private data');
  });
  it("rejects concurrent turns on one thread, isolates other threads, and stops on dispose", async () => {
    let id = 0;
    const stops: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      const path = String(url);
      if (path.endsWith('/v1/runs')) return json({ run_id: String(++id) });
      if (path.endsWith('/stop')) { stops.push(path); return json({ status: 'stopping' }); }
      return new Response(new ReadableStream<Uint8Array>({ start(c) { init.signal.addEventListener('abort', () => c.error(init.signal.reason)); } }), { headers: { 'content-type': 'text/event-stream' } });
    }));
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const i = await instance(); const a = await turn(i); const b = await turn(i, 'b');
    await expect(i.adapter.sendTurn({ threadId: 't', text: 'overlap' })).rejects.toThrow('active generation');
    await vi.waitFor(() => expect(id).toBe(2));
    await i.adapter.interruptTurn('t'); await a.done;
    expect(b.events.some(e => e.type === 'turn.completed')).toBe(false);
    await i.dispose(); await b.done;
    expect(stops.length).toBeGreaterThanOrEqual(2);
    expect(a.events.filter(e => e.type === 'turn.completed')).toHaveLength(1);
  });
  it("refuses unenforceable restrictions and images before contacting Hermes", async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const i = await instance();
    await expect(i.adapter.sendTurn({ threadId: 't', text: 'hi', toolScope: { allow: [] } })).rejects.toThrow('restrictions');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
