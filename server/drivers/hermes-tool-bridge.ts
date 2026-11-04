// Hermes's standalone Chief plugin calls this per-run broker. Tool execution
// stays in the existing app MCP/VM boundary, never in a new Hermes process.
import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { SendTurnInput, RuntimeEvent, RequestOutcome } from "../contracts.ts";
import { mountChatTools } from "./chat-mcp-tools.ts";
import { createChatToolApproval } from "./chat-tool-approval.ts";
import { chatUserContent, chatImageBudget } from "./chat-images.ts";
import { allowsTool } from "../../shared/tool-scope.ts";
import { hermesRoutineMcp, hermesRoutineNative } from "./hermes-routine-approval.ts";
import { commandReviewWorkingFolder, commandReviewReceipt, type CommandReviewer, type CommandReviewInput } from "./hermes-command-review.ts";
import { redactSecretsInText } from "../redact.ts";

type Payload<E> = E extends RuntimeEvent ? Omit<E, "eventId" | "provider" | "providerInstanceId" | "threadId" | "turnId" | "createdAt"> : never;

export async function createHermesToolBridge(turn: SendTurnInput, signal: AbortSignal, directory: string,
  publish: (event: Payload<RuntimeEvent>) => void, routineApprovals = false, commandReviewer?: CommandReviewer) {
  const integrations = turn.integrations?.phone ? { ...turn.integrations, custom: { ...turn.integrations.custom, phone: turn.integrations.phone } } : turn.integrations;
  const tools = await mountChatTools(integrations, signal, true, turn.toolScope);
  const secret = randomBytes(32).toString("hex");
  const imageBudget = chatImageBudget();
  let runId: string | undefined;
  let closed = false;
  const completedCalls = new Map<string, { fingerprint: string; result: Promise<unknown> }>();
  const review = async (tool: string, input: CommandReviewInput) => {
    const started = performance.now();
    const verdict = await commandReviewer!.review(input, signal);
    console.info(JSON.stringify({ component: "hermes.approval", threadId: turn.threadId, tool, source: "command-review",
      decision: verdict.decision, reason: verdict.reason, commandHash: commandReviewReceipt(input), latencyMs: Math.round(performance.now() - started) }));
    return verdict;
  };
  const commandSummary = (reason: string, command: unknown, cwd?: string) => `Command checkpoint (${reason})${cwd ? ` in ${cwd}` : ""}: ${reason === "credentials" ? "Sensitive command withheld; inspect its credential access locally." : redactSecretsInText(String(command ?? "")).slice(0, 1200)}`;
  const approval = createChatToolApproval({ signal,
    open: ask => publish({ type: "request.opened", requestType: "permission", requestId: ask.id, tool: ask.tool,
      summary: ask.summary, allowSession: false, requiresExplicitApproval: turn.integrations?.localComputer?.scope === "local-computer" }),
    resolved: (ask, allowed, source) => publish({ type: "request.resolved", requestId: ask.id, behavior: allowed ? "allow" : "deny", source }),
    openQuestion: (ask, questions) => publish({ type: "request.opened", requestType: "question", requestId: ask.id, tool: ask.tool, summary: ask.summary, questions }),
    resolvedQuestion: (ask, answered, source) => publish({ type: "request.resolved", requestId: ask.id, behavior: answered ? "answer" : "deny", source }),
  });
  const execute = async (body: Record<string, unknown>) => {
    const name = body.name;
    if (typeof name !== "string" || !body.arguments || typeof body.arguments !== "object" || Array.isArray(body.arguments)) throw new Error("Invalid tool call");
    const args = body.arguments as Record<string, unknown>;
    tools.validate(name, args);
    const itemId = `chief-tool-${randomBytes(12).toString("hex")}`;
    publish({ type: "item.started", itemType: "tool", itemId, title: name });
    let ok = false;
    try {
      const routine = hermesRoutineMcp(turn, routineApprovals, tools.identity(name));
      const identity = tools.identity(name);
      const reviewable = routineApprovals && commandReviewer && turn.approvalMode === "auto" && identity?.builtIn && identity.server === "agents" && identity.name === "vm_exec" && typeof args.command === "string" && turn.integrations?.localComputer?.scope !== "local-computer";
      const verdict = reviewable ? await review(name, { command: args.command as string, cwd: "/home/cua/workspace", scope: "vm" }) : undefined;
      if (turn.approvalMode !== "full" && !routine && verdict?.decision !== "approve" && !await approval.ask(name, verdict ? commandSummary(verdict.reason, args.command, "/home/cua/workspace") : "Allow this tool on the computer or integration assigned to this chat?")) return { text: "The person denied this tool call.", ok: false };
      if (routine) console.info(JSON.stringify({ component: "hermes.approval", threadId: turn.threadId, tool: name, source: "routine-policy" }));
      if (closed || signal.aborted) throw new Error("Turn ended");
      const result = await tools.execute(name, args, signal);
      imageBudget(result.images ?? []);
      ok = result.ok;
      return result;
    } finally { publish({ type: "item.completed", itemType: "tool", itemId, ok }); }
  };
  const server = createServer(async (req, res) => {
    const reply = (status: number, value: unknown) => { if (!res.destroyed) { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(value)); } };
    const token = Buffer.from(req.headers.authorization?.replace(/^Bearer /, "") ?? "");
    const expected = Buffer.from(secret);
    if (token.length !== expected.length || !timingSafeEqual(token, expected)) { reply(401, { error: "Unauthorized" }); return; }
    if (closed || signal.aborted || req.method !== "POST" || req.url !== `/runs/${runId}`) { reply(404, { error: "Run is not active" }); return; }
    try {
      let text = "";
      for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 1024 * 1024) { reply(413, { error: "Request too large" }); return; } }
      const body = JSON.parse(text) as Record<string, unknown>;
      if (body.action === "list") {
        reply(200, { tools: tools.definitions.map(tool => ({ name: tool.function.name, description: tool.function.description.slice(0, 160) })),
          next: "Use action=describe with one exact name for its full argument schema before calling it.", imagesAvailable: !!turn.images?.length }); return;
      }
      if (body.action === "describe") {
        const tool = tools.definitions.find(tool => tool.function.name === body.name);
        if (!tool) throw new Error("Tool is not advertised");
        reply(200, { tool }); return;
      }
      if (body.action === "attachments") {
        const content = chatUserContent(turn);
        reply(200, { text: "User attachments for this turn.", ok: true, images: Array.isArray(content) ? content.filter(p => p.type === "image_url") : [] }); return;
      }
      if (body.action === "authorize") {
        const name = typeof body.name === "string" ? body.name : "";
        const discovery = ["tool_search", "tool_describe"].includes(name);
        const allowed = discovery || !!name && (!turn.toolScope || !name.startsWith("mcp_")) && allowsTool(turn.toolScope, { kind: "native", name });
        const args = body.arguments && typeof body.arguments === "object" && !Array.isArray(body.arguments) ? body.arguments as Record<string, unknown> : {};
        const routine = allowed && hermesRoutineNative(turn, routineApprovals, name, args);
        if (routine) console.info(JSON.stringify({ component: "hermes.approval", threadId: turn.threadId, tool: name, source: "routine-policy" }));
        const reviewable = allowed && !routine && routineApprovals && commandReviewer && turn.approvalMode === "auto" && name === "terminal" && typeof args.command === "string";
        if (reviewable && (typeof args.workdir !== "string" || !isAbsolute(args.workdir))) {
          reply(200, { allowed: false, approval: false, message: `Set terminal workdir explicitly to an absolute folder inside the active Chief workspace (${turn.cwd || "unavailable; use the assigned VM tools"}), then retry this operation.` }); return;
        }
        const cwd = reviewable ? commandReviewWorkingFolder(turn.cwd, args.workdir) : null;
        const verdict = reviewable ? cwd ? await review(name, { command: args.command as string, cwd, scope: "workspace" }) : { decision: "checkpoint", reason: "working-folder-required" } : undefined;
        if (closed || signal.aborted) throw new Error("Turn ended");
        reply(200, { allowed, approval: allowed && !discovery && !routine && verdict?.decision !== "approve" && turn.approvalMode !== "full",
          ...(verdict?.decision === "checkpoint" ? { summary: commandSummary(verdict.reason, args.command, typeof args.workdir === "string" ? args.workdir : undefined) } : {}) }); return;
      }
      if (body.action !== "call" || typeof body.call_id !== "string" || !body.call_id || body.call_id.length > 256) throw new Error("Invalid action");
      // A retransmitted HTTP request cannot execute a click or write twice.
      let pending = completedCalls.get(body.call_id);
      const fingerprint = JSON.stringify([body.name, body.arguments]);
      if (pending && pending.fingerprint !== fingerprint) throw new Error("Tool call identity was reused with different arguments");
      if (!pending) {
        if (completedCalls.size >= 1000) throw new Error("Tool call limit reached");
        pending = { fingerprint, result: execute(body) }; completedCalls.set(body.call_id, pending);
      }
      reply(200, await pending.result);
    } catch { reply(400, { error: "Chief tool request failed; verify its arguments and active turn before retrying" }); }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  try { await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); }); }
  catch (error) { approval.close(); await tools.close(); throw error; }
  server.unref();
  const port = (server.address() as { port: number }).port;
  const close = async () => {
    if (closed) return;
    closed = true; approval.close(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (runId) await unlink(join(directory, `${runId}.json`)).catch(error => { if (error.code !== "ENOENT") throw error; });
    try { await tools.close(); } finally { await commandReviewer?.close(); }
  };
  return {
    async bind(id: string) {
      if (!/^run_[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error("Invalid Hermes run identifier");
      runId = id;
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, `${id}.json`), JSON.stringify({ url: `http://127.0.0.1:${port}/runs/${id}`, token: secret, expires: Date.now() + 24 * 60 * 60 * 1000 }), { mode: 0o600, flag: "wx" });
    },
    answer(id: string, behavior: "allow" | "deny" | "answer", message?: string): RequestOutcome { return approval.answer(id, behavior, message); },
    close,
  };
}

export type HermesToolBridge = Awaited<ReturnType<typeof createHermesToolBridge>>;
