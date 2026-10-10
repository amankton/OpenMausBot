import test from 'node:test';
import assert from 'node:assert/strict';
import { rememberChiefSession, reconcileChiefSession, revokeChiefSession, withChiefSessionLock } from '../../../.chief-local/platform-source/packages/presentation/src/chief-session.ts';

function fixture(t, replies) {
  const originalFetch = globalThis.fetch, originalStorage = globalThis.localStorage;
  const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
  let pending = Promise.resolve();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: (_name, _options, callback) => {
    const next = pending.then(callback); pending = next.catch(() => {}); return next;
  } } });
  const storage = new Map(), calls = [];
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  globalThis.fetch = async (path, init) => { calls.push({ path, ...init }); return new Response('{}', { status: replies.shift() ?? 503 }); };
  t.after(() => { globalThis.fetch = originalFetch; globalThis.localStorage = originalStorage;
    if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks); else delete navigator.locks;
  });
  return { storage, calls };
}
test('unconfigured workspace never changes login or invokes pairing endpoints', async t => {
  const f = fixture(t, []); await revokeChiefSession(); await reconcileChiefSession('synthetic'); assert.equal(f.calls.length, 0);
});
test('same member reload preserves the existing session', async t => {
  const f = fixture(t, [200]); rememberChiefSession(); await reconcileChiefSession('synthetic');
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].headers.Authorization, 'Bearer synthetic'); assert.equal(f.storage.size, 1);
});
test('account switching revokes the old HttpOnly session before permitting the new member', async t => {
  const f = fixture(t, [403, 200]); rememberChiefSession(); await reconcileChiefSession('new-synthetic');
  assert.equal(f.calls[1].method, 'DELETE'); assert.equal(f.calls[1].headers, undefined); assert.equal(f.storage.size, 0);
});
test('logout uses only its own cookie so membership removal cannot prevent revocation', async t => {
  const f = fixture(t, [200]); rememberChiefSession(); await revokeChiefSession();
  assert.equal(f.calls[0].credentials, 'same-origin'); assert.equal(f.calls[0].headers, undefined); assert.equal(f.storage.size, 0);
});
test('outage blocks switching and preserves the revocation marker for a retry', async t => {
  const f = fixture(t, [503, 200]); rememberChiefSession(); await assert.rejects(() => reconcileChiefSession('synthetic'));
  assert.equal(f.storage.size, 1); await revokeChiefSession(); assert.equal(f.storage.size, 0);
});
test('failed logout retains the capability cookie marker for retry', async t => {
  const f = fixture(t, [503, 200]); rememberChiefSession(); await assert.rejects(() => revokeChiefSession());
  assert.equal(f.storage.size, 1); await revokeChiefSession(); assert.equal(f.storage.size, 0);
});

test('concurrent logout waits for invitation work and revokes once', async t => {
  const f = fixture(t, [200]); let release;
  const invitation = withChiefSessionLock(async () => {
    rememberChiefSession(); await new Promise(resolve => { release = resolve; });
  });
  await Promise.resolve();
  const first = revokeChiefSession(), second = revokeChiefSession();
  await Promise.resolve(); assert.equal(f.calls.length, 0);
  release(); await Promise.all([invitation, first, second]);
  assert.equal(f.calls.length, 1); assert.equal(f.storage.size, 0);
});

test('unsupported coordination fails closed before making requests', async t => {
  const f = fixture(t, []); rememberChiefSession(); Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
  await assert.rejects(() => revokeChiefSession(), /secure session coordination/);
  assert.equal(f.calls.length, 0); assert.equal(f.storage.size, 1);
});

test('logout also waits for an invitation queued before its marker exists', async t => {
  const f = fixture(t, [200]); let release;
  const blocker = withChiefSessionLock(() => new Promise(resolve => { release = resolve; }));
  await Promise.resolve();
  const invitation = withChiefSessionLock(async () => { rememberChiefSession(); });
  const logout = revokeChiefSession();
  assert.equal(f.storage.size, 0); release(); await Promise.all([blocker, invitation, logout]);
  assert.equal(f.calls.length, 1); assert.equal(f.storage.size, 0);
});
