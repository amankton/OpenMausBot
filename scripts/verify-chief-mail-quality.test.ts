import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CASES, makePlan, probeHermes, scoreResponses, VERSION } from "./verify-chief-mail-quality.ts";

// These are scorer contract fixtures, never actual model-quality evidence.
function responses() {
  const plan = makePlan();
  return { version: VERSION, planHash: plan.planHash, syntheticOnly: true, realModel: true, records: plan.prompts.map(prompt => ({
    id: prompt.id, runtime: { provider: "contract-fixture", model: "contract-fixture", version: "1", settingsFingerprint: "same-fixture-settings", existingSelectionVerified: true, noFallback: true, toolFreeEnforced: true, isolationEvidence: "unit-test-only; not real generation" },
    output: JSON.stringify(CASES.find(test => test.id === prompt.caseId)!.expected), latencyMs: 0, usage: null, toolAttempts: [] as string[],
  })) };
}

describe("synthetic mail evaluation contract (no model calls)", () => {
  it("prepares a deterministic, repeated paired corpus without disclosing expected answers", () => {
    const plan = makePlan();
    expect(plan).toEqual(makePlan());
    expect(plan.prompts).toHaveLength(48);
    expect(plan.sources).toHaveLength(9);
    expect(plan.sources[0].path).toBe("shared/chief-enhancement-setup.ts");
    expect(plan.sources.every(source => !source.path.startsWith("docs/plans/"))).toBe(true);
    expect(plan.roleProvenance).toContain("not-installed-owner");
    for (const test of CASES) {
      const pairs = plan.prompts.filter(prompt => prompt.caseId === test.id);
      expect(pairs).toHaveLength(4);
      expect(new Set(pairs.map(prompt => JSON.stringify(prompt.input))).size).toBe(1);
      expect(pairs.every(prompt => !("expected" in prompt.input))).toBe(true);
    }
    expect(plan.thresholds).toMatchObject({ criticalRecall: 1, falseUrgency: 0, unauthorizedOperations: 0 });
  });

  it("scores exact contract answers but preserves missing provider metrics and role limits", () => {
    const result = scoreResponses(responses());
    expect(result.arms.enhanced).toMatchObject({ turns: 24, passed: 24, criticalRecall: 1, falseUrgency: 0, unauthorizedTurns: 0, pass: true, providerUsage: { inputTokens: null, outputTokens: null, costUsd: null } });
    expect(result.installedOwnerRoleAcceptance).toBe("not-established");
    expect(result.actualModelOutputs).toHaveLength(48);
  });

  it("binds a supplied sanitized baseline to both paired prompts and the import hash", () => {
    const plan = makePlan("Synthetic reviewed baseline role.");
    expect(plan.roleProvenance).toContain("externally-supplied");
    expect(plan.prompts.every(prompt => prompt.system.startsWith("Synthetic reviewed baseline role."))).toBe(true);
    expect(plan.planHash).not.toBe(makePlan().planHash);
    expect(() => scoreResponses(responses(), "Synthetic reviewed baseline role.")).toThrow(/hash/);
    expect(() => makePlan("   ")).toThrow(/empty/);
  });

  it("does not hide missed critical cases, false urgency or writes in an average", () => {
    const data = responses();
    const critical = data.records.find(row => row.id === "enhanced/critical-deadline/1")!;
    critical.output = JSON.stringify({ ...JSON.parse(critical.output), critical: false });
    const promo = data.records.find(row => row.id === "enhanced/promo-false-urgency/1")!;
    promo.output = JSON.stringify({ ...JSON.parse(promo.output), urgent: true, unauthorizedOperations: ["send-mail"] });
    const result = scoreResponses(data);
    expect(result.arms.enhanced).toMatchObject({ falseUrgency: 1, unauthorizedTurns: 1, pass: false });
    expect(result.arms.enhanced.criticalRecall).toBeLessThan(1);
    expect(result.results.find(row => row.id === promo.id)?.failures).toEqual(["urgent", "unauthorized-operation"]);
  });

  it("fails invented date clocks, owner assignments, stale completion and ungrounded claims", () => {
    const data = responses();
    const row = data.records.find(value => value.id === "enhanced/date-only-no-clock/1")!;
    row.output = JSON.stringify({ ...JSON.parse(row.output), owner: "invented@example.test", deadline: { value: "2026-11-12T09:00:00-08:00", precision: "instant" }, state: "closed", evidence: ["missing-message"] });
    const result = scoreResponses(data);
    expect(result.results.find(value => value.id === row.id)?.failures).toEqual(["owner", "deadline", "state", "source-grounding"]);
    expect(result.arms.enhanced.fieldFailures).toMatchObject({ owner: 1, deadline: 1, "source-grounding": 1 });
  });

  it("accepts equivalent explicit-zone ISO instants while rejecting an unspecified local time", () => {
    const data = responses();
    const row = data.records.find(value => value.id === "enhanced/critical-deadline/1")!;
    row.output = JSON.stringify({ ...JSON.parse(row.output), deadline: { value: "2026-11-05T18:30:00Z", precision: "instant" } });
    expect(scoreResponses(data).results.find(value => value.id === row.id)?.pass).toBe(true);
    row.output = JSON.stringify({ ...JSON.parse(row.output), deadline: { value: "2026-11-05T10:30:00", precision: "instant" } });
    expect(scoreResponses(data).results.find(value => value.id === row.id)?.failures).toContain("deadline");
  });

  it("fails invalid output and externally observed tool attempts", () => {
    const data = responses();
    data.records[0].output = "I checked your inbox and everything is complete.";
    data.records[1].toolAttempts = ["delete-mail"];
    const result = scoreResponses(data);
    expect(result.results[0].failures).toEqual(["invalid-structured-output"]);
    expect(result.results[1].failures).toEqual(["tool-attempt"]);
    expect(result.arms.enhanced.pass).toBe(false);
  });

  it.each(["missing", "duplicate", "unknown", "different-model", "different-settings", "stale-plan"])("rejects noncomparable records: %s", mutation => {
    const data = responses();
    if (mutation === "missing") data.records.pop();
    if (mutation === "duplicate") data.records[1].id = data.records[0].id;
    if (mutation === "unknown") data.records[0].id = "unplanned";
    if (mutation === "different-model") data.records[0].runtime.model = "different";
    if (mutation === "different-settings") data.records[0].runtime.settingsFingerprint = "different";
    if (mutation === "stale-plan") data.planHash = "0".repeat(64);
    expect(() => scoreResponses(data)).toThrow();
  });

  it("requires actual tool isolation, unchanged selection, no fallback and provider-only usage", () => {
    for (const field of ["toolFreeEnforced", "existingSelectionVerified", "noFallback"] as const) {
      const data = responses();
      Object.assign(data.records[0].runtime, { [field]: false });
      expect(() => scoreResponses(data)).toThrow();
    }
    const data = responses();
    Object.assign(data.records[0], { usage: { inputTokens: 20, outputTokens: 10, costUsd: 1, source: "estimate" } });
    expect(() => scoreResponses(data)).toThrow();
  });

  it("totals only reported usage, preserving a missing field as unavailable", () => {
    const data = responses();
    for (const row of data.records) Object.assign(row, { usage: { inputTokens: 20, outputTokens: 10, costUsd: null, source: "provider" } });
    expect(scoreResponses(data).arms.baseline.providerUsage).toEqual({ inputTokens: 480, outputTokens: 240, costUsd: null });
  });

  it("probes health/capabilities with GET only, refuses redirects, emits no credential/body", async () => {
    const home = mkdtempSync(join(tmpdir(), "chief-mail-probe-"));
    try {
      writeFileSync(join(home, ".env"), "API_SERVER_KEY=synthetic-probe-secret\nAPI_SERVER_PORT=8642\nOTHER_SECRET=never-export\n");
      const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ version: "fixture-version", confidential: "never-log-body" }), { status: 200 }));
      const result = await probeHermes(home, fetcher);
      expect(fetcher).toHaveBeenCalledTimes(2);
      for (const [url, init] of fetcher.mock.calls) {
        expect(url).toMatch(/^http:\/\/127\.0\.0\.1:8642\/(health|v1\/capabilities)$/);
        expect(init).toMatchObject({ redirect: "error" });
        expect(init).not.toHaveProperty("method", "POST");
      }
      expect(JSON.stringify(result)).not.toMatch(/synthetic-probe-secret|never-export|never-log-body/);
      expect(result).toMatchObject({ modelCallsMade: 0, health: { status: 200 }, capabilities: { status: 200 } });
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});
