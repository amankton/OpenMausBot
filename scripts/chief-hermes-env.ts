import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

/** Only the explicitly selected local Hermes server's HTTP settings cross
 * the launcher's otherwise sealed environment. No provider secrets are copied. */
export function chiefHermesEnvironment(home: string | undefined, env: NodeJS.ProcessEnv): Record<string, string> {
  const path = home ? join(home, ".env") : undefined;
  const server = path && existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
  const values = {
    HERMES_TRANSPORT: env.HERMES_TRANSPORT || "http",
    HERMES_API_BASE_URL: env.HERMES_API_BASE_URL || `http://127.0.0.1:${server.API_SERVER_PORT || "8642"}`,
    HERMES_API_KEY: env.HERMES_API_KEY || server.API_SERVER_KEY,
    HERMES_API_MODEL: env.HERMES_API_MODEL || server.API_SERVER_MODEL_NAME || "hermes-agent",
    HERMES_API_TIMEOUT_MS: env.HERMES_API_TIMEOUT_MS || "900000",
    ...(env.HERMES_TOOL_BRIDGE_ENABLED || home && existsSync(join(home, "plugins", "chief-http-tools", "plugin.yaml")) ? {
      HERMES_TOOL_BRIDGE_ENABLED: env.HERMES_TOOL_BRIDGE_ENABLED || "1",
      HERMES_TOOL_BRIDGE_DIR: env.HERMES_TOOL_BRIDGE_DIR || (home ? join(home, "chief-http-bridge") : undefined),
    } : {}),
  };
  return Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}
