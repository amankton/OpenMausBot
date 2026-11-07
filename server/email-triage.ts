import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { mailboxScopeSchema, mailClassificationSchema, type MailboxScope, type MailCapabilities, type MailMessageRef, type MailThread, type MailClassification, type MailScanReceipt } from "../shared/email-triage.ts";
import type { ExecutiveWorkStore } from "./executive-work.ts";

export { EMAIL_TRIAGE_ROLE } from "../shared/email-triage.ts";
export interface MailReadProvider {
  readonly capabilities: MailCapabilities;
  /** Setup may identify an explicitly selected active connection before an
   * expected address exists. This operation retrieves only GET_PROFILE. */
  identifyAccount?(accountId: string): Promise<{ accountId: string; address: string }>;
  verifyIdentity(scope: MailboxScope): Promise<{ accountId: string; address: string }>;
  list(scope: MailboxScope, window: { start: number; end: number; cursor?: string; historyCursor?: string; limit: number }): Promise<{ messages: MailMessageRef[]; nextCursor?: string; historyCursor?: string; truncated?: boolean }>;
  readThread(scope: MailboxScope, threadId: string): Promise<MailThread>;
}
export class MailCursorExpired extends Error {}
export type MailScopeGuard = (scope: MailboxScope) => void;
export type MailClassifier = (thread: MailThread, scope: MailboxScope) => Promise<MailClassification>;
type ScanSession = { start: number; end: number; cursor?: string; historyCursor?: string; complete: boolean; gaps: string[] };
type ReviewRecord = { accountId: string; threadId: string; version: string; status: "pending" | "reviewed"; classification?: MailClassification; workItemId?: string; publishPending: boolean; updatedAt: number };
const refSchema = z.object({ id: z.string().min(1).max(240), threadId: z.string().min(1).max(240), version: z.string().min(1).max(240), receivedAt: z.number().nonnegative().optional() }).strict();
const rowJson = <T>(row: unknown): T | undefined => row ? JSON.parse((row as { json: string }).json) as T : undefined;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
// Strip untrusted header controls before placing a summary in a queue title.
// eslint-disable-next-line no-control-regex
const oneLine = (value: string, max = 180) => value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** Mail checkpoints are private operational metadata. Bodies stay ephemeral;
 * only bounded classifications and owner-requested local reply text persist. */
