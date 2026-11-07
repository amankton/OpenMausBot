"use strict";
const { existsSync, statSync } = require("node:fs");
const { isAbsolute, join, extname, dirname } = require("node:path");

// Optional owner-configured source runtime. It is still forked and supervised
// by Electron, using the same private grant coordinator and data-directory lease.
// No renderer input or HTTP request may select these paths.
function desktopServerRuntime(resourcesPath, env = process.env) {
  const entry = env.CHIEF_DESKTOP_SERVER_ENTRY;
  const ui = env.CHIEF_DESKTOP_UI_DIR;
  if (entry === undefined && ui === undefined) {
    return { entry: join(resourcesPath, "server", "index.js"), staticDir: join(resourcesPath, "ui"), execArgv: [], environment: {} };
  }
  if (!entry || !ui || !env.CHIEF_PROFILE_DIR || !env.OMB_DATA_DIR || !env.CHIEF_DESKTOP_NODE_EXE ||
      ![entry, ui, env.CHIEF_PROFILE_DIR, env.OMB_DATA_DIR, env.CHIEF_DESKTOP_NODE_EXE].every(isAbsolute) ||
      ![".ts", ".js", ".mjs"].includes(extname(entry)) ||
      !existsSync(entry) || !statSync(entry).isFile() || !existsSync(env.CHIEF_DESKTOP_NODE_EXE) ||
      !existsSync(join(ui, "index.html")) || !statSync(join(ui, "index.html")).isFile()) {
    throw new Error("A managed source workspace requires explicit absolute server, UI, profile and data paths");
  }
  const home = env.OMB_DATA_DIR;
  return { entry, staticDir: ui, execArgv: extname(entry) === ".ts" ? ["--experimental-strip-types"] : [], environment: {
    HOME: home, USERPROFILE: home, APPDATA: join(home, "AppData", "Roaming"), LOCALAPPDATA: join(home, "AppData", "Local"),
    XDG_CONFIG_HOME: join(home, ".config"), XDG_CACHE_HOME: join(home, ".cache"), XDG_DATA_HOME: join(home, ".local", "share"),
    TEMP: join(home, "tmp"), TMP: join(home, "tmp"), TMPDIR: join(home, "tmp"),
    PATH: dirname(env.CHIEF_DESKTOP_NODE_EXE), OMB_TEST_SEALED_PATH: "1",
  } };
}
module.exports = { desktopServerRuntime };
