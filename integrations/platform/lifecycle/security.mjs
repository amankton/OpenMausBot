import { createHash, randomBytes, createCipheriv, createDecipheriv, createPublicKey, verify } from 'node:crypto';

export class AccessError extends Error {
  constructor(status = 403, message = 'Connection access denied') { super(message); this.status = status; }
}
export const digest = value => createHash('sha256').update(value).digest('hex');
export const secret = () => randomBytes(32).toString('base64url');
export const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
export const capability = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new AccessError(400, 'Invalid request');
}
export function identifiers(value) {
  if (!Array.isArray(value) || !value.length || value.length > 16 || new Set(value).size !== value.length || value.some(v => typeof v !== 'string' || !/^[\w:-]{1,100}$/.test(v))) throw new AccessError(400, 'Invalid scope');
  return [...value].sort();
}
export function credentialVault(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw Error('A dedicated 32-byte lifecycle encryption key is required');
  return {
    seal(value, binding) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(binding));
      const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return [iv, cipher.getAuthTag(), body].map(v => v.toString('base64url')).join('.');
    },
    open(value, binding) {
      try {
        const [iv, tag, body] = value.split('.').map(v => Buffer.from(v, 'base64url'));
        const cipher = createDecipheriv('aes-256-gcm', key, iv);
        cipher.setAAD(Buffer.from(binding)); cipher.setAuthTag(tag);
        return Buffer.concat([cipher.update(body), cipher.final()]).toString('utf8');
      } catch { throw new AccessError(403, 'Stored connection credential is unavailable'); }
    }
  };
}
export function publicKey(value) {
  try {
    if (typeof value !== 'string' || value.length > 128) throw Error();
    const key = createPublicKey({ key: Buffer.from(value, 'base64url'), type: 'spki', format: 'der' });
    if (key.asymmetricKeyType !== 'ed25519' || key.export({ type: 'spki', format: 'der' }).toString('base64url') !== value) throw Error();
    return key;
  } catch { throw new AccessError(400, 'An Ed25519 runtime key is required'); }
}
export function signedClaim(claim) {
  return Buffer.from(JSON.stringify(['chief-pair-v1', claim.challenge, claim.runtimeId, claim.publicKey, identifiers(claim.bots), identifiers(claim.scopes)]));
}
export function requireProof(claim) {
  if (!capability(claim.challenge) || !uuid(claim.runtimeId) || typeof claim.signature !== 'string' || claim.signature.length > 100) throw new AccessError(400, 'Invalid pairing proof');
  if (!verify(null, signedClaim(claim), publicKey(claim.publicKey), Buffer.from(claim.signature, 'base64url'))) throw new AccessError();
}
