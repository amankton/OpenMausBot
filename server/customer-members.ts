import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "./atomic.ts";

const memberSchema = z.object({ workspace: z.string().uuid(), account: z.string().uuid(), person: z.string().min(1).max(200), membershipEpoch: z.string().uuid(), role: z.enum(["USER", "MAINTAINER", "ADMIN", "OWNER"]) }).strict();
const requestSchema = z.object({ version: z.literal(1), operation: z.enum(["ensure", "revoke"]), member: memberSchema, nonce: z.string().uuid(), issuedAt: z.number(), expiresAt: z.number(), signature: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
type Member = z.infer<typeof memberSchema>;
type Record = { member: Member; botId: string; state: "pending" | "active" | "revoked"; leaseUntil: number };
const recordSchema = z.object({ member: memberSchema, botId: z.string(), state: z.enum(["pending", "active", "revoked"]), leaseUntil: z.number() });
type Options = { directory: string; bridge: string; key: string; template: { name: string; soul: string; modelSelection: { instanceId: string; model: string } }; work: string; bots: () => Array<{ id: string; soul: string }>; create: (profile: { name: string; soul: string; cwd: string; modelSelection: { instanceId: string; model: string } }) => { id: string }; now?: () => number };
const memberKey = (m: Member) => createHash("sha256").update(m.workspace + ":" + m.account).digest("hex");
const signed = (value: unknown, key: string) => createHmac("sha256", key).update(JSON.stringify(value)).digest("hex");

/** The local install explicitly authorizes verified members of its fresh
 * workspace authority. Provisioning creates a profile, never an admin session,
 * provider credential, tool grant, or an automatically confirmed pairing. */
export class CustomerMembers {
  private records: Record[];
  private now: () => number;
  private file: string;
  private options: Options;
  private processed = new Map<string, string>();
  constructor(options: Options) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.file = join(options.directory, "customer-members.json");
    mkdirSync(options.directory, { recursive: true, mode: 0o700 });
    mkdirSync(options.bridge, { recursive: true, mode: 0o700 });
    if (lstatSync(options.bridge).isSymbolicLink() || !/^[a-f0-9]{64}$/.test(options.key)) throw Error("Invalid private member bridge");
    try { this.records = z.array(recordSchema).max(1000).parse(JSON.parse(readFileSync(this.file, "utf8"))); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw Error("Member provisioning state requires recovery"); this.records = []; }
  }
  private save() { writeFileAtomic(this.file, JSON.stringify(this.records), { mode: 0o600 }); }
  allowed(botId: string) { const row = this.records.find(r => r.botId === botId); return !row || row.state === "active" && row.leaseUntil > this.now(); }
  status() { return this.records.map(r => ({ botId: r.botId, workspace: r.member.workspace, account: r.member.account, state: r.state === "active" && r.leaseUntil <= this.now() ? "needs connection" : r.state })); }
  sweep() {
    for (const name of readdirSync(this.options.bridge).filter(n => /^[a-f0-9]{64}\.request\.json$/.test(n)).slice(0, 1000)) {
      try {
        const file = join(this.options.bridge, name), stat = lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) continue;
        const request = requestSchema.parse(JSON.parse(readFileSync(file, "utf8")));
        const { signature, ...body } = request;
        const expected = signed(body, this.options.key);
        if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) || memberKey(request.member) + ".request.json" !== name || request.issuedAt > this.now() + 5000 || request.expiresAt <= this.now() || request.expiresAt - request.issuedAt > 15_000) continue;
        if (this.processed.get(name) === signature) continue;
        let row = this.records.find(r => memberKey(r.member) === memberKey(request.member));
        if (request.operation === "ensure") {
          const marker = `<!-- chief-member:${memberKey(request.member)} -->`;
          const matching = this.options.bots().filter(b => b.soul.includes(marker));
          if (matching.length > 1) throw Error("Conflicting member profile identities");
          let bot = row?.botId ? this.options.bots().find(b => b.id === row!.botId) : matching[0];
          // A customer-deleted profile is a decision, not permission to recreate.
          if (row && !bot) throw Error("The member profile was removed or creation is unconfirmed; repair it explicitly");
          if (!bot) {
            if (this.records.length >= 1000) throw Error("Member profile capacity reached");
            row = { member: request.member, botId: "", state: "pending", leaseUntil: 0 }; this.records.push(row); this.save();
            const cwd = join(this.options.work, "members", memberKey(request.member));
            mkdirSync(cwd, { recursive: true, mode: 0o700 });
            bot = { ...this.options.create({ name: `${this.options.template.name} · ${request.member.account.slice(0, 8)}`, soul: this.options.template.soul + "\n\n" + marker, cwd, modelSelection: this.options.template.modelSelection }), soul: marker };
          }
          row ??= { member: request.member, botId: bot.id, state: "active", leaseUntil: 0 };
          if (!this.records.includes(row)) this.records.push(row);
          row.member = request.member; row.botId = bot.id; row.state = "active"; row.leaseUntil = request.issuedAt + 60_000;
        } else if (row && row.member.membershipEpoch === request.member.membershipEpoch) { row.state = "revoked"; row.leaseUntil = 0; }
        this.save();
        const result = { version: 1, nonce: request.nonce, expiresAt: request.expiresAt, ...(row ? { botId: row.botId, state: row.state } : { state: "revoked" }) };
        writeFileAtomic(join(this.options.bridge, name.replace(".request.", ".response.")), JSON.stringify({ ...result, signature: signed(result, this.options.key) }), { mode: 0o600 });
        this.processed.set(name, signature);
      } catch { /* Invalid requests never create profiles or leak diagnostics. */ }
    }
  }
}
