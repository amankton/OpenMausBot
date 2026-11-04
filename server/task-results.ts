import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { z } from "zod";
import type { ArtifactVersion, ExecutionOutcome, ResultSource, TaskResult, TaskResultSummary, VerificationRecord } from "../shared/task-result.ts";
import { deleteAttachment, FILE_MAX_BYTES, saveFile } from "./attachments.ts";
import { guestWorkspaceToHost } from "./bot-attachment.ts";
import { runCommand } from "./commands.ts";
import { taskResultById, taskResultRow, taskResultRows, taskResultWorkRows, writeTaskResult } from "./message-db.ts";
import { openMessageFile } from "./message-file.ts";
import { redactSecretsInText } from "./redact.ts";

export type ResultExecution = Pick<TaskResult, "botId" | "threadId" | "executionId" | "requestMessageId" | "requestId" | "modelInstanceId" | "retryOfExecutionId" | "source">;
export const registrationSchema = z.object({
  summary: z.string().trim().min(1).max(2000),
  deliveryOutcome: z.enum(["delivered", "partial", "blocked", "unverified"]),
  dataKind: z.enum(["synthetic", "real", "unspecified"]).default("unspecified"),
  artifacts: z.array(z.object({ path: z.string().min(1).max(8192), title: z.string().min(1).max(160), scope: z.enum(["host", "vm"]) }).strict()).max(4).default([]),
  verifications: z.array(z.object({
    check: z.string().min(1).max(200), outcome: z.enum(["passed", "failed", "not_run", "unknown"]),
    artifactIndex: z.number().int().nonnegative().optional(),
  }).strict()).max(10).default([]),
}).strict();

