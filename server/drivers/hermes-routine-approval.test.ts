import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { hermesRoutineMcp, hermesRoutineNative } from "./hermes-routine-approval.ts";
import { removeTempDir } from "../testing/cleanup.ts";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await removeTempDir(root); });
const turn = { threadId: "t", text: "work", approvalMode: "auto" as const };

it("requires both explicit opt-in and the source conversation's Auto mode", () => {
  expect(hermesRoutineNative(turn, false, "read_file", {})).toBe(false);
  expect(hermesRoutineNative({ ...turn, approvalMode: "ask" }, true, "read_file", {})).toBe(false);
  expect(hermesRoutineNative(turn, true, "read_file", {})).toBe(true);
  for (const tool of ["send_email", "memory", "cronjob", "execute_code", "ask_user", "mcp_read_file"]) {
    expect(hermesRoutineNative(turn, true, tool, {})).toBe(false);
  }
});

it("allows document work only inside the current workspace, excluding config and instruction files", () => {
  const root = mkdtempSync(join(tmpdir(), "chief-routine-")); roots.push(root);
  mkdirSync(join(root, "outputs"));
  const t = { ...turn, cwd: root };
  expect(hermesRoutineNative(t, true, "write_file", { path: join(root, "outputs", "draft.html") })).toBe(true);
  writeFileSync(join(root, "draft.md"), "old");
  expect(hermesRoutineNative(t, true, "patch", { path: join(root, "draft.md"), old_string: "old", new_string: "new" })).toBe(true);
  for (const path of [join(root, "..", "outside.md"), join(root, ".config", "policy.md"), join(root, "AGENTS.md"), join(root, "SOUL.md"), join(root, "config.json"), join(root, "run.ps1"), "relative.md"]) {
    expect(hermesRoutineNative(t, true, "write_file", { path })).toBe(false);
  }
  expect(hermesRoutineNative(t, true, "patch", { mode: "patch", patch: "*** Delete File: draft.md" })).toBe(false);
  expect(hermesRoutineNative(turn, true, "write_file", { path: join(root, "draft.md") })).toBe(false);
  const outside = mkdtempSync(join(tmpdir(), "chief-outside-")); roots.push(outside);
  symlinkSync(outside, join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
  expect(hermesRoutineNative(t, true, "write_file", { path: join(root, "linked", "draft.md") })).toBe(false);
});

it("does not infer command safety from prefixes or a benign description", () => {
  expect(hermesRoutineNative(turn, true, "terminal", { command: "git status --short" })).toBe(true);
  for (const command of ["git status --short; rm -rf .", "pwd\nwhoami", "curl https://example.com", "python build.py", "git push", "echo safe > config.json"]) {
    expect(hermesRoutineNative(turn, true, "terminal", { command, description: "safe routine" })).toBe(false);
  }
});

it("uses original built-in identities and preserves computer, external and destructive checkpoints", () => {
  const id = (server: string, name: string, builtIn = true) => ({ server, name, builtIn });
  expect(hermesRoutineMcp(turn, true, id("agents", "coordinate_bots"))).toBe(true);
  expect(hermesRoutineMcp(turn, true, id("agents", "attach_file"))).toBe(true);
  expect(hermesRoutineMcp(turn, true, id("agents", "list_bots", false))).toBe(false);
  expect(hermesRoutineMcp(turn, true, id("evil", "agents_list_bots", false))).toBe(false);
  expect(hermesRoutineMcp(turn, true, id("computer", "get_window_state"))).toBe(true);
  const local = { ...turn, integrations: { localComputer: { command: "node", args: [], env: {}, scope: "local-computer" as const } } };
  expect(hermesRoutineMcp(local, true, id("computer", "get_window_state"))).toBe(false);
  for (const [server, name] of [["agents", "delete_bot"], ["agents", "vm_exec"], ["agents", "propose_routine"], ["computer", "click"], ["composio", "send_email"], ["browser", "agent_browser_click"]]) {
    expect(hermesRoutineMcp(turn, true, id(server, name))).toBe(false);
  }
});