export class EmailTriageStore {
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  constructor(dataDir: string, now: () => number = Date.now) {
    this.now = now;
    mkdirSync(dataDir, { recursive: true });
    const path = join(dataDir, "email-triage.db");
    this.db = new DatabaseSync(path, { timeout: 5000 });
    chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS mail_schema (version INTEGER NOT NULL);
      INSERT INTO mail_schema SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM mail_schema);
      CREATE TABLE IF NOT EXISTS mail_scans (account TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mail_messages (account TEXT NOT NULL, id TEXT NOT NULL, version TEXT NOT NULL, thread TEXT NOT NULL, PRIMARY KEY(account,id));
      CREATE TABLE IF NOT EXISTS mail_reviews (account TEXT NOT NULL, thread TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(account,thread));
      CREATE TABLE IF NOT EXISTS mail_receipts (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mail_leases (account TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS mail_state (key TEXT PRIMARY KEY, value INTEGER NOT NULL);`);
    const version = this.db.prepare("SELECT version FROM mail_schema").get() as { version: number };
    if (version.version !== 1) throw new Error("Unsupported mail state schema; refusing to overwrite it");
  }
  close() { this.db.close(); }
  private transaction<T>(fn: () => T): T { this.db.exec("BEGIN IMMEDIATE"); try { const value = fn(); this.db.exec("COMMIT"); return value; } catch (error) { this.db.exec("ROLLBACK"); throw error; } }
  lease(account: string, owner: string, ttlMs = 120_000) {
    return this.transaction(() => {
      const row = this.db.prepare("SELECT owner,expires FROM mail_leases WHERE account=?").get(account) as { owner: string; expires: number } | undefined;
      if (row && row.owner !== owner && row.expires > this.now()) throw new Error("Mailbox scan is already running");
      this.db.prepare("INSERT INTO mail_leases VALUES(?,?,?) ON CONFLICT(account) DO UPDATE SET owner=excluded.owner,expires=excluded.expires").run(account, owner, this.now() + ttlMs);
    });
  }
  assertLease(account: string, owner: string) {
    const row = this.db.prepare("SELECT owner,expires FROM mail_leases WHERE account=?").get(account) as { owner: string; expires: number } | undefined;
    if (!row || row.owner !== owner || row.expires <= this.now()) throw new Error("Mailbox scan lease expired or was superseded");
  }
  renewLease(account: string, owner: string, ttlMs = 120_000) {
    this.transaction(() => {
      this.assertLease(account, owner);
      this.db.prepare("UPDATE mail_leases SET expires=? WHERE account=? AND owner=?").run(this.now() + ttlMs, account, owner);
    });
  }
  withLease<T>(account: string, owner: string, commit: () => T): T { return this.transaction(() => { this.assertLease(account, owner); return commit(); }); }
  // Retain the last owner as a fencing token, including after release.
  // An expired old caller must never acquire its previous token again.
  release(account: string, owner: string) { this.db.prepare("UPDATE mail_leases SET expires=0 WHERE account=? AND owner=?").run(account, owner); }
  session(account: string): ScanSession | undefined { return rowJson(this.db.prepare("SELECT json FROM mail_scans WHERE account=?").get(account)); }
  begin(account: string, end: number, initialWindowMs: number, overlapMs: number, leaseOwner?: string): ScanSession {
    if (leaseOwner) return this.withLease(account, leaseOwner, () => this.begin(account, end, initialWindowMs, overlapMs));
    const previous = this.session(account);
    if (previous && !previous.complete) return previous;
    const state: ScanSession = { start: previous ? Math.max(0, previous.end - overlapMs) : Math.max(0, end - initialWindowMs), end, historyCursor: previous?.historyCursor, complete: false, gaps: [] };
    this.saveSession(account, state); return state;
  }
  private saveSession(account: string, session: ScanSession) { this.db.prepare("INSERT INTO mail_scans VALUES(?,?) ON CONFLICT(account) DO UPDATE SET json=excluded.json").run(account, JSON.stringify(session)); }
  /** Page IDs, review backlog, and the discovery cursor commit together. */
  page(account: string, state: ScanSession, input: MailMessageRef[], nextCursor?: string, historyCursor?: string, truncated = false, leaseOwner?: string) {
    const messages = z.array(refSchema).max(200).parse(input);
    return this.transaction(() => {
      if (leaseOwner) this.assertLease(account, leaseOwner);
      let fresh = 0;
      for (const message of messages) {
        const previous = this.db.prepare("SELECT version FROM mail_messages WHERE account=? AND id=?").get(account, message.id) as { version: string } | undefined;
        if (previous?.version === message.version) continue;
        this.db.prepare("INSERT INTO mail_messages VALUES(?,?,?,?) ON CONFLICT(account,id) DO UPDATE SET version=excluded.version,thread=excluded.thread").run(account, message.id, message.version, message.threadId);
        const old = this.review(account, message.threadId);
        this.putReview({ accountId: account, threadId: message.threadId, version: message.version, status: "pending", workItemId: old?.workItemId, publishPending: false, updatedAt: this.now() });
        fresh++;
      }
      const next = { ...state, cursor: nextCursor, historyCursor: historyCursor ?? state.historyCursor, complete: !nextCursor && !truncated };
      if (truncated && !next.gaps.includes("Provider truncated discovery; coverage is incomplete")) next.gaps.push("Provider truncated discovery; coverage is incomplete");
      this.saveSession(account, next);
      return { discovered: fresh, session: next };
    });
  }
  resetCursor(account: string, session: ScanSession, leaseOwner?: string): ScanSession { if (leaseOwner) return this.withLease(account, leaseOwner, () => this.resetCursor(account, session)); const next = { ...session, cursor: undefined, historyCursor: undefined, complete: false, gaps: [...session.gaps, "Expired provider cursor; reconciling the same fixed discovery window"] }; this.saveSession(account, next); return next; }
  review(account: string, thread: string): ReviewRecord | undefined { return rowJson(this.db.prepare("SELECT json FROM mail_reviews WHERE account=? AND thread=?").get(account, thread)); }
  private putReview(record: ReviewRecord) { this.db.prepare("INSERT INTO mail_reviews VALUES(?,?,?) ON CONFLICT(account,thread) DO UPDATE SET json=excluded.json").run(record.accountId, record.threadId, JSON.stringify(record)); }
  reviews(account: string): ReviewRecord[] { return this.db.prepare("SELECT json FROM mail_reviews WHERE account=? ORDER BY thread").all(account).map(row => rowJson<ReviewRecord>(row)!); }
  backlog(account: string) { return this.reviews(account).filter(r => r.status === "pending"); }
  markPending(account: string, thread: string, version: string, leaseOwner?: string): void { if (leaseOwner) { this.withLease(account, leaseOwner, () => this.markPending(account, thread, version)); return; } const old = this.review(account, thread); this.putReview({ accountId: account, threadId: thread, version, status: "pending", workItemId: old?.workItemId, publishPending: false, updatedAt: this.now() }); }
  reviewed(account: string, thread: string, expectedVersion: string, sourceVersion: string, classification: MailClassification, leaseOwner?: string) {
    return this.transaction(() => {
      if (leaseOwner) this.assertLease(account, leaseOwner);
      const previous = this.review(account, thread);
      if (!previous || previous.version !== expectedVersion) throw new Error("Mail source changed during review; re-read the thread");
      const value = mailClassificationSchema.parse(classification);
      this.putReview({ ...previous, version: sourceVersion, status: "reviewed", classification: value, publishPending: true, updatedAt: this.now() });
    });
  }
  published(account: string, thread: string, version: string, workItemId?: string) { const previous = this.review(account, thread); if (!previous || previous.version !== version) throw new Error("Mail review changed before publication"); this.putReview({ ...previous, workItemId: workItemId ?? previous.workItemId, publishPending: false }); }
  rotate(count: number): number { if (!count) return 0; const row = this.db.prepare("SELECT value FROM mail_state WHERE key='rotation'").get() as { value: number } | undefined; const value = row?.value ?? 0; this.db.prepare("INSERT INTO mail_state VALUES('rotation',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run((value + 1) % count); return value % count; }
  recordReceipt(receipt: MailScanReceipt) { this.db.prepare("INSERT INTO mail_receipts VALUES(?,?)").run(receipt.id, JSON.stringify(receipt)); }
  receipts(limit = 20): MailScanReceipt[] { return this.db.prepare("SELECT json FROM mail_receipts ORDER BY rowid DESC LIMIT ?").all(Math.max(1, Math.min(100, limit))).map(row => rowJson<MailScanReceipt>(row)!); }
  draft(account: string, thread: string, sourceVersion: string): { text: string; accountId: string; sourceVersion: string; providerDraft: false; sent: false } {
    const record = this.review(account, thread);
    if (!record || record.status !== "reviewed" || record.version !== sourceVersion || !record.classification?.replyText) throw new Error("No current reviewed reply text for this account and source revision");
    return { text: record.classification.replyText, accountId: account, sourceVersion, providerDraft: false, sent: false };
  }
}

export class EmailTriageService {
  readonly state: EmailTriageStore;
  private readonly work: ExecutiveWorkStore;
  private readonly provider: MailReadProvider;
  private readonly now: () => number;
  private readonly guard: MailScopeGuard;
  constructor(state: EmailTriageStore, work: ExecutiveWorkStore, provider: MailReadProvider, now: () => number = Date.now, guard: MailScopeGuard = () => {}) {
    this.state = state;
    this.work = work;
    this.provider = provider;
    this.now = now;
    this.guard = guard;
  }
  async scan(input: MailboxScope[], options: { classifier?: MailClassifier; reviewBudget?: number; pageBudget?: number; initialWindowMs?: number; overlapMs?: number } = {}): Promise<MailScanReceipt> {
    const scopes = z.array(mailboxScopeSchema).min(1).max(10).parse(input);
    if (new Set(scopes.map(s => s.accountId)).size !== scopes.length) throw new Error("Configure each mailbox connection once");
    const receipt: MailScanReceipt = { id: randomUUID(), startedAt: this.now(), finishedAt: 0, runEnd: this.now(), status: "complete", accounts: [] };
    if (!this.provider.capabilities.search || !this.provider.capabilities.fullThreads || !this.provider.capabilities.pagination) throw new Error("Mail provider lacks verified paginated search and complete thread reads");
    const verified: MailboxScope[] = [];
    for (const scope of scopes) {
      const coverage: MailScanReceipt["accounts"][number] = { accountId: scope.accountId, identityVerified: false, discoveryComplete: false, discovered: 0, reviewed: 0, backlog: this.state.backlog(scope.accountId).length, reconciledThreads: 0, gaps: [] };
      receipt.accounts.push(coverage);
      try {
        this.guard(scope);
        this.state.lease(scope.accountId, receipt.id);
        this.guard(scope);
        const identity = await this.provider.verifyIdentity(scope);
        this.guard(scope);
        this.state.renewLease(scope.accountId, receipt.id);
        if (identity.accountId !== scope.accountId || identity.address.toLowerCase() !== scope.address.toLowerCase()) throw new Error("Mailbox identity differs from configured account; no mail was read");
        coverage.identityVerified = true; verified.push(scope);
        this.guard(scope);
        let session = this.state.begin(scope.accountId, receipt.runEnd, options.initialWindowMs ?? 7 * 86400_000, options.overlapMs ?? 86400_000, receipt.id);
        let reset = false;
        const seen = new Set<string>();
        const pageBudget = Math.max(1, Math.min(100, options.pageBudget ?? 20));
        for (let page = 0; page < pageBudget && !session.complete; page++) {
          this.guard(scope);
          this.state.renewLease(scope.accountId, receipt.id);
          try {
            this.guard(scope);
            const result = await this.provider.list(scope, { start: session.start, end: session.end, cursor: session.cursor, historyCursor: this.provider.capabilities.incrementalHistory ? session.historyCursor : undefined, limit: 25 });
            this.guard(scope);
            if (result.nextCursor && (result.nextCursor === session.cursor || seen.has(result.nextCursor))) throw new Error("Provider repeated a pagination cursor");
            if (result.nextCursor) seen.add(result.nextCursor);
            this.guard(scope);
            this.state.renewLease(scope.accountId, receipt.id);
            this.guard(scope);
            const saved = this.state.page(scope.accountId, session, result.messages, result.nextCursor, result.historyCursor, result.truncated, receipt.id);
            coverage.discovered += saved.discovered; session = saved.session;
            if (result.truncated) break;
          } catch (error) {
            if (error instanceof MailCursorExpired && !reset) { this.guard(scope); reset = true; session = this.state.resetCursor(scope.accountId, session, receipt.id); continue; }
            throw error;
          }
        }
        coverage.discoveryComplete = session.complete; coverage.gaps.push(...session.gaps);
        if (!session.complete && !coverage.gaps.length) coverage.gaps.push("Discovery page budget reached; resume saved cursor");
        // Reconcile unresolved obligations even when no new message falls in
        // the discovery window. Closed/dismissed work is deliberately excluded.
        const open = this.work.list({ accountScope: scope.accountId, statuses: ["proposed", "queued", "working", "waiting-on-human", "waiting-on-other", "blocked", "ready-for-review"], limit: 1000 });
        if (open.length === 1000) coverage.gaps.push("Discovery unresolved-thread reconciliation reached its bounded limit; more work may remain");
        for (const item of open.filter(item => item.source.kind === "gmail" && item.source.threadId)) {
          const thread = await this.readThread(scope, item.source.threadId!, receipt.id);
          coverage.reconciledThreads++;
          const previous = this.state.review(scope.accountId, thread.id);
          if (!previous || previous.version !== thread.version) { this.guard(scope); this.state.markPending(scope.accountId, thread.id, thread.version, receipt.id); }
        }
      } catch (error) { coverage.gaps.push(safeMailFailure(error)); }
    }
    try {
      // Rotate the first account between runs, then allocate one thread at a
      // time so a busy account cannot consume the shared analysis budget.
      const offset = this.state.rotate(verified.length);
      const ordered = verified.slice(offset).concat(verified.slice(0, offset));
      const budget = Math.max(0, Math.min(100, options.reviewBudget ?? 15));
      if (options.classifier) {
        let used = 0;
        let progress = true;
        const failed = new Set<string>();
        while (used < budget && progress) {
          progress = false;
          for (const scope of ordered) {
            if (used >= budget) break;
            const pending = this.state.backlog(scope.accountId).find(r => !failed.has(`${scope.accountId}:${r.threadId}`));
            if (!pending) continue;
            used++; progress = true;
            const coverage = receipt.accounts.find(a => a.accountId === scope.accountId)!;
            try {
              this.guard(scope);
              this.state.renewLease(scope.accountId, receipt.id);
              const thread = await this.readThread(scope, pending.threadId, receipt.id);
              if (!thread.complete) throw new Error("Thread context is incomplete; review remains pending");
              this.guard(scope);
              const classification = mailClassificationSchema.parse(await options.classifier(thread, scope));
              this.guard(scope);
              this.state.renewLease(scope.accountId, receipt.id);
              this.guard(scope);
              this.state.reviewed(scope.accountId, pending.threadId, pending.version, thread.version, classification, receipt.id);
              await this.publish(scope, this.state.review(scope.accountId, pending.threadId)!, receipt.id); coverage.reviewed++;
            } catch (error) { failed.add(`${scope.accountId}:${pending.threadId}`); coverage.gaps.push(safeMailFailure(error)); }
          }
        }
      }
      for (const scope of verified) {
        const coverage = receipt.accounts.find(a => a.accountId === scope.accountId)!;
        for (const pending of this.state.reviews(scope.accountId).filter(r => r.publishPending)) {
          try { await this.publish(scope, pending, receipt.id); } catch (error) { coverage.gaps.push(safeMailFailure(error)); }
        }
        coverage.backlog = this.state.backlog(scope.accountId).length;
        if (coverage.backlog) coverage.gaps.push(`${coverage.backlog} thread(s) await review`);
      }
    } finally { for (const scope of scopes) this.state.release(scope.accountId, receipt.id); }
    receipt.finishedAt = this.now();
    receipt.status = receipt.accounts.every(a => !a.identityVerified) && receipt.accounts.length ? "failed" : receipt.accounts.some(a => a.gaps.length || !a.discoveryComplete || a.backlog) ? "partial" : "complete";
    this.state.recordReceipt(receipt); return receipt;
  }
  async readThread(scopeInput: MailboxScope, id: string, leaseOwner?: string) {
    const scope = mailboxScopeSchema.parse(scopeInput);
    this.guard(scope);
    if (leaseOwner) this.state.renewLease(scope.accountId, leaseOwner);
    const thread = await this.provider.readThread(scope, id);
    this.guard(scope);
    if (leaseOwner) this.state.renewLease(scope.accountId, leaseOwner);
    if (thread.accountId !== scope.accountId || thread.id !== id) throw new Error("Provider returned a thread from a different account or target");
    if (!thread.messages.length || thread.messages.length > 200 || thread.messages.some(m => m.threadId !== id || m.text.length > 250_000)) throw new Error("Provider returned invalid or excessive thread context");
    return thread;
  }
  private async publish(scope: MailboxScope, review: ReviewRecord, leaseOwner: string) {
    return this.state.withLease(scope.accountId, leaseOwner, () => this.publishCurrent(scope, review));
  }
  private publishCurrent(scope: MailboxScope, review: ReviewRecord) {
    this.guard(scope);
    const classification = review.classification;
    if (!classification) return;
    let item = review.workItemId ? this.work.get(scope.accountId, review.workItemId) : undefined;
    if (classification.actionable || item) {
      const source = { kind: "gmail", id: review.threadId, threadId: review.threadId, version: review.version, botId: scope.ownerBotId };
      const summary = { source, title: oneLine(classification.summary) || "Review correspondence", desiredOutcome: classification.summary, nextAction: classification.recommendedAction, priority: classification.priority, ...(classification.deadline ? { deadline: classification.deadline } : {}) };
      const reviewKey = digest(`${scope.accountId}:${review.threadId}:${review.version}:${JSON.stringify(summary)}`);
      this.guard(scope);
      item ??= this.work.create({ accountScope: scope.accountId, ownerBotId: scope.ownerBotId, coordinatorBotId: scope.coordinatorBotId, sourceThreadId: scope.sourceThreadId, ...summary }, { eventId: `mail-create:${reviewKey}` });
      const changed = item.source.version !== review.version || item.title !== summary.title || item.desiredOutcome !== summary.desiredOutcome || item.nextAction !== summary.nextAction || item.priority !== summary.priority || JSON.stringify(item.deadline) !== JSON.stringify(classification.deadline);
      this.guard(scope);
      if (changed) item = this.work.update(scope.accountId, item.id, item.revision, summary, { eventId: `mail-review:${reviewKey}` });
    }
    this.guard(scope);
    this.state.published(scope.accountId, review.threadId, review.version, item?.id);
  }
  async submitReview(scope: MailboxScope, threadId: string, sourceVersion: string, input: unknown) {
    this.guard(scope);
    const owner = randomUUID();
    this.state.lease(scope.accountId, owner);
    try {
      const identity = await this.provider.verifyIdentity(scope);
      this.guard(scope);
      this.state.renewLease(scope.accountId, owner);
      if (identity.accountId !== scope.accountId || identity.address.toLowerCase() !== scope.address.toLowerCase()) throw new Error("Mailbox identity changed");
      const thread = await this.readThread(scope, threadId, owner);
      if (!thread.complete || thread.version !== sourceVersion) throw new Error("Reply/classification source revision is stale or incomplete; re-read before reviewing");
      const current = this.state.review(scope.accountId, threadId);
      if (!current) throw new Error("Discover this thread before submitting review");
      this.guard(scope);
      this.state.reviewed(scope.accountId, threadId, current.version, thread.version, mailClassificationSchema.parse(input), owner);
      await this.publish(scope, this.state.review(scope.accountId, threadId)!, owner);
      return this.state.review(scope.accountId, threadId)!;
    } finally { this.state.release(scope.accountId, owner); }
  }
  async draft(scope: MailboxScope, threadId: string, sourceVersion: string) {
    this.guard(scope);
    const identity = await this.provider.verifyIdentity(scope);
    this.guard(scope);
    if (identity.accountId !== scope.accountId || identity.address.toLowerCase() !== scope.address.toLowerCase()) throw new Error("Mailbox identity changed");
    const thread = await this.readThread(scope, threadId);
    if (!thread.complete || thread.version !== sourceVersion) throw new Error("Reply/classification source revision is stale or incomplete; re-read before reviewing");
    this.guard(scope);
    return this.state.draft(scope.accountId, threadId, sourceVersion);
  }
}

/** Provider messages can contain confidential data or credentials; retain only
 * bounded known operational failures, never arbitrary provider response text. */
export function safeMailFailure(error: unknown) {
  if (error instanceof z.ZodError) return "Mail review failed validation; check classification fields and current source revision";
  const value = error instanceof Error ? error.message : "Mail operation failed";
  const known = /^(Mailbox|Mail source|Thread context|Provider repeated|Provider returned|Discovery|Expired provider|Mail provider|Reply\/classification|Discover this|No current|Connected mail|Unsupported mail|Read-only mail|Mail operation)/;
  return known.test(value) ? oneLine(value, 250) : "Mail operation failed; inspect the run diagnostics without copying confidential content";
}
