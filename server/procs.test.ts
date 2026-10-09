import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTempDir } from "./testing/cleanup.ts";

import {
  assertSafeCliArgv,
  describeSpawnFailure,
  estimatedWindowsCommandLineChars,
  WINDOWS_SAFE_COMMAND_LINE_CHARS,
  execCli,
  spawnCli,
} from "./procs.ts";

describe("Windows CLI argument safety", () => {
  it("accepts ordinary launches", () => {
    const resolved = { command: "agy.exe", args: ["--model", "gemini-3.1-pro-high"] };
    expect(estimatedWindowsCommandLineChars(resolved)).toBeLessThan(WINDOWS_SAFE_COMMAND_LINE_CHARS);
    expect(() => assertSafeCliArgv(resolved, "win32")).not.toThrow();
  });

  it("rejects a prompt-sized argv before CreateProcess can fail opaquely", () => {
    const resolved = { command: "agy.exe", args: ["--print", "x".repeat(40_000)] };
    expect(() => assertSafeCliArgv(resolved, "win32")).toThrow(
      /pass large prompts through stdin or a file/,
    );
    try {
      assertSafeCliArgv(resolved, "win32");
    } catch (error) {
      expect((error as NodeJS.ErrnoException).code).toBe("ENAMETOOLONG");
    }
  });

  it("does not impose the Windows limit on other platforms", () => {
    const resolved = { command: "agy", args: ["--print", "x".repeat(40_000)] };
    expect(() => assertSafeCliArgv(resolved, "linux")).not.toThrow();
  });

  it("turns ENAMETOOLONG into an actionable message without echoing argv", () => {
    const error = Object.assign(new Error("private prompt contents"), { code: "ENAMETOOLONG" });
    const failure = describeSpawnFailure(error, "agy");
    expect(failure).toEqual({
      message: "`agy` received too much launch data for Windows; update this provider or pass its prompt through stdin/a file",
      setup: false,
    });
    expect(failure.message).not.toContain("private prompt contents");
  });
});

describe.skipIf(process.platform !== "win32")("Windows CLI execution", () => {
  it("reports synchronous batch launch failures through the callback", async () => {
    const dir = mkdtempSync(join(tmpdir(), "chief-procs-"));
    try {
      const cli = join(dir, "unsupported.cmd");
      writeFileSync(cli, "@echo off\nunknown-wrapper %*\n");
      const error = await new Promise<Error | null>((resolve) => {
        expect(() => execCli(cli, ["--version"], {}, (err) => resolve(err))).not.toThrow();
      });
      expect((error as NodeJS.ErrnoException).code).toBe("EINVAL");
      expect(describeSpawnFailure(error!, cli).message).toContain("supported CLI launcher");
    } finally { await removeTempDir(dir); }
  });

  it("uses the supplied environment for both probes and turns, preserving Windows argv", async () => {
    const dir = mkdtempSync(join(tmpdir(), "chief-procs-"));
    try {
      writeFileSync(join(dir, "fixture.cmd"), '@echo off\n"%~dp0fixture.js" %*\n');
      writeFileSync(join(dir, "fixture.js"), "console.log(JSON.stringify(process.argv.slice(2)))");
      const args = ["", 'a "quoted" value', "C:\\with space\\", "%PATH%", "!VALUE!", "&|^<>"];
      const env = { ...process.env, PATH: dir, PATHEXT: ".CMD" };
      const out = await new Promise<string>((resolve, reject) => execCli("fixture", args, { env }, (err, stdout) => err ? reject(err) : resolve(stdout)));
      expect(JSON.parse(out)).toEqual(args);
      const child = spawnCli("fixture", args, { env, stdio: "pipe" });
      let output = "";
      child.stdout.on("data", (data) => { output += data; });
      await new Promise<void>((resolve, reject) => { child.on("error", reject); child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`exit ${code}`))); });
      expect(JSON.parse(output)).toEqual(args);
    } finally { await removeTempDir(dir); }
  });
});
