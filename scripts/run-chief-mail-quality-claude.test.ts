import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { claudeArgs, executePrompt, extractClaude } from "./run-chief-mail-quality-claude.ts";
import { makePlan } from "./verify-chief-mail-quality.ts";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

const events = () => [
  { type: "system", subtype: "init", model: "preserved-model", tools: [], mcp_servers: [], claude_code_version: "fixture-only" },
  { type: "result", subtype: "success", is_error: false, result: '{"synthetic":"contract-only"}', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2, cache_creation_input_tokens: 3 }, total_cost_usd: 0.01, modelUsage: { "preserved-model": {} } },
];

describe("Claude tool-free runner contract (no real model calls)", () => {
  it("passes enforced no-tools/no-MCP/no-persistence guards and exact model without fallback", () => {
    const args = claudeArgs(makePlan().prompts[0], "preserved-model");
    expect(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2)).toEqual(["--tools", ""]);
    expect(args).toContain("--safe-mode");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain('{"mcpServers":{}}');
    expect(args).toContain("--no-session-persistence");
    expect(args).toContain("--disable-slash-commands");
    expect(args).toContain("--no-chrome");
    expect(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2)).toEqual(["--model", "preserved-model"]);
    expect(args).not.toContain("--fallback-model");
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  it("accepts only observed empty tools/MCP and provider-reported usage", () => {
    expect(extractClaude(events(), "preserved-model")).toMatchObject({ observedModel: "preserved-model", cliVersion: "fixture-only", toolAttempts: [], usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.01, source: "provider" }, providerUsageDetails: { inputTokens: 10, cacheReadInputTokens: 2, cacheCreationInputTokens: 3 } });
  });

  it.each(["missing-init", "wrong-model", "tools", "mcp", "error", "tool-attempt", "fallback-usage"])("rejects unsupported execution evidence: %s", mutation => {
    const data: Record<string, unknown>[] = events();
    if (mutation === "missing-init") data.shift();
    if (mutation === "wrong-model") data[0].model = "different-model";
    if (mutation === "tools") data[0].tools = ["Bash"];
    if (mutation === "mcp") data[0].mcp_servers = [{ name: "mail" }];
    if (mutation === "error") data[1].is_error = true;
    if (mutation === "tool-attempt") data.splice(1, 0, { type: "assistant", message: { content: [{ type: "tool_use", name: "send-mail" }] } });
    if (mutation === "fallback-usage") data[1].modelUsage = { "another-model": {} };
    expect(() => extractClaude(data, "preserved-model")).toThrow();
  });

  it("keeps unreported tokens/cost unavailable", () => {
    const data = events() as Record<string, unknown>[];
    delete data[1].usage;
    delete data[1].total_cost_usd;
    expect(extractClaude(data, "preserved-model").usage).toBeNull();
  });

  it("waits for child close after a timeout before allowing fixture cleanup", async () => {
    vi.useFakeTimers();
    try {
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: vi.fn(() => true) });
      vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
      let settled = false;
      const pending = executePrompt("fixture-executable", "preserved-model", makePlan().prompts[0], "fixture-cwd").catch(error => { settled = true; return error as Error; });
      await vi.advanceTimersByTimeAsync(180000);
      expect(child.kill).toHaveBeenCalledTimes(1);
      expect(settled).toBe(false);
      child.emit("close", 1);
      const result = await pending;
      expect(result).toBeInstanceOf(Error);
      if (!(result instanceof Error)) throw new Error("Expected timeout failure.");
      expect(result.message).toBe("180-second-timeout-no-verifiable-result");
      expect(result).toMatchObject({ diagnostics: { timedOut: true, stdoutBytes: 0, stderrBytes: 0, initObserved: false, closeObserved: true, closeCode: 1 } });
      expect(settled).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it("retains startup/byte/exit facts without retaining raw diagnostic text", async () => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: vi.fn(() => true) });
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const pending = executePrompt("fixture-executable", "preserved-model", makePlan().prompts[0], "fixture-cwd").catch(error => error as Error);
    child.emit("spawn");
    child.stderr.write("synthetic-private-diagnostic");
    child.emit("exit", 7, null);
    child.emit("close", 7);
    const result = await pending;
    expect(result).toMatchObject({ diagnostics: { spawnObserved: true, stdoutBytes: 0, stderrBytes: 28, initObserved: false, exitObserved: true, exitCode: 7, closeObserved: true, closeCode: 7, timedOut: false } });
    expect(JSON.stringify(result)).not.toContain("synthetic-private-diagnostic");
  });
});
