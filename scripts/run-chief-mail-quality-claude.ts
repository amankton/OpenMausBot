/** Opt-in synthetic pilot on an explicitly preserved Claude selection. No mailbox or app API. */
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makePlan, VERSION } from "./verify-chief-mail-quality.ts";

type Prompt = ReturnType<typeof makePlan>["prompts"][number];
type Event = Record<string, unknown>;
interface ExecutionDiagnostics {
  spawnObserved: boolean;
  stdinWriteFinished: boolean;
  stdoutBytes: number;
  stderrBytes: number;
  firstStdoutMs: number | null;
  eventCount: number;
  initObserved: boolean;
  initModelMatched: boolean | null;
  initToolsEmpty: boolean | null;
  initMcpEmpty: boolean | null;
  exitObserved: boolean;
  exitCode: number | null;
  closeObserved: boolean;
  closeCode: number | null;
  terminatedBySignal: boolean;
  timedOut: boolean;
  elapsedMs: number;
}
class ClaudeRunError extends Error {
  category: string;
  diagnostics?: ExecutionDiagnostics;
  constructor(category: string, diagnostics?: ExecutionDiagnostics) { super(category); this.category = category; this.diagnostics = diagnostics; }
}

export function claudeArgs(prompt: Prompt, model: string) {
  return ["--print", "--safe-mode", "--tools", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--no-session-persistence", "--disable-slash-commands", "--no-chrome", "--permission-mode", "dontAsk", "--model", model, "--output-format", "stream-json", "--verbose", "--system-prompt", prompt.system];
}

export function extractClaude(events: Event[], expectedModel: string) {
  const init = events.find(event => event.type === "system" && event.subtype === "init");
  if (!init || !Array.isArray(init.tools) || init.tools.length || !Array.isArray(init.mcp_servers) || init.mcp_servers.length || init.model !== expectedModel) throw new Error("Model/tools/MCP isolation was not verified.");
  const attempts: string[] = [];
  for (const event of events) {
    const message = event.message as { content?: { type?: string; name?: string }[] } | undefined;
    for (const block of message?.content ?? []) if (block.type === "tool_use" || block.type === "server_tool_use") attempts.push(block.name ?? "unknown-tool");
  }
  const result = events.findLast(event => event.type === "result");
  if (!result || result.is_error === true || result.subtype !== "success" || typeof result.result !== "string" || attempts.length) throw new Error("Claude did not produce a successful tool-free result.");
  const modelUsage = result.modelUsage;
  if (modelUsage && typeof modelUsage === "object" && Object.keys(modelUsage).some(model => model !== expectedModel)) throw new Error("Observed usage includes another model; fallback/substitution is rejected.");
  const usage = result.usage as Record<string, unknown> | undefined;
  const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  const inputTokens = number(usage?.input_tokens);
  const cacheRead = number(usage?.cache_read_input_tokens);
  const cacheCreate = number(usage?.cache_creation_input_tokens);
  return { output: result.result, toolAttempts: attempts, observedModel: init.model as string, cliVersion: typeof init.claude_code_version === "string" ? init.claude_code_version : "unreported", usage: usage || typeof result.total_cost_usd === "number" ? { inputTokens, outputTokens: number(usage?.output_tokens), costUsd: number(result.total_cost_usd), source: "provider" as const } : null, providerUsageDetails: usage ? { inputTokens, cacheReadInputTokens: cacheRead, cacheCreationInputTokens: cacheCreate, outputTokens: number(usage.output_tokens) } : null };
}

export async function executePrompt(executable: string, model: string, prompt: Prompt, cwd: string) {
  const started = performance.now();
  const events: Event[] = [];
  const diagnostics: ExecutionDiagnostics = { spawnObserved: false, stdinWriteFinished: false, stdoutBytes: 0, stderrBytes: 0, firstStdoutMs: null, eventCount: 0, initObserved: false, initModelMatched: null, initToolsEmpty: null, initMcpEmpty: null, exitObserved: false, exitCode: null, closeObserved: false, closeCode: null, terminatedBySignal: false, timedOut: false, elapsedMs: 0 };
  const snapshot = () => ({ ...diagnostics, elapsedMs: Math.round(performance.now() - started) });
  const parsed = await new Promise<ReturnType<typeof extractClaude>>((accept, reject) => {
    const child = spawn(executable, claudeArgs(prompt, model), { cwd, env: process.env, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    let pending = "";
    let invalid = false;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; diagnostics.timedOut = true; invalid = true; child.kill(); }, 180000);
    child.once("spawn", () => { diagnostics.spawnObserved = true; });
    child.once("exit", (code, signal) => { diagnostics.exitObserved = true; diagnostics.exitCode = code; diagnostics.terminatedBySignal = signal != null; });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (text: string) => {
      diagnostics.stdoutBytes += Buffer.byteLength(text);
      diagnostics.firstStdoutMs ??= Math.round(performance.now() - started);
      if (diagnostics.stdoutBytes > 4 * 1024 * 1024) { invalid = true; child.kill(); return; }
      pending += text;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop()!;
      for (const line of lines) if (line.trim()) {
        try {
          const event = JSON.parse(line) as Event;
          events.push(event);
          diagnostics.eventCount++;
          if (event.type === "system" && event.subtype === "init") {
            diagnostics.initObserved = true;
            diagnostics.initModelMatched = event.model === model;
            diagnostics.initToolsEmpty = Array.isArray(event.tools) && event.tools.length === 0;
            diagnostics.initMcpEmpty = Array.isArray(event.mcp_servers) && event.mcp_servers.length === 0;
          }
          if (event.type === "system" && event.subtype === "init" && (event.model !== model || !Array.isArray(event.tools) || event.tools.length || !Array.isArray(event.mcp_servers) || event.mcp_servers.length)) { invalid = true; child.kill(); }
        } catch { invalid = true; child.kill(); }
      }
    });
    // Count stderr without retaining or logging potentially private diagnostic text.
    child.stderr.on("data", (data: Buffer) => { diagnostics.stderrBytes += data.length; });
    child.once("error", () => { clearTimeout(timer); reject(new ClaudeRunError("executable-start-failed", snapshot())); });
    child.once("close", code => {
      clearTimeout(timer);
      diagnostics.closeObserved = true;
      diagnostics.closeCode = code;
      if (timedOut) return reject(new ClaudeRunError("180-second-timeout-no-verifiable-result", snapshot()));
      if (invalid || code !== 0 || pending.trim()) return reject(new ClaudeRunError("nonzero-exit-or-unverified-stream", snapshot()));
      try { accept(extractClaude(events, model)); } catch { reject(new ClaudeRunError("model-tools-mcp-or-result-contract-rejected", snapshot())); }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(prompt.input), () => { diagnostics.stdinWriteFinished = true; });
  });
  return { id: prompt.id, runtime: { provider: "claude", model: parsed.observedModel, version: parsed.cliVersion, settingsFingerprint: "tools-none+strict-empty-mcp+safe-mode+no-session+dontAsk-v1", existingSelectionVerified: true, noFallback: true, toolFreeEnforced: true, isolationEvidence: "Installed Claude help confirms --tools empty and strict MCP; stream init confirmed exact model, tools=[],mcp_servers=[]; safe-mode disables customizations, hooks and plugins; no fallback argument. Selected model supplied from parent read-only bot metadata." }, output: parsed.output, latencyMs: Math.round(performance.now() - started), usage: parsed.usage, toolAttempts: parsed.toolAttempts, providerUsageDetails: parsed.providerUsageDetails, executionDiagnostics: snapshot() };
}

async function main() {
  const [executable, model, target, mode = "pilot", baselinePath] = process.argv.slice(2);
  if (!executable || !isAbsolute(executable) || !model || !target || !["pilot", "full"].includes(mode)) throw new Error("Explicit executable/model/output and pilot|full required.");
  const plan = makePlan(baselinePath ? readFileSync(baselinePath, "utf8") : undefined);
  const prompts = mode === "pilot" ? plan.prompts.filter(prompt => prompt.repeat === 1 && ["critical-deadline", "promo-false-urgency"].includes(prompt.caseId)) : plan.prompts;
  const cwd = mkdtempSync(join(tmpdir(), "chief-synthetic-mail-"));
  const records: Awaited<ReturnType<typeof executePrompt>>[] = [];
  let attempted = 0;
  const base = { version: VERSION, planHash: plan.planHash, syntheticOnly: true, realModel: true };
  const save = (status: string, failure: string | null, failureDiagnostics: ExecutionDiagnostics | null = null) => {
    mkdirSync(dirname(resolve(target)), { recursive: true });
    const responseSet = { ...base, records: records.map(({ providerUsageDetails: _details, executionDiagnostics: _diagnostics, ...record }) => record) };
    writeFileSync(target, `${JSON.stringify({ status, roleProvenance: plan.roleProvenance, responseSet, providerUsageDetails: records.map(record => ({ id: record.id, usage: record.providerUsageDetails })), executionDiagnostics: records.map(record => ({ id: record.id, ...record.executionDiagnostics })), failure, failureDiagnostics, cliTurnsAttempted: attempted, successfulModelOutputs: records.length, fixtureRemoved: false }, null, 2)}\n`);
  };
  try {
    for (const prompt of prompts) {
      attempted++;
      save("in-progress", null);
      records.push(await executePrompt(executable, model, prompt, cwd));
      save("in-progress", null);
      console.log(JSON.stringify({ turn: prompt.id, completed: records.length, planned: prompts.length }));
    }
    save(mode === "pilot" ? "pilot-only-not-full-acceptance" : "completed", null);
  } catch (error) {
    save("blocked", `${error instanceof ClaudeRunError ? error.category : "execution-failed"}. No retry, fallback, credential or configuration change attempted.`, error instanceof ClaudeRunError ? error.diagnostics ?? null : null);
    process.exitCode = 1;
  } finally {
    const artifact = JSON.parse(readFileSync(target, "utf8"));
    try { rmSync(cwd, { recursive: true, force: true }); artifact.fixtureRemoved = true; }
    catch { artifact.fixtureRemoved = false; artifact.cleanupFailure = "Temporary fixture removal failed. No alternate removal method attempted."; process.exitCode = 1; }
    writeFileSync(target, `${JSON.stringify(artifact, null, 2)}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error("Synthetic Claude runner failed; private diagnostics are not logged."); process.exitCode = 1; });
