// Isolated real-server/private-desktop-grant acceptance. No live agent data,
// provider credentials, operating-system tools, or external requests are used.
const { app, utilityProcess } = require("electron");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { once } = require("node:events");
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve, dirname } = require("node:path");
const { randomUUID } = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");
const { createTrustedApprovalModeCoordinator } = require("../electron/approval-trusted-mode.cjs");

const root = resolve(__dirname, "..");
const home = mkdtempSync(join(tmpdir(), "chief-hermes-full-"));
app.setPath("userData", join(home, "electron"));
const coordinator = createTrustedApprovalModeCoordinator({ randomId: randomUUID });
let child, provider, logs = "", failures = false;
const runs = new Map();
const receipts = [];
const checks = [];
async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}
async function freePort() {
  const server = createServer();
  const port = await listen(server);
  await new Promise(done => server.close(done));
  return port;
}
async function until(check) {
  const deadline = Date.now() + 30000;
  do { const result = await check(); if (result) return result; await delay(40); } while (Date.now() < deadline);
  throw Error(`Fixture timed out: ${logs.slice(-1800)}`);
}
app.whenReady().then(async () => {
  provider = createServer(async (req, res) => {
    const json = (body, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    assert.equal(req.headers.authorization, "Bearer isolated-fixture-key");
    let body = ""; for await (const chunk of req) body += chunk;
    const data = body ? JSON.parse(body) : {};
    if (req.url === "/health") return json({ ok: true });
    if (req.url === "/v1/capabilities") return json({ features: { run_submission: true, run_events_sse: true, run_stop: true } });
    if (req.url === "/v1/runs") {
      const id = `run_${runs.size + 1}`;
      runs.set(id, { choices: data.input.includes("unsupported-choice") ? ["session", "deny"] : ["once", "deny"], model: data.model });
      return json({ run_id: id });
    }
    const match = /^\/v1\/runs\/(run_\d+)\/(events|approval|stop)$/.exec(req.url);
    if (!match) return json({}, 404);
    const run = runs.get(match[1]);
    if (match[2] === "events") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      run.stream = res;
      res.write(`data: ${JSON.stringify({ event: "approval.request", request_id: `approval-${match[1]}`, command: "<write_file> (plugin approval rule)", choices: run.choices })}\n\n`);
      return;
    }
    receipts.push({ run: match[1], action: match[2], choice: data.choice });
    if (match[2] === "approval") {
      assert.ok(run.choices.includes(data.choice));
      run.executed = data.choice === "once";
      run.stream?.end(`data: ${JSON.stringify({ event: "run.completed", output: run.executed ? "fake tool executed" : "fake tool denied" })}\n\n`);
    } else run.stream?.end('data: {"event":"run.cancelled"}\n\n');
    return json({ accepted: true });
  });
  const providerPort = await listen(provider), port = await freePort(), webhook = await freePort();
  mkdirSync(join(home, "hermes"));
  writeFileSync(join(home, "hermes/config.yaml"), "model:\n  provider: openrouter\n  default: fixture-model\n");
  writeFileSync(join(home, "config.json"), JSON.stringify({ instances: {
    "hermes-http": { driver: "hermesAgent", config: { transport: "http" }, environment: {
      HERMES_TRANSPORT: "http", HERMES_API_BASE_URL: `http://127.0.0.1:${providerPort}`, HERMES_API_KEY: "isolated-fixture-key", HERMES_API_MODEL: "preserved-fixture-model",
    } },
    "hermes-acp": { driver: "hermesAgent", config: { transport: "acp", cli: join(root, "server/testing/fake-acp-cli.ts") }, environment: {
      HERMES_TRANSPORT: "acp", HERMES_HOME: join(home, "hermes"), OPENMAUSBOT_PROBE_LOCAL_INJECT: "0", FAKE_ACP_MODE: "permission", FAKE_ACP_AUTH_METHOD: "oauth-personal",
    } },
  } }));
  const serverEntry = process.argv.find(arg => arg.startsWith("--server="))?.slice(9) || join(root, "server/index.ts");
  child = utilityProcess.fork(serverEntry, [], { cwd: root, execArgv: ["--experimental-strip-types"], env: {
    HOME: home, USERPROFILE: home, OMB_DATA_DIR: home, OMB_PORT: String(port), OMB_WEBHOOK_PORT: String(webhook),
    PATH: process.env.CHIEF_FIXTURE_NODE ? dirname(process.env.CHIEF_FIXTURE_NODE) : "",
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
  }, stdio: "pipe" });
  child.stdout.on("data", data => { logs += data; }); child.stderr.on("data", data => { logs += data; });
  child.on("message", message => coordinator.receive(child, message));
  child.on("exit", () => coordinator.rejectProcess(child));
  const api = async (path, method = "GET", body) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  await until(() => api("/api/health").catch(() => null));
  const create = async (name, instanceId = "hermes-http") => {
    const result = await api("/api/bots", "POST", { name, modelSelection: { instanceId, model: instanceId === "hermes-http" ? "preserved-fixture-model" : "hermes-default" } });
    assert.equal(result.status, 201, JSON.stringify(result)); return result.body.bot;
  };
  const get = async id => (await api("/api/bots")).body.bots.find(bot => bot.id === id);
  const pending = bot => bot.messages.find(message => message.card?.requestId && !message.card.answered && !message.card.dismissed)?.card;
  const whole = await create("Hermes all threads");
  const unrelated = await create("Unrelated Ask agent");
  const unrelatedBefore = await get(unrelated.id);
  const archived = (await api(`/api/bots/${whole.id}/tasks`, "POST", { title: "Archived Hermes conversation" })).body.task;
  assert.equal((await api(`/api/bots/${whole.id}/tasks/${archived.threadId}`, "PATCH", { archivedAt: Date.now() })).status, 200);
  assert.equal((await api(`/api/bots/${whole.id}`, "PATCH", { approvalMode: "full", acknowledgeFullAccess: true })).status, 403);
  const grant = await coordinator.request(child, whole.id, "full", { allThreads: true });
  assert.equal(grant.approvalMode, "full"); assert.ok(grant.tasks.every(task => task.approvalMode === "full"));
  const future = (await api(`/api/bots/${whole.id}/tasks`, "POST", { title: "Future Hermes conversation" })).body.task;
  assert.equal(future.approvalMode, "full");
  assert.equal((await api(`/api/bots/${whole.id}/messages`, "POST", { text: "Exercise fake native tool", threadId: future.threadId })).status, 202);
  await until(async () => !(await get(whole.id)).busy);
  assert.ok(receipts.some(row => row.action === "approval" && row.choice === "once"));
  assert.ok([...runs.values()].some(run => run.executed && run.model === "preserved-fixture-model"));
  assert.equal(pending(await get(whole.id)), undefined);
  const saved = JSON.parse(readFileSync(join(home, "bots.json"), "utf8")).find(bot => bot.id === whole.id);
  assert.equal(saved.approvalGrant, undefined); assert.ok(saved.tasks.every(task => task.approvalMode === "full"));
  assert.deepEqual((await get(unrelated.id)).modelSelection, unrelatedBefore.modelSelection);
  assert.equal((await get(unrelated.id)).approvalMode, unrelatedBefore.approvalMode);
  checks.push("HTTP Full automatically selects once; all existing, archived and future threads; no pending grant; model preserved; unrelated agent unchanged; public HTTP elevation refused");
  for (const mode of ["ask", "auto"]) {
    const bot = await create(`HTTP ${mode}`);
    await coordinator.request(child, bot.id, mode, { threadId: bot.threadId, threadOnly: true });
    const before = receipts.length;
    assert.equal((await api(`/api/bots/${bot.id}/messages`, "POST", { text: "Exercise fake native tool" })).status, 202);
    const card = await until(async () => pending(await get(bot.id)));
    assert.equal(receipts.length, before);
    assert.equal((await api(`/api/bots/${bot.id}/respond`, "POST", { requestId: card.requestId, behavior: "deny" })).status, 200);
    await until(async () => !(await get(bot.id)).busy);
    assert.ok(receipts.slice(before).some(row => row.choice === "deny"));
    checks.push(`HTTP ${mode} waits and denial does not execute fake tool`);
  }
  const held = await create("HTTP Full unsupported choice");
  await coordinator.request(child, held.id, "full", { allThreads: true });
  const beforeStop = receipts.length;
  const beforeRuns = runs.size;
  await api(`/api/bots/${held.id}/messages`, "POST", { text: "unsupported-choice" });
  await until(() => runs.size === beforeRuns + 1 && [...runs.values()].at(-1).stream);
  await delay(200);
  assert.equal(receipts.length, beforeStop);
  assert.equal((await api(`/api/bots/${held.id}/interrupt`, "POST", {})).status, 200);
  await until(async () => !(await get(held.id)).busy);
  assert.ok(receipts.slice(beforeStop).some(row => row.action === "stop"));
  checks.push("Unsupported Full choice is never guessed; cancellation stops the exact run");
  for (const mode of ["full", "ask", "auto"]) {
    const bot = await create(`ACP ${mode}`, "hermes-acp");
    await coordinator.request(child, bot.id, mode, mode === "full" ? { allThreads: true } : { threadId: bot.threadId, threadOnly: true });
    await api(`/api/bots/${bot.id}/messages`, "POST", { text: "Exercise fake ACP tool" });
    if (mode !== "full") {
      const card = await until(async () => {
        const current = await get(bot.id);
        if (!current.busy && !pending(current)) throw Error(`ACP fixture failed: ${JSON.stringify(current.messages)}`);
        return pending(current);
      });
      assert.equal((await api(`/api/bots/${bot.id}/respond`, "POST", { requestId: card.requestId, behavior: "deny" })).status, 200);
    }
    await until(async () => !(await get(bot.id)).busy);
    assert.ok(!(await get(bot.id)).messages.some(message => message.tool?.name?.startsWith("error:")), `ACP ${mode} must actually execute the fake provider`);
    assert.equal(pending(await get(bot.id)), undefined);
    checks.push(`ACP ${mode}: ${mode === "full" ? "automatic residual approval" : "human denial retained"}`);
  }
  console.log(JSON.stringify({ passed: true, isolated: true, privateDesktopGrant: true, checks }, null, 2));
}).catch(error => { failures = true; console.error(error.stack); }).finally(async () => {
  if (child) { const stopped = once(child, "exit"); child.kill(); await stopped; }
  for (const run of runs.values()) run.stream?.destroy();
  if (provider) { provider.closeAllConnections(); await new Promise(done => provider.close(done)); }
  try { rmSync(home, { recursive: true, force: true }); }
  catch { console.log(JSON.stringify({ cleanupAfterExit: home })); }
  app.exit(failures ? 1 : 0);
});
