// Isolated CockroachDB + HTTP service. Real read-only synthetic Platform identity
// checks; explicit authorization doubles exercise removal and entitlement loss.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { randomBytes, randomUUID, generateKeyPairSync, sign } from 'node:crypto';
import { createServer } from 'node:net';
import { join } from 'node:path';
import postgres from '../integrations/platform/lifecycle/driver.mjs';
import { ROOT, dockerEnvironment } from './configure-chief-platform.mjs';
import { accountsMemberVerifier } from '../integrations/platform/lifecycle/member.mjs';
import { PairingService, migratePairing, runtimeMessage } from '../integrations/platform/lifecycle/pairing.mjs';
import { createLifecycleServer } from '../integrations/platform/lifecycle/http.mjs';
import { AccessError, digest, secret, signedClaim } from '../integrations/platform/lifecycle/security.mjs';
import { ChiefPairingRuntime } from '../server/chief-pairing.ts';
import { withRemovedSyntheticMember } from './chief-pairing-fixture-membership.mjs';
import { runPairingBrowserFixture } from './chief-pairing-browser-fixture.mjs';
import { runWorkbenchBrowserFixture } from './chief-workbench-browser-fixture.mjs';

const local = join(ROOT, '.chief-local/m1-pairing');
await mkdir(local, { recursive: true });
const name = 'chief-m1-pairing-' + randomBytes(4).toString('hex');
const label = 'm1-pairing';
const image = 'cockroachdb/cockroach@sha256:885d9b0e3243f262976763717e547dbbe75ca999548f7a4ea95fcd30a9aee66c';
const docker = args => execFileSync('docker', args, { env: dockerEnvironment(), encoding: 'utf8', windowsHide: true, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const fixturePort = async () => {
  const probe = createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port; await new Promise(r => probe.close(r)); return port;
};
const tokens = [];
for (const file of ['acceptance-state.json', 'acceptance-partner-state.json', 'acceptance-outsider-state.json']) {
  const state = JSON.parse(await readFile(join(ROOT, '.chief-local/platform', file), 'utf8'));
  if (JSON.stringify(state).includes('chiefexecutivesuite')) throw Error('Owner state forbidden');
  const token = state.cookies.find(c => c.name === 'presentation-metadata-Token' && c.path.startsWith('/files/'))?.value;
  if (!token) throw Error('Missing synthetic workspace state'); tokens.push(token);
}
// Legacy live Accounts has no epochs. This retained regression suite explicitly
// excludes epoch acceptance; the strict native-Accounts epoch fixture covers it.
const realVerifier = accountsMemberVerifier({ accountsUrl: 'http://localhost:18087/_accounts', transactorUrl: 'http://localhost:18087/_transactor', requireMembershipEpoch: false });
const members = await Promise.all(tokens.map(realVerifier));
assert.notEqual(members[0].account, members[1].account);
assert.equal(members[0].workspace, members[1].workspace);
assert.notEqual(members[0].workspace, members[2].workspace);
const checks = ['Accounts validates two distinct synthetic members and a separate workspace; caller-scoped Contacts resolves their active people'];
let created = false, sql, admin, server;
const key = randomBytes(32), removed = new Set(), unentitled = new Set();
const policies = new Map(members.map((m, i) => [m.account, { pairing: true, bots: ['synthetic-specialist-' + i], scopes: ['workspace:read', 'draft:write'] }]));
const verifyMember = async token => {
  const member = await realVerifier(token);
  if (removed.has(member.account)) throw new AccessError();
  return member;
};
const entitlement = async member => unentitled.has(member.account) ? null : policies.get(member.account);
const pairClaim = (challenge, i = 0) => {
  const keys = generateKeyPairSync('ed25519');
  const body = { challenge: challenge.challenge, runtimeId: randomUUID(), publicKey: keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'), bots: ['synthetic-specialist-' + i], scopes: ['workspace:read'] };
  return { keys, body: { ...body, signature: sign(null, signedClaim(body), keys.privateKey).toString('base64url') } };
};
const proof = (pair, keys, changes = {}) => {
  const body = { connectionId: pair.connection.id, generation: pair.connection.generation, nonce: secret(), timestamp: Date.now(), bot: pair.connection.bots[0], scope: 'workspace:read', ...changes };
  return { ...body, signature: sign(null, runtimeMessage(body), keys.privateKey).toString('base64url') };
};
const denied = action => assert.rejects(action, error => error instanceof AccessError && [400, 401, 403, 409, 429].includes(error.status));
try {
  // The image wrapper initializes certificates and restricts listen addresses.
  // Invoke the database directly for this disposable, host-loopback fixture.
  docker(['run', '--detach', '--name', name, '--label', 'io.chief.verification=' + label, '--memory', '1g', '--cpus', '1', '--publish', '127.0.0.1::26257', '--entrypoint', '/cockroach/cockroach', image,
    'start-single-node', '--insecure', '--store=type=mem,size=640MiB', '--cache=64MiB', '--max-sql-memory=64MiB', '--listen-addr=0.0.0.0:26257']);
  created = true;
  let container;
  for (let i = 0; i < 20; i++) {
    [container] = JSON.parse(docker(['inspect', name]));
    if (container.NetworkSettings.Ports['26257/tcp']?.length) break;
    await new Promise(r => setTimeout(r, 300));
  }
  if (!container.NetworkSettings.Ports['26257/tcp']?.length) throw Error('Disposable database failed to bind: ' + JSON.stringify({ state: container.State, bindings: container.HostConfig.PortBindings, ports: container.NetworkSettings.Ports }));
  const port = container.NetworkSettings.Ports['26257/tcp'][0].HostPort;
  const url = `postgres://root@127.0.0.1:${port}/defaultdb?sslmode=disable`;
  admin = postgres(url, { max: 1, connect_timeout: 2, onnotice() {} });
  let ready = false;
  for (let i = 0; i < 25; i++) { try { await admin`SELECT 1`; ready = true; break; } catch { await new Promise(r => setTimeout(r, 400)); } }
  assert.equal(ready, true, 'Disposable database must start');
  await migratePairing(admin); await migratePairing(admin);
  await admin`CREATE USER chief_pairing_fixture`;
  await admin`GRANT USAGE ON SCHEMA chief_lifecycle TO chief_pairing_fixture`;
  await admin`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA chief_lifecycle TO chief_pairing_fixture`;
  sql = postgres(url.replace('root@', 'chief_pairing_fixture@'), { max: 4, onnotice() {} });
  let service = new PairingService({ sql, verifyMember, entitlement, encryptionKey: key, requireMembershipEpoch: false });
  const sessions = await Promise.all(tokens.map(t => service.openSession(t)));
  const session = sessions[0].secret;
  const challenge = await service.challenge(tokens[0], session);
  const claim = pairClaim(challenge);
  const outcomes = await Promise.allSettled([service.complete(claim.body), service.complete(claim.body)]);
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
  const pair = outcomes.find(x => x.status === 'fulfilled').value;
  await denied(() => service.authorizeRuntime(pair.runtimeSecret, proof(pair, claim.keys)));
  await denied(() => service.confirm(tokens[1], sessions[1].secret, pair.connection.id, pair.connection.keyFingerprint));
  await denied(() => service.confirm(tokens[2], sessions[2].secret, pair.connection.id, pair.connection.keyFingerprint));
  await denied(() => service.confirm(tokens[0], session, pair.connection.id, 'wrong-fingerprint'));
  pair.connection = await service.confirm(tokens[0], session, pair.connection.id, pair.connection.keyFingerprint);
  const signed = proof(pair, claim.keys);
  const grant = await service.authorizeRuntime(pair.runtimeSecret, signed);
  assert.equal(grant.member.account, members[0].account);
  await denied(() => service.authorizeRuntime(pair.runtimeSecret, signed));
  await denied(() => service.authorizeRuntime(pair.runtimeSecret, proof(pair, claim.keys, { bot: 'synthetic-specialist-1' })));
  await denied(() => service.authorizeRuntime(pair.runtimeSecret, proof(pair, claim.keys, { generation: 0 })));
  await denied(() => service.authorizeRuntime(pair.runtimeSecret, proof(pair, claim.keys, { timestamp: Date.now() - 60000 })));
  await denied(() => service.authorizeRuntime(pair.runtimeSecret, proof(pair, pairClaim(challenge).keys)));
  await denied(() => service.challenge(tokens[1], session));
  assert.deepEqual(await service.list(tokens[1], sessions[1].secret), []);
  checks.push('Concurrent challenge completion consumes once; two-sided confirmation, member/workspace isolation, scope, key, time, generation and nonce checks pass');
  unentitled.add(members[0].account);
  await denied(() => service.authorizeRuntime(pair.runtimeSecret, proof(pair, claim.keys)));
  unentitled.clear();
  checks.push('Explicit entitlement double denies runtime access while access is removed');
  const rows = await sql`SELECT * FROM chief_lifecycle.member_session`;
  const connections = await sql`SELECT * FROM chief_lifecycle.member_connection`;
  const serialized = JSON.stringify({ rows, connections });
  for (const value of [...tokens, ...sessions.map(s => s.secret), pair.runtimeSecret, challenge.challenge]) assert.equal(serialized.includes(value), false);
  await sql.end();
  sql = postgres(url.replace('root@', 'chief_pairing_fixture@'), { max: 4, onnotice() {} });
  service = new PairingService({ sql, verifyMember, entitlement, encryptionKey: key, requireMembershipEpoch: false });
  await service.authorizeRuntime(pair.runtimeSecret, proof(pair, claim.keys));
  checks.push('Fresh service/database client restores pairing from SQL; persisted records contain no plaintext credentials or capabilities');
  const expiring = await service.challenge(tokens[0], session);
  await admin`UPDATE chief_lifecycle.connection_challenge SET expires_at=now()-INTERVAL '1 minute' WHERE code_hash=${digest(expiring.challenge)}`;
  await denied(() => service.complete(pairClaim(expiring).body));
  await service.logout(tokens[0], session);
  await denied(() => service.authorizeRuntime(pair.runtimeSecret, proof(pair, claim.keys)));
  await denied(() => service.challenge(tokens[0], session));
  checks.push('Expired challenges and logged-out session generations cannot authorize pairing or runtime requests');
  const httpPort = await fixturePort(), origin = `http://127.0.0.1:${httpPort}`;
  server = createLifecycleServer({ pairing: service, origin });
  await new Promise(r => server.listen(httpPort, '127.0.0.1', r));
  const request = (path, body, extra = {}) => fetch(origin + '/chief/v1' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: origin, Authorization: 'Bearer ' + tokens[1], 'Content-Type': 'application/json', ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal((await request('/sessions', {}, { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await request('/sessions', { account: members[0].account })).status, 400);
  const opened = await request('/sessions', {}); assert.equal(opened.status, 201);
  const cookie = opened.headers.get('set-cookie'); assert.match(cookie, /HttpOnly; Secure; SameSite=None; Partitioned/);
  assert.equal(JSON.stringify(await opened.json()).includes('secret'), false);
  const browserCookie = cookie.split(';')[0];
  assert.equal((await request('/connections/challenges', {}, { Cookie: browserCookie })).status, 201);
  assert.equal((await request('/connections/challenges', {}, { Cookie: browserCookie, Authorization: 'Bearer ' + tokens[0] })).status, 403);
  assert.equal((await request('/connections?token=forbidden')).status, 400);
  assert.equal((await request('/connections', undefined, { Cookie: browserCookie })).status, 200);
  checks.push('Real HTTP boundary enforces exact Origin, member/cookie binding, strict request shape and credential-free responses');
  const browserSession = browserCookie.slice(browserCookie.indexOf('=') + 1);
  const switchClaim = pairClaim(await service.challenge(tokens[1], browserSession), 1);
  const switchPair = await service.complete(switchClaim.body);
  switchPair.connection = await service.confirm(tokens[1], browserSession, switchPair.connection.id, switchPair.connection.keyFingerprint);
  const switched = await request('/sessions', {}, { Cookie: browserCookie, Authorization: 'Bearer ' + tokens[2] });
  assert.equal(switched.status, 201);
  const switchedCookie = switched.headers.get('set-cookie').split(';')[0];
  await denied(() => service.authorizeRuntime(switchPair.runtimeSecret, proof(switchPair, switchClaim.keys)));
  assert.equal((await request('/connections', undefined, { Cookie: browserCookie })).status, 403);
  assert.equal((await request('/connections', undefined, { Cookie: switchedCookie, Authorization: 'Bearer ' + tokens[2] })).status, 200);
  unentitled.add(members[2].account);
  const loggedOut = await fetch(origin + '/chief/v1/sessions/current', { method: 'DELETE', headers: {
    Origin: origin, Authorization: 'Bearer ' + tokens[2], Cookie: switchedCookie
  } });
  assert.equal(loggedOut.status, 200);
  assert.match(loggedOut.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
  unentitled.clear();
  assert.equal((await request('/connections', undefined, { Cookie: switchedCookie, Authorization: 'Bearer ' + tokens[2] })).status, 403);
  checks.push('HTTP account switching revokes the prior member runtime and session atomically; logout remains available after entitlement loss');
  const runtimeSession = await service.openSession(tokens[1]);
  const runtimeInvitation = await service.challenge(tokens[1], runtimeSession.secret);
  const runtimeDirectory = await mkdtemp(join(local, 'runtime-'));
  const runtimeOptions = { directory: runtimeDirectory, origin, hasBot: id => id === 'synthetic-specialist-1' };
  const personal = new ChiefPairingRuntime(runtimeOptions);
  const requested = await personal.pair(JSON.parse(JSON.stringify(runtimeInvitation)), ['synthetic-specialist-1']);
  await assert.rejects(() => personal.check(requested.id), error => error.status === 403);
  await service.confirm(tokens[1], runtimeSession.secret, requested.id, requested.keyFingerprint);
  assert.equal((await personal.check(requested.id)).state, 'active');
  const restartedPersonal = new ChiefPairingRuntime(runtimeOptions);
  assert.equal((await restartedPersonal.check(requested.id)).id, requested.id);
  assert.equal(JSON.stringify(restartedPersonal.list()).includes('runtimeSecret'), false);
  removed.add(members[1].account);
  await assert.rejects(() => restartedPersonal.check(requested.id), error => error.status === 403);
  removed.clear();
  await assert.rejects(() => restartedPersonal.check(requested.id), error => error.status === 403);
  await assert.rejects(() => service.challenge(tokens[1], runtimeSession.secret), error => error.status === 403);
  checks.push('Observed membership loss permanently revokes the trusted session; restoring membership cannot resurrect an old connection');
  await service.closeBrowserSession(runtimeSession.secret);
  await assert.rejects(() => restartedPersonal.check(requested.id), error => error.status === 403);
  restartedPersonal.forget(requested.id); assert.deepEqual(restartedPersonal.list(), []);
  checks.push('Personal Chief runtime signs real HTTP pairing, requires workspace confirmation, persists across restart and loses access on workspace revocation');
  const removalSession = await service.openSession(tokens[1]);
  const removalClaim = pairClaim(await service.challenge(tokens[1], removalSession.secret), 1);
  const removalPair = await service.complete(removalClaim.body);
  removalPair.connection = await service.confirm(tokens[1], removalSession.secret, removalPair.connection.id, removalPair.connection.keyFingerprint);
  await withRemovedSyntheticMember({ tokens, members, directory: local, action: async () => {
    await assert.rejects(() => realVerifier(tokens[1]), error => error.status === 403);
    await denied(() => service.authorizeRuntime(removalPair.runtimeSecret, proof(removalPair, removalClaim.keys)));
  } });
  assert.equal((await realVerifier(tokens[1])).account, members[1].account);
  await denied(() => service.authorizeRuntime(removalPair.runtimeSecret, proof(removalPair, removalClaim.keys)));
  checks.push('Real Accounts membership removal denies the signed runtime; exact synthetic membership is restored and the old connection stays revoked');
  const receipt = { passed: true, completedAt: new Date().toISOString(), scope: 'CON-01 legacy-Accounts regression; excludes required production membership epochs, deployment and full M1', membershipEpochAcceptance: false, database: 'disposable CockroachDB with restricted service role', livePlatformIdentityChecks: true, membershipRemoval: 'real synthetic Accounts member removed and restored', entitlements: 'explicit doubles', providerExecution: false, browserUi: false, checks };
  await writeFile(join(ROOT, 'docs/verification/evidence/chief-member-pairing.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
  if (process.argv.includes('--browser')) await runPairingBrowserFixture({ root: ROOT, pairing: service, tokens });
  if (process.argv.includes('--workbench')) await runWorkbenchBrowserFixture({ root: ROOT, pairing: service, tokens });
} catch (error) {
  console.error('Pairing verification failed:', error.name, error.code ?? '', error instanceof AccessError ? error.message : 'See private fixture failure report');
  let message = String(error.stack ?? error); for (const token of tokens) message = message.replaceAll(token, '[redacted]');
  await writeFile(join(local, 'failure.log'), message, { mode: 0o600 }).catch(() => {}); process.exitCode = 1;
}
try {
  if (server) await new Promise(r => server.close(r));
  await sql?.end(); await admin?.end();
  if (created) {
    const [owned] = JSON.parse(docker(['inspect', name]));
    if (owned.Config.Labels['io.chief.verification'] !== label || owned.Mounts.length) throw Error('Unexpected fixture ownership/mounts; cleanup refused');
    docker(['rm', '--force', name]);
  }
} catch (error) {
  let message = String(error.stack ?? error); for (const token of tokens) message = message.replaceAll(token, '[redacted]');
  await writeFile(join(local, 'cleanup-failure.log'), message, { mode: 0o600 }).catch(() => {});
  console.error('Pairing fixture cleanup failed; inspect the private cleanup report.');
  process.exitCode = 1;
}
