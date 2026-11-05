import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  CONNECTOR_TRUST_OPERATIONS, CONNECTOR_TRUST_CATALOG_FINGERPRINT, connectorTrustAccountFactSchema, connectorTrustPolicySchema,
  connectorTrustReviewSchema, connectorTrustApprovalSchema, connectorTrustActionSchema,
  type ConnectorTrustAccountFact, type ConnectorTrustApproval, type ConnectorTrustAction, type ConnectorTrustEffect,
  type ConnectorTrustOperation, type ConnectorTrustPolicy,
} from "../shared/connector-trust.ts";

export const CONNECTOR_TRUST_IDENTITY_MAX_AGE_MS = 60_000;
const id = z.string().min(1).max(240);
type ToolAllowed = (tool: string) => boolean;
export type BoundConnectorTrustCall = { tool: string; accountId: string; arguments: Record<string, unknown>; userTargets: unknown[]; operation: ConnectorTrustOperation; effect: ConnectorTrustEffect };
export class ConnectorTrustError extends Error {
  readonly status: number;
  constructor(message: string, status = 403) { super(message); this.name = "ConnectorTrustError"; this.status = status; }
}
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const safeRecord = (value: unknown): Record<string, unknown> => {
  if (!plain(value) || Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => !("value" in descriptor))) throw new ConnectorTrustError("Bounded connected-app call has an unreadable object shape");
  return value;
};
function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = safeRecord(value);
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}
export function connectorTrustActionDigest(payload: unknown): string {
  const rpc = safeRecord(payload);
  // RPC ids and transport session ids do not identify the action; every
  // name, argument, account selection and execution option inside params does.
  return createHash("sha256").update(canonical({ method: rpc.method ?? null, params: rpc.params ?? null })).digest("hex");
}

