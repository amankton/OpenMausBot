import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { join } from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as attachments from "./attachments.ts";
import { DATA_DIR } from "./config.ts";
import { LocalVmLease } from "./local-vm-lease.ts";
import { closeMessageDb } from "./message-db.ts";
import { handleTaskResultRoutes } from "./routes/task-results.ts";
import { TaskResults } from "./task-results.ts";

// Execute the production capability validator and its actual route wiring,
// without booting index.ts or acquiring a real computer/provider. An isolated
// SQLite result service, real file copies and real lease exercise the race.
const source = ts.createSourceFile("index.ts", readFileSync(new URL("./index.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const validator = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "internalCapabilityIsActive");
let wiring: ts.Expression | undefined;
function visit(node: ts.Node): void {
  if (ts.isCallExpression(node) && node.expression.getText(source) === "handleTaskResultRoutes") wiring = node.arguments[1];
  ts.forEachChild(node, visit);
}
visit(source);
if (!validator || !wiring) throw new Error("Production task-result wiring or capability validator is missing");
const executable = ts.transpileModule(`${validator.getText(source)}\nconst deps = ${wiring.getText(source)};`, {
  compilerOptions: { target: ts.ScriptTarget.ESNext },
}).outputText;
type RouteDeps = Parameters<typeof handleTaskResultRoutes>[1];
const production = (bindings: Record<string, unknown>) => new Function(...Object.keys(bindings), `${executable}; return { deps, internalCapabilityIsActive };`)(
  ...Object.values(bindings),
) as { deps: RouteDeps; internalCapabilityIsActive(capability: unknown): boolean };
const root = join(DATA_DIR, "ownership-work");

beforeEach(() => {
  closeMessageDb(); rmSync(DATA_DIR, { recursive: true, force: true }); mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "packet.md"), "Synthetic prior delivery; owner and deadline unresolved.");
});
afterEach(() => vi.restoreAllMocks());

describe("task-result pinned computer ownership", () => {
  it.each(["expired", "reassigned", "target-replaced"])("rejects a %s VM lease during copy and preserves prior committed evidence", async mode => {
    let now = Date.now(); vi.spyOn(Date, "now").mockImplementation(() => now);
    const lease = new LocalVmLease(1_000);
    const vm = { key: "fixture-vm", workspaceDir: root };
    const targets = new Map([["build-task", vm]]);
    const capability = { botId: "builder", threadId: "build-task", generation: "C", kind: "agents", orphanExpiresAt: now + 60_000 };
    const publish = vi.fn(() => "projected-message");
    const results = new TaskResults({ authorizeThread: () => true, notificationAccess: () => "allowed", publish, publishArtifacts: publish });
    const priorExecution = { botId: "builder", threadId: "build-task", executionId: "B" };
    const input = { summary: "Prior packet", deliveryOutcome: "delivered", dataKind: "synthetic",
      artifacts: [{ path: join(root, "packet.md"), title: "Packet", scope: "host" }] };
    results.begin(priorExecution);
    const prior = await results.register(priorExecution, input, { roots: [root], isLive: () => true });
    results.seal("B", "succeeded"); results.reconcile(); publish.mockClear();
    results.begin({ ...priorExecution, executionId: "C" });
    lease.claim("build-task", "builder", () => true);
    let validate: (value: unknown) => boolean;
    const loaded = production({
      taskResults: results, internalSender: { id: "builder" }, internalCapability: capability,
      store: { taskByThread: () => ({ threadId: "build-task" }) },
      cloudLendingView: () => false, cloudOwnerOnlyThread: () => true,
      attachmentVmForTurn: async () => {
        if (!validate({ ...capability, localVmTarget: vm })) throw new Error("fixture turn does not own VM");
        return vm;
      },
      messageFileRootsForThread: () => [root], ATTACHMENTS_DIR: join(DATA_DIR, "attachments"), VM_WORKSPACE_GUEST: "/home/cua/workspace",
      EXTERNAL_RUNTIME_GENERATION: "external", computerSelectionTurns: new Map(), teamComputerTurns: new Map(),
      localVmLeaseFor: () => lease, localVmOwnerBusy: () => true, localVmThreadTargets: targets,
      activeInternalGenerationByThread: new Map([["build-task", "C"]]),
    });
    validate = loaded.internalCapabilityIsActive;
    const save = attachments.saveFile;
    vi.spyOn(attachments, "saveFile").mockImplementationOnce(async (chunks, name, mime, options) => {
      async function* loseOwnershipDuringCopy(): AsyncGenerator<Uint8Array> {
        let first = true;
        for await (const chunk of chunks) {
          if (first) {
            first = false;
            if (mode === "expired") now += 1_001;
            else if (mode === "reassigned") { lease.release("build-task"); lease.claim("replacement-task", "other-bot", () => true); }
            else targets.set("build-task", { ...vm, key: "replacement-vm" });
          }
          yield chunk;
        }
      }
      return save(loseOwnershipDuringCopy(), name, mime, options);
    });
    const json = vi.fn();
    let rejection: unknown;
    try {
      await handleTaskResultRoutes({ path: "/api/internal/task-results", method: "POST", url: new URL("http://fixture.invalid/api/internal/task-results"),
        res: {} as ServerResponse, json, readBody: async () => ({ ...input, artifacts: [{ path: "/home/cua/workspace/packet.md", scope: "vm", title: "New packet" }] }),
      }, loaded.deps);
    } catch (error) { rejection = error; }
    // The agents generation is still active; only the pinned VM fence fails.
    expect(validate(capability)).toBe(true);
    expect(validate({ ...capability, localVmTarget: vm })).toBe(false);
    expect(rejection).toMatchObject({ status: 409 });
    expect(json).not.toHaveBeenCalled();
    results.seal("C", "failed"); results.reconcile();
    expect(publish).not.toHaveBeenCalled();
    expect(results.execution("C")?.artifacts).toEqual([]);
    expect(results.summary("build-task")?.lastDeliveredResultId).toBe(prior.id);
    expect(readdirSync(join(DATA_DIR, "attachments"))).toHaveLength(1);
    expect(readFileSync(prior.artifacts[0].attachment.path, "utf8")).toContain("Synthetic prior delivery");
  });
});
