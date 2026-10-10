// Real candidate image + nginx + disk-backed disposable CockroachDB.
// Only synthetic acceptance tokens are read. Owner containers/volumes stay intact.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { join, resolve, relative, isAbsolute } from 'node:path';
import postgres from '../integrations/platform/lifecycle/driver.mjs';
import { accountsMemberVerifier } from '../integrations/platform/lifecycle/member.mjs';
import { ChiefPairingRuntime } from '../server/chief-pairing.ts';
import { ROOT, dockerEnvironment } from './configure-chief-platform.mjs';

const docker = args => execFileSync('docker', args, { env: dockerEnvironment(), encoding: 'utf8', windowsHide: true, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const label = 'io.chief.verification=m1-release';
const prefix = 'chief-m1-release-' + randomBytes(4).toString('hex');
const dbName = prefix + '-db', appName = prefix + '-app', proxyName = prefix + '-proxy', volume = prefix + '-data';
const dbImage = 'cockroachdb/cockroach@sha256:885d9b0e3243f262976763717e547dbbe75ca999548f7a4ea95fcd30a9aee66c';
const appImage = docker(['image', 'inspect', 'chief-lifecycle:con01-epochs', '--format', '{{.Id}}']);
const nginxImage = docker(['image', 'inspect', 'nginx:1.21.3', '--format', '{{.Id}}']);
const existing = docker(['ps', '--format', '{{.ID}}']).split('\n').filter(Boolean).sort();
const base = join(ROOT, '.chief-local/m1-pairing'); await mkdir(base, { recursive: true });
const directory = await mkdtemp(join(base, 'release-'));
const probe = createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r));
const port = probe.address().port; await new Promise(r => probe.close(r));
const origin = 'http://127.0.0.1:' + port;
const authorityIndex = process.argv.indexOf('--synthetic-authority');
let authority;
if (authorityIndex !== -1) {
  const file = resolve(process.argv[authorityIndex + 1] ?? '');
  const within = relative(base, file);
  assert.ok(within && !within.startsWith('..') && !isAbsolute(within), 'Synthetic authority manifest must be in the ignored pairing fixture directory');
  authority = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(authority.kind, 'chief-epoch-synthetic-authority');
  const [pod] = JSON.parse(docker(['inspect', authority.accountContainer]));
  assert.equal(pod.Config.Labels['io.chief.verification'], 'm1-epochs');
  assert.equal(pod.Image, authority.accountImage);
  assert.equal(pod.State.Running, true);
  assert.ok(Date.now() - Date.parse(authority.createdAt) < 3600000);
}
const tokens = authority?.tokens ?? [];
for (const file of authority ? [] : ['acceptance-state.json', 'acceptance-partner-state.json']) {
  const state = JSON.parse(await readFile(join(ROOT, '.chief-local/platform', file), 'utf8'));
  if (JSON.stringify(state).includes('chiefexecutivesuite')) throw Error('Owner state forbidden');
  const token = state.cookies.find(c => c.name === 'presentation-metadata-Token' && c.path.startsWith('/files/'))?.value;
  if (!token) throw Error('Synthetic state missing'); tokens.push(token);
}
assert.equal(tokens.length, 2);
const verify = accountsMemberVerifier({ accountsUrl: authority?.accountsUrl ?? 'http://localhost:18087/_accounts', transactorUrl: authority?.transactorUrl ?? 'http://localhost:18087/_transactor' });
// Fail before creating any fixture resources if Accounts has not been upgraded.
// The old pre-epoch image receipt must not certify this newer candidate.
let members;
try { members = await Promise.all(tokens.map(verify)); }
catch { throw Error('Release acceptance requires epoch-enabled staging Accounts and valid synthetic states; the owner Accounts service must not be upgraded just to run this test.'); }
assert.notEqual(members[0].account, members[1].account); assert.equal(members[0].workspace, members[1].workspace);
const until = new Date(Date.now() + 3600000).toISOString();
const policy = { version: 1, mode: 'staging', validUntil: until, grants: members.map(m => ({ workspace: m.workspace, account: m.account,
  pairing: true, bots: ['synthetic-reader'], scopes: ['workspace:read'], expiresAt: until })) };
