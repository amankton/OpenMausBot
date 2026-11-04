import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb, verificationServerEnvironment } from "../scripts/control-omb.ts";
import { request } from "../scripts/mcp-server.ts";
import { waitForExit } from "./testing/cleanup.ts";

it("synthetic onboarding: failed A, delivered B, stopped requester, later failure and restart preserve scoped sourced evidence", async () => {
  const session = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, { scripted: true });
  const { url, dataDir, logPath } = session.info;
  let restarted: ChildProcess | undefined;
  const cli = (...args: string[]) => runControlOmb([...args, "--url", url]) as Promise<any>;
  const api = (path: string, body?: unknown, method = "POST") => request(path, body === undefined ? {} : { method, body: JSON.stringify(body) }, url) as Promise<any>;
  try {
    const chief = (await cli("new-bot", "--name", "Onboarding lead", "--section", "Synthetic")).bot;
    const builder = (await cli("new-bot", "--name", "Packet builder", "--section", "Synthetic")).bot;
    const stranger = (await cli("new-bot", "--name", "Unrelated bot", "--section", "Private")).bot;
    await api(`/api/bots/${chief.id}`, { chiefOfStaff: true }, "PATCH");
    const source = join(dataDir, "workspaces", builder.id); mkdirSync(source, { recursive: true });
    const transcript = readFileSync(new URL("../examples/durable-results/transcript.md", import.meta.url), "utf8");
    const sop = readFileSync(new URL("../examples/durable-results/sop.md", import.meta.url), "utf8");
    const packetPath = join(source, "sourced-packet.md");
    writeFileSync(packetPath, `# SYNTHETIC onboarding packet\n\nRequirement: weekly service report [Transcript T1].\nOwner: unresolved [T2; SOP S2].\nDeadline: unresolved [T2; SOP S2].\nContact/publish authority: absent [T3; SOP S3].\n\n## Source transcript\n${transcript}\n## Source SOP\n${sop}`);
    const gate = join(dataDir, "release-builder"); const ready = join(dataDir, "registration-ready");
    const planPath = join(dataDir, "room-plan.json");
    const plan: Record<string, any> = {
      [chief.id]: { steps: [{ tool: "coordinate_bots", arguments: { bot_ids: [builder.id], message: "Produce the sourced onboarding packet", rework: true } }], reply: "Assigned", resumeReply: "Reviewed the result" },
      [builder.id]: { fail: true },
    };
    const save = () => writeFileSync(planPath, JSON.stringify(plan));
    const evidence = () => existsSync(`${planPath}.evidence.jsonl`) ? readFileSync(`${planPath}.evidence.jsonl`, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
    const nodes = (): any[] => JSON.parse(readFileSync(join(dataDir, "room-handoffs.json"), "utf8"));
    const messages = async () => (await api(`/api/threads/${chief.activeTaskId}/messages`)).messages;
    const send = async (bot: any, threadId: string, text: string) => {
      await cli("send", "--bot", bot.id, "--task", threadId, "--text", text);
      return cli("wait", "--bot", bot.id, "--task", threadId, "--timeout", "30");
    };
    save(); await send(chief, chief.activeTaskId, "Create the synthetic packet, first attempt");
    const buildThread = nodes().find(n => n.botId === builder.id)!.threadId;
    const firstSummary = (await api("/api/bots?messages=0")).bots.find((b: any) => b.id === builder.id).tasks.find((t: any) => t.threadId === buildThread).resultSummary;
    expect(firstSummary.executionOutcome).toBe("failed");

    plan[builder.id] = { steps: [{ tool: "register_task_result", arguments: {
      summary: "Synthetic sourced packet; owner and deadline remain unresolved.", deliveryOutcome: "delivered", dataKind: "synthetic",
      artifacts: [{ path: packetPath, title: "Sourced onboarding packet", scope: "host" }],
      verifications: [{ check: "SOP source citations reviewed", outcome: "passed", artifactIndex: 0 }],
    } }], readyFile: ready, gateFile: gate, reply: "Packet delivered, no customer contact" };
    save();
    await cli("send", "--bot", chief.id, "--task", chief.activeTaskId, "--text", "Retry the packet work");
    await expect.poll(() => existsSync(ready), { timeout: 20_000 }).toBe(true);
    await expect.poll(async () => (await api("/api/bots?messages=0")).bots.find((b: any) => b.id === chief.id)?.waitingForTeammates, { timeout: 20_000 }).toBe(true);
    await api(`/api/bots/${chief.id}/interrupt`, { threadId: chief.activeTaskId });
    const chiefTurns = evidence().filter(t => t.botId === chief.id).length;
    writeFileSync(gate, "finish the already-running specialist");
    await expect.poll(() => nodes().filter(n => n.botId === builder.id).at(-1)?.status, { timeout: 20_000 }).toBe("completed");
    await expect.poll(async () => (await messages()).filter((m: any) => m.taskResultIds?.length).length, { timeout: 10_000 }).toBe(1);
    expect(evidence().filter(t => t.botId === chief.id)).toHaveLength(chiefTurns);
    const resultId = (await messages()).find((m: any) => m.taskResultIds?.length).taskResultIds[0];
    expect(nodes().filter(n => n.botId === builder.id).at(-1).resultIds).toContain(resultId);

    plan[builder.id] = { fail: true }; save(); await send(builder, buildThread, "A later execution fails");
    const latestSummary = (await api("/api/bots?messages=0")).bots.find((b: any) => b.id === builder.id).tasks.find((t: any) => t.threadId === buildThread).resultSummary;
    expect(latestSummary).toMatchObject({ executionOutcome: "failed", lastDeliveredResultId: resultId });

    const lookup = async (bot: any, expectError = false) => {
      plan[bot.id] = { steps: [{ tool: "task_results", arguments: { target_thread_id: buildThread }, expectError }], reply: "Lookup finished" }; save();
      await send(bot, bot.activeTaskId, "Find the existing result; do not redo the work");
      const turn = evidence().filter(t => t.botId === bot.id).at(-1);
      const response = turn.evidence.find((e: any) => e.step?.tool === "task_results").response.result;
      expect(Boolean(response.isError)).toBe(expectError);
      return expectError ? response : JSON.parse(response.content[0].text);
    };
    const found = await lookup(chief);
    const delivered = found.results.find((r: any) => r.id === resultId);
    expect(delivered).toMatchObject({ schemaVersion: 1, executionOutcome: "succeeded", deliveryOutcome: "delivered", dataKind: "synthetic" });
    expect(delivered.retryOfExecutionId).toBe(found.results.at(-1).executionId);
    expect(delivered.verifications.map((v: any) => v.authority)).toEqual(["harness_observation", "agent_claim"]);
    expect(readFileSync(delivered.artifacts[0].attachment.path, "utf8")).toContain("Deadline: unresolved");
    const artifactMessages = (await api(`/api/threads/${buildThread}/messages`)).messages;
    expect(artifactMessages.find((m: any) => m.id === delivered.artifactPublication?.messageId)?.attachments?.[0].path)
      .toBe(delivered.artifacts[0].attachment.path);
    const download = () => fetch(`${url}/api/threads/${buildThread}/messages/${delivered.artifactPublication.messageId}/file`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: delivered.artifacts[0].attachment.path }),
    });
    const fileResponse = await download();
    expect(fileResponse.ok).toBe(true);
    expect(await fileResponse.text()).toBe(readFileSync(packetPath, "utf8"));
    await lookup(stranger, true);

    await waitForExit(session.child, { signal: "SIGTERM" });
    // Reproduce a committed result whose notification was not projected.
    // The only writer is stopped; update this disposable fixture atomically.
    const db = new DatabaseSync(join(dataDir, "messages.db"));
    try {
      const card = db.prepare("SELECT id, json FROM messages WHERE thread_id = ? AND json_extract(json, '$.taskResultIds[0]') = ?")
        .get(chief.activeTaskId, resultId) as { id: string; json: string };
      db.exec("BEGIN");
      db.prepare("UPDATE messages SET json = json_set(json, '$.parentId', ?) WHERE thread_id = ? AND json_extract(json, '$.parentId') = ?")
        .run(JSON.parse(card.json).parentId ?? null, chief.activeTaskId, card.id);
      db.prepare("DELETE FROM messages WHERE thread_id = ? AND id = ?").run(chief.activeTaskId, card.id);
      db.prepare("DELETE FROM command_receipts WHERE kind = 'task-result.report' AND key = ?").run(`${resultId}:${chief.activeTaskId}`);
      db.prepare("UPDATE task_results SET payload = json_set(payload, '$.notification.state', 'pending') WHERE id = ?").run(resultId);
      db.exec("COMMIT");
    } finally { db.close(); }
    const log = openSync(logPath, "a", 0o600);
    restarted = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./index.ts", import.meta.url))], {
      cwd: fileURLToPath(new URL("..", import.meta.url)), env: verificationServerEnvironment({}, dataDir, Number(new URL(url).port)), stdio: ["ignore", log, log],
    }); closeSync(log);
    await expect.poll(async () => {
      if (restarted?.exitCode !== null) throw new Error(readFileSync(logPath, "utf8"));
      return fetch(url + "/api/health").then(r => r.ok).catch(() => false);
    }, { timeout: 15_000 }).toBe(true);
    expect((await lookup(chief)).results.some((r: any) => r.id === resultId && r.deliveryOutcome === "delivered")).toBe(true);
    expect((await messages()).filter((m: any) => m.taskResultIds?.includes(resultId))).toHaveLength(1);
    expect((await download()).ok).toBe(true);
    await api(`/api/bots/${chief.id}`, { peers: [] }, "PATCH");
    await lookup(chief, true);
    expect(readFileSync(logPath, "utf8")).not.toMatch(/ReferenceError|store: change listener threw/);
  } finally {
    await waitForExit(restarted, { signal: "SIGTERM" });
    await session.close();
  }
}, 120_000);
