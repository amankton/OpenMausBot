import { appendFileSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as persistence from "./message-db.ts";
import * as messageFiles from "./message-file.ts";
import * as commands from "./commands.ts";
import { FILE_MAX_BYTES } from "./attachments.ts";
import { DATA_DIR } from "./config.ts";
import { closeMessageDb, deleteThread, insertMessage, readThread } from "./message-db.ts";
import { runCommand } from "./commands.ts";
import { TaskResults, type ResultExecution } from "./task-results.ts";

const root = join(DATA_DIR, "work");
let live = true;
let reachable = true;
let targetExists = true;
let crashAfterPublish = false;
let publications = 0;
const execution = (executionId: string): ResultExecution => ({
  botId: "builder", threadId: "build-task", executionId, requestMessageId: "owner-request",
  requestId: "handoff-1", modelInstanceId: "fake", source: { botId: "chief", threadId: "chief-task" },
});
const registration = () => ({ summary: "Sourced packet", deliveryOutcome: "delivered", dataKind: "synthetic",
  artifacts: [{ path: join(root, "packet.md"), scope: "host", title: "Packet" }],
  verifications: [{ check: "SOP citations", outcome: "passed", artifactIndex: 0 }],
});
const service = () => new TaskResults({
  authorizeThread: (viewer, thread) => thread === "build-task" && (viewer === "builder" || (viewer === "chief" && reachable)),
  notificationAccess: () => !targetExists ? "deleted" : reachable ? "allowed" : "revoked",
  publish: (result, target) => {
    const message = runCommand({ kind: "task-result.report", key: `${result.id}:${target.threadId}` }, () => {
      publications++;
      const value = { id: `report-${result.id}`, at: 1, role: "bot" as const, kind: "text" as const, text: result.id };
      insertMessage(target.threadId, value);
      return value;
    });
    if (crashAfterPublish) throw new Error("crash after committed message, before acknowledgement");
    return message.id;
  },
});
const register = (s: TaskResults, e = execution("B"), value: unknown = registration(), isLive = () => live) =>
  s.register(e, value, { roots: [root], isLive });

beforeEach(() => {
  closeMessageDb();
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "packet.md"), "# Synthetic packet\nSOP §1: obtain owner approval.\nOwner: unresolved. Deadline: unresolved.\n");
  live = true; reachable = true; targetExists = true; crashAfterPublish = false; publications = 0;
});