const savePolicy = () => writeFile(join(directory, 'policy.json'), JSON.stringify(policy));
await savePolicy();
await writeFile(join(directory, 'key'), randomBytes(32).toString('base64url'));
await writeFile(join(directory, 'next-key'), randomBytes(32).toString('base64url'));
await writeFile(join(directory, 'service-db'), 'postgres://chief_service@database:26257/defaultdb?sslmode=disable');
await writeFile(join(directory, 'migration-db'), 'postgres://chief_migration@database:26257/defaultdb?sslmode=disable');
const location = await readFile(join(ROOT, 'integrations/platform/lifecycle/nginx-location.conf'), 'utf8');
await writeFile(join(directory, 'nginx.conf'), `events {}\nhttp { access_log off; server { listen 8080; ${location} } }\n`);
const env = [
  'CHIEF_LIFECYCLE_MODE=staging', 'CHIEF_LIFECYCLE_ORIGIN=' + origin,
  'CHIEF_LIFECYCLE_HOST=0.0.0.0', 'CHIEF_LIFECYCLE_PORT=8097', 'CHIEF_LIFECYCLE_ALLOW_PLAINTEXT_DB=1',
  'CHIEF_LIFECYCLE_ACCOUNTS_URL=' + (authority?.containerAccountsUrl ?? 'http://host.docker.internal:18087/_accounts'),
  'CHIEF_LIFECYCLE_TRANSACTOR_URL=' + (authority?.containerTransactorUrl ?? 'http://host.docker.internal:18087/_transactor'),
  'CHIEF_LIFECYCLE_POLICY_FILE=/run/chief/policy.json'
];
const appArgs = (database = 'service-db', key = 'key') => ['--network', prefix, '--label', label, '--read-only', '--cap-drop', 'ALL',
  '--security-opt', 'no-new-privileges', '--memory', '256m', '--cpus', '0.5',
  '--mount', `type=bind,src=${directory},dst=/run/chief,readonly`, ...env.flatMap(value => ['--env', value]),
  '--env', 'CHIEF_LIFECYCLE_DATABASE_URL_FILE=/run/chief/' + database, '--env', 'CHIEF_LIFECYCLE_ENCRYPTION_KEY_FILE=/run/chief/' + key];
const operation = (command, database = 'service-db', key = 'key') => docker(['run', '--rm', ...appArgs(database, key),
  '--env', 'CHIEF_LIFECYCLE_NEW_KEY_FILE=/run/chief/next-key', appImage, 'node', 'main.mjs', command]);
