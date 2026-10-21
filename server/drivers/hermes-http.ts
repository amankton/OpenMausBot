import { createHmac, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderDriver, RuntimeEvent, RuntimeEventListener, SendTurnInput } from "../contracts.ts";
import { newEventId } from "../contracts.ts";
import { HermesHttpClient, HermesHttpError, hermesHttpConfig } from "./hermes-http-client.ts";
import { createHermesToolBridge, type HermesToolBridge } from "./hermes-tool-bridge.ts";

type Config = { transport: "http" | "acp"; [key: string]: unknown };
const models = { default: "hermes-agent", options: [{ id: "hermes-agent", label: "Hermes API server", custom: true as const }] };

/** Primary Hermes driver. ACP is retained only as an explicit migration escape
 * hatch because it can mount app-owned stdio MCP servers, unlike /v1/runs. */
export const HermesAgentDriver: ProviderDriver<Config> = {
  driverKind: "hermesAgent",
  metadata: { displayName: "Hermes", supportsMultipleInstances: true, access: "custom" },
  models,
  defaultConfig: () => ({ transport: "http" }),
  decodeConfig(raw) {
    const transport = (raw as Partial<Config> | null)?.transport ?? "http";
    if (transport !== "http" && transport !== "acp") throw new Error("Hermes transport must be http or acp");
    return { ...(raw && typeof raw === "object" ? raw : {}), transport };
  },
  async create(input) {
    const env = { ...process.env, ...input.environment };
    const transport = env.HERMES_TRANSPORT ?? input.config.transport;
    if (transport === "acp") {
      const { HermesAgentDriver: legacy } = await import("./acp/hermes.ts");
      return legacy.create({ ...input, config: legacy.decodeConfig(input.config) });
    }
    if (transport !== "http") throw new Error("HERMES_TRANSPORT must be http or acp");
    const config = hermesHttpConfig(env); // Registry surfaces missing configuration at startup.
    const bridgeEnabled = env.HERMES_TOOL_BRIDGE_ENABLED === "1";
    const bridgeDirectory = env.HERMES_TOOL_BRIDGE_DIR || (env.HERMES_HOME ? join(env.HERMES_HOME, "chief-http-bridge") : "");
    if (bridgeEnabled && !bridgeDirectory) throw new Error("Hermes tool bridge requires HERMES_HOME or HERMES_TOOL_BRIDGE_DIR");
    const client = new HermesHttpClient(config);
    const requests = new HermesHttpClient({ ...config, timeoutMs: Math.min(config.timeoutMs, 30000) });
    const controls = new HermesHttpClient({ ...config, timeoutMs: Math.min(config.timeoutMs, 10000) });
    const listeners = new Set<RuntimeEventListener>();
    const sessions = new Map<string, string>();
    type Active = { controller: AbortController; turnId: string; runId?: string; stopped: boolean; done?: Promise<void>; asks: Map<string, string[]>; bridge?: HermesToolBridge };
    const active = new Map<string, Active>();
    const scope = (turn: SendTurnInput) => JSON.stringify([env.OMB_DATA_DIR ?? env.HOME ?? homedir(), input.instanceId, turn.botId ?? "", turn.threadId]);
    const sign = (value: string) => createHmac("sha256", config.apiKey).update(value).digest("hex");
    const cursor = (session: string, turn: SendTurnInput) => `hermes-http:${session}:${sign(scope(turn) + session)}`;
    const sessionFor = (turn: SendTurnInput) => {
      if (turn.sessionReset) return `chief-${randomUUID()}`;
      const parts = typeof turn.resumeCursor === "string" ? turn.resumeCursor.split(":") : [];
      if (parts.length === 3 && parts[0] === "hermes-http" && parts[2] === sign(scope(turn) + parts[1])) return parts[1];
      return sessions.get(scope(turn)) ?? `chief-${sign(scope(turn))}`;
    };
    const base = (threadId: string, turnId: string) => ({ eventId: newEventId(), provider: "hermesAgent", providerInstanceId: input.instanceId, threadId, turnId, createdAt: new Date().toISOString() });
    const emit = (event: RuntimeEvent) => { for (const listener of listeners) listener(event); };
    const control = (state: Active, action: string, body: unknown = {}) => controls.json(`/v1/runs/${encodeURIComponent(state.runId!)}/${action}`, body);
    const stop = async (state: Active) => {
      state.stopped = true;
      // Do not abort admission: if accepted, we must learn the id and stop the
      // server run. Aborting only the socket can leave an orphan generation.
      try { if (state.runId) await control(state, "stop"); }
      finally { if (state.runId) state.controller.abort(); }
    };
    const stopAll = async () => {
      const states = [...active.values()];
      await Promise.allSettled(states.map(stop));
      await Promise.allSettled(states.map(s => s.done));
    };
    const catalog = { default: config.model, options: [{ id: config.model, label: config.model, custom: true as const }] };
    return {
      instanceId: input.instanceId, driverKind: "hermesAgent", displayName: input.displayName, enabled: input.enabled, models: catalog,
      async snapshot() {
        try {
          await requests.json("/health");
          const capabilities = await requests.json("/v1/capabilities");
          const features = capabilities.features as Record<string, unknown> | undefined;
          if (!features?.run_submission || !features.run_events_sse || !features.run_stop) throw new HermesHttpError("unsupported_capabilities");
          if (bridgeEnabled) {
            const toolsets = await requests.json("/v1/toolsets");
            if (!Array.isArray(toolsets.data) || !toolsets.data.some((row: any) => row.enabled && row.tools?.includes("chief_tools"))) throw new Error("Enable the chief-http-tools plugin and chief_http_tools API toolset on the Hermes server");
            return { state: "available", authenticated: true };
          }
          return { state: "available", authenticated: true, warning: { title: "Hermes HTTP tools", message: "Uses the API server's tools and approval policy. App-provided MCP servers and per-bot tool restrictions require explicit ACP transport." } };
        } catch (error) { return { state: "unavailable", authenticated: false, reason: (error as Error).message }; }
      },
      adapter: {
        provider: "hermesAgent",
        capabilities: { sessionModelSwitch: "unsupported", strictResume: true, queueing: true,
          ...(bridgeEnabled ? { computerMcp: true, localComputerMcp: true, agentsMcp: true, composioMcp: true, browserMcp: true, customMcp: true, phoneMcp: true, images: true, nativeImageInput: true } : {}) },
        async sendTurn(turn) {
          // Saved ACP chats used this virtual alias for the configured default.
          if (turn.model === "hermes-default") turn = { ...turn, model: config.model };
          if (active.has(turn.threadId)) throw new Error("Hermes already has an active generation on this thread");
          // The public API does not accept per-request MCP descriptors or
          // enforcement policy. Refuse narrowing rather than bypassing it.
          if ((!bridgeEnabled && turn.toolScope !== undefined) || turn.guestConfined) throw new Error("Hermes HTTP tool restrictions require the Chief tools plugin; guest confinement is unavailable");
          if (!bridgeEnabled && (turn.images?.length || turn.integrations?.localComputer)) throw new Error("Hermes HTTP computer tools and images require the Chief tools plugin");
          const state: Active = { controller: new AbortController(), turnId: randomUUID(), stopped: false, asks: new Map() };
          active.set(turn.threadId, state);
          const session = sessionFor(turn);
          const received = performance.now();
          let sent = received, first: number | undefined, firstEvent = false, terminal = false, text = "";
          const tools = new Map<string, string[]>();
          const log = (stage: string, extra: Record<string, unknown> = {}) => console.info(JSON.stringify({ component: "hermes.http", stage, conversationId: session, runId: state.runId, turnId: state.turnId, elapsedMs: Math.round(performance.now() - received), ...extra }));
          type Payload<E> = E extends RuntimeEvent ? Omit<E, keyof ReturnType<typeof base>> : never;
          const publish = (payload: Payload<RuntimeEvent>) => emit({ ...base(turn.threadId, state.turnId), ...payload } as RuntimeEvent);
          const delta = (value: string) => {
            if (!value) return;
            if (first === undefined) { first = performance.now(); log("first_content", { timeToFirstContentMs: Math.round(first - sent) }); }
            text += value;
            publish({ type: "content.delta", streamKind: "assistant_text", delta: value });
          };
          const finish = async (ok: boolean, reason: string) => {
            if (terminal) return;
            terminal = true;
            if (state.bridge) {
              try { await state.bridge.close(); } catch { ok = false; reason = "tool_cleanup_failed"; publish({ type: "runtime.error", message: "Tool cleanup could not be confirmed; inspect the computer before retrying", terminal: true }); }
            }
            for (const requestId of state.asks.keys()) publish({ type: "request.resolved", requestId, behavior: "deny", source: "system" });
            state.asks.clear();
            for (const ids of tools.values()) for (const itemId of ids) publish({ type: "item.completed", itemType: "tool", itemId, ok: false });
            tools.clear();
            if (text) publish({ type: "item.completed", itemType: "assistant_text", text });
            // The harness may dispatch its queued turn synchronously on completion.
            if (active.get(turn.threadId) === state) active.delete(turn.threadId);
            publish({ type: "turn.completed", ok, stopReason: reason, cost: null });
            log("final", { ok, reason, dispatchLatencyMs: Math.round(sent - received), timeToFirstContentMs: first === undefined ? null : Math.round(first - sent), totalMs: Math.round(performance.now() - received) });
          };
          publish({ type: "turn.started" }); log("received");
          state.done = (async () => {
            try {
              if (bridgeEnabled) state.bridge = await createHermesToolBridge(turn, state.controller.signal, bridgeDirectory, publish);
              if (state.stopped) { await finish(true, "interrupted"); return; }
              sent = performance.now(); log("dispatch", { dispatchLatencyMs: Math.round(sent - received) });
              const rebuilding = typeof turn.resumeCursor === "string" && !turn.resumeCursor.startsWith("hermes-http:");
              const admitted = await requests.json("/v1/runs", { model: turn.model || config.model,
                session_id: session, input: rebuilding ? turn.recoveryText || turn.text : turn.text,
                instructions: [turn.system, bridgeEnabled ? "This is a Chief-managed chat. Use chief_tools with action=list to discover the tools assigned to this turn, action=describe with an exact name for its argument schema, then action=call. For the assigned VM/computer/browser, always use these tools; native host tools do not control that computer. User images are available via action=attachments. Chief owns approvals, tool selection and cancellation." : ""].filter(Boolean).join("\n\n") }, undefined, status => log("headers", { status }));
              if (typeof admitted.run_id !== "string" || !admitted.run_id) throw new HermesHttpError("invalid_run");
              state.runId = admitted.run_id;
              await state.bridge?.bind(state.runId);
              sessions.set(scope(turn), session);
              publish({ type: "session.started", sessionId: cursor(session, turn), model: turn.model || config.model, ...(rebuilding ? { rebuilt: true } : {}) });
              if (state.stopped) { await stop(state); await finish(true, "interrupted"); return; }
              for await (const data of client.events(state.runId, state.controller.signal, status => log("stream_headers", { status }))) {
                if (active.get(turn.threadId) !== state || state.stopped) break;
                if (!firstEvent) { firstEvent = true; log("first_event", { timeToFirstEventMs: Math.round(performance.now() - sent) }); }
                if (data.run_id !== undefined && data.run_id !== state.runId) throw new HermesHttpError("wrong_run");
                const name = data.event;
                if (name === "message.delta" && typeof data.delta === "string") delta(data.delta);
                else if (name === "message.interim" && typeof data.text === "string") {
                  if (!data.already_streamed) delta(data.text);
                  if (text) publish({ type: "item.completed", itemType: "assistant_text", text });
                  text = "";
                } else if (name === "reasoning.available" && typeof data.text === "string") publish({ type: "content.delta", streamKind: "reasoning_text", delta: data.text });
                else if (name === "tool.started") {
                  const tool = typeof data.tool === "string" ? data.tool : "tool";
                  const itemId = randomUUID();
                  const ids = tools.get(tool) ?? []; ids.push(itemId); tools.set(tool, ids);
                  publish({ type: "item.started", itemType: "tool", itemId, title: tool });
                } else if (name === "tool.completed") {
                  const itemId = tools.get(String(data.tool))?.shift() ?? randomUUID();
                  publish({ type: "item.completed", itemType: "tool", itemId, ok: data.error !== true });
                } else if (name === "approval.request") {
                  if (typeof data.request_id !== "string" || !Array.isArray(data.choices)) throw new HermesHttpError("invalid_approval");
                  const choices = data.choices.filter((v): v is string => typeof v === "string");
                  state.asks.set(data.request_id, choices);
                    // Native plugin approvals identify the tool in this fixed command
                    // shape, rather than `tool`. Do not expose arbitrary commands.
                    const nativeTool = typeof data.command === "string"
                      ? /^<([a-zA-Z][a-zA-Z0-9_]{0,79})> \(plugin approval rule\)$/.exec(data.command)?.[1] : undefined;
                    publish({ type: "request.opened", requestId: data.request_id, requestType: "permission", tool: nativeTool || String(data.tool || "Hermes"),
                      summary: nativeTool ? `Hermes requests permission to use ${nativeTool}` : "Hermes requests permission for an action", choices, requiresExplicitApproval: true });
                } else if (name === "run.completed") {
                  if (!text && typeof data.output === "string") delta(data.output);
                  await finish(true, "end_turn"); break;
                } else if (["run.cancelled", "run.interrupted", "run.failed"].includes(String(name))) {
                  if (name === "run.failed") publish({ type: "runtime.error", message: "Hermes run failed; check the server and retry", terminal: true });
                  await finish(name !== "run.failed", name === "run.failed" ? "error" : "interrupted"); break;
                }
              }
              if (!terminal && !state.stopped) throw new HermesHttpError("interrupted");
              if (state.stopped) await finish(true, "interrupted");
            } catch (error) {
              const category = error instanceof HermesHttpError ? error.category : "transport_error";
              log("error", { category, status: error instanceof HermesHttpError ? error.status : undefined });
              if (!state.stopped) publish({ type: "runtime.error", message: error instanceof HermesHttpError ? error.message : "Hermes transport failed; retry the message", terminal: true });
              // An interrupted event socket does not stop a server-owned run.
              if (state.runId && !terminal) { try { await control(state, "stop"); } catch { log("stop_failed", { category: "cleanup" }); } }
              await finish(state.stopped, state.stopped ? "interrupted" : "error");
            } finally {
              state.controller.abort();
              if (active.get(turn.threadId) === state) active.delete(turn.threadId);
            }
          })();
          return { turnId: state.turnId };
        },
        async interruptTurn(threadId, turnId) {
          const state = active.get(threadId);
          if (state && (!turnId || state.turnId === turnId)) { await stop(state); await state.done; }
        },
        async respondToRequest(threadId, requestId, decision) {
          const state = active.get(threadId);
          const local = state?.bridge?.answer(requestId, decision.behavior, decision.message);
          if (local && local !== "unavailable") return local;
          const choices = state?.asks.get(requestId);
          if (!state?.runId || !choices || decision.behavior === "answer") return "unavailable";
          // Only exact choices advertised by this approval may be returned.
          const choice = decision.behavior === "deny" ? "deny" : decision.always ? "session" : "once";
          if (!choices.includes(choice)) return "unavailable";
          try {
            await control(state, "approval", { request_id: requestId, choice });
            state.asks.delete(requestId);
            emit({ ...base(threadId, state.turnId), requestId, type: "request.resolved", behavior: decision.behavior, source: "user" });
            return decision.behavior === "allow" ? "allowed-once" : "rejected";
          } catch { return "unavailable"; }
        },
        async steer(threadId, text) {
          const state = active.get(threadId);
          if (!state?.runId || state.stopped) return "refused";
          try { const result = await control(state, "steer", { input: text }); return result.accepted === true ? "steered" : "refused"; }
          catch (error) { return error instanceof HermesHttpError && error.status ? "refused" : "indeterminate"; }
        },
        hasSession: threadId => active.has(threadId), stopAll,
        onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      },
      async dispose() { await stopAll(); sessions.clear(); listeners.clear(); },
    };
  },
};
