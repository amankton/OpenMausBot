import { mkdirSync, readFileSync, writeFileSync, existsSync, openSync, closeSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, resolve, relative, basename, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "vite";
import { launchVerificationServer, verificationServerEnvironment, type VerificationServer } from "./control-omb.ts";
import { freePortBlock } from "../server/testing/ports.ts";
import { waitForExit } from "../server/testing/cleanup.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const runtime = join(root, ".chief-local");
mkdirSync(runtime, { recursive: true });
const mediaFile = join(runtime, "media.json");
const media = process.argv.includes("--with-local-media") && existsSync(mediaFile)
  ? JSON.parse(readFileSync(mediaFile, "utf8")) as { url: string; key: string; secret: string } : undefined;
if (media && !/^ws:\/\/127\.0\.0\.1:\d{1,5}$/.test(media.url)) throw new Error("Chief preview media must be the owned loopback development server");
const manifestPath = join(runtime, "preview.json");
let fixture: Pick<VerificationServer, "info" | "child">;
const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;
const pairingOrigin = process.argv.includes("--with-chief-pairing") ? "http://localhost:18087" : previous?.pairingOrigin;
if (pairingOrigin && pairingOrigin !== "http://localhost:18087") throw new Error("Local Chief pairing must use its existing loopback workspace");
if (pairingOrigin && !previous) throw new Error("Enable pairing only after the local Chief preview has been created");
// Explicitly reuse Hermes' installed dependency/login home without copying it.
const hermesHomeIndex = process.argv.indexOf("--hermes-home");
const hermesHome = hermesHomeIndex >= 0 ? process.argv[hermesHomeIndex + 1] : previous?.hermesHome;
if (hermesHomeIndex >= 0 && !hermesHome) throw new Error("--hermes-home requires an existing Hermes home");
if (hermesHome && (!isAbsolute(hermesHome) || !existsSync(join(hermesHome, "installs")))) throw new Error("Hermes home must be an absolute path with installed dependency state");
if (hermesHome && !previous) throw new Error("Configure local Hermes only after the initial isolated Chief preview exists");
if (previous && existsSync(join(previous.dataDir, "config.json"))) {
  const dataDir = resolve(previous.dataDir);
  const local = relative(resolve(tmpdir()), dataDir);
  if (!local || local.startsWith("..") || isAbsolute(local) || !basename(dataDir).startsWith("openmausbot-verify-data-")) throw new Error("Saved Chief preview is not its own workspace");
  // Refuse to touch a live recorded process. The data-directory lease also
  // prevents a second server from opening this workspace.
  let running = false;
  try { process.kill(previous.pid, 0); running = true; } catch { /* stopped */ }
  if (running) throw new Error("This Chief preview backend is already running. Keep the current launcher open.");
  const port = await freePortBlock([0, 1]);
  const childEnv = verificationServerEnvironment(process.env, dataDir, port);
  childEnv.CHIEF_OFFICE_ENABLED = "1";
  childEnv.CHIEF_PLATFORM_MANIFEST = join(runtime, "platform", "manifest.json");
  if (pairingOrigin) childEnv.CHIEF_LIFECYCLE_ORIGIN = pairingOrigin;
  if (hermesHome) childEnv.HERMES_HOME = hermesHome;
  if (media) Object.assign(childEnv, { CHIEF_LIVEKIT_URL: media.url, CHIEF_LIVEKIT_API_KEY: media.key, CHIEF_LIVEKIT_API_SECRET: media.secret });
  const logPath = join(runtime, `backend-${Date.now()}.log`);
  const log = openSync(logPath, "a");
  const child = spawn(process.execPath, ["--experimental-strip-types", join(root, "server/index.ts")], { cwd: root, env: childEnv, stdio: ["ignore", log, log] });
  closeSync(log);
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30000;
  try {
    for (;;) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Chief backend stopped; see ${logPath}`);
      try { const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1000) }); if (response.ok && (await response.json()).app === "openmausbot") break; } catch { /* starting */ }
      if (Date.now() >= deadline) throw new Error(`Chief backend did not become ready; see ${logPath}`);
      await new Promise(done => setTimeout(done, 150));
    }
  } catch (error) { await waitForExit(child, { signal: "SIGTERM" }); throw error; }
  fixture = { child, info: { url, pid: child.pid!, dataDir, logPath } };
} else {
  fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, undefined, [], undefined, { media });
}
const ui = await createServer({ root, server: { host: "127.0.0.1", port: 5299, strictPort: true,
  proxy: { "/api": { target: fixture.info.url, ws: true }, "/.well-known/openmausbot/environment": { target: fixture.info.url } },
} });
try { await ui.listen(); } catch (error) { await waitForExit(fixture.child, { signal: "SIGTERM" }); throw error; }
const info = { ...fixture.info, previewUrl: "http://127.0.0.1:5299", officeUrl: "http://127.0.0.1:5299/office", launcherPid: process.pid, agentMode: "simulated starter; additional providers may be configured independently", preserveData: true, media: media ? "local LiveKit" : "not configured" };
writeFileSync(manifestPath, JSON.stringify({ ...info, ...(pairingOrigin ? { pairingOrigin } : {}), ...(hermesHome ? { hermesHome } : {}) }, null, 2));
console.log(JSON.stringify(info));
let closing = false;
async function close() { if (closing) return; closing = true; await ui.close(); await waitForExit(fixture.child, { signal: "SIGTERM" }); process.exit(0); }
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
