// Standalone Chief releases reuse the existing desktop build and native helpers.
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = realpathSync(join(dirname(fileURLToPath(import.meta.url)), ".."));
const target = process.argv[2];
if (!["mac", "win"].includes(target)) throw new Error("Use pnpm package:win or pnpm package:mac");
if (process.platform !== (target === "mac" ? "darwin" : "win32")) {
  throw new Error(`Build ${target} on its native operating system so its helpers can be verified.`);
}
const pnpm = process.env.npm_execpath;
if (!pnpm || !existsSync(pnpm)) throw new Error("Run this script through pnpm package:win or pnpm package:mac");
const env = { ...process.env, OMB_INCLUDE_ENTERPRISE: "0", VITE_CHIEF_AGENT_ONLY: "1" };
// An earlier licensed build must not leave restricted output in this release.
const output = join(root, "dist-server");
if (existsSync(output)) {
  if (relative(root, realpathSync(output)) !== "dist-server") throw new Error("Unexpected server output location");
  rmSync(output, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
function run(args) {
  const result = spawnSync(process.execPath, [pnpm, ...args], { cwd: root, env, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(["run", "package:prepare"]);
if (existsSync(join(output, "enterprise"))) throw new Error("Restricted enterprise output cannot ship in Chief");
if (target === "mac") {
  run(["run", "build:speech"]);
  run(["run", "build:cua"]);
} else {
  run(["run", "build:cua:win"]);
}
run(["exec", "node", "scripts/smoke-packaged-server.mjs"]);
run(["exec", "electron-builder", `--${target}`, "--publish", "never"]);
