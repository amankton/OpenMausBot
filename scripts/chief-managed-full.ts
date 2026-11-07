// Owner's existing Full workspace, hosted by the packaged desktop. The data
// stays in place; Electron owns the lease, server lifecycle and grant protocol.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { chiefHermesEnvironment } from "./chief-hermes-env.ts";
import { chiefPodmanEnvironment } from "./chief-podman-env.ts";
import { assertChiefUiBuild, chiefUiDirectory } from "./chief-ui-build.ts";
import { serveChiefUi } from "./chief-ui-server.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const runtime = join(root, ".chief-local");
const config = JSON.parse(readFileSync(join(runtime, "native-full-runtime.json"), "utf8")) as {
  application: string; dataDir: string; profileDir: string; requiredBotId: string;
};
for (const path of [config.application, config.dataDir, config.profileDir]) {
  if (!isAbsolute(path)) throw Error("Managed desktop paths must be absolute");
}
for (const path of [config.application, join(config.dataDir, "bots.json"), join(config.dataDir, "config.json")]) {
  if (!existsSync(path)) throw Error("Managed desktop input is missing");
}
const saved = JSON.parse(readFileSync(join(runtime, "preview.json"), "utf8"));
if (resolve(saved.dataDir) !== resolve(config.dataDir)) throw Error("Refusing to change the Full workspace data directory");
const build = assertChiefUiBuild(root);
const log = (message: string) => appendFileSync(join(runtime, "native-full-startup.log"), `${new Date().toISOString()} ${message}\n`);
if (process.argv.includes("--check")) {
  console.log(JSON.stringify({ ready: true, dataDir: config.dataDir, profileDir: config.profileDir, sourceRuntime: true, privateDesktopGrants: true }));
} else {
  const find = async () => {
    for (const port of [8899, 18899, 28899]) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/bots?messages=0`, { signal: AbortSignal.timeout(1000) });
        if (response.ok && (await response.json()).bots?.some((bot: { id: string }) => bot.id === config.requiredBotId)) return `http://127.0.0.1:${port}`;
      } catch { /* not this workspace */ }
    }
    return null;
  };
  let target = await find();
  if (target) {
    if (process.argv.includes("--show")) {
      // The profile's normal single-instance handler raises its existing window.
      const existing = spawn(config.application, [], { env: { ...process.env, CHIEF_PROFILE_DIR: config.profileDir }, windowsHide: false, stdio: "ignore" });
      existing.unref();
    }
    console.log(JSON.stringify({ ready: true, target, alreadyRunning: true }));
    process.exit(0);
  }
  try {
    const response = await fetch("http://127.0.0.1:5299/api/health", { signal: AbortSignal.timeout(1000) });
    if (response.ok) throw Error("Stop the old Full workspace only after its work is idle");
  } catch (error) { if (error instanceof Error && error.message.startsWith("Stop the old")) throw error; }
  const env = { ...process.env, CHIEF_PROFILE_DIR: config.profileDir, OMB_DATA_DIR: config.dataDir,
    CHIEF_DESKTOP_SERVER_ENTRY: join(root, "server/index.ts"), CHIEF_DESKTOP_UI_DIR: chiefUiDirectory(root),
    CHIEF_DESKTOP_NODE_EXE: process.execPath,
    CHIEF_DESKTOP_COMPANION_DIRECTORY: join(runtime, "phone"),
    CHIEF_OFFICE_ENABLED: "1", CHIEF_PLATFORM_MANIFEST: join(runtime, "platform/manifest.json"),
    ...(saved.pairingOrigin ? { CHIEF_LIFECYCLE_ORIGIN: saved.pairingOrigin } : {}),
    ...(saved.hermesHome ? { HERMES_HOME: saved.hermesHome } : {}),
    ...chiefHermesEnvironment(saved.hermesHome, process.env),
  } as NodeJS.ProcessEnv;
  delete env.ELECTRON_RUN_AS_NODE;
  if (saved.localVm) {
    try { Object.assign(env, chiefPodmanEnvironment()); }
    catch { log("Existing Local VM is unavailable; no VM or computer choice was changed."); }
  }
  if (saved.media === "local LiveKit") {
    const media = JSON.parse(readFileSync(join(runtime, "media.json"), "utf8"));
    Object.assign(env, { CHIEF_LIVEKIT_URL: media.url, CHIEF_LIVEKIT_API_KEY: media.key, CHIEF_LIVEKIT_API_SECRET: media.secret });
  }
  mkdirSync(config.profileDir, { recursive: true });
  const desktop = spawn(config.application, [], { env, cwd: root, windowsHide: false, stdio: "ignore" });
  let exited = false;
  desktop.once("exit", () => { exited = true; });
  desktop.once("error", error => { log(`Desktop launch failed: ${error.message}`); exited = true; });
  const deadline = Date.now() + 120000;
  while (!(target = await find())) {
    if (exited || Date.now() >= deadline) throw Error("Managed desktop did not become ready; inspect its profile logs before retrying");
    await new Promise(done => setTimeout(done, 300));
  }
  const ui = await serveChiefUi({ root, target });
  const receipt = { ...saved, url: target, pid: desktop.pid, launcherPid: process.pid, desktopManaged: true,
    logPath: join(config.profileDir, "logs", "server.log"),
    desktopProfile: config.profileDir, uiBuild: build, previewUrl: "http://127.0.0.1:5299" };
  writeFileSync(join(runtime, "preview.json"), JSON.stringify(receipt, null, 2));
  writeFileSync(join(runtime, "native-full-running.json"), JSON.stringify({ target, desktopPid: desktop.pid, launcherPid: process.pid, dataDir: config.dataDir, profileDir: config.profileDir }, null, 2));
  log(`Desktop-owned source workspace ready at ${target}; original 5299 route preserved`);
  console.log(JSON.stringify({ ready: true, target, desktopPid: desktop.pid, privateDesktopGrants: true }));
  // A normal desktop relaunch can replace the original child. Keep the source
  // URL alive across that short gap; Quit ends the proxy after the grace period.
  let unavailableSince: number | null = null;
  for (;;) {
    await new Promise(done => setTimeout(done, 3000));
    let healthy = false;
    try { healthy = (await fetch(`${target}/api/health`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* relaunch or Quit */ }
    if (healthy) unavailableSince = null;
    else unavailableSince ??= Date.now();
    if (unavailableSince !== null && Date.now() - unavailableSince >= 30000) break;
  }
  await ui.close();
}