describe("durable task results", () => {
  it("preserves B and its evidence across failed A, later failure and database reopen", async () => {
    const s = service();
    s.begin(execution("A")); s.seal("A", "failed");
    s.begin({ ...execution("B"), retryOfExecutionId: "A" });
    const b = await register(s, { ...execution("B"), retryOfExecutionId: "A" });
    s.seal("B", "succeeded", "provider-B");
    s.begin(execution("C")); s.seal("C", "failed");
    closeMessageDb();
    const found = service().lookup("chief", "build-task");
    expect(found.map(r => r.executionOutcome)).toEqual(["failed", "succeeded", "failed"]);
    const result = found.find(r => r.id === b.id)!;
    expect(result).toMatchObject({ schemaVersion: 1, deliveryOutcome: "delivered", retryOfExecutionId: "A", providerTurnId: "provider-B", dataKind: "synthetic" });
    expect(result.artifacts[0]).toMatchObject({ schemaVersion: 1, scope: "host", bytes: expect.any(Number), sha256: expect.stringMatching(/^[a-f0-9]{64}$/), observedAt: expect.any(Number) });
    expect(result.verifications.map(v => v.authority)).toEqual(["harness_observation", "agent_claim"]);
    expect(result.verifications[0].check).toBe("file-content-identity");
    expect(s.summary("build-task")?.lastDeliveredResultId).toBe(b.id);
  });

  it("separates success without registration from a verified delivery, including consultations", () => {
    const s = service(); s.begin(execution("consult"));
    const result = s.seal("consult", "succeeded")!;
    expect(result.deliveryOutcome).toBe("unverified");
    expect(result.artifacts).toEqual([]);
    expect(result.executionOutcome).toBe("succeeded");
  });

  it("keeps the last usable delivery discoverable beyond the bounded recent-history window", async () => {
    const s = service(); s.begin(execution("B")); const result = await register(s); s.seal("B", "succeeded");
    for (let i = 0; i < 55; i++) { s.begin(execution(`failed-${i}`)); s.seal(`failed-${i}`, "failed"); }
    expect(s.lookup("chief", "build-task").some(r => r.id === result.id)).toBe(true);
    expect(s.lookup("chief", "build-task")).toHaveLength(51);
    expect(s.summary("build-task")?.lastDeliveredResultId).toBe(result.id);
  });

  it("rolls back registration and cleans prepared attachments when commit fails, then safely retries", async () => {
    const s = service(); s.begin(execution("B"));
    const write = persistence.writeTaskResult;
    const mocked = vi.spyOn(persistence, "writeTaskResult").mockImplementationOnce((...args) => { write(...args); throw new Error("injected transaction failure"); });
    try { await expect(register(s)).rejects.toThrow("injected transaction failure"); } finally { mocked.mockRestore(); }
    expect(s.lookup("builder", "build-task")[0].artifacts).toEqual([]);
    expect(readdirSync(join(DATA_DIR, "attachments"))).toEqual([]);
    const result = await register(s); expect(result.artifacts).toHaveLength(1);
  });

  it("keeps fixture and real flags explicit without promoting claimed checks", async () => {
    const s = service(); s.begin(execution("B"));
    const value = registration(); value.dataKind = "real";
    const r = await register(s, execution("B"), value);
    expect(r.dataKindAuthority).toBe("agent_claim");
    expect(r.verifications.find(v => v.check === "SOP citations")?.authority).toBe("agent_claim");
    expect(r.verifications.every(v => v.schemaVersion === 1)).toBe(true);
  });

  it("is idempotent for the same execution and refuses a conflicting registration", async () => {
    const s = service(); s.begin(execution("B"));
    const a = await register(s); const b = await register(s);
    expect(a.id).toBe(b.id); expect(a.artifacts).toEqual(b.artifacts);
    await expect(register(s, execution("B"), { ...registration(), summary: "Different result" })).rejects.toThrow(/already registered/);
    s.seal("B", "succeeded"); s.seal("B", "failed");
    expect(s.lookup("builder", "build-task")[0].executionOutcome).toBe("succeeded");
  });

  it("checks scope on every lookup and refuses forged ids without leaking records", async () => {
    const s = service(); s.begin(execution("B")); const r = await register(s);
    expect(() => s.lookup("stranger", "build-task")).toThrow(/not available/);
    reachable = false;
    expect(() => s.lookup("chief", "build-task", r.id)).toThrow(/not available/);
    expect(s.lookup("builder", "build-task", "forged")).toEqual([]);
    expect(() => s.lookup("builder", "private-task", r.id)).toThrow(/not available/);
  });

  it("deduplicates simultaneous registrations without retaining duplicate file copies", async () => {
    const s = service(); s.begin(execution("B"));
    const results = await Promise.all([register(s), register(s)]);
    expect(results[0].artifacts).toEqual(results[1].artifacts);
    expect(readdirSync(join(DATA_DIR, "attachments"))).toHaveLength(1);
  });

  it("removes a deleted task's result rows without deleting other tasks or retained bytes", async () => {
    const s = service(); s.begin(execution("B")); const result = await register(s); s.seal("B", "succeeded");
    s.begin({ ...execution("other"), threadId: "another-task" });
    deleteThread("build-task"); closeMessageDb();
    expect(s.lookup("builder", "build-task")).toEqual([]);
    expect(s.execution("other")?.threadId).toBe("another-task");
    expect(readFileSync(result.artifacts[0].attachment.path, "utf8")).toContain("Owner: unresolved");
  });

  it("refuses paths outside the permitted roots, directories, remote locators and forged observation authority", async () => {
    const s = service(); s.begin(execution("B"));
    const outside = join(DATA_DIR, "outside.md"); writeFileSync(outside, "private");
    for (const path of [outside, join(root, "..", "outside.md"), root, "packet.md", "https://example.invalid/packet.md"]) {
      await expect(register(s, execution("B"), { ...registration(), artifacts: [{ path, scope: "host", title: "Bad" }] })).rejects.toThrow();
    }
    await expect(register(s, execution("B"), { ...registration(), verifications: [{ check: "Tests", outcome: "passed", authority: "harness_observation" }] })).rejects.toThrow();
  });

  it("refuses a symlink escaping the permitted root", async () => {
    const outside = join(DATA_DIR, "private"); mkdirSync(outside); writeFileSync(join(outside, "secret.md"), "private");
    symlinkSync(outside, join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
    const s = service(); s.begin(execution("B"));
    await expect(register(s, execution("B"), { ...registration(), artifacts: [{ path: join(root, "escape", "secret.md"), scope: "host", title: "Bad" }] })).rejects.toThrow();
  });

  it("rejects stale generations before and after asynchronous file preparation", async () => {
    const s = service(); s.begin(execution("B")); live = false;
    await expect(register(s)).rejects.toThrow(/ended/);
    live = true; let checks = 0;
    await expect(register(s, execution("B"), registration(), () => ++checks === 1)).rejects.toThrow(/ended/);
    expect(s.lookup("builder", "build-task")[0].artifacts).toEqual([]);
    expect(s.lookup("builder", "build-task")[0].deliveryOutcome).toBe("unverified");
  });

  it("rechecks validity inside the synchronous commit and retains only prior committed bytes", async () => {
    const s = service(); s.begin(execution("B")); const prior = await register(s); s.seal("B", "succeeded");
    s.begin(execution("C"));
    const run = commands.runCommand;
    const mocked = vi.spyOn(commands, "runCommand").mockImplementationOnce((command, apply, now) => run(command, () => {
      live = false; return apply();
    }, now));
    try { await expect(register(s, execution("C"))).rejects.toMatchObject({ status: 409 }); }
    finally { mocked.mockRestore(); }
    expect(s.execution("C")?.artifacts).toEqual([]);
    expect(s.summary("build-task")?.lastDeliveredResultId).toBe(prior.id);
    expect(readdirSync(join(DATA_DIR, "attachments"))).toHaveLength(1);
    expect(readFileSync(prior.artifacts[0].attachment.path, "utf8")).toContain("Owner: unresolved");
  });

  it("caps descriptor reads and allocation when a source grows past 25 MiB, without deleting prior delivery", async () => {
    const s = service(); s.begin(execution("B")); const prior = await register(s); s.seal("B", "succeeded");
    const growing = join(root, "growing.md"); writeFileSync(growing, Buffer.alloc(FILE_MAX_BYTES - 7, 65));
    let consumed = 0; let maxRead = 0; let maxAllocation = 0; let wholeFileReads = 0;
    const buffers = new Set<unknown>();
    const originalOpen = messageFiles.openMessageFile;
    const mocked = vi.spyOn(messageFiles, "openMessageFile").mockImplementation(async (...args) => {
      const file = await originalOpen(...args);
      if (args[0] !== growing) return file;
      const stat = file.handle.stat.bind(file.handle);
      vi.spyOn(file.handle, "stat").mockImplementationOnce(async () => {
        const before = await stat(); appendFileSync(growing, Buffer.alloc(1024 * 1024, 66)); return before;
      });
      const read = file.handle.read.bind(file.handle);
      vi.spyOn(file.handle, "read").mockImplementation(async (...readArgs: any[]) => {
        buffers.add(readArgs[0]); maxRead = Math.max(maxRead, readArgs[2] ?? readArgs[0].byteLength);
        maxAllocation = Math.max(maxAllocation, readArgs[0].byteLength);
        const result = await Reflect.apply(read, file.handle, readArgs); consumed += result.bytesRead; return result;
      });
      const readFile = file.handle.readFile.bind(file.handle);
      vi.spyOn(file.handle, "readFile").mockImplementation(async () => {
        wholeFileReads++; const bytes = await readFile(); consumed += bytes.length; maxRead = bytes.length; maxAllocation = bytes.length; return bytes;
      });
      return file;
    });
    s.begin(execution("C"));
    let rejection: unknown;
    try {
      await register(s, execution("C"), { ...registration(), artifacts: [...registration().artifacts, { path: growing, scope: "host", title: "Growing source" }] });
    } catch (error) { rejection = error; } finally { mocked.mockRestore(); }
    expect(consumed).toBe(FILE_MAX_BYTES + 1);
    expect(maxRead).toBe(64 * 1024);
    expect(maxAllocation).toBe(64 * 1024);
    expect(buffers.size).toBe(1);
    expect(wholeFileReads).toBe(0);
    expect(rejection).toMatchObject({ status: 413 });
    expect(s.execution("C")?.artifacts).toEqual([]);
    expect(s.execution("C")?.deliveryOutcome).toBe("unverified");
    expect(readdirSync(join(DATA_DIR, "attachments"))).toHaveLength(1);
    expect(readFileSync(prior.artifacts[0].attachment.path, "utf8")).toContain("Owner: unresolved");
  });

  it("accepts a stable file exactly at the per-file byte limit", async () => {
    writeFileSync(join(root, "packet.md"), Buffer.alloc(FILE_MAX_BYTES, 65));
    const s = service(); s.begin(execution("B")); const result = await register(s);
    expect(result.artifacts[0].bytes).toBe(FILE_MAX_BYTES);
    const expected = createHash("sha256");
    for (let i = 0; i < FILE_MAX_BYTES / 1024; i++) expected.update(Buffer.alloc(1024, 65));
    expect(result.artifacts[0].sha256).toBe(expected.digest("hex"));
  });

  it("rejects an under-limit source change before its attachment partial can commit", async () => {
    const originalOpen = messageFiles.openMessageFile;
    const mocked = vi.spyOn(messageFiles, "openMessageFile").mockImplementationOnce(async (...args) => {
      const file = await originalOpen(...args);
      const stat = file.handle.stat.bind(file.handle);
      vi.spyOn(file.handle, "stat").mockImplementationOnce(async () => {
        const before = await stat(); appendFileSync(join(root, "packet.md"), "changed"); return before;
      });
      return file;
    });
    const s = service(); s.begin(execution("B"));
    try { await expect(register(s)).rejects.toMatchObject({ status: 409 }); }
    finally { mocked.mockRestore(); }
    expect(s.execution("B")?.artifacts).toEqual([]);
    expect(readdirSync(join(DATA_DIR, "attachments"))).toEqual([]);
  });

  it("enforces the remaining aggregate budget incrementally when a later source grows", async () => {
    const s = service(); s.begin(execution("B")); const prior = await register(s); s.seal("B", "succeeded");
    const paths = [join(root, "first.md"), join(root, "second.md"), join(root, "last.md")];
    paths.forEach((path, i) => writeFileSync(path, Buffer.alloc((i < 2 ? 24 : 1) * 1024 * 1024)));
    let consumed = 0;
    const originalOpen = messageFiles.openMessageFile;
    const mocked = vi.spyOn(messageFiles, "openMessageFile").mockImplementation(async (...args) => {
      const file = await originalOpen(...args);
      if (args[0] !== paths[2]) return file;
      const stat = file.handle.stat.bind(file.handle);
      vi.spyOn(file.handle, "stat").mockImplementationOnce(async () => {
        const before = await stat(); appendFileSync(paths[2], Buffer.alloc(4 * 1024 * 1024)); return before;
      });
      const read = file.handle.read.bind(file.handle);
      vi.spyOn(file.handle, "read").mockImplementation(async (...readArgs: any[]) => {
        const result = await Reflect.apply(read, file.handle, readArgs); consumed += result.bytesRead; return result;
      });
      return file;
    });
    s.begin(execution("C"));
    try {
      await expect(register(s, execution("C"), { ...registration(), artifacts: paths.map(path => ({ path, scope: "host", title: "Budget fixture" })) }))
        .rejects.toMatchObject({ status: 413 });
    } finally { mocked.mockRestore(); }
    expect(consumed).toBe(2 * 1024 * 1024 + 1);
    expect(s.execution("C")?.artifacts).toEqual([]);
    expect(readdirSync(join(DATA_DIR, "attachments"))).toHaveLength(1);
    expect(readFileSync(prior.artifacts[0].attachment.path, "utf8")).toContain("Owner: unresolved");
  });

  it("retains immutable attachment bytes when the original is changed or missing", async () => {
    const s = service(); s.begin(execution("B")); const r = await register(s); s.seal("B", "succeeded");
    writeFileSync(join(root, "packet.md"), "changed"); rmSync(join(root, "packet.md"));
    const artifact = s.lookup("builder", "build-task")[0].artifacts[0];
    expect(artifact).toEqual(r.artifacts[0]);
    expect(readFileSync(artifact.attachment.path, "utf8")).toContain("Owner: unresolved");
  });

  it("preserves explicit VM scope and rejects a VM registration without the claimed VM", async () => {
    const s = service(); s.begin(execution("B"));
    const value = { ...registration(), artifacts: [{ path: "/home/cua/workspace/packet.md", scope: "vm", title: "VM packet" }] };
    await expect(register(s, execution("B"), value)).rejects.toThrow(/VM/);
    const r = await s.register(execution("B"), value, { roots: [], guest: { root: "/home/cua/workspace", host: root }, isLive: () => true });
    expect(r.artifacts[0].scope).toBe("vm");
    expect(r.artifacts[0].locator).toBe("/home/cua/workspace/packet.md");
  });

  it("reconciles once after a crash after message commit, without waking any model", async () => {
    const s = service(); s.begin(execution("B")); await register(s); s.seal("B", "succeeded");
    crashAfterPublish = true; expect(() => s.reconcile()).toThrow(/crash after/);
    closeMessageDb(); crashAfterPublish = false; service().reconcile(); service().reconcile();
    expect(publications).toBe(1);
    expect(readThread("chief-task", "/missing").messages).toHaveLength(1);
    expect(service().lookup("chief", "build-task")[0].notification).toMatchObject({ state: "reported", noWake: true });
  });

  it("suppresses a result when requester access was revoked or its task deleted", async () => {
    const s = service(); s.begin(execution("B")); await register(s); s.seal("B", "succeeded"); reachable = false;
    s.reconcile(); expect(publications).toBe(0);
    expect(s.lookup("builder", "build-task")[0].notification).toMatchObject({ state: "suppressed", reason: "revoked" });
    s.begin(execution("C")); await register(s, execution("C")); s.seal("C", "failed"); reachable = true; targetExists = false; s.reconcile();
    expect(s.lookup("builder", "build-task")[0].notification.reason).toBe("deleted");
  });

  it("reconciles an attachment message once after its commit but before acknowledgement", async () => {
    let crash = true; let copies = 0;
    const s = new TaskResults({
      authorizeThread: () => true, notificationAccess: () => "allowed", publish: () => "source-card",
      publishArtifacts: result => {
        const message = runCommand({ kind: "task-result.artifacts", key: result.id }, () => {
          copies++;
          const value = { id: `files-${result.id}`, at: 1, role: "bot" as const, kind: "text" as const,
            text: "Saved files", attachments: result.artifacts.map(a => a.attachment) };
          insertMessage(result.threadId, value); return value;
        });
        if (crash) throw new Error("crash before attachment acknowledgement");
        return message.id;
      },
    });
    s.begin(execution("B")); await register(s); s.seal("B", "succeeded");
    expect(() => s.reconcile()).toThrow(/attachment acknowledgement/);
    closeMessageDb(); crash = false; s.reconcile(); s.reconcile();
    expect(copies).toBe(1);
    expect(readThread("build-task", "/missing").messages).toHaveLength(1);
    expect(s.lookup("builder", "build-task")[0].artifactPublication).toMatchObject({ state: "reported" });
  });

  it("marks interrupted executions on restart without replaying effects or losing registered files", async () => {
    const s = service(); s.begin(execution("B")); const r = await register(s);
    closeMessageDb(); service().recoverInterrupted();
    expect(service().lookup("builder", "build-task")[0]).toMatchObject({ id: r.id, executionOutcome: "interrupted", deliveryOutcome: "partial" });
    expect(publications).toBe(0);
  });
});
