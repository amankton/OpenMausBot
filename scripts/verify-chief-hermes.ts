// Opt-in installed-CLI smoke. No chat turn, login, or owner configuration writes.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchVerificationServer, verificationServerEnvironment } from "./control-omb.ts";
import { execCli, resolveCli } from "../server/procs.ts";

const cli = process.argv[2];
assert(cli && process.platform === "win32", "Pass the installed Hermes launcher path on Windows");
const digest = () => createHash("sha256").update(readFileSync(cli)).digest("hex");
const before = digest();
const fixture = await launchVerificationServer();
try {
  const env = verificationServerEnvironment(process.env, fixture.info.dataDir, Number(new URL(fixture.info.url).port));
  const run = (command: string, args: string[], childEnv = env) => new Promise<string>((resolve, reject) =>
    execCli(command, args, { env: childEnv, timeout: 30000, maxBuffer: 65536 }, (error, stdout) => error ? reject(new Error(`CLI probe failed (${String((error as NodeJS.ErrnoException).code)})`)) : resolve(stdout.trim())));
  const resolved = resolveCli(cli, ["--version"], env);
  assert.match(resolved.command, /python[\d.]*\.exe$/i);
  const runtime: unknown = JSON.parse(await run(cli, ["--print-runtime-command", "--", "--version"]));
  assert(Array.isArray(runtime) && runtime.length > 1 && runtime.every(value => typeof value === "string"));
  // Version-only check in the installed runtime's existing home. No login/turn.
  const nativeVersion = await run(runtime[0], runtime.slice(1), process.env);
  assert.match(nativeVersion, /hermes/i);

  // The route runs the published wrapper shape with real Python in an empty
  // fixture home. Hermes dependency state itself lives in its existing home.
  const echo = join(fixture.info.dataDir, "Hermes argv fixture.cmd");
  const wrapper = (payload: string) => `@echo off\r\n"${resolved.command}" -I -c "import base64; exec(base64.b64decode('${payload}'))" %*\r\n`;
  writeFileSync(echo, wrapper(Buffer.from("print('Hermes fixture 1.0.0')").toString("base64")));
  const response = await fetch(`${fixture.info.url}/api/cli-test`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ cli: echo, driver: "hermesAgent" }),
  });
  const probe = await response.json();
  assert.equal(response.status, 200);
  assert.equal(probe.ok, true, JSON.stringify(probe));
  assert.match(probe.version, /hermes/i);

  // Actual Python process verifies quotes, trailing slashes, empty strings
  // and shell metacharacters survive the recognized wrapper as literal argv.
  const payload = Buffer.from("import json, sys; print(json.dumps(sys.argv[1:]))").toString("base64");
  writeFileSync(echo, wrapper(payload));
  const args = ["", 'a "quoted" value', "C:\\path with spaces\\", "%PATH%", "!VALUE!", "&|^<>"];
  assert.deepEqual(JSON.parse(await run(echo, args)), args);
  assert.equal(digest(), before, "Installed launcher changed during verification; retry after installer completes");
  const evidence = { checkedAt: new Date().toISOString(), fixtureUrl: fixture.info.url, logPath: fixture.info.logPath,
    launcherHash: before, nativeRuntimeProtocol: true, version: nativeVersion.split(/\r?\n/)[0],
    syntheticManagedAccountsProbe: probe.ok, windowsArgvPreserved: true, isolatedServerHome: true, installedVersionUsesExistingHermesHome: true, paidCalls: 0 };
  writeFileSync(new URL("../docs/verification/evidence/chief-hermes.json", import.meta.url), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally { await fixture.close(); }