function accountBinding(child: Record<string, unknown>, ...containers: Record<string, unknown>[]) {
  // The provider adapter consumes this exact child-argument selector. Other
  // spellings/wrapper metadata cannot select an account by themselves.
  if (!Object.hasOwn(child, "connected_account_id")) throw new ConnectorTrustError("Bounded connected-app call requires an explicit connected account in canonical child arguments");
  const accountIds: string[] = [];
  for (const record of [child, ...containers]) for (const field of ["connected_account_id", "connectedAccountId"]) {
    if (Object.hasOwn(record, field)) {
      if (typeof record[field] !== "string" || !record[field] || record[field] !== (record[field] as string).trim()) throw new ConnectorTrustError("Bounded connected-app call has an invalid account binding");
      accountIds.push(record[field] as string);
    }
  }
  const distinct = [...new Set(accountIds)];
  if (distinct.length !== 1) throw new ConnectorTrustError(distinct.length ? "Bounded connected-app call has conflicting account bindings" : "Bounded connected-app call requires an explicit connected account");
  return distinct[0];
}
const discovery = new Set(["COMPOSIO_SEARCH_TOOLS", "COMPOSIO_GET_TOOL_SCHEMAS"]);
function parseBoundCalls(payload: unknown): { calls: BoundConnectorTrustCall[]; discovery: boolean } {
  const rpc = safeRecord(payload);
  if (rpc.method !== "tools/call") {
    if (["initialize", "notifications/initialized", "tools/list", "ping"].includes(String(rpc.method))) return { calls: [], discovery: true };
    throw new ConnectorTrustError("Bounded connected-app mode refuses an unknown transport operation");
  }
  const params = safeRecord(rpc.params);
  const name = params.name;
  if (typeof name !== "string") throw new ConnectorTrustError("Bounded connected-app call names no tool");
  if (discovery.has(name)) return { calls: [], discovery: true };
  const args = safeRecord(params.arguments ?? {});
  const raw: Array<{ name: string; args: Record<string, unknown>; containers: Record<string, unknown>[] }> = [];
  if (name === "COMPOSIO_MULTI_EXECUTE_TOOL") {
    if (!Array.isArray(args.tools) || !args.tools.length || args.tools.length > 50) throw new ConnectorTrustError("Bounded connected-app execution requires a finite explicit tool batch");
    for (const value of args.tools) {
      const entry = safeRecord(value);
      if (typeof entry.tool_slug !== "string" || !entry.tool_slug) throw new ConnectorTrustError("Bounded connected-app batch has an unnamed tool");
      raw.push({ name: entry.tool_slug, args: safeRecord(entry.arguments ?? {}), containers: [args, entry] });
    }
  } else {
    if (name.startsWith("COMPOSIO_") || name.endsWith("_MANAGE_CONNECTIONS") || name.endsWith("_WAIT_FOR_CONNECTIONS")) throw new ConnectorTrustError("Bounded connected-app mode refuses opaque code, connection changes and unknown executors");
    raw.push({ name, args, containers: [] });
  }
  return { discovery: false, calls: raw.map(call => {
    const operation = CONNECTOR_TRUST_OPERATIONS.find(operation => (operation.tools as readonly string[]).includes(call.name));
    if (!operation) throw new ConnectorTrustError("This operation is not in the reviewed bounded connected-app catalog");
    const accountId = accountBinding(call.args, ...call.containers);
    if (operation.effect === "send") {
      const recipients = [call.args.to, call.args.recipient_email, call.args.recipients, call.args.to_email].filter(value => typeof value === "string" && value.trim() || Array.isArray(value) && value.length);
      if (!recipients.length) throw new ConnectorTrustError("Sending in bounded mode needs explicit reviewable recipients; implicit draft or thread recipients are unavailable");
    }
    const userTargets = [...call.containers, call.args].flatMap(container => ["user_id", "userId"].filter(field => Object.hasOwn(container, field)).map(field => container[field]));
    return { tool: call.name, accountId, arguments: call.args, userTargets, operation: operation.id, effect: operation.effect };
  }) };
}
function verifiedFact(accountId: string, facts: ConnectorTrustAccountFact[], now: number) {
  const matches = facts.filter(fact => fact.accountId === accountId);
  if (matches.length !== 1) throw new ConnectorTrustError("The connected mailbox identity is missing or ambiguous");
  const fact = connectorTrustAccountFactSchema.parse(matches[0]);
  if (fact.status !== "active" || !fact.identity || fact.verifiedAt <= 0 || fact.verifiedAt > now + 1000 || now - fact.verifiedAt > CONNECTOR_TRUST_IDENTITY_MAX_AGE_MS) throw new ConnectorTrustError("The connected mailbox identity needs a fresh authoritative profile check");
  return { ...fact, identity: fact.identity.toLowerCase() };
}
export interface ConnectorTrustVerdict {
  bounded: boolean;
  revision: number;
  actionDigest: string;
  requiresApproval: boolean;
  calls: BoundConnectorTrustCall[];
}
/** Additional intersection only. Existing bot tool, app and outbound gates
 * remain mandatory; an absent policy deliberately preserves legacy behavior. */
export function evaluateConnectorTrust(policy: ConnectorTrustPolicy | null, payload: unknown, facts: ConnectorTrustAccountFact[], toolAllowed: ToolAllowed, now = Date.now()): ConnectorTrustVerdict {
  if (!policy) return { bounded: false, revision: 0, actionDigest: "", requiresApproval: false, calls: [] };
  const actionDigest = connectorTrustActionDigest(payload);
  const current = connectorTrustPolicySchema.parse(policy);
  if (current.state === "revoked") throw new ConnectorTrustError("Bounded connected-app access was revoked; it does not fall back to previous grants");
  if (current.catalogFingerprint !== CONNECTOR_TRUST_CATALOG_FINGERPRINT) throw new ConnectorTrustError("The reviewed connected-app catalog changed; review the current exact operations before dispatch",409);
  const parsed = parseBoundCalls(payload);
  for (const call of parsed.calls) {
    if (!toolAllowed(call.tool)) throw new ConnectorTrustError("This tool is outside the agent's current connected-app grants or tool selection");
    const fact = verifiedFact(call.accountId, facts, now);
    const grant = current.grants.find(grant => grant.accountId === call.accountId);
    if (!grant || grant.identity !== fact.identity || !grant.operations.includes(call.operation) || !grant.tools.includes(call.tool)) throw new ConnectorTrustError("This mailbox identity or operation is outside the reviewed agent grant");
    for (const target of call.userTargets) {
      if (target !== undefined && target !== "me" && (typeof target !== "string" || target.toLowerCase() !== fact.identity)) throw new ConnectorTrustError("The mailbox user target differs from the verified account identity");
    }
    if (call.effect === "send") for (const field of ["from", "from_email", "sender_email"]) {
      const sender = call.arguments[field];
      if (sender !== undefined && (typeof sender !== "string" || sender.toLowerCase() !== fact.identity)) throw new ConnectorTrustError("The sending identity differs from the verified mailbox; unverified aliases are unavailable in bounded mode");
    }
  }
  return { bounded: true, revision: current.revision, actionDigest, requiresApproval: parsed.calls.some(call => call.effect !== "read"), calls: parsed.calls };
}

