import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { createLifecycleServer } from './http.mjs';

test('loopback sessions support embedded and standalone cookies without accepting conflicting identities', async t => {
  const probe = createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const origin = `http://127.0.0.1:${port}`, secret = 'a'.repeat(43);
  const server = createLifecycleServer({ origin, pairing: {
    openSession: async () => ({ secret, expiresAt: new Date(Date.now() + 60000), member: { fixture: true } }),
    memberSession: async (_token, cookie) => { assert.equal(cookie, secret); return { member: { fixture: true }, session: {} }; },
  } });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(origin + '/chief/v1/sessions', { method: 'POST', headers: { Origin: origin, Authorization: 'Bearer synthetic', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 201); const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 2); assert.ok(cookies.some(c => c.includes('Secure; SameSite=None; Partitioned'))); assert.ok(cookies.some(c => c.includes('SameSite=Strict') && !c.includes('Secure')));
  const equal = `chief-lifecycle-session=${secret}; chief-lifecycle-session=${secret}`;
  assert.equal((await fetch(origin + '/chief/v1/sessions/current', { headers: { Authorization: 'Bearer synthetic', Cookie: equal } })).status, 200);
  const conflicting = `chief-lifecycle-session=${secret}; chief-lifecycle-session=${'b'.repeat(43)}`;
  assert.equal((await fetch(origin + '/chief/v1/sessions/current', { headers: { Authorization: 'Bearer synthetic', Cookie: conflicting } })).status, 401);
});
