import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { createHermesToolBridge, type HermesToolBridge } from "./hermes-tool-bridge.ts";
import { createCommandReviewer, type CommandReviewer } from "./hermes-command-review.ts";
import { removeTempDir } from "../testing/cleanup.ts";

const roots: string[] = [], bridges: HermesToolBridge[] = [];
afterEach(async () => { for (const b of bridges.splice(0)) await b.close(); for (const p of roots.splice(0)) await removeTempDir(p); });
async function fixture(mode: "auto" | "ask" = "auto", custom = false, injected?: CommandReviewer) {
  const root = mkdtempSync(join(tmpdir(), "chief-command-bridge-")); roots.push(root);
  const mcp = join(root, "mcp.mjs"), worker = join(root, "review.mjs"), receipt = join(root, "executed.json");
  writeFileSync(mcp, `import{createInterface}from'node:readline';import{writeFileSync}from'node:fs';const reply=(id,result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\\n');for await(const line of createInterface({input:process.stdin})){const p=JSON.parse(line);if(p.method==='initialize')reply(p.id,{protocolVersion:'2024-11-05',capabilities:{tools:{}}});if(p.method==='tools/list')reply(p.id,{tools:[{name:'vm_exec',inputSchema:{type:'object',properties:{command:{type:'string'}},required:['command'],additionalProperties:false}}]});if(p.method==='tools/call'){writeFileSync(process.env.RECEIPT,JSON.stringify(p.params.arguments));reply(p.id,{content:[{type:'text',text:'fixture executed'}]});}}`);
  writeFileSync(worker, `import{createInterface}from'node:readline';for await(const line of createInterface({input:process.stdin})){const p=JSON.parse(line);process.stdout.write(JSON.stringify({id:p.id,decision:'approve'})+'\\n');}`);
  const reviewer = injected ?? createCommandReviewer({ command: process.execPath, args: [worker], env: process.env });
  const events: any[] = [], abort = new AbortController();
  const descriptor = { command: process.execPath, args: [mcp], env: { RECEIPT: receipt } };
  const b = await createHermesToolBridge({ threadId: "thread", text: "work", approvalMode: mode, cwd: root,
    toolScope: { allow: ["native:terminal", "native:ask_user", "mcp:agents:vm_exec"] },
    integrations: custom ? { custom: { agents: descriptor } } : { agents: descriptor } }, abort.signal, root, e => events.push(e), true, reviewer);
  bridges.push(b); await b.bind(`run_${roots.length}`);
  const manifest = JSON.parse(readFileSync(join(root, `run_${roots.length}.json`), "utf8"));
  const call = async (body: unknown) => {
    const r = await fetch(manifest.url, { method: "POST", headers: { authorization: `Bearer ${manifest.token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() as any };
  };
  return { root, events, b, abort, call, receipt };
}

it("reviews exact native command and folder, holds important actions, and never reviews excluded tools", async () => {
  const f = await fixture();
  const native = (command: string, workdir: string | undefined = f.root) => f.call({ action: "authorize", name: "terminal", arguments: { command, workdir } });
  expect((await native('python -c "print(4)" && pwd')).body.approval).toBe(false);
  expect((await native("git push origin main")).body).toMatchObject({ approval: true, summary: expect.stringContaining("publish-or-deploy") });
  const sensitive = await native('python -c "password=\'short value\'; print(password)"');
  expect(sensitive.body.approval).toBe(true);
  expect(sensitive.body.summary).not.toContain("short value");
  expect((await native("python build.py", tmpdir())).body.approval).toBe(true);
  expect((await native("python build.py", "relative")).body).toMatchObject({ allowed: false, approval: false, message: expect.stringContaining("workdir") });
  expect((await f.call({ action: "authorize", name: "send_email", arguments: { command: "pwd" } })).body.allowed).toBe(false);
  expect((await f.call({ action: "authorize", name: "ask_user", arguments: {} })).body.approval).toBe(true);
});

it("executes reviewed VM commands once, while a destructive command still opens a human card and honors denial", async () => {
  const f = await fixture();
  const command = { action: "call", call_id: "safe", name: "agents_vm_exec", arguments: { command: 'python3 -c "print(4)"' } };
  expect((await f.call(command)).body.ok).toBe(true);
  expect((await f.call(command)).body.ok).toBe(true);
  const pending = f.call({ ...command, call_id: "danger", arguments: { command: "rm -rf /home/cua/workspace" } });
  await vi.waitFor(() => expect(f.events.some(e => e.type === "request.opened")).toBe(true));
  const ask = f.events.find(e => e.type === "request.opened");
  expect(ask.summary).toContain("destructive"); f.b.answer(ask.requestId, "deny");
  expect((await pending).body.ok).toBe(false);
  expect(JSON.parse(readFileSync(f.receipt, "utf8")).command).toBe(command.arguments.command);
});

it.each([["ask", false], ["auto", true]] as const)("retains permission for mode %s and custom-server impersonation %s", async (mode, custom) => {
  const f = await fixture(mode, custom);
  const pending = f.call({ action: "call", call_id: "a", name: "agents_vm_exec", arguments: { command: "pwd" } });
  await vi.waitFor(() => expect(f.events.some(e => e.type === "request.opened")).toBe(true));
  f.b.answer(f.events.find(e => e.type === "request.opened").requestId, "deny");
  expect((await pending).body.ok).toBe(false); expect(existsSync(f.receipt)).toBe(false);
});

it("Stop prevents execution even if a reviewer later approves", async () => {
  let finish!: (value: { decision: "approve"; reason: string }) => void;
  const review = vi.fn(() => new Promise<{ decision: "approve"; reason: string }>(resolve => { finish = resolve; }));
  const f = await fixture("auto", false, { review, close: async () => {} });
  const pending = f.call({ action: "call", call_id: "a", name: "agents_vm_exec", arguments: { command: "pwd" } }).catch(() => null);
  await vi.waitFor(() => expect(review).toHaveBeenCalledOnce());
  f.abort.abort(); await f.b.close(); finish({ decision: "approve", reason: "routine" }); await pending;
  expect(existsSync(f.receipt)).toBe(false);
});