export class ConnectorTrustStore {
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  constructor(dataDir: string, now: () => number = Date.now) {
    const actualCatalog = createHash("sha256").update(JSON.stringify(CONNECTOR_TRUST_OPERATIONS)).digest("hex");
    if (actualCatalog !== CONNECTOR_TRUST_CATALOG_FINGERPRINT) throw new ConnectorTrustError("The connected-app catalog fingerprint must be updated before reviewing grants", 409);
    this.now = now; mkdirSync(dataDir, { recursive: true });
    const path = join(dataDir, "connector-trust.db"); this.db = new DatabaseSync(path, { timeout: 5000 }); chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS connector_trust_schema(version INTEGER NOT NULL);
      INSERT INTO connector_trust_schema SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM connector_trust_schema);
      CREATE TABLE IF NOT EXISTS connector_trust_policies(bot_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS connector_trust_approvals(id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, state TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS connector_trust_actions(bot_id TEXT NOT NULL,action_digest TEXT NOT NULL,state TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(bot_id,action_digest));`);
    if ((this.db.prepare("SELECT version FROM connector_trust_schema").get() as {version: number}).version !== 1) throw new ConnectorTrustError("Unsupported connected-app trust schema", 409);
    // A second runtime cannot distinguish an in-flight send from a crash.
    // Both are unsafe to replay until the original result is acknowledged.
    for (const row of this.db.prepare("SELECT bot_id,action_digest,payload FROM connector_trust_actions WHERE state='pending'").all() as Array<{bot_id: string;action_digest: string;payload: string}>) {
      const action = connectorTrustActionSchema.parse(JSON.parse(row.payload));
      this.saveAction({...action,state: "outcome-unknown"});
    }
  }
  close() { this.db.close(); }
  private atomic<T>(fn: () => T): T { this.db.exec("BEGIN IMMEDIATE"); try { const value = fn(); this.db.exec("COMMIT"); return value; } catch (error) { this.db.exec("ROLLBACK"); throw error; } }
  get(botId: string): ConnectorTrustPolicy | null { id.parse(botId); const row = this.db.prepare("SELECT payload FROM connector_trust_policies WHERE bot_id=?").get(botId) as {payload: string} | undefined; if (!row) return null; const policy = connectorTrustPolicySchema.parse(JSON.parse(row.payload)); if (policy.botId !== botId) throw new ConnectorTrustError("Stored trust belongs to a different agent",409); return policy; }
  private saveAction(action: ConnectorTrustAction) { this.db.prepare("INSERT INTO connector_trust_actions VALUES(?,?,?,?) ON CONFLICT(bot_id,action_digest) DO UPDATE SET state=excluded.state,payload=excluded.payload").run(action.botId,action.actionDigest,action.state,JSON.stringify(action)); }
  actions(botId: string, limit = 50): ConnectorTrustAction[] { id.parse(botId); return this.db.prepare("SELECT payload FROM connector_trust_actions WHERE bot_id=? ORDER BY rowid DESC LIMIT ?").all(botId,Math.max(1,Math.min(100,limit))).map(row => connectorTrustActionSchema.parse(JSON.parse((row as {payload: string}).payload))); }
  private assertNotRepeated(botId: string, digest: string) {
    const row = this.db.prepare("SELECT state FROM connector_trust_actions WHERE bot_id=? AND action_digest=?").get(botId,digest) as {state: string} | undefined;
    if (row && row.state !== "not-executed") throw new ConnectorTrustError(row.state === "succeeded" ? "This exact action is already confirmed completed; do not send or write it again" : "The previous exact action is pending or outcome-unknown; reconcile authoritative evidence with the owner before another approval or retry",409);
  }
  private save(policy: ConnectorTrustPolicy) { this.db.prepare("INSERT INTO connector_trust_policies VALUES(?,?,?) ON CONFLICT(bot_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload").run(policy.botId, policy.revision, JSON.stringify(policy)); this.db.prepare("UPDATE connector_trust_approvals SET state='revoked' WHERE bot_id=? AND state='approved'").run(policy.botId); return policy; }
  review(botId: string, input: unknown, facts: ConnectorTrustAccountFact[], reviewerId: string, toolAllowed: ToolAllowed): ConnectorTrustPolicy {
    id.parse(botId); id.parse(reviewerId); const review = connectorTrustReviewSchema.parse(input);
    return this.atomic(() => {
      const previous = this.get(botId);
      if ((previous?.revision ?? 0) !== review.expectedRevision) throw new ConnectorTrustError("Trust settings changed; refresh and review the current proposal", 409);
      for (const grant of review.grants) {
        const fact = verifiedFact(grant.accountId, facts, this.now());
        if (fact.identity !== grant.identity) throw new ConnectorTrustError("The reviewed mailbox address differs from its current verified account identity");
        for (const operationId of grant.operations) {
          const operation = CONNECTOR_TRUST_OPERATIONS.find(operation => operation.id === operationId)!;
          if (!operation.tools.some(toolAllowed)) throw new ConnectorTrustError("This operation is unavailable under the agent's existing tool grants");
        }
      }
      const grants = review.grants.map(grant => ({...grant,tools: [...new Set(grant.operations.flatMap(operationId => CONNECTOR_TRUST_OPERATIONS.find(operation => operation.id === operationId)!.tools.filter(toolAllowed)))]}));
      return this.save(connectorTrustPolicySchema.parse({ botId, provider: "composio", catalogFingerprint: review.catalogFingerprint, revision: review.expectedRevision + 1, state: "active", grants, reviewedAt: this.now(), reviewedBy: reviewerId }));
    });
  }
  revoke(botId: string, expectedRevision: number, reviewerId: string): ConnectorTrustPolicy {
    id.parse(botId); id.parse(reviewerId); z.number().int().positive().parse(expectedRevision);
    return this.atomic(() => { const previous = this.get(botId); if (!previous || previous.revision !== expectedRevision) throw new ConnectorTrustError("Trust settings changed; refresh before revoking", 409); return this.save({ ...previous, revision: previous.revision + 1, state: "revoked", grants: [], reviewedAt: this.now(), reviewedBy: reviewerId }); });
  }
  /** Call only after the platform's ordinary owner action card approved the
   * complete immutable payload. No HTTP/bot tool exposes this minting method. */
  issueApproval(botId: string, threadId: string, payload: unknown, expectedRevision: number, facts: ConnectorTrustAccountFact[], toolAllowed: ToolAllowed, ttlMs = 5 * 60_000): ConnectorTrustApproval {
    id.parse(botId); id.parse(threadId); z.number().int().min(1).max(5 * 60_000).parse(ttlMs);
    return this.atomic(() => {
      const policy = this.get(botId); const verdict = evaluateConnectorTrust(policy, payload, facts, toolAllowed, this.now());
      if (!verdict.bounded || verdict.revision !== expectedRevision || !verdict.requiresApproval) throw new ConnectorTrustError("The action or reviewed trust revision changed; obtain a fresh exact-action approval", 409);
      this.assertNotRepeated(botId,verdict.actionDigest);
      const approval = connectorTrustApprovalSchema.parse({ id: randomUUID(), botId, threadId, policyRevision: verdict.revision, actionDigest: verdict.actionDigest, approvedAt: this.now(), expiresAt: this.now() + ttlMs });
      this.db.prepare("INSERT INTO connector_trust_approvals VALUES(?,?,'approved',?)").run(approval.id, botId, JSON.stringify(approval)); return approval;
    });
  }
  /** Final dispatch gate: consumes a write approval exactly once. Call after
   * every awaited lookup/approval/session preparation, immediately before send. */
  authorizeDispatch(botId: string, threadId: string, payload: unknown, facts: ConnectorTrustAccountFact[], toolAllowed: ToolAllowed, expectedRevision?: number, approvalId?: string): ConnectorTrustVerdict {
    return this.atomic(() => {
      const policy = this.get(botId); const verdict = evaluateConnectorTrust(policy, payload, facts, toolAllowed, this.now());
      if (expectedRevision !== undefined && verdict.revision !== expectedRevision) throw new ConnectorTrustError("The connected-app trust revision changed before dispatch", 409);
      if (!verdict.requiresApproval) return verdict;
      this.assertNotRepeated(botId,verdict.actionDigest);
      if (!approvalId) throw new ConnectorTrustError("This mailbox write needs a fresh exact-action owner approval");
      const row = this.db.prepare("SELECT state,payload FROM connector_trust_approvals WHERE id=? AND bot_id=?").get(approvalId, botId) as {state: string;payload: string} | undefined;
      if (!row || row.state !== "approved") throw new ConnectorTrustError("This exact-action approval is unavailable, revoked or already used");
      const approval = connectorTrustApprovalSchema.parse(JSON.parse(row.payload));
      if (approval.threadId !== threadId || approval.policyRevision !== verdict.revision || approval.actionDigest !== verdict.actionDigest || approval.expiresAt <= this.now() || approval.approvedAt > this.now() + 1000) throw new ConnectorTrustError("This exact-action approval does not match the current account, action, thread or revision");
      this.db.prepare("UPDATE connector_trust_approvals SET state='consumed' WHERE id=? AND state='approved'").run(approval.id);
      this.saveAction({...approval,state: "pending",startedAt: this.now()}); return verdict;
    });
  }
  /** Trusted transport acknowledgement only. Tool isError, a timeout, a
   * partial batch or an unparsed HTTP200 is not confirmed completion. */
  ackAction(botId: string, approvalId: string, outcome: "succeeded" | "not-executed" | "outcome-unknown", evidenceReference: string): ConnectorTrustAction {
    id.parse(botId); id.parse(approvalId); z.enum(["succeeded","not-executed","outcome-unknown"]).parse(outcome); z.string().min(1).max(1000).parse(evidenceReference);
    return this.atomic(() => {
      const row = this.db.prepare("SELECT payload FROM connector_trust_approvals WHERE id=? AND bot_id=? AND state='consumed'").get(approvalId,botId) as {payload: string} | undefined;
      if (!row) throw new ConnectorTrustError("No dispatched exact action matches this acknowledgement",409);
      const approval = connectorTrustApprovalSchema.parse(JSON.parse(row.payload));
      const actionRow = this.db.prepare("SELECT payload FROM connector_trust_actions WHERE bot_id=? AND action_digest=?").get(botId,approval.actionDigest) as {payload: string} | undefined;
      if (!actionRow) throw new ConnectorTrustError("Missing exact-action outcome journal",409);
      const action = connectorTrustActionSchema.parse(JSON.parse(actionRow.payload));
      if (action.id !== approvalId || !["pending","outcome-unknown"].includes(action.state)) throw new ConnectorTrustError("This outcome was already resolved or superseded; do not overwrite it",409);
      const next = {...action,state: outcome,resolvedAt: this.now(),evidenceReference}; this.saveAction(next); return next;
    });
  }
}
