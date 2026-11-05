import { expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { runControlOmb, HELP, HELP_UI } from "../scripts/control-omb.ts";
import { handleToolCall, parseExecutiveWorkOperation, TOOLS } from "../scripts/mcp-server.ts";

const fixtureUrl = "http://127.0.0.1:29517";
const createBody = { item: { accountScope: "local:chief", source: { kind: "fixture", id: "request-one", version: "version-one" }, ownerBotId: "chief", coordinatorBotId: "chief", sourceThreadId: "chief-task", title: "Synthetic request", desiredOutcome: "Verify the result", nextAction: "Inspect the fixture evidence" }, mutation: { eventId: "create-request-one" } };
const updateBody = { accountScope: "local:chief", expectedRevision: 1, patch: { status: "queued" }, eventId: "queue-request-one" };
const settingsBody = { expectedRevision: 0, analysisBudget: 15, scansEnabled: false, checkInEnabled: false, routineBindings: [] };
const scanBody = { accountScopes: ["account-one"], eventId: "scan-one" };

it("advertises a bounded shared executive tool and explicit CLI operations", () => {
  const tool = TOOLS.find(candidate => candidate.name === "executive_work")!;
  expect(tool.inputSchema.additionalProperties).toBe(false);
  expect(tool.inputSchema.properties.operation).toMatchObject({ enum: ["read", "create", "update", "settings", "scan"] });
  expect(tool.annotations?.readOnlyHint).toBe(false);
  expect(HELP).toContain("executive-work --operation read");
  expect(HELP).toContain("executive-work --operation create|update|settings|scan");
  expect(HELP_UI).toContain("ui viewport --ui HANDLE --width WIDTH --height HEIGHT");
});
it("maps read onto a single GET without transcript or mailbox side reads", async () => {
  const fetcher = vi.fn(async () => ({ settings: {}, items: [] }));
  const result = await handleToolCall("executive_work", { operation: "read" }, fetcher);
  expect(result).toEqual({ settings: {}, items: [] });
  expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/executive-work");
});
it.each([
  ["create", createBody, undefined, "/api/executive-work/items", "POST"],
  ["update", updateBody, "work-one", "/api/executive-work/items/work-one", "PATCH"],
  ["settings", settingsBody, undefined, "/api/executive-work/settings", "PATCH"],
  ["scan", scanBody, undefined, "/api/executive-work/scan", "POST"],
] as const)("maps %s through the shared request boundary", async (operation, body, id, path, method) => {
  const fetcher = vi.fn(async () => ({ ok: true }));
  const args = { operation, body, ...(id ? { id } : {}) };
  await expect(handleToolCall("executive_work", args, fetcher)).resolves.toEqual({ ok: true });
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(path, { method, body: JSON.stringify(parseExecutiveWorkOperation(args).body) });
});
it.each([
  { operation: "remove", body: {} },
  { operation: "read", id: "unneeded" },
  { operation: "read", body: { accountScope: "secret" } },
  { operation: "create", body: { ...createBody, extra: true } },
  { operation: "create", body: { ...createBody, item: { ...createBody.item, body: "Mailbox bodies do not belong in the queue" } } },
  { operation: "update", body: updateBody },
  { operation: "update", id: "../../config", body: updateBody },
  { operation: "update", id: "work-one", body: { ...updateBody, expectedRevision: 0 } },
  { operation: "update", id: "work-one", body: { ...updateBody, patch: { status: "sent" } } },
  { operation: "settings", body: { ...settingsBody, apiKey: "not-a-real-secret" } },
  { operation: "settings", body: { ...settingsBody, analysisBudget: 101 } },
  { operation: "scan", body: { ...scanBody, accountScopes: ["one", "one"] } },
  { operation: "scan", body: { ...scanBody, send: true } },
  { operation: "scan", body: { ...scanBody, eventId: "x".repeat(121) } },
])("rejects invalid executive argument shape %# before any request", async args => {
  const fetcher = vi.fn(); await expect(handleToolCall("executive_work", args, fetcher)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
});
it("rejects excessive payloads and unknown top-level arguments", async () => {
  const fetcher = vi.fn();
  await expect(handleToolCall("executive_work", { operation: "read", body: { text: "x".repeat(64_001) } }, fetcher)).rejects.toThrow(/64000/);
  await expect(handleToolCall("executive_work", { operation: "read", url: fixtureUrl }, fetcher)).rejects.toThrow(/not supported/);
  expect(fetcher).not.toHaveBeenCalled();
});
it("maps CLI JSON and literal instance URL through the existing tool caller", async () => {
  const callTool = vi.fn(async (_name: string, _args: Record<string, unknown>, _fetcher?: (path: string, options?: RequestInit) => Promise<unknown>) => ({ success: true })), requester = vi.fn();
  const result = await runControlOmb(["executive-work", "--operation", "update", "--id", "work-one", "--json", JSON.stringify(updateBody), "--url", fixtureUrl], { env: {}, callTool, request: requester });
  expect(result).toEqual({ success: true });
  expect(callTool).toHaveBeenCalledWith("executive_work", { operation: "update", id: "work-one", body: updateBody }, expect.any(Function));
  const fetcher = callTool.mock.calls[0]![2]!;
  await fetcher("/api/executive-work/items/work-one", { method: "PATCH" });
  expect(requester).toHaveBeenCalledExactlyOnceWith("/api/executive-work/items/work-one", { method: "PATCH" }, fixtureUrl);
});
it.each(["create", "update", "settings", "scan"])("requires literal --url for CLI %s even with ambient configured defaults", async operation => {
  const callTool = vi.fn();
  for (const env of [{}, { OPENMAUSBOT_URL: fixtureUrl, OMB_PORT: "29517" }]) {
    await expect(runControlOmb(["executive-work", "--operation", operation, "--json", "{}"], { env, callTool })).rejects.toThrow(/explicit --url/);
  }
  expect(callTool).not.toHaveBeenCalled();
});
it("keeps read compatible with the existing safe read-only discovery boundary", async () => {
  const callTool = vi.fn(async () => ({ items: [] }));
  await expect(runControlOmb(["executive-work", "--operation", "read"], { env: {}, callTool })).resolves.toEqual({ items: [] });
  expect(callTool).toHaveBeenCalledWith("executive_work", { operation: "read" }, expect.any(Function));
});
it("refuses default-requester mutations before attempting port discovery", () => {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
    globalThis.fetch = async () => { throw new Error('Unexpected network request'); };
    const { handleToolCall } = await import('./scripts/mcp-server.ts');
    try { await handleToolCall('executive_work', { operation: 'scan', body: { accountScopes: ['synthetic'], eventId: 'must-not-run' } }); process.exitCode = 2; }
    catch (error) { if (!error.message.includes('discovery is read-only')) throw error; console.log('explicit-instance-required'); }
  `], { encoding: "utf8", env: { ...process.env, OPENMAUSBOT_URL: "", OMB_PORT: "", OPENMAUSBOT_TOKEN: "" } });
  expect(result.status).toBe(0); expect(result.stdout).toContain("explicit-instance-required"); expect(result.stderr).not.toContain("Unexpected network request");
});
it.each(([
  ["executive-work", "--operation", "scan", "--json", "{bad", "--url", fixtureUrl],
  ["executive-work", "--operation", "scan", "--json", "[]", "--url", fixtureUrl],
  ["executive-work", "--operation", "scan", "--json", JSON.stringify(scanBody), "--url", "http://127.0.0.1:29517/forged-path"],
  ["executive-work", "--operation", "scan", "--json", JSON.stringify(scanBody), "--url", fixtureUrl, "--unknown", "value"],
] as string[][]).map(args => ({ args })))("rejects malformed CLI input before calling any tool %#", async ({ args }) => {
  const callTool = vi.fn(); await expect(runControlOmb(args, { env: {}, callTool })).rejects.toThrow(); expect(callTool).not.toHaveBeenCalled();
});
