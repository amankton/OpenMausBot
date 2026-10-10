import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { fileEntitlements } from './entitlements.mjs';
import { lifecycleConfig } from './config.mjs';

const future = () => new Date(Date.now() + 3600000).toISOString();
const expired = () => new Date(Date.now() - 1000).toISOString();
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'chief-policy-test-'));
  const file = join(dir, 'policy.json');
  const workspace = randomUUID();
  // Three explicit fixture levels, not an invented commercial matrix.
  const grants = [false, true, true].map((pairing, i) => ({ workspace, account: randomUUID(), pairing,
    bots: i === 2 ? ['reader', 'writer'] : ['reader'], scopes: i === 2 ? ['workspace:read', 'draft:write'] : ['workspace:read'], expiresAt: future() }));
  const policy = { version: 1, mode: 'staging', validUntil: future(), grants };
  const save = () => writeFile(file, JSON.stringify(policy));
  await save(); return { dir, file, policy, grants, save, authorize: fileEntitlements({ file, mode: 'staging' }) };
}
test('explicit fixture levels, unknown members and cross-workspace access', async () => {
  const f = await fixture();
  assert.equal(await f.authorize(f.grants[0]), null);
  assert.deepEqual((await f.authorize(f.grants[1])).bots, ['reader']);
  assert.deepEqual((await f.authorize(f.grants[2])).scopes, ['workspace:read', 'draft:write']);
  assert.equal(await f.authorize({ ...f.grants[1], workspace: randomUUID() }), null);
  assert.equal(await f.authorize({ ...f.grants[1], account: randomUUID() }), null);
  assert.equal(await fileEntitlements({ mode: 'production' })(f.grants[1]), null);
});
test('policy changes and expiry take effect without a service restart', async () => {
  const f = await fixture();
  assert.ok(await f.authorize(f.grants[1]));
  f.grants[1].pairing = false; await f.save(); assert.equal(await f.authorize(f.grants[1]), null);
  f.grants[1].pairing = true; f.grants[1].expiresAt = expired(); await f.save(); assert.equal(await f.authorize(f.grants[1]), null);
});
test('staging grants, malformed policy, duplicate bindings and expired authority fail closed', async () => {
  const f = await fixture();
  const unavailable = error => error.status === 503;
  await assert.rejects(() => fileEntitlements({ file: f.file, mode: 'production' })(f.grants[1]), unavailable);
  f.policy.grants.push(f.grants[1]); await f.save(); await assert.rejects(() => f.authorize(f.grants[1]), unavailable);
  f.policy.grants.pop(); f.policy.validUntil = expired(); await f.save(); await assert.rejects(() => f.authorize(f.grants[1]), unavailable);
  await writeFile(f.file, '{invalid'); await assert.rejects(() => f.authorize(f.grants[1]), unavailable);
});
test('configuration requires secret files, a dedicated database role and production TLS', async () => {
  const f = await fixture();
  const database = join(f.dir, 'database'), key = join(f.dir, 'key');
  await writeFile(database, 'postgres://chief_service@127.0.0.1:26257/defaultdb?sslmode=disable');
  await writeFile(key, randomBytes(32).toString('base64url'));
  const env = { CHIEF_LIFECYCLE_MODE: 'staging', CHIEF_LIFECYCLE_ORIGIN: 'http://127.0.0.1:8097', CHIEF_LIFECYCLE_DATABASE_URL_FILE: database,
    CHIEF_LIFECYCLE_ENCRYPTION_KEY_FILE: key, CHIEF_LIFECYCLE_ALLOW_PLAINTEXT_DB: '1', CHIEF_LIFECYCLE_ACCOUNTS_URL: 'http://accounts:3000', CHIEF_LIFECYCLE_TRANSACTOR_URL: 'http://transactor:3333' };
  assert.equal((await lifecycleConfig(env)).encryptionKey.length, 32);
  await assert.rejects(() => lifecycleConfig({ ...env, CHIEF_LIFECYCLE_MODE: 'production' }), /origin/);
  await assert.rejects(() => lifecycleConfig({ ...env, CHIEF_LIFECYCLE_MODE: 'production', CHIEF_LIFECYCLE_ORIGIN: 'https://workspace.example' }), /TLS/);
  await writeFile(database, 'postgres://root@127.0.0.1:26257/defaultdb?sslmode=verify-full');
  await assert.rejects(() => lifecycleConfig(env), /dedicated/);
  await writeFile(database, 'postgres://chief_service@database.example:26257/defaultdb?sslmode=verify-full');
  assert.equal((await lifecycleConfig({ ...env, CHIEF_LIFECYCLE_MODE: 'production', CHIEF_LIFECYCLE_ORIGIN: 'https://workspace.example' })).mode, 'production');
  await writeFile(key, 'invalid'); await assert.rejects(() => lifecycleConfig(env), /encryption/);
});
