import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createHermesToolBridge, type HermesToolBridge } from "./hermes-tool-bridge.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import type { SendTurnInput } from "../contracts.ts";

const roots: string[] = [], bridges: HermesToolBridge[] = [];
const json = async (response: Promise<Response>) => await (await response).json() as any;
afterEach(async () => { for (const b of bridges.splice(0)) await b.close(); for (const p of roots.splice(0)) await removeTempDir(p); });
async function fixture(approvalMode: "ask" | "auto" | "full" = "full", backgroundWork?: SendTurnInput["backgroundWork"]) {
  const root = mkdtempSync(join(tmpdir(), "chief-http-tools-")); roots.push(root);
  const script = join(root, "mcp.mjs"), receipt = join(root, "calls.json");
  writeFileSync(script, `import{createInterface}from'node:readline';import{writeFileSync}from'node:fs';let n=0;const reply=(id,result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\\n');for await(const line of createInterface({input:process.stdin})){const m=JSON.parse(line);if(m.method==='initialize')reply(m.id,{protocolVersion:'2024-11-05',capabilities:{tools:{}}});if(m.method==='tools/list')reply(m.id,{tools:[{name:'click',description:'Fixture click',inputSchema:{type:'object',properties:{x:{type:'integer'}},required:['x'],additionalProperties:false}}]});if(m.method==='tools/call'){writeFileSync(process.env.RECEIPT,JSON.stringify({count:++n,args:m.params.arguments,hermesKey:process.env.HERMES_API_KEY||null}));reply(m.id,{content:[{type:'text',text:'clicked'}]});}}`);
  const events: any[] = [];
  const abort = new AbortController();
  const bridge = await createHermesToolBridge({ threadId: 'thread', text: 'hello', approvalMode, backgroundWork,
    toolScope: { allow: ['mcp:computer:click'] },
    integrations: { localComputer: { command: process.execPath, args: [script], env: { RECEIPT: receipt } } } }, abort.signal, root, e => events.push(e));
  bridges.push(bridge); await bridge.bind(`run_${roots.length}`);
  const manifest = JSON.parse(readFileSync(join(root, `run_${roots.length}.json`), 'utf8'));
  const call = (body: unknown, token = manifest.token) => fetch(manifest.url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { bridge, abort, events, call, root, receipt, manifest };
}

it("reserves provider attempts only through an authenticated active run and refuses exhausted budgets", async () => {
  let used = 0;
  const f = await fixture('full', { workflowId: 'root', assertActive() {}, resume() {}, reserveRequest() { if (used === 20) throw Error('budget exhausted'); used++; return { remainingActiveMs: 600000, remainingRequests: 20 - used }; } });
  expect(f.manifest.budgeted).toBe(true);
  expect((await f.call({ action: 'budget' }, 'wrong')).status).toBe(401); expect(used).toBe(0);
  for (let n = 0; n < 20; n++) expect((await json(f.call({ action: 'budget' }))).remainingRequests).toBe(19 - n);
  expect((await f.call({ action: 'budget' })).status).toBe(400); expect(used).toBe(20);
});

it("keeps a permission pending when its root cannot reacquire the active slot", async () => {
  let occupied = true, resumed = 0;
  const f = await fixture('ask', { workflowId: 'root', assertActive() {}, resume() { if (occupied) throw Error('active slot occupied'); resumed++; }, reserveRequest() { return { remainingActiveMs: 600000, remainingRequests: 20 }; } });
  const response = f.call({ action: 'call', call_id: 'budget-card', name: 'computer_click', arguments: { x: 1 } });
  while (!f.events.some(e => e.type === 'request.opened')) await new Promise(done => setTimeout(done, 10));
  const ask = f.events.find(e => e.type === 'request.opened');
  expect(f.bridge.answer('stale', 'allow')).toBe('unavailable');
  expect(() => f.bridge.answer(ask.requestId, 'allow')).toThrow(/active slot/); expect(existsSync(f.receipt)).toBe(false);
  occupied = false; expect(f.bridge.answer(ask.requestId, 'allow')).toBe('allowed-once'); expect((await json(response)).ok).toBe(true); expect(resumed).toBe(1);
});

it("executes only scoped catalog tools, validates arguments and deduplicates a repeated call", async () => {
  const f = await fixture();
  expect((await json(f.call({ action: 'list' }))).tools[0].name).toBe('computer_click');
  expect((await json(f.call({ action: 'describe', name: 'computer_click' }))).tool.function.parameters.required).toEqual(['x']);
  expect((await f.call({ action: 'list' }, 'x')).status).toBe(401);
  expect((await f.call({ action: 'call', call_id: 'bad', name: 'computer_click', arguments: { x: 'wrong' } })).status).toBe(400);
  const call = { action: 'call', call_id: 'a', name: 'computer_click', arguments: { x: 5 } };
  expect((await json(f.call(call))).ok).toBe(true);
  expect((await json(f.call(call))).ok).toBe(true);
  expect((await f.call({ ...call, arguments: { x: 99 } })).status).toBe(400);
  expect(JSON.parse(readFileSync(f.receipt, 'utf8')).count).toBe(1);
  expect((await json(f.call({ action: 'authorize', name: 'terminal' }))).allowed).toBe(false);
  expect(f.events.filter(e => e.type === 'item.started')).toHaveLength(1);
});

it.each(["ask", "auto"] as const)("keeps %s permission cards and denies execution when permission is rejected", async mode => {
  const f = await fixture(mode);
  const response = f.call({ action: 'call', call_id: 'b', name: 'computer_click', arguments: { x: 1 } });
  const end = Date.now() + 3000;
  while (!f.events.some(e => e.type === 'request.opened') && Date.now() < end) await new Promise(r => setTimeout(r, 10));
  const ask = f.events.find(e => e.type === 'request.opened'); expect(ask).toBeDefined();
  expect(f.bridge.answer(ask.requestId, 'deny')).toBe('rejected');
  expect((await json(response)).ok).toBe(false);
  expect(existsSync(f.receipt)).toBe(false);
});

it("revokes pending permissions and removes the per-run capability on cancellation", async () => {
  const f = await fixture('ask');
  const response = f.call({ action: 'call', call_id: 'c', name: 'computer_click', arguments: { x: 2 } }).catch(() => null);
  await new Promise(r => setTimeout(r, 30)); f.abort.abort(); await f.bridge.close(); await response;
  expect(existsSync(join(f.root, `run_${roots.length}.json`))).toBe(false);
  expect(existsSync(f.receipt)).toBe(false);
});
