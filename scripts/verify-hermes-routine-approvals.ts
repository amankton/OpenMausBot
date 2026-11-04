// Scripted Hermes transport, real isolated Chief server and built-in MCP proxy.
import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchVerificationServer } from "./control-omb.ts";
import { removeTempDir } from "../server/testing/cleanup.ts";

const directory = mkdtempSync(join(tmpdir(), "chief-routine-acceptance-"));
const reviewerHome = process.argv[2];
const runs = new Map<string, { text: string; stream?: ServerResponse }>();
const checks: string[] = [];
let sequence = 0;
const send = (res: ServerResponse, event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);
const upstream = createServer(async (req, res) => {
  const json = (value: unknown) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
  try {
    if (req.url === "/health") return json({ ok: true });
    if (req.url === "/v1/capabilities") return json({ features: { run_submission: true, run_events_sse: true, run_stop: true } });
    if (req.url === "/v1/toolsets") return json({ data: [{ enabled: true, tools: ["chief_tools"] }] });
    let text = ""; for await (const chunk of req) text += chunk;
    const body = text ? JSON.parse(text) : {};
    if (req.url === "/v1/runs") {
      const id = `run_fixture${++sequence}`; runs.set(id, { text: body.input }); return json({ run_id: id });
    }
    const match = /^\/v1\/runs\/(run_fixture\d+)\/(events|approval|stop)$/.exec(req.url ?? "");
    assert(match); const run = runs.get(match[1])!;
    if (match[2] === "stop") { run.stream?.end(); return json({ stopped: true }); }
    if (match[2] === "approval") {
      assert.equal(body.choice, "deny"); checks.push("human denial retained");
      send(run.stream!, { event: "run.completed", output: "checkpoint denied" }); run.stream!.end(); return json({ ok: true });
    }
    res.writeHead(200, { "content-type": "text/event-stream" }); run.stream = res;
    const manifest = JSON.parse(readFileSync(join(directory, match[1] + ".json"), "utf8"));
    const broker = async (value: unknown) => {
      const response = await fetch(manifest.url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${manifest.token}` }, body: JSON.stringify(value) });
      assert(response.ok); return await response.json() as any;
    };
    const read = await broker({ action: "authorize", name: "skill_view", arguments: {} });
    const automatic = run.text.includes("AUTO_ROUTINES");
    assert.equal(read.approval, !automatic);
    assert.equal((await broker({ action: "authorize", name: "terminal", arguments: { command: "git push" } })).approval, true);
    assert.equal((await broker({ action: "authorize", name: "send_message", arguments: {} })).approval, true);
    if (automatic) {
      if (reviewerHome) {
        const command = await broker({ action: "authorize", name: "terminal", arguments: { command: 'python3 -c "print(2+2)" && pwd', workdir: directory } });
        assert.equal(command.approval, false, "real command reviewer approves the complete routine command");
        checks.push("real native auxiliary approves a compound command through the live Chief broker");
      }
      const list = await broker({ action: "list" });
      const name = list.tools.find((tool: any) => tool.name === "agents_list_bots")?.name;
      assert(name, "real scoped agents MCP mounted");
      const result = await broker({ action: "call", call_id: "list-bots", name, arguments: {} });
      assert.equal(result.ok, true); checks.push("Auto native read and real built-in MCP read run without cards");
    } else checks.push("Ask or disabled policy retains native read approval");
    send(res, { event: "approval.request", request_id: "checkpoint", command: "<terminal> (plugin approval rule)", choices: ["once", "deny"] });
  } catch (error) {
    console.error(error); res.destroy(error as Error);
  }
});
await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
const fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, undefined, [], undefined, undefined,
  { baseUrl: `http://127.0.0.1:${(upstream.address() as { port: number }).port}`, apiKey: "fixture-only", model: "fixture-hermes", toolsDirectory: directory, home: reviewerHome });
console.log(JSON.stringify({ stage: "isolated-fixture", url: fixture.info.url, logPath: fixture.info.logPath }));
const api = async (method: string, path: string, body?: unknown) => {
  const response = await fetch(fixture.info.url + path, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  const value = await response.json() as any; assert(response.ok, `${path}: ${JSON.stringify(value)}`); return value;
};
try {
  for (const [mode, enabled] of [["auto", true], ["ask", true], ["auto", false]] as const) {
    await api("PATCH", "/api/instances/hermes", { routineApprovals: enabled, commandReview: !!reviewerHome && enabled });
    const { bot } = await api("POST", "/api/bots", { name: `Fixture ${mode} ${enabled}`, modelSelection: { instanceId: "hermes", model: "fixture-hermes" } });
    await api("PATCH", `/api/bots/${bot.id}`, { approvalMode: mode, cwd: directory });
    await api("POST", `/api/bots/${bot.id}/messages`, { text: mode === "auto" && enabled ? "AUTO_ROUTINES" : "ASK_ROUTINES" });
    const deadline = Date.now() + 25000;
    let current: any;
    do {
      current = (await api("GET", "/api/bots?messages=1")).bots.find((row: any) => row.id === bot.id);
      if (current.messages?.some((row: any) => row.card?.requestId === "checkpoint")) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    const card = current.messages?.find((row: any) => row.card?.requestId === "checkpoint")?.card;
    assert(card, "consequential command still opens a real human card");
    assert.equal(current.messages.filter((row: any) => row.card?.requestType === "permission").length, 1);
    await api("POST", `/api/threads/${current.threadId}/respond`, { requestId: card.requestId, behavior: "deny" });
    while ((await api("GET", "/api/bots")).bots.find((row: any) => row.id === bot.id)?.busy) {
      assert(Date.now() < deadline, "fixture did not settle"); await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  const evidence = { checkedAt: new Date().toISOString(), passed: true, checks, realChiefServer: true, realBuiltInMcp: true, scriptedProvider: true, logPath: fixture.info.logPath };
  writeFileSync(`docs/verification/evidence/${reviewerHome ? "hermes-command-review-server" : "hermes-routine-approvals"}.json`, JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence));
} finally {
  await fixture.close(); upstream.closeAllConnections(); await new Promise<void>(resolve => upstream.close(() => resolve())); await removeTempDir(directory);
}
