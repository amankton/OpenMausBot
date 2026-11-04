// Real installed Hermes, disposable Chief data and a synthetic document only.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseEnv } from "node:util";
import { launchVerificationServer } from "./control-omb.ts";
import { removeTempDir } from "../server/testing/cleanup.ts";

const home = process.argv[2]; assert(home, "Pass the installed Hermes home");
const commands = process.argv.includes("--commands");
const env = parseEnv(readFileSync(join(home, ".env"), "utf8"));
const baseUrl = `http://127.0.0.1:${env.API_SERVER_PORT || "8642"}`;
const readyDeadline = Date.now() + 180000;
for (;;) {
  try {
    const response = await fetch(baseUrl + "/v1/toolsets", { headers: { authorization: `Bearer ${env.API_SERVER_KEY}` }, signal: AbortSignal.timeout(2000) });
    const value = await response.json() as any;
    if (response.ok && value.data?.some((row: any) => row.enabled && row.tools?.includes("chief_tools"))) break;
  } catch { /* bounded plugin and gateway cold start */ }
  assert(Date.now() < readyDeadline, "Installed Hermes API did not become ready");
  await new Promise(resolve => setTimeout(resolve, 1000));
}
const directory = mkdtempSync(join(tmpdir(), "chief-routine-live-"));
const fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, undefined, [], undefined, undefined,
  { baseUrl, apiKey: env.API_SERVER_KEY, model: env.API_SERVER_MODEL_NAME || "hermes-agent", toolsDirectory: join(home, "chief-http-bridge"), ...(commands ? { home } : {}) });
const api = async (method: string, path: string, body?: unknown) => {
  const response = await fetch(fixture.info.url + path, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  const value = await response.json() as any; assert(response.ok, `${path}: ${JSON.stringify(value)}`); return value;
};
let botId: string | undefined;
try {
  console.log(JSON.stringify({ stage: "isolated-real-Hermes", url: fixture.info.url, logPath: fixture.info.logPath }));
  await api("PATCH", "/api/instances/hermes", { routineApprovals: true, commandReview: commands });
  const { bot } = await api("POST", "/api/bots", { name: "Routine live fixture", modelSelection: { instanceId: "hermes", model: env.API_SERVER_MODEL_NAME || "hermes-agent" } });
  botId = bot.id;
  await api("PATCH", `/api/bots/${bot.id}`, { approvalMode: "auto", cwd: directory });
  const document = join(directory, commands ? "command-draft.md" : "draft.md");
  const marker = commands ? "ROUTINE_COMMAND_OK" : "ROUTINE_DOCUMENT_OK";
  const command = `python -c "from pathlib import Path; Path('command-draft.md').write_text('ROUTINE_COMMAND_OK'); print(Path('command-draft.md').read_text())"`;
  const text = commands
    ? `Synthetic isolated command-review verification. Use exactly one native terminal call with command=${JSON.stringify(command)} and workdir=${JSON.stringify(directory)}. This creates and reads a synthetic draft in the explicitly authorized disposable working folder. Then reply exactly ROUTINE_COMMAND_OK. Do not use file tools, chief_tools, other commands, network, memory, or delegation.`
    : `Synthetic isolated routine-policy verification. Use the native write_file tool to create the absolute path ${JSON.stringify(document)} with exactly ROUTINE_DOCUMENT_OK as its content, then use native read_file to read that path, then reply exactly ROUTINE_DOCUMENT_OK. Do not use terminal, external services, memory, other files, or delegation. These two file operations are explicitly authorized in this disposable folder.`;
  await api("POST", `/api/bots/${bot.id}/messages`, { text });
  const deadline = Date.now() + 180000;
  let current: any;
  for (;;) {
    current = (await api("GET", "/api/bots?messages=1")).bots.find((row: any) => row.id === bot.id);
    assert(!current.messages?.some((row: any) => row.card?.requestType === "permission"), "Routine operation unexpectedly asked for approval");
    if (!current.busy) break;
    assert(Date.now() < deadline, "Live fixture timed out"); await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal(readFileSync(document, "utf8").trim(), marker);
  const log = readFileSync(fixture.info.logPath, "utf8");
  if (commands) assert(log.includes('"tool":"terminal","source":"command-review","decision":"approve"'));
  else {
    assert(log.includes('"tool":"write_file","source":"routine-policy"'));
    assert(log.includes('"tool":"read_file","source":"routine-policy"'));
  }
  assert(!log.includes(env.API_SERVER_KEY));
  const evidence = { checkedAt: new Date().toISOString(), passed: true, realHermes: true, isolatedChief: true, nativeDocumentWriteAndRead: true, nativeCommandExecuted: commands, approvalCards: 0, logPath: fixture.info.logPath };
  writeFileSync(`docs/verification/evidence/${commands ? "hermes-command-review-live" : "hermes-routine-live"}.json`, JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence));
} finally {
  if (botId) await api("POST", `/api/bots/${botId}/interrupt`, {}).catch(() => {});
  await fixture.close(); await removeTempDir(directory);
}
