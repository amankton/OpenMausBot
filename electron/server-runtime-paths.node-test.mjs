import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import runtime from "./server-runtime-paths.cjs";

test("ordinary desktop paths and grant transport remain unchanged", () => {
  assert.deepEqual(runtime.desktopServerRuntime("resources", {}), {
    entry: join("resources", "server", "index.js"), staticDir: join("resources", "ui"), execArgv: [], environment: {},
  });
});
test("managed source paths require a complete explicit owner launch configuration", () => {
  const root = mkdtempSync(join(tmpdir(), "chief-runtime-paths-"));
  try {
    const entry = join(root, "index.ts"), ui = join(root, "ui");
    mkdirSync(ui); writeFileSync(entry, "// fixture"); writeFileSync(join(ui, "index.html"), "fixture");
    const env = { CHIEF_DESKTOP_SERVER_ENTRY: entry, CHIEF_DESKTOP_UI_DIR: ui, CHIEF_PROFILE_DIR: join(root, "profile"), OMB_DATA_DIR: join(root, "data"), CHIEF_DESKTOP_NODE_EXE: process.execPath };
    const selected = runtime.desktopServerRuntime("resources", env);
    assert.equal(selected.entry, entry); assert.equal(selected.staticDir, ui);
    assert.deepEqual(selected.execArgv, ["--experimental-strip-types"]);
    assert.equal(selected.environment.HOME, env.OMB_DATA_DIR);
    assert.equal(selected.environment.USERPROFILE, env.OMB_DATA_DIR);
    assert.equal(selected.environment.OMB_TEST_SEALED_PATH, "1");
    for (const name of Object.keys(env)) {
      assert.throws(() => runtime.desktopServerRuntime("resources", { ...env, [name]: undefined }));
      assert.throws(() => runtime.desktopServerRuntime("resources", { ...env, [name]: "relative" }));
    }
    assert.throws(() => runtime.desktopServerRuntime("resources", { ...env, CHIEF_DESKTOP_SERVER_ENTRY: join(root, "missing.ts") }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
