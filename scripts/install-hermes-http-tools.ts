// Install only this standalone plugin; preserve all existing Hermes settings.
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { parseDocument } from "yaml";

const home = resolve(process.argv[2] || "");
assert(process.argv[2] && existsSync(join(home, "config.yaml")), "Pass the existing Hermes home explicitly");
const env = parseEnv(readFileSync(join(home, ".env"), "utf8"));
const url = process.env.HERMES_API_BASE_URL || `http://127.0.0.1:${env.API_SERVER_PORT || "8642"}`;
const response = await fetch(`${url}/v1/toolsets`, { headers: { Authorization: `Bearer ${env.API_SERVER_KEY}` }, signal: AbortSignal.timeout(10000) });
assert(response.ok, "Hermes toolset discovery failed; configuration was not changed");
const data = await response.json() as { data: Array<{ name: string; enabled: boolean }> };
const enabled = data.data.filter(row => row.enabled).map(row => row.name);
assert(enabled.length, "Expected existing toolsets; refusing to replace with an empty selection");
const path = join(home, "config.yaml");
const text = readFileSync(path, "utf8");
const config = parseDocument(text);
assert.equal(config.errors.length, 0);
const selected = config.getIn(["plugins", "enabled"])?.toJSON?.() as unknown;
assert(Array.isArray(selected), "Expected an explicit existing plugins.enabled list");
config.setIn(["plugins", "enabled"], [...new Set([...selected, "chief-http-tools"])]);
config.deleteIn(["plugins", "entries", "chief-http-tools", "enabled"]);
config.setIn(["platform_toolsets", "api_server"], [...new Set([...enabled, "chief_http_tools"])]);
const target = join(home, "plugins", "chief-http-tools");
mkdirSync(target, { recursive: true });
const source = fileURLToPath(new URL("../integrations/hermes-http-tools/", import.meta.url));
const stamp = Date.now();
for (const name of ["plugin.yaml", "__init__.py"]) {
  const dest = join(target, name);
  if (existsSync(dest)) copyFileSync(dest, `${dest}.before-${stamp}`);
  copyFileSync(join(source, name), dest);
}
copyFileSync(path, `${path}.before-chief-http-tools-${stamp}`);
writeFileSync(path, config.toString());
console.log(JSON.stringify({ installed: true, plugin: target, addedToolset: "chief_http_tools", existingToolsetsPreserved: enabled.length, configBackup: `${path}.before-chief-http-tools-${stamp}`, restartHermesRequired: true }));
