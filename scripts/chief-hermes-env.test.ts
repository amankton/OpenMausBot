import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { chiefHermesEnvironment } from "./chief-hermes-env.ts";
import { removeTempDir } from "../server/testing/cleanup.ts";

it("loads only HTTP settings from the explicitly selected Hermes home", async () => {
  const home = mkdtempSync(join(tmpdir(), "chief-hermes-env-"));
  try {
    writeFileSync(join(home, ".env"), 'API_SERVER_KEY="fixture-only"\nAPI_SERVER_MODEL_NAME=virtual-model\nAPI_SERVER_PORT=8765\nOPENAI_API_KEY=must-not-copy\n');
    expect(chiefHermesEnvironment(home, {})).toEqual({ HERMES_TRANSPORT: "http", HERMES_API_BASE_URL: "http://127.0.0.1:8765", HERMES_API_KEY: "fixture-only", HERMES_API_MODEL: "virtual-model", HERMES_API_TIMEOUT_MS: "900000" });
    expect(chiefHermesEnvironment(home, { HERMES_API_BASE_URL: "http://other:123", HERMES_API_KEY: "explicit", HERMES_API_MODEL: "chosen", HERMES_TRANSPORT: "acp" })).toMatchObject({ HERMES_TRANSPORT: "acp", HERMES_API_BASE_URL: "http://other:123", HERMES_API_KEY: "explicit", HERMES_API_MODEL: "chosen" });
  } finally { await removeTempDir(home); }
});

it("does not invent a secret or read an unselected home", () => {
  expect(chiefHermesEnvironment(undefined, {})).not.toHaveProperty("HERMES_API_KEY");
});
