import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { removeTempDir } from "../../testing/cleanup.ts";
import { probeHermesVersion } from "./hermes.ts";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await removeTempDir(dir);
});

function fixture(mode: "supported" | "legacy" | "broken") {
  const dir = mkdtempSync(join(tmpdir(), "hermes-version-"));
  dirs.push(dir);
  const cli = join(dir, "hermes.mjs");
  const calls = join(dir, "calls.jsonl");
  writeFileSync(cli, `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.PROBE_CALLS, JSON.stringify(args) + '\\n');
if (process.env.PROBE_MODE === 'broken') { console.error('runtime failed'); process.exit(1); }
if (process.env.PROBE_MODE === 'legacy' && args.includes('--no-update-check')) {
  console.error('hermes: error: unrecognized arguments: --no-update-check'); process.exit(2);
}
console.log('Hermes Agent v0.22.0');
`);
  chmodSync(cli, 0o755);
  return {
    cli, env: { ...process.env, PROBE_MODE: mode, PROBE_CALLS: calls },
    calls: () => readFileSync(calls, "utf8").trim().split("\n").map((line) => JSON.parse(line)),
  };
}

it("checks the actual executable with updates disabled", async () => {
  const f = fixture("supported");
  expect(await probeHermesVersion(f.cli, f.env)).toBe("Hermes Agent v0.22.0");
  expect(f.calls()).toEqual([["--version", "--no-update-check"]]);
});

it("preserves older launchers that explicitly reject the new option", async () => {
  const f = fixture("legacy");
  expect(await probeHermesVersion(f.cli, f.env)).toBe("Hermes Agent v0.22.0");
  expect(f.calls()).toEqual([["--version", "--no-update-check"], ["--version"]]);
});

it("does not claim availability or retry a broken runtime", async () => {
  const f = fixture("broken");
  expect(await probeHermesVersion(f.cli, f.env)).toBeNull();
  expect(f.calls()).toHaveLength(1);
});
