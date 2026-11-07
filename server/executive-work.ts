import { chmodSync, closeSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { executiveNotificationPresentation } from "./executive-notifications.ts";
import {
  DEFAULT_EXECUTIVE_SETTINGS, executiveRunSchema, executiveSettingsSchema, workItemCreateSchema, workItemPatchSchema, workMutationSchema,
  type ExecutiveRun, type ExecutiveSettings, type ExecutiveSettingsPatch, type WorkEvent, type WorkItem, type WorkItemCreate, type WorkItemPatch, type WorkMutation, type WorkNotification, type WorkStatus,
} from "../shared/executive-work.ts";

export const EXECUTIVE_WORK_SCHEMA_VERSION = 1;
export class ExecutiveWorkError extends Error {
  readonly code: "not-found" | "conflict" | "invalid" | "leased";
  constructor(code: "not-found" | "conflict" | "invalid" | "leased", message: string) { super(message); this.code = code; }
}
const stringId = z.string().trim().min(1).max(240);
const closed = (status: WorkStatus) => status === "done" || status === "dismissed";
const transitions: Record<WorkStatus, WorkStatus[]> = {
  proposed: ["queued", "waiting-on-human", "blocked", "dismissed"],
  queued: ["working", "waiting-on-human", "waiting-on-other", "blocked", "dismissed"],
  working: ["ready-for-review", "waiting-on-human", "waiting-on-other", "blocked", "dismissed"],
  "waiting-on-human": ["queued", "working", "ready-for-review", "blocked", "dismissed"],
  "waiting-on-other": ["queued", "working", "ready-for-review", "blocked", "dismissed"],
  blocked: ["queued", "working", "waiting-on-human", "waiting-on-other", "dismissed"],
  "ready-for-review": ["done", "working", "waiting-on-human", "blocked", "dismissed"],
  done: ["queued", "proposed"], dismissed: ["queued", "proposed"],
};
function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function parse<T>(raw: unknown): T { return JSON.parse((raw as { payload: string }).payload) as T; }
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
function minuteAt(at: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  return Number(parts.find(part => part.type === "hour")!.value) * 60 + Number(parts.find(part => part.type === "minute")!.value);
}
export function notificationAvailableAt(at: number, settings: ExecutiveSettings, priority: number): number {
  const quiet = settings.notifications.quietHours;
  if (!quiet || (priority === 1 && settings.notifications.urgentBypassesQuiet)) return at;
  const toMinute = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const start = toMinute(quiet.start), end = toMinute(quiet.end);
  const inQuiet = (minute: number) => start === end || (start < end ? minute >= start && minute < end : minute >= start || minute < end);
  if (start === end) return Number.MAX_SAFE_INTEGER;
  if (!inQuiet(minuteAt(at, settings.timezone))) return at;
  // Evaluate real instants across DST rather than constructing local times.
  let next = Math.floor(at / 60_000) * 60_000 + 60_000;
  for (let i = 0; i < 26 * 60; i++, next += 60_000) if (!inQuiet(minuteAt(next, settings.timezone))) return next;
  return Number.MAX_SAFE_INTEGER;
}

/** Server-owned operational queue. Every mutation, event and notification is one transaction. */
export class ExecutiveWorkStore {
  readonly dbPath: string;
  private db: DatabaseSync;
  private now: () => number;
  constructor(dataDir: string, now: () => number = Date.now) {
    this.now = now;
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.dbPath = join(dataDir, "executive-work.db");
    closeSync(openSync(this.dbPath, "a", 0o600));
    try { chmodSync(this.dbPath, 0o600); } catch { /* Windows inherits the owner's workspace ACL. */ }
    this.db = new DatabaseSync(this.dbPath, { timeout: 5000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    const version = (this.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (version > EXECUTIVE_WORK_SCHEMA_VERSION) { this.db.close(); throw new ExecutiveWorkError("invalid", "Work queue uses a newer schema; refusing to overwrite it"); }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS executive_items (id TEXT PRIMARY KEY, account_scope TEXT NOT NULL, source_kind TEXT NOT NULL, source_id TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, UNIQUE(account_scope,source_kind,source_id));
      CREATE TABLE IF NOT EXISTS executive_events (account_scope TEXT NOT NULL,event_id TEXT NOT NULL,request_hash TEXT NOT NULL,work_item_id TEXT NOT NULL,revision INTEGER NOT NULL,at INTEGER NOT NULL,kind TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(account_scope,event_id));
      CREATE TABLE IF NOT EXISTS executive_idempotency (account_scope TEXT NOT NULL,key TEXT NOT NULL,request_hash TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(account_scope,key));
      CREATE TABLE IF NOT EXISTS executive_notifications (id TEXT PRIMARY KEY,account_scope TEXT NOT NULL,work_item_id TEXT NOT NULL,revision INTEGER NOT NULL,state TEXT NOT NULL,available_at INTEGER NOT NULL,payload TEXT NOT NULL,UNIQUE(account_scope,work_item_id,revision));
      CREATE TABLE IF NOT EXISTS executive_settings (id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS executive_leases (scope TEXT PRIMARY KEY,owner TEXT NOT NULL,token TEXT NOT NULL,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS executive_runs (account_scope TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(account_scope,id));
      CREATE TABLE IF NOT EXISTS executive_callbacks (account_scope TEXT NOT NULL,event_id TEXT NOT NULL,work_item_id TEXT NOT NULL,expected_revision INTEGER NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,PRIMARY KEY(account_scope,event_id));
      PRAGMA user_version=1;
    `);
    this.db.prepare("INSERT OR IGNORE INTO executive_settings(id,revision,payload) VALUES(1,0,?)").run(JSON.stringify(DEFAULT_EXECUTIVE_SETTINGS));
  }
  close() { this.db.close(); }
  private atomic<T>(action: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const value = action(); this.db.exec("COMMIT"); return value; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  settings(): ExecutiveSettings { return executiveSettingsSchema.parse(parse(this.db.prepare("SELECT payload FROM executive_settings WHERE id=1").get())); }
  saveSettings(expectedRevision: number, patch: ExecutiveSettingsPatch): ExecutiveSettings {
    z.number().int().nonnegative().parse(expectedRevision);
    return this.atomic(() => {
      const current = this.settings();
      if (current.revision !== expectedRevision) throw new ExecutiveWorkError("conflict", "Executive settings changed; reload before saving");
      const next = executiveSettingsSchema.parse({ ...current, ...patch, revision: current.revision + 1 });
      this.db.prepare("UPDATE executive_settings SET revision=?,payload=? WHERE id=1").run(next.revision, JSON.stringify(next));
      return next;
    });
  }
  get(accountScope: string, id: string): WorkItem | undefined {
    stringId.parse(accountScope); stringId.parse(id);
    const row = this.db.prepare("SELECT payload FROM executive_items WHERE account_scope=? AND id=?").get(accountScope, id);
    return row ? parse<WorkItem>(row) : undefined;
  }
  list(filter: { accountScope?: string; ownerBotId?: string; coordinatorBotId?: string; statuses?: WorkStatus[]; limit?: number } = {}): WorkItem[] {
    const f = z.object({ accountScope: stringId.optional(), ownerBotId: stringId.optional(), coordinatorBotId: stringId.optional(), statuses: z.array(z.enum(Object.keys(transitions) as [WorkStatus, ...WorkStatus[]])).optional(), limit: z.number().int().min(1).max(1000).default(200) }).strict().parse(filter);
    const rows = f.accountScope ? this.db.prepare("SELECT payload FROM executive_items WHERE account_scope=? ORDER BY json_extract(payload,'$.updatedAt') DESC").all(f.accountScope) : this.db.prepare("SELECT payload FROM executive_items ORDER BY json_extract(payload,'$.updatedAt') DESC").all();
    return rows.map(row => parse<WorkItem>(row)).filter(item => (!f.ownerBotId || item.ownerBotId === f.ownerBotId) && (!f.coordinatorBotId || item.coordinatorBotId === f.coordinatorBotId) && (!f.statuses || f.statuses.includes(item.status))).slice(0, f.limit);
  }
  private checkCompletion(item: WorkItem) {
    if (item.status === "done") {
      if (!item.completion || item.completion.sourceVersion !== item.source.version) throw new ExecutiveWorkError("invalid", "Completion requires reviewed evidence or user confirmation for the current source version");
      if (item.executionStatus === "outcome-unknown") throw new ExecutiveWorkError("invalid", "Reconcile the unknown execution outcome before closing work");
    }
  }
  private cached(accountScope: string, mutation: WorkMutation, requestHash: string): WorkItem | undefined {
    const event = this.db.prepare("SELECT request_hash,result FROM executive_events WHERE account_scope=? AND event_id=?").get(accountScope, mutation.eventId) as { request_hash: string; result: string } | undefined;
    const previous = event ?? (mutation.idempotencyKey ? this.db.prepare("SELECT request_hash,result FROM executive_idempotency WHERE account_scope=? AND key=?").get(accountScope, mutation.idempotencyKey) as { request_hash: string; result: string } | undefined : undefined);
    if (!previous) return undefined;
    if (previous.request_hash !== requestHash) throw new ExecutiveWorkError("conflict", "Event/idempotency key was already used for a different operation");
    return JSON.parse(previous.result) as WorkItem;
  }
  private record(item: WorkItem, kind: WorkEvent["kind"], mutation: WorkMutation, requestHash: string, notify = true) {
    const result = JSON.stringify(item);
    this.db.prepare("INSERT INTO executive_events(account_scope,event_id,request_hash,work_item_id,revision,at,kind,result) VALUES(?,?,?,?,?,?,?,?)").run(item.accountScope, mutation.eventId, requestHash, item.id, item.revision, this.now(), kind, result);
    if (mutation.idempotencyKey) this.db.prepare("INSERT INTO executive_idempotency(account_scope,key,request_hash,result) VALUES(?,?,?,?)").run(item.accountScope, mutation.idempotencyKey, requestHash, result);
    if (!notify) return;
    const settings = this.settings(), at = this.now();
    const presentation = executiveNotificationPresentation(item);
    const reason = !presentation ? "no-owner-action" : !settings.notifications.enabled ? "notifications-disabled" : item.priority > settings.notifications.priorityThreshold ? "below-priority-threshold" : undefined;
    const notification: WorkNotification = { id: randomUUID(), accountScope: item.accountScope, workItemId: item.id, revision: item.revision, botId: item.source.botId ?? item.ownerBotId, threadId: item.sourceThreadId, title: item.title, priority: item.priority, state: reason ? "suppressed" : "pending", availableAt: notificationAvailableAt(at, settings, item.priority), createdAt: at, ...(reason ? { reason } : {}) };
    this.db.prepare("INSERT INTO executive_notifications(id,account_scope,work_item_id,revision,state,available_at,payload) VALUES(?,?,?,?,?,?,?)").run(notification.id, item.accountScope, item.id, item.revision, notification.state, notification.availableAt, JSON.stringify(notification));
  }
  create(input: WorkItemCreate, mutationInput: WorkMutation): WorkItem {
    const data = workItemCreateSchema.parse(input), mutation = workMutationSchema.parse(mutationInput);
    const requestHash = hash(stableJson({ operation: "create", data }));
    return this.atomic(() => {
      const previous = this.cached(data.accountScope, mutation, requestHash); if (previous) return previous;
      const existing = this.db.prepare("SELECT payload FROM executive_items WHERE account_scope=? AND source_kind=? AND source_id=?").get(data.accountScope, data.source.kind, data.source.id);
      if (existing) { const item = parse<WorkItem>(existing); this.record(item, "updated", mutation, requestHash, false); return item; }
      if (data.status === "done" || data.status === "dismissed") throw new ExecutiveWorkError("invalid", "New work must enter the open lifecycle before resolution");
      const item: WorkItem = { ...data, id: randomUUID(), revision: 1, createdAt: this.now(), updatedAt: this.now() };
      this.checkCompletion(item);
      this.db.prepare("INSERT INTO executive_items(id,account_scope,source_kind,source_id,revision,payload) VALUES(?,?,?,?,?,?)").run(item.id, item.accountScope, item.source.kind, item.source.id, item.revision, JSON.stringify(item));
      this.record(item, "created", mutation, requestHash); return item;
    });
  }
  update(accountScope: string, id: string, expectedRevision: number, patchInput: WorkItemPatch, mutationInput: WorkMutation): WorkItem {
    stringId.parse(accountScope); stringId.parse(id); z.number().int().positive().parse(expectedRevision);
    const patch = workItemPatchSchema.parse(patchInput), mutation = workMutationSchema.parse(mutationInput);
    const requestHash = hash(stableJson({ operation: "update", id, expectedRevision, patch, reopenReason: mutation.reopenReason, resolutionActor: mutation.resolutionActor, resolutionReason: mutation.resolutionReason }));
    return this.atomic(() => {
      const previous = this.cached(accountScope, mutation, requestHash); if (previous) return previous;
      const current = this.get(accountScope, id); if (!current) throw new ExecutiveWorkError("not-found", "No work item in this account scope");
      if (current.revision !== expectedRevision) throw new ExecutiveWorkError("conflict", "Work item changed; inspect the current revision before updating");
      const next: WorkItem = { ...current, ...patch, source: patch.source ?? current.source, revision: current.revision + 1, updatedAt: this.now() };
      workItemCreateSchema.parse(Object.fromEntries(Object.entries(next).filter(([key]) => Object.hasOwn(workItemCreateSchema.shape, key))));
      if (next.source.kind !== current.source.kind || next.source.id !== current.source.id) throw new ExecutiveWorkError("invalid", "Source identity cannot move between work items");
      if (closed(current.status) && !closed(next.status) && (!mutation.reopenReason || next.source.version === current.source.version)) throw new ExecutiveWorkError("invalid", "Reopening needs genuinely new source evidence and a recorded reason");
      if (current.status !== next.status && !transitions[current.status].includes(next.status)) throw new ExecutiveWorkError("invalid", `Invalid work transition: ${current.status} to ${next.status}`);
      if (current.source.version !== next.source.version && !closed(next.status)) delete next.completion;
      // A later reply may be observed on resolved work without declaring that
      // reply resolved or reopening the obligation. Keep its historical proof.
      if (!(current.status === "done" && next.status === "done" && patch.completion === undefined)) this.checkCompletion(next);
      if (closed(next.status)) {
        next.resolvedAt = closed(current.status) ? current.resolvedAt : this.now(); next.resolutionActor = next.completion?.actor ?? mutation.resolutionActor ?? current.resolutionActor;
        next.resolutionReason = next.completion?.reason ?? mutation.resolutionReason ?? current.resolutionReason;
        if (!next.resolutionActor || !next.resolutionReason) throw new ExecutiveWorkError("invalid", "Resolution needs an actor and reason");
      } else { delete next.resolvedAt; delete next.resolutionActor; delete next.resolutionReason; }
      const material = ["title", "desiredOutcome", "nextAction", "status", "priority", "deadline", "completion", "executionStatus"].some(key => stableJson(current[key as keyof WorkItem]) !== stableJson(next[key as keyof WorkItem]));
      this.db.prepare("UPDATE executive_items SET revision=?,payload=? WHERE account_scope=? AND id=?").run(next.revision, JSON.stringify(next), accountScope, id);
      this.record(next, "updated", mutation, requestHash, material && (!closed(current.status) || !closed(next.status))); return next;
    });
  }
  events(accountScope: string, id?: string): WorkEvent[] {
    stringId.parse(accountScope); if (id) stringId.parse(id);
    const rows = id ? this.db.prepare("SELECT * FROM executive_events WHERE account_scope=? AND work_item_id=? ORDER BY at,event_id").all(accountScope, id) : this.db.prepare("SELECT * FROM executive_events WHERE account_scope=? ORDER BY at,event_id LIMIT 1000").all(accountScope);
    return rows.map(raw => { const row = raw as { event_id: string; account_scope: string; work_item_id: string; revision: number; kind: WorkEvent["kind"]; at: number }; return { id: row.event_id, accountScope: row.account_scope, workItemId: row.work_item_id, revision: row.revision, kind: row.kind, at: row.at }; });
  }
  acquireLease(scope: string, owner: string, ttlMs = 60_000): { token: string; expiresAt: number } {
    stringId.parse(scope); stringId.parse(owner); z.number().int().min(1000).max(3_600_000).parse(ttlMs);
    return this.atomic(() => {
      const old = this.db.prepare("SELECT * FROM executive_leases WHERE scope=?").get(scope) as { expires_at: number } | undefined;
      if (old && old.expires_at > this.now()) throw new ExecutiveWorkError("leased", "Another run owns this scope");
      const token = randomUUID(), expiresAt = this.now() + ttlMs;
      this.db.prepare("INSERT INTO executive_leases(scope,owner,token,expires_at) VALUES(?,?,?,?) ON CONFLICT(scope) DO UPDATE SET owner=excluded.owner,token=excluded.token,expires_at=excluded.expires_at").run(scope, owner, token, expiresAt); return { token, expiresAt };
    });
  }
  releaseLease(scope: string, token: string): boolean { stringId.parse(scope); stringId.parse(token); return this.db.prepare("DELETE FROM executive_leases WHERE scope=? AND token=?").run(scope, token).changes === 1; }
  recordRun(input: ExecutiveRun): ExecutiveRun {
    const run = executiveRunSchema.parse(input);
    return this.atomic(() => {
      const old = this.db.prepare("SELECT payload FROM executive_runs WHERE account_scope=? AND id=?").get(run.accountScope, run.id);
      if (old) {
        const previous = parse<ExecutiveRun>(old);
        if (previous.startedAt !== run.startedAt || previous.botId !== run.botId || previous.threadId !== run.threadId || previous.kind !== run.kind) throw new ExecutiveWorkError("conflict", "Run identity cannot change");
        if (previous.status !== "working" && stableJson(previous) !== stableJson(run)) throw new ExecutiveWorkError("conflict", "A finished run receipt cannot be overwritten");
      }
      this.db.prepare("INSERT INTO executive_runs(account_scope,id,payload) VALUES(?,?,?) ON CONFLICT(account_scope,id) DO UPDATE SET payload=excluded.payload").run(run.accountScope, run.id, JSON.stringify(run)); return run;
    });
  }
  getRuns(accountScope?: string, limit = 50): ExecutiveRun[] {
    if (accountScope) stringId.parse(accountScope); z.number().int().min(1).max(1000).parse(limit);
    const rows = accountScope ? this.db.prepare("SELECT payload FROM executive_runs WHERE account_scope=? ORDER BY json_extract(payload,'$.startedAt') DESC LIMIT ?").all(accountScope, limit) : this.db.prepare("SELECT payload FROM executive_runs ORDER BY json_extract(payload,'$.startedAt') DESC LIMIT ?").all(limit);
    return rows.map(row => parse<ExecutiveRun>(row));
  }
  getRun(accountScope: string, id: string): ExecutiveRun | undefined {
    stringId.parse(accountScope); stringId.parse(id);
    const row = this.db.prepare("SELECT payload FROM executive_runs WHERE account_scope=? AND id=?").get(accountScope, id);
    return row ? parse<ExecutiveRun>(row) : undefined;
  }
  /** Remove expired run detail, retaining minimal identity/status tombstones so
   * an old event can never become a new scan merely because history aged out. */
  pruneRunDetails(): number {
    return this.atomic(() => {
      const cutoff = this.now() - this.settings().retention.runDays * 86_400_000;
      const rows = this.db.prepare("SELECT payload FROM executive_runs WHERE json_extract(payload,'$.status')!='working' AND json_extract(payload,'$.finishedAt')<? AND json_extract(payload,'$.detailsPrunedAt') IS NULL").all(cutoff);
      for (const row of rows) {
        const run = parse<ExecutiveRun>(row);
        run.gaps = ["Run detail expired under the configured retention policy; identity and outcome are retained for deduplication"];
        run.evidence = []; run.detailsPrunedAt = this.now();
        this.db.prepare("UPDATE executive_runs SET payload=? WHERE account_scope=? AND id=?").run(JSON.stringify(run), run.accountScope, run.id);
      }
      return rows.length;
    });
  }
  notifications(accountScope?: string): WorkNotification[] {
    if (accountScope) stringId.parse(accountScope);
    return (accountScope ? this.db.prepare("SELECT payload FROM executive_notifications WHERE account_scope=? ORDER BY available_at").all(accountScope) : this.db.prepare("SELECT payload FROM executive_notifications ORDER BY available_at").all()).map(row => parse<WorkNotification>(row));
  }
  pendingNotifications(): WorkNotification[] {
    const settings = this.settings(), at = this.now(); if (!settings.notifications.enabled) return [];
    return this.notifications().filter(row => row.state === "pending" && row.availableAt <= at && row.priority <= settings.notifications.priorityThreshold && notificationAvailableAt(at, settings, row.priority) === at);
  }
  claimNotification(id: string, owner: string): WorkNotification | undefined {
    stringId.parse(id); stringId.parse(owner);
    return this.atomic(() => {
      const row = this.pendingNotifications().find(candidate => candidate.id === id); if (!row) return undefined;
      const item = this.get(row.accountScope, row.workItemId);
      if (!item || item.revision !== row.revision || !executiveNotificationPresentation(item)) { row.state = "suppressed"; row.reason = "superseded"; this.saveNotification(row); return undefined; }
      row.state = "claimed"; row.claimOwner = owner; row.claimedAt = this.now(); this.saveNotification(row); return row;
    });
  }
  private saveNotification(row: WorkNotification) { this.db.prepare("UPDATE executive_notifications SET state=?,available_at=?,payload=? WHERE id=?").run(row.state, row.availableAt, JSON.stringify(row), row.id); }
  ackNotification(id: string, owner: string, outcome: "delivered" | "outcome-unknown"): void {
    stringId.parse(id); stringId.parse(owner); z.enum(["delivered", "outcome-unknown"]).parse(outcome);
    this.atomic(() => {
      const raw = this.db.prepare("SELECT payload FROM executive_notifications WHERE id=?").get(id);
      if (!raw) throw new ExecutiveWorkError("not-found", "No notification");
      const row = parse<WorkNotification>(raw);
      if (row.state === outcome && row.claimOwner === owner) return;
      if (row.state !== "claimed" || row.claimOwner !== owner) throw new ExecutiveWorkError("conflict", "Notification claim does not belong to this dispatcher");
      row.state = outcome; this.saveNotification(row);
      if (outcome === "delivered") {
        const item = this.get(row.accountScope, row.workItemId); if (!item) return;
        if ((item.lastSurfacedRevision ?? 0) < row.revision) { item.lastSurfacedAt = this.now(); item.lastSurfacedRevision = row.revision; }
        this.db.prepare("UPDATE executive_items SET payload=? WHERE account_scope=? AND id=?").run(JSON.stringify(item), row.accountScope, item.id);
      }
    });
  }
  /** A recorded callback is a review wake-up, never proof of completion. */
  enqueueCallback(accountScope: string, eventId: string, id: string, expectedRevision: number, evidenceReference: string): boolean {
    stringId.parse(accountScope); stringId.parse(eventId); stringId.parse(id); z.number().int().positive().parse(expectedRevision); z.string().min(1).max(1000).parse(evidenceReference);
    return this.atomic(() => {
      const item = this.get(accountScope, id); if (!item || item.revision !== expectedRevision || closed(item.status)) return false;
      const payload = JSON.stringify({ accountScope, eventId, workItemId: id, expectedRevision, evidenceReference, botId: item.source.botId ?? item.ownerBotId, threadId: item.sourceThreadId });
      const existing = this.db.prepare("SELECT payload FROM executive_callbacks WHERE account_scope=? AND event_id=?").get(accountScope, eventId) as { payload: string } | undefined;
      if (existing) { if (existing.payload !== payload) throw new ExecutiveWorkError("conflict", "Callback event reused with another result"); return false; }
      this.db.prepare("INSERT INTO executive_callbacks(account_scope,event_id,work_item_id,expected_revision,payload,state) VALUES(?,?,?,?,?,'pending')").run(accountScope, eventId, id, expectedRevision, payload); return true;
    });
  }
  pendingCallbacks(): Array<{ accountScope: string; eventId: string; workItemId: string; expectedRevision: number; evidenceReference: string; botId: string; threadId: string }> {
    return this.db.prepare("SELECT payload FROM executive_callbacks WHERE state='pending'").all().map(row => parse(row));
  }
  claimCallback(accountScope: string, eventId: string): boolean {
    stringId.parse(accountScope); stringId.parse(eventId);
    return this.atomic(() => {
      const row = this.db.prepare("SELECT * FROM executive_callbacks WHERE account_scope=? AND event_id=? AND state='pending'").get(accountScope, eventId) as { work_item_id: string; expected_revision: number } | undefined;
      if (!row) return false;
      const item = this.get(accountScope, row.work_item_id), valid = !!item && item.revision === row.expected_revision && !closed(item.status);
      this.db.prepare("UPDATE executive_callbacks SET state=? WHERE account_scope=? AND event_id=?").run(valid ? "claimed" : "superseded", accountScope, eventId); return valid;
    });
  }
  ackCallback(accountScope: string, eventId: string, outcome: "delivered" | "outcome-unknown") { stringId.parse(accountScope); stringId.parse(eventId); z.enum(["delivered", "outcome-unknown"]).parse(outcome); this.db.prepare("UPDATE executive_callbacks SET state=? WHERE account_scope=? AND event_id=? AND state='claimed'").run(outcome, accountScope, eventId); }
  /** Call only after obtaining the server's exclusive runtime ownership on a
   * genuine restart. Opening a second read connection must not invoke this. */
  recoverUnacknowledgedDispatches(): { notifications: number; callbacks: number } {
    return this.atomic(() => {
      const notifications = this.notifications().filter(row => row.state === "claimed");
      for (const row of notifications) { row.state = "outcome-unknown"; row.reason = "Process ended before delivery acknowledgment; inspect delivery evidence before retrying"; this.saveNotification(row); }
      const callbacks = this.db.prepare("UPDATE executive_callbacks SET state='outcome-unknown' WHERE state='claimed'").run().changes;
      return { notifications: notifications.length, callbacks: Number(callbacks) };
    });
  }
}
