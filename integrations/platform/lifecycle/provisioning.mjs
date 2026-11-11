import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, rename, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { AccessError, uuid } from './security.mjs';

const sign = (value, key) => createHmac('sha256', key).update(JSON.stringify(value)).digest('hex');
const view = member => Object.fromEntries(['workspace', 'account', 'person', 'membershipEpoch', 'role'].map(k => [k, member[k]]));
export function localMemberProvisioner({ directory, key, now = Date.now, timeoutMs = 7000 }) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw Error('Invalid local provisioning key');
  const pending = new Map();
  async function request(member, operation) {
    if (![member.workspace, member.account, member.membershipEpoch].every(uuid)) throw new AccessError(403, 'Current versioned membership is required');
    const id = createHash('sha256').update(member.workspace + ':' + member.account).digest('hex');
    if (pending.has(id)) return pending.get(id);
    const action = (async () => {
      const body = { version: 1, operation, member: view(member), nonce: randomUUID(), issuedAt: now(), expiresAt: now() + 10_000 };
      const file = join(directory, id + '.request.json'), temporary = file + '.' + body.nonce + '.tmp';
      await writeFile(temporary, JSON.stringify({ ...body, signature: sign(body, key) }), { mode: 0o600, flag: 'wx' }); await rename(temporary, file);
      const until = Date.now() + timeoutMs;
      while (Date.now() < until) {
        try {
          const response = join(directory, id + '.response.json'), stat = await lstat(response);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw Error();
          const { signature, ...result } = JSON.parse(await readFile(response, 'utf8'));
          if (result.nonce === body.nonce && result.expiresAt > now() && typeof signature === 'string' && /^[a-f0-9]{64}$/.test(signature) && timingSafeEqual(Buffer.from(signature), Buffer.from(sign(result, key)))) {
            if (operation === 'revoke') return result;
            if (result.state === 'active' && typeof result.botId === 'string') return { pairing: true, bots: [result.botId], scopes: ['workspace:read', 'tracker:read', 'tracker:write'] };
            break;
          }
        } catch { /* No stale/forged response is an authorization. */ }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new AccessError(503, 'Personal member provisioning is unavailable; repair the local Chief service');
    })();
    pending.set(id, action);
    try { return await action; } finally { pending.delete(id); }
  }
  return { ensure: member => request(member, 'ensure'), revoke: async member => { if (pending.has(createHash('sha256').update(member.workspace + ':' + member.account).digest('hex'))) await pending.get(createHash('sha256').update(member.workspace + ':' + member.account).digest('hex')).catch(() => {}); return request(member, 'revoke'); } };
}
