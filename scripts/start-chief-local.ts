// Resume only the saved workspace. The preview launcher retains its PID/data lease guards.
import { appendFileSync, closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertChiefUiBuild } from "./chief-ui-build.ts";

const PREVIEW_URL = "http://127.0.0.1:5299";

export async function chiefIsHealthy(url = PREVIEW_URL, timeoutMs = 5000): Promise<boolean> {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
    return response.ok && (await response.json()).app === "openmausbot";
  } catch { return false; }
}

export function chiefPortAvailable(port = 5299): Promise<boolean> {
  return new Promise((done) => {
    const server = createServer();
    server.once("error", () => done(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => server.close(() => done(true)));
  });
}

export async function launchSavedChief(root: string, args: string[]): Promise<number> {
  const stamp = `${Date.now()}-${process.pid}`;
  const output = openSync(join(root, ".chief-local", `startup-${stamp}.log`), "a");
  let error: number | undefined;
  try {
    error = openSync(join(root, ".chief-local", `startup-${stamp}-error.log`), "a");
    const child = spawn(process.execPath, ["--experimental-strip-types", join(root, "scripts/chief-preview.ts"), ...args], {
      cwd: root, windowsHide: true, stdio: ["ignore", output, error],
    });
    const stop = () => { child.kill("SIGTERM"); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
      return await new Promise<number>((done, reject) => {
        child.once("error", reject);
        child.once("exit", (code) => done(code ?? 1));
      });
    } finally {
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
    }
  } finally {
    closeSync(output);
    if (error !== undefined) closeSync(error);
  }
}

export async function startChiefLocal(
  options: { root: string; checkOnly?: boolean; development?: boolean },
  dependencies = { healthy: chiefIsHealthy, portAvailable: chiefPortAvailable, launch: launchSavedChief },
): Promise<{ status: "ready" | "running" | "exited"; url: string; dataDir: string; exitCode: number }> {
  const { root, checkOnly, development } = options;
  const runtime = join(root, ".chief-local");
  const manifest = join(runtime, "preview.json");
  if (!existsSync(manifest)) throw new Error("Existing Chief preview manifest is required.");
  const saved = JSON.parse(readFileSync(manifest, "utf8"));
  if (typeof saved.dataDir !== "string" || !isAbsolute(saved.dataDir)) throw new Error("Saved Chief data path must be absolute.");
  for (const required of ["config.json", "bots.json"]) {
    if (!existsSync(join(saved.dataDir, required))) throw new Error(`Saved Chief data is not visible: ${required}. Check the saved path before restoring any data.`);
  }
  if (saved.previewUrl !== PREVIEW_URL) throw new Error("Unexpected Chief preview address.");
  if (!development) assertChiefUiBuild(root);
  const result = { url: saved.previewUrl as string, dataDir: saved.dataDir as string, exitCode: 0 };
  if (checkOnly) return { ...result, status: "ready" };
  const log = (message: string) => appendFileSync(join(runtime, "startup-supervisor.log"), `${new Date().toISOString()} ${message}\n`);
  log("Checking saved workspace health.");
  if (await dependencies.healthy()) {
    log("Existing Chief is healthy; no duplicate started.");
    return { ...result, status: "running" };
  }
  if (!(await dependencies.portAvailable())) throw new Error("Port 5299 is occupied but Chief is not healthy. No existing process was stopped.");
  const args: string[] = [];
  if (development) args.push("--dev");
  if (saved.media === "local LiveKit") args.push("--with-local-media");
  if (saved.pairingOrigin) args.push("--with-chief-pairing");
  log("Starting saved workspace.");
  const exitCode = await dependencies.launch(root, args);
  log(`Saved workspace launcher exited (${exitCode}).`);
  return { ...result, status: "exited", exitCode };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const flags = process.argv.slice(2);
    if (flags.some(flag => !["--check", "--dev"].includes(flag))) throw new Error("Usage: start-chief-local.ts [--check] [--dev]");
    const result = await startChiefLocal({ root: fileURLToPath(new URL("..", import.meta.url)), checkOnly: flags.includes("--check"), development: flags.includes("--dev") });
    console.log(JSON.stringify(result));
    process.exitCode = result.exitCode;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Chief startup failed.");
    process.exitCode = 1;
  }
}
