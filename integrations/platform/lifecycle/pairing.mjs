import { randomUUID, verify } from 'node:crypto';
import { migrationFiles } from './migrations.mjs';
import { AccessError, capability, credentialVault, digest, exact, identifiers, publicKey, requireProof, secret, uuid } from './security.mjs';

const hour = 3600000;
const binding = s => `${s.workspace}:${s.account}:${s.id}`;
const denied = () => { throw new AccessError(); };
const current = s => s && !s.revoked_at && new Date(s.expires_at).getTime() > Date.now();
export const runtimeMessage = p => Buffer.from(JSON.stringify(['chief-runtime-v1', p.connectionId, p.generation, p.nonce, p.timestamp, p.bot, p.scope]));
export function connectionView(c) {
  return { id: c.id, workspace: c.workspace, account: c.account, runtimeId: c.runtime_id,
    keyFingerprint: digest(c.public_key), bots: c.bots, scopes: c.scopes,
    state: c.state, generation: c.generation, expiresAt: c.expires_at };
}
// Only database operations belong in retryable callbacks. Accounts calls,
// encryption/random secrets and future provider effects happen outside them.
export async function transaction(sql, action) {
  for (let attempt = 0; ; attempt++) {
    try { return await sql.begin(action); }
    catch (error) {
      if (error.code !== '40001' || attempt >= 4) throw error;
      await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
}
export async function migratePairing(sql) {
  const migrations = await migrationFiles();
  const [ledger] = await sql`SELECT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='chief_lifecycle' AND table_name='schema_version') AS present`;
  const applied = ledger.present ? await sql`SELECT version, checksum FROM chief_lifecycle.schema_version ORDER BY version` : [];
  for (const row of applied) {
    if (migrations.find(m => m.version === row.version)?.checksum !== row.checksum) throw Error('Pairing migration checksum mismatch');
  }
  for (const migration of migrations) {
    if (applied.some(row => row.version === migration.version)) continue;
    // Cockroach requires completed schema changes before writes to new columns.
    for (const statement of migration.sql.split(';').filter(s => s.trim())) await sql.unsafe(statement);
    await transaction(sql, async tx => {
      const [row] = await tx`SELECT checksum FROM chief_lifecycle.schema_version WHERE version=${migration.version}`;
      if (row && row.checksum !== migration.checksum) throw Error('Pairing migration checksum mismatch');
      if (!row) await tx`INSERT INTO chief_lifecycle.schema_version (version, checksum) VALUES (${migration.version}, ${migration.checksum})`;
    });
  }
}
export class PairingService {
  constructor({ sql, verifyMember, entitlement = async () => null, encryptionKey, requireMembershipEpoch = true }) {
    this.sql = sql; this.verifyMember = verifyMember; this.entitlement = entitlement;
    this.requireMembershipEpoch = requireMembershipEpoch;
    this.vault = credentialVault(encryptionKey);
  }
  async verifyMembershipEpoch(member, session) {
    if (this.requireMembershipEpoch && !uuid(member.membershipEpoch)) throw new AccessError(503, 'Membership version authority is unavailable');
    if (session && ((this.requireMembershipEpoch && !uuid(session.membership_epoch)) ||
        (uuid(member.membershipEpoch) && session.membership_epoch !== member.membershipEpoch))) {
      await transaction(this.sql, tx => this.revokeSession(tx, session.id));
      denied();
    }
  }
  async policy(member, bots, scopes) {
    const policy = await this.entitlement(member);
    if (!policy?.pairing || !Array.isArray(policy.bots) || !Array.isArray(policy.scopes) ||
        bots.some(b => !policy.bots.includes(b)) || scopes.some(s => !policy.scopes.includes(s))) denied();
  }
  async revokeSession(tx, id) {
    await tx`UPDATE chief_lifecycle.member_session SET revoked_at=now(), generation=generation+1, credential=''
      WHERE id=${id} AND revoked_at IS NULL`;
    await tx`UPDATE chief_lifecycle.member_connection SET state='revoked', revoked_at=now(), generation=generation+1
      WHERE session_id=${id} AND state != 'revoked'`;
  }
  async openSession(token, previousSecret) {
    if (previousSecret !== undefined && !capability(previousSecret)) denied();
    const member = await this.verifyMember(token);
    await this.verifyMembershipEpoch(member);
    await this.policy(member, [], []);
    const id = randomUUID(), value = secret(), expires = new Date(Date.now() + 24 * hour);
    const credential = this.vault.seal(token, binding({ ...member, id }));
    await transaction(this.sql, async tx => {
      // The browser must present its existing secret to replace its session.
      // Revocation and the new binding commit together, including account switches.
      if (previousSecret !== undefined) {
        const [previous] = await tx`SELECT * FROM chief_lifecycle.member_session
          WHERE secret_hash=${digest(previousSecret)} FOR UPDATE`;
        if (!current(previous)) throw new AccessError(409, 'The prior browser session has already ended');
        await this.revokeSession(tx, previous.id);
      }
      await tx`INSERT INTO chief_lifecycle.member_session
        (id, workspace, account, person, secret_hash, credential, expires_at, membership_epoch)
        VALUES (${id}, ${member.workspace}, ${member.account}, ${member.person}, ${digest(value)}, ${credential}, ${expires}, ${member.membershipEpoch ?? null})`;
    });
    return { secret: value, expiresAt: expires, member };
  }
  async memberSession(token, sessionSecret, requireEntitlement = true) {
    if (!capability(sessionSecret)) denied();
    const member = await this.verifyMember(token);
    const [session] = await this.sql`SELECT * FROM chief_lifecycle.member_session
      WHERE secret_hash=${digest(sessionSecret)} AND workspace=${member.workspace} AND account=${member.account}`;
    if (!current(session) || session.person !== member.person) denied();
    await this.verifyMembershipEpoch(member, session);
    if (requireEntitlement) await this.policy(member, [], []);
    return { member, session };
  }
  async lockSession(tx, session) {
    const [fresh] = await tx`SELECT * FROM chief_lifecycle.member_session WHERE id=${session.id}
      AND workspace=${session.workspace} AND account=${session.account} FOR UPDATE`;
    if (!current(fresh) || fresh.generation !== session.generation) denied();
    return fresh;
  }
  async logout(token, sessionSecret) {
    const { session } = await this.memberSession(token, sessionSecret, false);
    await transaction(this.sql, async tx => {
      await this.lockSession(tx, session);
      await this.revokeSession(tx, session.id);
    });
  }
  async closeBrowserSession(sessionSecret) {
    // The HttpOnly capability plus the HTTP boundary's exact Origin check is
    // sufficient to revoke itself, even after workspace membership is lost.
    if (sessionSecret === undefined) return;
    if (!capability(sessionSecret)) denied();
    await transaction(this.sql, async tx => {
      const [session] = await tx`SELECT id FROM chief_lifecycle.member_session
        WHERE secret_hash=${digest(sessionSecret)} FOR UPDATE`;
      if (session) await this.revokeSession(tx, session.id);
    });
  }
  async storedMember(session) {
    try {
      const member = await this.verifyMember(this.vault.open(session.credential, binding(session)));
      if (member.account !== session.account || member.workspace !== session.workspace || member.person !== session.person) denied();
      await this.verifyMembershipEpoch(member, session);
      return member;
    } catch (error) {
      // Only a trusted stored identity is eligible for durable revocation.
      // Network/authority failures deny this request without destroying access.
      if (error instanceof AccessError && [401, 403].includes(error.status)) {
        await transaction(this.sql, tx => this.revokeSession(tx, session.id));
      }
      throw error;
    }
  }
  async challenge(token, sessionSecret) {
    const { session } = await this.memberSession(token, sessionSecret);
    const code = secret(), id = randomUUID(), expires = new Date(Date.now() + 5 * 60000);
    await transaction(this.sql, async tx => {
      await this.lockSession(tx, session);
      const [count] = await tx`SELECT count(*)::int AS n FROM chief_lifecycle.connection_challenge
        WHERE session_id=${session.id} AND consumed_at IS NULL AND expires_at > now()`;
      if (count.n >= 5) throw new AccessError(429, 'Too many pending connections');
      await tx`INSERT INTO chief_lifecycle.connection_challenge
        (id, workspace, account, session_id, session_generation, code_hash, expires_at)
        VALUES (${id}, ${session.workspace}, ${session.account}, ${session.id}, ${session.generation}, ${digest(code)}, ${expires})`;
    });
    return { challenge: code, workspace: session.workspace, account: session.account, expiresAt: expires };
  }
  async complete(claim) {
    exact(claim, ['challenge', 'runtimeId', 'publicKey', 'bots', 'scopes', 'signature']); requireProof(claim);
    const bots = identifiers(claim.bots), scopes = identifiers(claim.scopes);
    const [challenge] = await this.sql`SELECT * FROM chief_lifecycle.connection_challenge WHERE code_hash=${digest(claim.challenge)}`;
    if (!challenge || challenge.consumed_at || new Date(challenge.expires_at).getTime() <= Date.now()) denied();
    const [session] = await this.sql`SELECT * FROM chief_lifecycle.member_session WHERE id=${challenge.session_id}`;
    if (!current(session) || session.generation !== challenge.session_generation) denied();
    const member = await this.storedMember(session);
    if (member.account !== session.account || member.workspace !== session.workspace || member.person !== session.person) denied();
    await this.policy(member, bots, scopes);
    const id = randomUUID(), runtimeSecret = secret();
    const record = await transaction(this.sql, async tx => {
      await this.lockSession(tx, session);
      const [consumed] = await tx`UPDATE chief_lifecycle.connection_challenge SET consumed_at=now()
        WHERE id=${challenge.id} AND consumed_at IS NULL AND expires_at > now() RETURNING id`;
      if (!consumed) throw new AccessError(409, 'Pairing challenge already used or expired');
      const [connection] = await tx`INSERT INTO chief_lifecycle.member_connection
        (id, workspace, account, session_id, session_generation, runtime_id, public_key, capability_hash, bots, scopes, state, expires_at)
        VALUES (${id}, ${session.workspace}, ${session.account}, ${session.id}, ${session.generation}, ${claim.runtimeId},
        ${claim.publicKey}, ${digest(runtimeSecret)}, ${tx.json(bots)}, ${tx.json(scopes)}, 'pending', ${challenge.expires_at}) RETURNING *`;
      return connection;
    });
    // Inactive until the initiating browser session explicitly confirms this
    // runtime's fingerprint and scopes; possession of a code alone is not enough.
    return { connection: connectionView(record), runtimeSecret };
  }
  async list(token, sessionSecret) {
    const { member } = await this.memberSession(token, sessionSecret);
    return (await this.sql`SELECT * FROM chief_lifecycle.member_connection
      WHERE workspace=${member.workspace} AND account=${member.account} ORDER BY created_at DESC LIMIT 100`).map(connectionView);
  }
  async confirm(token, sessionSecret, id, fingerprint) {
    if (!uuid(id) || typeof fingerprint !== 'string') throw new AccessError(400, 'Invalid connection');
    const { member, session } = await this.memberSession(token, sessionSecret);
    const [record] = await this.sql`SELECT * FROM chief_lifecycle.member_connection WHERE id=${id}
      AND workspace=${member.workspace} AND account=${member.account} AND session_id=${session.id}`;
    if (!record || record.state !== 'pending' || digest(record.public_key) !== fingerprint) denied();
    await this.policy(member, record.bots, record.scopes);
    return transaction(this.sql, async tx => {
      await this.lockSession(tx, session);
      const expires = new Date(Math.min(Date.now() + 12 * hour, new Date(session.expires_at).getTime()));
      const [updated] = await tx`UPDATE chief_lifecycle.member_connection SET state='active', expires_at=${expires}
        WHERE id=${id} AND session_id=${session.id} AND session_generation=${session.generation}
        AND state='pending' AND expires_at > now() RETURNING *`;
      if (!updated) denied();
      return connectionView(updated);
    });
  }
  async revoke(token, sessionSecret, id) {
    if (!uuid(id)) throw new AccessError(400, 'Invalid connection');
    const { member, session } = await this.memberSession(token, sessionSecret);
    await transaction(this.sql, async tx => {
      await this.lockSession(tx, session);
      const records = await tx`UPDATE chief_lifecycle.member_connection SET state='revoked', revoked_at=now(), generation=generation+1
        WHERE id=${id} AND workspace=${member.workspace} AND account=${member.account} RETURNING id`;
      if (!records.length) denied();
    });
  }
  async authorizeRuntime(runtimeSecret, proof) {
    exact(proof, ['connectionId', 'generation', 'nonce', 'timestamp', 'bot', 'scope', 'signature']);
    if (!capability(runtimeSecret) || !capability(proof.nonce) || !uuid(proof.connectionId) ||
        !Number.isInteger(proof.generation) || !Number.isSafeInteger(proof.timestamp) || Math.abs(Date.now() - proof.timestamp) > 30000 ||
        typeof proof.signature !== 'string' || proof.signature.length > 100) denied();
    const [record] = await this.sql`SELECT * FROM chief_lifecycle.member_connection
      WHERE id=${proof.connectionId} AND capability_hash=${digest(runtimeSecret)}`;
    if (!current(record) || record.state !== 'active' || record.generation !== proof.generation ||
        !record.bots.includes(proof.bot) || !record.scopes.includes(proof.scope) ||
        !verify(null, runtimeMessage(proof), publicKey(record.public_key), Buffer.from(proof.signature, 'base64url'))) denied();
    const [session] = await this.sql`SELECT * FROM chief_lifecycle.member_session WHERE id=${record.session_id}`;
    if (!current(session) || session.generation !== record.session_generation) denied();
    const member = await this.storedMember(session);
    if (member.workspace !== record.workspace || member.account !== record.account || member.person !== session.person) denied();
    await this.policy(member, [proof.bot], [proof.scope]);
    return transaction(this.sql, async tx => {
      await this.lockSession(tx, session);
      const [fresh] = await tx`SELECT * FROM chief_lifecycle.member_connection WHERE id=${record.id} FOR UPDATE`;
      if (!current(fresh) || fresh.state !== 'active' || fresh.generation !== proof.generation) denied();
      const seen = await tx`INSERT INTO chief_lifecycle.runtime_nonce (connection_id, nonce_hash, expires_at)
        VALUES (${record.id}, ${digest(proof.nonce)}, ${new Date(Date.now() + 60000)}) ON CONFLICT DO NOTHING RETURNING nonce_hash`;
      if (!seen.length) throw new AccessError(409, 'Runtime request already used');
      await tx`DELETE FROM chief_lifecycle.runtime_nonce WHERE connection_id=${record.id} AND expires_at < now()`;
      return { member, connection: connectionView(fresh), bot: proof.bot, scope: proof.scope };
    });
  }
}
