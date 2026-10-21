import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "./atomic.ts";
import { pairingPathExists, pairingPrivateDirectory, PAIRING_PRIVATE_FILE, protectPairingPath } from "./chief-pairing-storage.ts";

const capability = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const identifiers = z.array(z.string().regex(/^[\w:-]{1,100}$/)).min(1).max(16);
const connectionSchema = z.object({
  id: z.string().uuid(), workspace: z.string().uuid(), account: z.string().uuid(), runtimeId: z.string().uuid(),
  keyFingerprint: z.string().regex(/^[a-f0-9]{64}$/), bots: identifiers, scopes: identifiers,
  state: z.enum(["pending", "active", "revoked"]), generation: z.number().int().positive(), expiresAt: z.string().datetime(),
}).strict();
const invitationSchema = z.object({ challenge: capability, workspace: z.string().uuid(), account: z.string().uuid(), expiresAt: z.string().datetime() }).strict();
type Connection = z.infer<typeof connectionSchema>;
const recordSchema = z.object({ connection: connectionSchema, runtimeSecret: capability }).strict();
const stateSchema = z.object({ version: z.literal(1), runtimeId: z.string().uuid(), publicKey: z.string(), privateKey: z.string(),
  origin: z.string(), connections: z.array(recordSchema).max(100) }).strict();
type State = z.infer<typeof stateSchema>;

export class PairingError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export function lifecycleOrigin(value: string): string {
  const url = new URL(value);
  if (url.origin !== value || url.username || url.password ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "127.0.0.2"].includes(url.hostname)))) {
    throw new Error("Configure an exact HTTPS lifecycle origin (HTTP is allowed only on loopback)");
  }
  return url.origin;
}
const fingerprint = (key: string) => createHash("sha256").update(key).digest("hex");

/** Personal runtime credentials never leave this owner's OS boundary. A workspace
 * login token is not accepted here; only a short-lived pairing invitation is. */
