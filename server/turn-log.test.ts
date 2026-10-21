import { describe, expect, it } from "vitest";
import { turnStartLogLine } from "./turn-log.ts";

describe("turnStartLogLine", () => {
  const turn = { botId: "bot-1", text: "what is six times seven", images: 0, depth: 0, card: false };

  it("logs size without private prompt contents", () => {
    expect(turnStartLogLine({ ...turn, spoken: false })).toBe(
      '[omb-turn] bot=bot-1 text=(private:23 chars) images=0 depth=0 card=false',
    );
    expect(turnStartLogLine({ ...turn, text: "x".repeat(200), spoken: false })).toContain('text=(private:200 chars) ');
  });

  it("never logs words spoken on a Live call", () => {
    const line = turnStartLogLine({ ...turn, images: 1, depth: 0, card: true, spoken: true });
    expect(line).not.toContain("six times seven");
    expect(line).toBe("[omb-turn] bot=bot-1 text=(spoken) images=1 depth=0 card=true");
  });
});