const request = (path, { method = 'GET', token = tokens[0], cookie, body } = {}) => fetch(origin + '/chief/v1' + path,
  { method, redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Origin: origin, Authorization: 'Bearer ' + token,
    ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
const waitReady = async () => {
  for (let i = 0; i < 50; i++) { try { if ((await request('/status')).status === 200) return; } catch {} await new Promise(r => setTimeout(r, 400)); }
  throw Error('Isolated lifecycle service did not become ready');
};
const created = [], checks = []; let admin, restricted, networkCreated = false, volumeCreated = false;
try {
  docker(['network', 'create', '--label', label, prefix]); networkCreated = true;
  docker(['volume', 'create', '--label', label, volume]); volumeCreated = true;
  docker(['run', '--detach', '--name', dbName, '--label', label, '--network', prefix, '--network-alias', 'database',
    '--memory', '1g', '--cpus', '1', '--mount', `type=volume,src=${volume},dst=/cockroach/data`, '--publish', '127.0.0.1::26257',
    '--entrypoint', '/cockroach/cockroach', dbImage, 'start-single-node', '--insecure', '--store=/cockroach/data', '--cache=64MiB', '--max-sql-memory=64MiB', '--listen-addr=0.0.0.0:26257']); created.push(dbName);
  const [db] = JSON.parse(docker(['inspect', dbName]));
  const sqlUrl = 'postgres://root@127.0.0.1:' + db.NetworkSettings.Ports['26257/tcp'][0].HostPort + '/defaultdb?sslmode=disable';
  admin = postgres(sqlUrl, { max: 1, connect_timeout: 2, onnotice() {} });
  let ready = false;
  for (let i = 0; i < 50; i++) { try { await admin`SELECT 1`; ready = true; break; } catch {} await new Promise(r => setTimeout(r, 400)); }
  assert.ok(ready);
  await admin`CREATE USER chief_migration`; await admin`CREATE USER chief_service`;
  await admin`GRANT CREATE ON DATABASE defaultdb TO chief_migration`;
  operation('migrate', 'migration-db'); operation('migrate', 'migration-db');
  await admin`GRANT USAGE ON SCHEMA chief_lifecycle TO chief_service`;
  await admin`GRANT SELECT ON chief_lifecycle.schema_version TO chief_service`;
  for (const table of ['member_session', 'connection_challenge', 'member_connection', 'runtime_nonce']) {
    await admin.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON chief_lifecycle.${table} TO chief_service`);
  }
  restricted = postgres(sqlUrl.replace('root@', 'chief_service@'), { max: 1, onnotice() {} });
  await assert.rejects(() => restricted`CREATE TABLE chief_lifecycle.forbidden (id INT)`);
  await assert.rejects(() => restricted`UPDATE chief_lifecycle.schema_version SET checksum='forbidden'`);
  checks.push('Dedicated migration role applies twice; runtime role cannot create tables or alter migration ledger');
  docker(['run', '--detach', '--name', appName, '--network-alias', 'chief-lifecycle', ...appArgs(), appImage]); created.push(appName);
  docker(['run', '--detach', '--name', proxyName, '--label', label, '--network', prefix, '--publish', `127.0.0.1:${port}:8080`,
    '--mount', `type=bind,src=${join(directory, 'nginx.conf')},dst=/etc/nginx/nginx.conf,readonly`, nginxImage]); created.push(proxyName);
  await waitReady();
  const response = await request('/sessions', { method: 'POST', body: {} }); assert.equal(response.status, 201);
  assert.match(response.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=None; Partitioned/);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const invitationResponse = await request('/connections/challenges', { method: 'POST', cookie, body: {} }); assert.equal(invitationResponse.status, 201);
  const runtimeDirectory = join(directory, 'runtime');
  let runtime = new ChiefPairingRuntime({ directory: runtimeDirectory, origin, hasBot: id => id === 'synthetic-reader' });
  const pair = await runtime.pair(await invitationResponse.json(), ['synthetic-reader']);
  await assert.rejects(() => runtime.check(pair.id));
  const confirmed = await request('/connections/' + pair.id + '/confirm', { method: 'POST', cookie, body: { keyFingerprint: pair.keyFingerprint } });
  assert.equal(confirmed.status, 200); await runtime.check(pair.id);
  assert.equal((await request('/connections', { token: tokens[1], cookie })).status, 403);
  checks.push('Actual non-root candidate container through nginx verifies real synthetic membership, pending/approval/runtime access, isolated member and partitioned cookie');
  docker(['restart', appName]); await waitReady();
  runtime = new ChiefPairingRuntime({ directory: runtimeDirectory, origin, hasBot: id => id === 'synthetic-reader' });
  await runtime.check(pair.id);
  await restricted.end(); restricted = undefined; await admin.end(); admin = undefined;
  docker(['restart', dbName]); await waitReady(); await runtime.check(pair.id);
  checks.push('Actual service container, personal runtime and disk-backed database restarts preserve authorized pairing');
  policy.grants[0].pairing = false; await savePolicy(); await assert.rejects(() => runtime.check(pair.id));
  policy.grants[0].pairing = true; await savePolicy(); await runtime.check(pair.id);
  await writeFile(join(directory, 'policy.json'), '{broken');
  assert.equal((await request('/connections', { cookie })).status, 503); await savePolicy(); await runtime.check(pair.id);
  checks.push('Server-owned file policy changes revoke access immediately; malformed policy fails closed and recovers without restart');
  docker(['stop', appName]);
  assert.ok([502, 504].includes((await request('/sessions/current', { method: 'DELETE', cookie })).status));
  docker(['start', appName]); await waitReady(); await runtime.check(pair.id);
  checks.push('Service outage fails closed; proxy returns unavailable and restart preserves the previous session for retry');
  docker(['stop', appName]); operation('rotate-key');
  // Restore through reverse rotation to prove rollback before using the new key.
  await writeFile(join(directory, 'old-key'), await readFile(join(directory, 'key')));
  await writeFile(join(directory, 'key'), await readFile(join(directory, 'next-key')));
  await writeFile(join(directory, 'next-key'), await readFile(join(directory, 'old-key')));
  operation('rotate-key');
  await writeFile(join(directory, 'key'), await readFile(join(directory, 'old-key')));
  docker(['start', appName]); await waitReady(); await runtime.check(pair.id);
  checks.push('Offline transactional key rotation and reverse rotation restore usable encrypted sessions without credential output');
  const switches = await Promise.all([0, 1].map(() => request('/sessions', { method: 'POST', token: tokens[1], cookie, body: {} })));
  assert.deepEqual(switches.map(r => r.status).sort(), [201, 409]);
  await assert.rejects(() => runtime.check(pair.id));
  const nextCookie = switches.find(r => r.status === 201).headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/connections', { token: tokens[1], cookie: nextCookie })).status, 200);
  checks.push('Concurrent stale-cookie session replacements yield one success and one conflict; prior runtime stays revoked');
  docker(['stop', appName]); operation('revoke-all'); docker(['start', appName]); await waitReady();
  assert.equal((await request('/connections', { token: tokens[1], cookie: nextCookie })).status, 403);
  checks.push('Disable/rollback operation revokes all persisted sessions; restart cannot restore revoked credentials');
  const logs = docker(['logs', appName]);
  for (const secret of [...tokens, cookie.split('=')[1], await readFile(join(directory, 'key'), 'utf8')]) assert.equal(logs.includes(secret), false);
  const [app] = JSON.parse(docker(['inspect', appName]));
  assert.equal(app.Config.User, 'node'); assert.equal(app.HostConfig.ReadonlyRootfs, true);
  const receipt = { capturedAt: new Date().toISOString(), passed: true, candidateImage: appImage, proxyImage: nginxImage, accountImage: authority?.accountImage, checks,
    scope: authority ? 'Actual epoch-enabled Accounts, lifecycle and nginx containers with synthetic signed members and disposable disk-backed lifecycle DB. Employee lookup is a fixture. No full native browser, owner rollout or production TLS acceptance.' : 'Disposable container deployment using synthetic acceptance members; no full native browser UI, live rollout, production TLS or membership-event acceptance claim' };
  await writeFile(join(ROOT, 'docs/verification/evidence', authority ? 'chief-lifecycle-epochs-release.json' : 'chief-lifecycle-release.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
} catch (error) {
  await writeFile(join(directory, 'failure.txt'), String(error.stack ?? error));
  console.error('Isolated release verification failed; private diagnostic: ' + join(directory, 'failure.txt')); process.exitCode = 1;
} finally {
  await restricted?.end({ timeout: 2 }); await admin?.end({ timeout: 2 });
  for (const name of created.reverse()) {
    const [container] = JSON.parse(docker(['inspect', name]));
    assert.equal(container.Config.Labels['io.chief.verification'], 'm1-release');
    assert.ok(container.Mounts.every(m => m.Type === 'bind' ? m.Source.toLowerCase().includes('m1-pairing') : m.Name === volume));
    docker(['rm', '--force', name]);
  }
  if (volumeCreated) {
    const [owned] = JSON.parse(docker(['volume', 'inspect', volume])); assert.equal(owned.Labels['io.chief.verification'], 'm1-release'); docker(['volume', 'rm', volume]);
  }
  if (networkCreated) { const [owned] = JSON.parse(docker(['network', 'inspect', prefix])); assert.equal(owned.Labels['io.chief.verification'], 'm1-release'); docker(['network', 'rm', prefix]); }
  const after = docker(['ps', '--format', '{{.ID}}']).split('\n').filter(Boolean).sort();
  assert.deepEqual(after, existing, 'Existing running containers must remain unchanged');
}