export class ChiefPairingRuntime {
  private readonly file: string;
  private state: State;
  private busy = false;
  private readonly options: { directory: string; origin: string; hasBot: (id: string) => boolean; fetcher?: typeof fetch };
  constructor(options: { directory: string; origin: string; hasBot: (id: string) => boolean; fetcher?: typeof fetch }) {
    this.options = options;
    const origin = lifecycleOrigin(options.origin);
    this.file = join(pairingPrivateDirectory(options.directory), PAIRING_PRIVATE_FILE);
    const legacy = join(options.directory, PAIRING_PRIVATE_FILE);
    if (pairingPathExists(this.file) && pairingPathExists(legacy)) throw new Error("Conflicting pairing stores require owner recovery; no identity was replaced.");
    const existing = pairingPathExists(this.file) ? this.file : pairingPathExists(legacy) ? legacy : undefined;
    if (existing) {
      protectPairingPath(existing, false);
      this.state = stateSchema.parse(JSON.parse(readFileSync(existing, "utf8")));
      if (this.state.origin !== origin) throw new Error("Existing pairings belong to a different configured lifecycle origin");
      // Same-volume rename preserves the existing identity and its restricted
      // ACL. Never copy it to a backup or silently generate replacement keys.
      if (existing === legacy) renameSync(legacy, this.file);
    } else {
      const keys = generateKeyPairSync("ed25519");
      this.state = { version: 1, runtimeId: randomUUID(), origin,
        publicKey: keys.publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
        privateKey: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), connections: [] };
      this.save();
    }
  }
  private save() { writeFileAtomic(this.file, JSON.stringify(this.state), { mode: 0o600 }); }
  list(): Connection[] { return this.state.connections.map(row => ({ ...row.connection, bots: [...row.connection.bots], scopes: [...row.connection.scopes] })); }
  private async request(path: string, body: unknown, bearer?: string): Promise<unknown> {
    let response: Response;
    try {
      response = await (this.options.fetcher ?? fetch)(this.state.origin + "/chief/v1" + path, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(8000),
        headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: "Bearer " + bearer } : {}) }, body: JSON.stringify(body),
      });
    } catch { throw new PairingError(503, "The workspace connection service is unavailable. Try again when it returns."); }
    if (!response.ok) {
      await response.body?.cancel();
      throw new PairingError([400, 401, 403, 409].includes(response.status) ? response.status : 503,
        response.status === 403 ? "This connection is pending, expired, or no longer authorized." : path === "/runtime/tracker" ? "Tracker result is unconfirmed or conflicted. Read the saved issue before retrying; do not automatically resend writes with a new requestId." : "The workspace could not verify this connection.");
    }
    const chunks: Uint8Array[] = []; let size = 0;
    for await (const chunk of response.body!) { size += chunk.length; if (size > 32768) throw new PairingError(503, "Invalid connection response"); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new PairingError(503, "Invalid connection response"); }
  }
  async pair(invitation: unknown, botIds: unknown, trackerWrite = false): Promise<Connection> {
    const parsed = invitationSchema.safeParse(invitation), bots = identifiers.safeParse(botIds);
    if (!parsed.success || !bots.success || new Set(bots.data).size !== bots.data.length || bots.data.some(id => !this.options.hasBot(id))) {
      throw new PairingError(400, "Choose existing personal agents and a valid workspace invitation.");
    }
    if (Date.parse(parsed.data.expiresAt) <= Date.now()) throw new PairingError(400, "This invitation expired. Create a new one in the workspace.");
    if (this.busy) throw new PairingError(409, "Another connection operation is still running.");
    if (this.state.connections.length >= 100) throw new PairingError(409, "Remove an unused local connection before pairing another.");
    this.busy = true;
    try {
      const claim = { challenge: parsed.data.challenge, runtimeId: this.state.runtimeId, publicKey: this.state.publicKey,
        bots: [...bots.data].sort(), scopes: trackerWrite ? ["tracker:read", "tracker:write", "workspace:read"] : ["workspace:read"] };
      const bytes = Buffer.from(JSON.stringify(["chief-pair-v1", claim.challenge, claim.runtimeId, claim.publicKey, claim.bots, claim.scopes]));
      const result = recordSchema.parse(await this.request("/connections/complete", { ...claim, signature: sign(null, bytes, this.state.privateKey).toString("base64url") }));
      const c = result.connection;
      if (c.workspace !== parsed.data.workspace || c.account !== parsed.data.account || c.runtimeId !== this.state.runtimeId ||
          c.keyFingerprint !== fingerprint(this.state.publicKey) || c.state !== "pending" ||
          JSON.stringify(c.bots) !== JSON.stringify(claim.bots) || JSON.stringify(c.scopes) !== JSON.stringify(claim.scopes)) {
        throw new PairingError(403, "The connection response did not match your invitation and selected agents.");
      }
      this.state.connections.push(result); this.save();
      return { ...c };
    } finally { this.busy = false; }
  }
  async check(id: string): Promise<Connection> {
    const row = this.state.connections.find(value => value.connection.id === id);
    if (!row) throw new PairingError(404, "Connection not found");
    if (!this.options.hasBot(row.connection.bots[0]!)) throw new PairingError(403, "The selected agent is no longer available.");
    const proof = { connectionId: id, generation: row.connection.generation, nonce: randomBytes(32).toString("base64url"),
      timestamp: Date.now(), bot: row.connection.bots[0]!, scope: "workspace:read" };
    const bytes = Buffer.from(JSON.stringify(["chief-runtime-v1", id, proof.generation, proof.nonce, proof.timestamp, proof.bot, proof.scope]));
    const result = z.object({ connection: connectionSchema }).passthrough().parse(await this.request("/runtime/authorize",
      { ...proof, signature: sign(null, bytes, this.state.privateKey).toString("base64url") }, row.runtimeSecret));
    if (result.connection.id !== id || result.connection.account !== row.connection.account || result.connection.workspace !== row.connection.workspace ||
        result.connection.runtimeId !== this.state.runtimeId || result.connection.keyFingerprint !== fingerprint(this.state.publicKey)) {
      throw new PairingError(403, "The workspace returned a different connection.");
    }
    row.connection = result.connection; this.save(); return { ...row.connection };
  }
  async tracker(connectionId: string, botId: string, operation: string, args: Record<string, unknown>): Promise<unknown> {
    const row = this.state.connections.find(candidate => candidate.connection.id === connectionId);
    const scope = ["create_issue", "update_issue"].includes(operation) ? "tracker:write" : "tracker:read";
    if (!row || !this.options.hasBot(botId) || !row.connection.bots.includes(botId) || !row.connection.scopes.includes(scope) || row.connection.state !== "active" || Date.parse(row.connection.expiresAt) <= Date.now()) {
      throw new PairingError(403, "No active member connection grants this agent the requested Tracker access.");
    }
    // Local forgetting/rebinding invalidates a warm MCP process immediately.
    const current = stateSchema.parse(JSON.parse(readFileSync(this.file, "utf8")));
    if (!current.connections.some(candidate => candidate.runtimeSecret === row.runtimeSecret && candidate.connection.id === connectionId)) throw new PairingError(403, "Connection was removed locally.");
    const proof = { connectionId, generation: row.connection.generation, nonce: randomBytes(32).toString("base64url"), timestamp: Date.now(), bot: botId, scope };
    const bytes = Buffer.from(JSON.stringify(["chief-workspace-v1", proof.connectionId, proof.generation, proof.nonce, proof.timestamp, proof.bot, proof.scope, operation, args]));
    return this.request("/runtime/tracker", { proof: { ...proof, signature: sign(null, bytes, this.state.privateKey).toString("base64url") }, operation, arguments: args }, row.runtimeSecret);
  }
  forget(id: string): void {
    if (this.busy) throw new PairingError(409, "Another connection operation is still running.");
    this.state.connections = this.state.connections.filter(row => row.connection.id !== id); this.save();
  }
}
