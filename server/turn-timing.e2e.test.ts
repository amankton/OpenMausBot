import { readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";

it("records bounded timing metadata for real fixture chat turns without retaining content", async () => {
  const fixture = await launchVerificationServer();
  const evidence: unknown[] = [{ fixture: fixture.info }];
  const control = async (args: string[]) => {
    const result = await runControlOmb([...args, "--url", fixture.info.url]);
    evidence.push({ command: args, result });
    return result;
  };
  const records = () => readFileSync(fixture.info.logPath, "utf8").split(/\r?\n/)
    .filter(line => line.startsWith("[turn-timing] ")).map(line => JSON.parse(line.slice("[turn-timing] ".length)));
  try {
    const { bot } = await control(["new-bot", "--name", "Timing fixture"]) as { bot: { id: string } };
    for (const text of ["timing-secret-canary-first", "timing-secret-canary-second"]) {
      await control(["send", "--bot", bot.id, "--text", text]);
      const result = await control(["wait", "--bot", bot.id, "--timeout", "30"]);
      expect(result).toMatchObject({ status: "settled", messages: expect.arrayContaining([
        expect.objectContaining({ role: "bot", text: "hello from fake claude" }),
      ]) });
      await control(["messages", "--bot", bot.id, "--limit", "10"]);
    }
    await expect.poll(() => records().filter(record => record.outcome === "completed").length).toBe(2);
    const rows = records();
    expect(rows).toHaveLength(2);
    expect(rows[0].trace).not.toBe(rows[1].trace);
    for (const row of rows) {
      expect(row).toMatchObject({ outcome: "completed", setupMs: expect.any(Number),
        runtimeMs: expect.any(Number), firstTextAfterDispatchMs: expect.any(Number) });
      expect(row.totalMs).toBeGreaterThanOrEqual(row.setupMs);
      expect(row.runtimeMs).toBeGreaterThanOrEqual(row.firstTextAfterDispatchMs);
      expect(row.events).toBeGreaterThan(0);
      expect(Object.values(row).every(value => typeof value === "number" || value === null || value === "completed")).toBe(true);
    }
    expect(JSON.stringify(rows)).not.toContain("timing-secret-canary");
    expect(JSON.stringify(rows)).not.toContain("hello from fake claude");
    evidence.push({ timings: rows });
  } finally {
    const evidencePath = `${fixture.info.logPath}.timing.json`;
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    console.info(JSON.stringify({ evidencePath }));
    await fixture.close();
  }
}, 60_000);
