import { readFile } from 'node:fs/promises';
import { AccessError, exact, identifiers, uuid } from './security.mjs';

// Operator-managed grants are independent of browser claims and membership.
// No implicit role/tier grants; commercial allocations remain undecided.
export function fileEntitlements({ file, mode }) {
  return async member => {
    if (!file) return null;
    let document;
    try {
      const bytes = await readFile(file);
      if (bytes.length > 262144) throw Error();
      document = JSON.parse(bytes);
      exact(document, ['version', 'mode', 'validUntil', 'grants']);
      if (document.version !== 1 || document.mode !== mode || !['staging', 'production'].includes(mode) ||
          !Number.isFinite(Date.parse(document.validUntil)) || Date.parse(document.validUntil) <= Date.now() ||
          !Array.isArray(document.grants) || document.grants.length > 1000) throw Error();
      const keys = new Set();
      for (const grant of document.grants) {
        exact(grant, ['workspace', 'account', 'pairing', 'bots', 'scopes', 'expiresAt']);
        if (!uuid(grant.workspace) || !uuid(grant.account) || typeof grant.pairing !== 'boolean' ||
            !Number.isFinite(Date.parse(grant.expiresAt))) throw Error();
        identifiers(grant.bots); identifiers(grant.scopes);
        const key = grant.workspace + ':' + grant.account;
        if (keys.has(key)) throw Error(); keys.add(key);
      }
    } catch { throw new AccessError(503, 'Workspace entitlement policy is unavailable'); }
    const grant = document.grants.find(grant => grant.workspace === member.workspace && grant.account === member.account);
    if (!grant?.pairing || Date.parse(grant.expiresAt) <= Date.now()) return null;
    return { pairing: true, bots: [...grant.bots], scopes: [...grant.scopes] };
  };
}