type Hooks = {
  authorizeThread(viewerBotId: string, threadId: string): boolean;
  notificationAccess(result: TaskResult, target: ResultSource): "allowed" | "revoked" | "deleted";
  /** Must project with a durable idempotency key. Never start a provider turn. */
  publish(result: TaskResult, target: ResultSource): string;
  /** Bind saved files to an authored message using existing attachment guards. */
  publishArtifacts?(result: TaskResult): string | undefined;
};
function fail(status: number, message: string): never { throw Object.assign(new Error(message), { status }); }
const decode = (row: { payload: string } | null): TaskResult | null => row ? JSON.parse(row.payload) as TaskResult : null;
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export class TaskResults {
  private readonly hooks: Hooks;
  constructor(hooks: Hooks) { this.hooks = hooks; }

  execution(executionId: string): TaskResult | null { return decode(taskResultRow(executionId)); }
  latest(threadId: string): TaskResult | null { return decode(taskResultRows(threadId)[0] ?? null); }

  begin(execution: ResultExecution): TaskResult {
    return runCommand({ kind: "task-result.begin", key: execution.executionId }, () => {
      const previous = decode(taskResultRows(execution.threadId)[0] ?? null);
      const result: TaskResult = { ...execution, schemaVersion: 1, id: `result_${hash(execution.executionId).slice(0, 32)}`,
        createdAt: Date.now(), executionOutcome: "running", deliveryOutcome: "unverified", summary: "No deliverable registered.",
        dataKind: "unspecified", dataKindAuthority: "agent_claim", artifacts: [], verifications: [],
        notification: { state: "none", noWake: true }, ...(previous ? { previousExecutionId: previous.executionId } : {}),
      };
      writeTaskResult(result, JSON.stringify(result)); return result;
    });
  }

  async register(execution: ResultExecution, input: unknown, files: { roots: readonly string[]; guest?: { root: string; host: string }; isLive(): boolean }): Promise<TaskResult> {
    if (!files.isLive()) fail(409, "The execution ended; use task_results to read its result.");
    const parsed = registrationSchema.safeParse(input);
    if (!parsed.success) fail(400, "Invalid task result: use bounded files and verification claims; observation authority is assigned by the harness.");
    const value = parsed.data;
    if (value.deliveryOutcome === "delivered" && !value.artifacts.length) fail(400, "A delivered result needs at least one explicit file. Consultations do not need registration.");
    if (value.verifications.some(v => v.artifactIndex !== undefined && v.artifactIndex >= value.artifacts.length)) fail(400, "Verification artifactIndex is outside this result.");
    const signature = hash(JSON.stringify(value));
    const existing = taskResultRow(execution.executionId);
    const current = decode(existing);
    if (!current || current.botId !== execution.botId || current.threadId !== execution.threadId || current.executionOutcome !== "running") fail(409, "The execution ended or is not registered with this task.");
    if (existing?.registration_hash) {
      if (existing.registration_hash !== signature) fail(409, "This execution already registered a different result. Continue in a new execution.");
      return current;
    }
    const prepared: ArtifactVersion[] = [];
    let retained = new Set<string>();
    try {
      let totalBytes = 0;
      for (const [index, item] of value.artifacts.entries()) {
        if (/^https?:/i.test(item.path)) fail(400, "Remote URLs are not file observations; no URL is probed.");
        if (!isAbsolute(item.path)) fail(400, "Use an explicit absolute file path so its host or VM scope is unambiguous.");
        const vmPath = files.guest ? guestWorkspaceToHost(item.path, files.guest.root, files.guest.host) : null;
        if (item.scope === "vm" && !vmPath) fail(400, "VM files require the current claimed VM workspace and an absolute guest path.");
        if (item.scope === "host" && vmPath) fail(400, "A VM locator cannot be labeled host.");
        const file = await openMessageFile(vmPath ?? item.path, item.scope === "vm" ? [files.guest!.host] : files.roots);
        try {
          if (file.bytes > FILE_MAX_BYTES || totalBytes + file.bytes > FILE_MAX_BYTES * 2) fail(413, "Result files exceed the bounded attachment budget.");
          const before = await file.handle.stat();
          const digest = createHash("sha256");
          let bytes = 0;
          async function* chunks(): AsyncGenerator<Buffer> {
            const buffer = Buffer.allocUnsafe(64 * 1024);
            for (;;) {
              const remaining = Math.min(FILE_MAX_BYTES - bytes, FILE_MAX_BYTES * 2 - totalBytes);
              // One sentinel byte distinguishes exact-limit EOF from growth.
              const { bytesRead } = await file.handle.read(buffer, 0, Math.min(buffer.length, remaining + 1), null);
              if (!bytesRead) break;
              if (bytesRead > remaining) fail(413, "Result files exceed the bounded attachment budget.");
              bytes += bytesRead; totalBytes += bytesRead;
              const chunk = buffer.subarray(0, bytesRead);
              digest.update(chunk);
              yield chunk;
            }
            const after = await file.handle.stat();
            // Validate before the storage consumer commits its partial file.
            if (bytes !== file.bytes || before.mtimeMs !== after.mtimeMs || before.size !== after.size) fail(409, "The file changed while it was being observed; finish writing it first.");
          }
          const saved = await saveFile(chunks(), file.name, file.mime, { expectedBytes: file.bytes });
          prepared.push({ schemaVersion: 1, id: `${current.id}:artifact:${index}`, title: redactSecretsInText(item.title), scope: item.scope,
            locator: item.path, observedAt: Date.now(), sha256: digest.digest("hex"), bytes,
            attachment: { kind: "file", path: saved.path, name: saved.name, mime: saved.mime },
          });
        } finally { await file.handle.close(); }
      }
      if (!files.isLive()) fail(409, "The execution ended while files were read; no result was registered.");
      const result = runCommand({ kind: "task-result.register", key: execution.executionId }, () => {
        if (!files.isLive()) fail(409, "The execution or pinned computer ownership ended before registration committed.");
        const latest = decode(taskResultRow(execution.executionId));
        if (!latest || latest.executionOutcome !== "running") fail(409, "The execution ended before registration committed.");
        const verifications: VerificationRecord[] = prepared.map((artifact, i) => ({ schemaVersion: 1, id: `${current.id}:observed:${i}`,
          authority: "harness_observation", check: "file-content-identity", outcome: "passed", artifactIds: [artifact.id], observedAt: artifact.observedAt, botId: execution.botId }));
        value.verifications.forEach((v, i) => verifications.push({ schemaVersion: 1, id: `${current.id}:claim:${i}`, authority: "agent_claim",
          check: redactSecretsInText(v.check), outcome: v.outcome, artifactIds: v.artifactIndex === undefined ? [] : [prepared[v.artifactIndex]!.id], observedAt: Date.now(), botId: execution.botId }));
        const next: TaskResult = { ...latest, summary: redactSecretsInText(value.summary), deliveryOutcome: value.deliveryOutcome, dataKind: value.dataKind, artifacts: prepared, verifications };
        writeTaskResult(next, JSON.stringify(next), signature); return next;
      });
      retained = new Set(result.artifacts.map(a => a.attachment.path));
      if (taskResultRow(execution.executionId)?.registration_hash !== signature) fail(409, "This execution already registered a different result.");
      return result;
    } finally {
      for (const artifact of prepared) if (!retained.has(artifact.attachment.path)) deleteAttachment(artifact.attachment.path);
    }
  }

  seal(executionId: string, outcome: Exclude<ExecutionOutcome, "running">, providerTurnId?: string): TaskResult | null {
    const current = decode(taskResultRow(executionId));
    if (!current) return null;
    return runCommand({ kind: "task-result.seal", key: executionId }, () => {
      const latest = decode(taskResultRow(executionId))!;
      const result: TaskResult = { ...latest, executionOutcome: outcome, sealedAt: Date.now(), ...(providerTurnId ? { providerTurnId } : {}),
        deliveryOutcome: outcome !== "succeeded" && latest.deliveryOutcome === "delivered" ? "partial" : latest.deliveryOutcome,
        notification: { state: latest.source && latest.artifacts.length ? "pending" : "none", noWake: true },
      };
      writeTaskResult(result, JSON.stringify(result)); return result;
    });
  }

  lookup(viewerBotId: string, threadId: string, resultId?: string): TaskResult[] {
    if (!this.hooks.authorizeThread(viewerBotId, threadId)) fail(403, "Task results are not available to this caller.");
    if (resultId !== undefined) { const result = decode(taskResultById(threadId, resultId)); return result ? [result] : []; }
    return taskResultRows(threadId).map(row => decode(row)!);
  }

  summary(threadId: string): TaskResultSummary | undefined {
    const rows = taskResultRows(threadId).map(row => decode(row)!);
    if (!rows.length) return undefined;
    const delivered = rows.find(r => r.deliveryOutcome === "delivered" && r.executionOutcome === "succeeded");
    return { latestResultId: rows[0].id, executionOutcome: rows[0].executionOutcome, deliveryOutcome: rows[0].deliveryOutcome,
      ...(delivered ? { lastDeliveredResultId: delivered.id } : {}),
    };
  }

  recoverInterrupted(): void {
    for (const row of taskResultWorkRows("running")) { const result = decode(row)!; this.seal(result.executionId, "interrupted"); }
  }

  /** Projects durable cards only. No queue/provider/model wake is called. */
  reconcile(): void {
    for (const row of taskResultWorkRows("pending")) {
      const result = decode(row)!;
      if (result.executionOutcome !== "running" && result.artifacts.length && !result.artifactPublication && this.hooks.publishArtifacts) {
        const messageId = this.hooks.publishArtifacts(result);
        result.artifactPublication = messageId ? { state: "reported", messageId } : { state: "suppressed", reason: "deleted" };
        writeTaskResult(result, JSON.stringify(result));
      }
      if (result.notification.state !== "pending" || !result.source) continue;
      const access = this.hooks.notificationAccess(result, result.source);
      result.notification = access === "allowed"
        ? { state: "reported", noWake: true, messageId: this.hooks.publish(result, result.source) }
        : { state: "suppressed", noWake: true, reason: access };
      writeTaskResult(result, JSON.stringify(result));
    }
  }
}
