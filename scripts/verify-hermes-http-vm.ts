// Real HTTP/SSE -> standalone Hermes plugin -> app MCP -> disposable VM.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { parseEnv } from "node:util";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { launchVerificationServer, runControlOmb } from "./control-omb.ts";
import { chiefPodmanEnvironment } from "./chief-podman-env.ts";
import { parseSse } from "../server/drivers/hermes-http-client.ts";

const home = process.argv[2]; assert(home, "Pass the installed Hermes home");
const env = parseEnv(readFileSync(join(home, ".env"), "utf8"));
const machine = chiefPodmanEnvironment();
const fixture = await launchVerificationServer(process.env, undefined, {
  binDir: machine.OMB_EXTRA_PATH.split(delimiter)[0], host: machine.CONTAINER_HOST,
  sshKey: machine.CONTAINER_SSHKEY, staticDir: join(process.cwd(), "dist"),
}, undefined, undefined, undefined, [], undefined, undefined, {
  baseUrl: "http://127.0.0.1:8642", apiKey: env.API_SERVER_KEY, model: env.API_SERVER_MODEL_NAME,
  toolsDirectory: join(home, "chief-http-bridge"),
});
const api = async (method: string, path: string, body?: unknown) => {
  const response = await fetch(fixture.info.url + path, { method, headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(120000) });
  const result = await response.json(); assert(response.ok, `${path}: ${JSON.stringify(result)}`); return result;
};
let botId: string | undefined;
const events: any[] = [];
const controller = new AbortController();
const response = await fetch(fixture.info.url + "/api/events", { signal: controller.signal });
const consume = (async () => { try { for await (const frame of parseSse(response.body!)) {
  const msg = JSON.parse(frame.data); if (msg.kind === "runtime") {
    events.push(msg.event);
    if (msg.event.type === "request.opened" && msg.event.requestType === "permission") {
      // This synthetic chat owns a disposable VM; exercise the normal card
      // answer endpoint instead of bypassing desktop Full Access confirmation.
      await api("POST", `/api/threads/${msg.event.threadId}/respond`, { requestId: msg.event.requestId, behavior: "allow" });
    }
  }
} } catch (error) { if (!controller.signal.aborted) throw error; } })();
try {
  console.log(JSON.stringify({ stage: "fixture", url: fixture.info.url, logPath: fixture.info.logPath }));
  await api("PUT", "/api/config", { localVm: { mode: "per-bot", maxInstances: 2 } });
  const created = await api("POST", "/api/bots", { name: "Hermes VM Acceptance" });
  botId = created.bot.id;
  await api("PATCH", `/api/bots/${botId}`, { computer: "vm" });
  await api("POST", `/api/bots/${botId}/local-computer/run`, {});
  const vm = await api("GET", `/api/bots/${botId}/local-computer`);
  const container = vm.container_name;
  assert(typeof container === "string" && /^openmausbot-computer-[a-f0-9]+$/.test(container));
  const marker = "HTTP_VM_" + randomBytes(5).toString("hex").toUpperCase();
  const podman = join(machine.OMB_EXTRA_PATH.split(delimiter)[0], "podman.exe");
  execFileSync(podman, ["exec", "-u", "cua", "-e", "DISPLAY=:1", container, "sh", "-lc",
    `if command -v xfce4-terminal >/dev/null; then nohup xfce4-terminal --disable-server --title='${marker}' --command="sh -c 'printf ${marker}; sleep 120'" >/tmp/chief-http-probe.log 2>&1 </dev/null & elif command -v xterm >/dev/null; then nohup xterm -title '${marker}' -e sh -c 'printf ${marker}; sleep 120' >/tmp/chief-http-probe.log 2>&1 </dev/null & else echo 'No fixture marker terminal installed' >&2; exit 1; fi`],
    { env: { ...process.env, ...machine }, timeout: 10000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  console.log(JSON.stringify({ stage: "isolated-vm-ready", container }));
  const readyDeadline = Date.now() + 180000;
  for (;;) {
    try {
      const check = await fetch("http://127.0.0.1:8642/v1/toolsets", { headers: { authorization: `Bearer ${env.API_SERVER_KEY}` }, signal: AbortSignal.timeout(2000) });
      const data = await check.json() as any;
      if (check.ok && data.data?.some((row: any) => row.enabled && row.tools?.includes("chief_tools"))) break;
    } catch { /* bounded server cold start */ }
    assert(Date.now() < readyDeadline, "Hermes Chief plugin did not become ready");
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  await runControlOmb(["set-model", "--bot", botId!, "--instance", "hermes", "--model", env.API_SERVER_MODEL_NAME, "--url", fixture.info.url]);
  await runControlOmb(["send", "--bot", botId!, "--text", "Use chief_tools action=list, then action=describe with name=computer_get_desktop_state, then action=call with that exact name and valid arguments to inspect the VM screenshot. Read the HTTP_VM marker on its desktop. Reply only with the exact marker you SEE. Do not use host tools or guess. The marker value is available only in the VM.", "--url", fixture.info.url]);
  let wait: any;
  for (let attempt = 0; attempt < 6; attempt++) {
    wait = await runControlOmb(["wait", "--bot", botId!, "--timeout", "120", "--url", fixture.info.url]);
    if (wait.status !== "needs-user") break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const rows = await runControlOmb(["messages", "--bot", botId!, "--limit", "8", "--url", fixture.info.url]);
  assert.equal(wait.status, "settled", JSON.stringify(wait));
  assert(JSON.stringify(rows).includes(marker), "Hermes did not read the screenshot-only marker");
  const toolStart = events.find(e => e.type === "item.started" && e.title?.includes("get_desktop_state"));
  assert(toolStart, "No actual VM desktop tool reached the broker");
  assert(events.some(e => e.type === "item.completed" && e.itemId === toolStart.itemId && e.ok), "VM tool did not finish successfully");
  assert(events.some(e => e.type === "content.delta"), "No streamed response");
  const logs = readFileSync(fixture.info.logPath, "utf8");
  assert(!logs.includes(env.API_SERVER_KEY), "Hermes key appeared in app logs");
  const evidence = { checkedAt: new Date().toISOString(), passed: true, fixtureUrl: fixture.info.url, logPath: fixture.info.logPath,
    container, isolatedPerBotVm: true, screenshotOnlyMarkerRead: true, marker, streamed: true, approvalCards: events.filter(e => e.type === "request.opened").length, transport: "HTTP/SSE + standalone plugin + app MCP", acp: false,
    toolEvents: events.filter(e => e.itemId === toolStart.itemId).map(e => ({ type: e.type, title: e.title, ok: e.ok })) };
  writeFileSync("docs/verification/evidence/hermes-http-vm.json", JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally {
  if (botId) {
    await api("POST", `/api/bots/${botId}/interrupt`, {}).catch(() => {});
    await api("POST", `/api/bots/${botId}/local-computer/remove`, {});
  }
  controller.abort(); await consume; await fixture.close();
}
