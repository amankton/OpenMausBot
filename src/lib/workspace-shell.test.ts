import { describe, expect, it } from "vitest";
import { workspaceSlot } from "./workspace-shell";

describe("workspace top bar slot", () => {
  it("accepts a compact slot within the native top bar", () => {
    expect(workspaceSlot({ x: 16, y: 2, width: 112, height: 32 }, 390)).toEqual({ x: 16, y: 2, width: 112, height: 32 });
  });
  it.each([
    null, {}, { x: 0, y: 0, width: "112", height: 32 },
    { x: 0, y: 100, width: 112, height: 32 }, { x: -1, y: 0, width: 112, height: 32 },
    { x: 0, y: 0, width: 1000, height: 1000 }, { x: NaN, y: 0, width: 112, height: 32 },
    { x: 16, y: 2, width: 112, height: 32 },
  ])("rejects malformed, oversized or offscreen slots", value => {
    expect(workspaceSlot(value, 100)).toBeNull();
  });
});
