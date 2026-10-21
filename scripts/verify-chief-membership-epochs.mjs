// Native Accounts SQL methods + strict lifecycle service on a disposable DB.
// No owner credentials, live Accounts calls, or production migrations.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID, generateKeyPairSync, sign, createHmac } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { ROOT, dockerEnvironment } from './configure-chief-platform.mjs';
import postgres from '../integrations/platform/lifecycle/driver.mjs';
import { PairingService, migratePairing, runtimeMessage } from '../integrations/platform/lifecycle/pairing.mjs';
import { accountsMemberVerifier } from '../integrations/platform/lifecycle/member.mjs';
import { AccessError, signedClaim, secret, digest } from '../integrations/platform/lifecycle/security.mjs';
import { verifySchema } from '../integrations/platform/lifecycle/migrations.mjs';

const source = join(ROOT, '.chief-local/platform-source');
const directory = await mkdtemp(join(ROOT, '.chief-local/m1-pairing/epochs-'));
const nativeFiles = ['server/account/src/collections/postgres/postgres.ts', 'server/account/src/collections/postgres/migrations.ts'];
await build({ entryPoints: nativeFiles.map(f => join(source, f)), outdir: directory, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { PostgresAccountDB } = await import(pathToFileURL(join(directory, 'postgres.js')));
const { getMigrations } = await import(pathToFileURL(join(directory, 'migrations.js')));
const name = 'chief-epochs-' + randomBytes(4).toString('hex');
const label = 'm1-epochs';
const docker = args => execFileSync('docker', args, { env: dockerEnvironment(), encoding: 'utf8', windowsHide: true, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const image = 'cockroachdb/cockroach@sha256:885d9b0e3243f262976763717e547dbbe75ca999548f7a4ea95fcd30a9aee66c';
const before = docker(['ps', '--format', '{{.ID}}']).split('\n').sort();
const checks = []; let created = false, sql, accountCreated = false, accountImage;
const accountName = name + '-accounts';
try {
  docker(['run', '--detach', '--name', name, '--label', 'io.chief.verification=' + label, '--memory', '1g', '--cpus', '1',
    '--publish', '127.0.0.1::26257', '--entrypoint', '/cockroach/cockroach', image, 'start-single-node', '--insecure',
    '--store=type=mem,size=640MiB', '--cache=64MiB', '--max-sql-memory=64MiB', '--listen-addr=0.0.0.0:26257']); created = true;
  const [container] = JSON.parse(docker(['inspect', name]));
  const dbPort = container.NetworkSettings.Ports['26257/tcp'][0].HostPort;
  sql = postgres('postgres://root@127.0.0.1:' + dbPort + '/defaultdb?sslmode=disable', { max: 4, connect_timeout: 2, onnotice() {} });
  let ready = false;
  for (let i = 0; i < 30; i++) { try { await sql`SELECT 1`; ready = true; break; } catch {} await new Promise(r => setTimeout(r, 300)); }
  assert.ok(ready);
  const db = new PostgresAccountDB(sql, 'epoch_accounts', 'cockroach');
  await db.init(); await db.init();
  const account = randomUUID(), other = randomUUID(), workspace = randomUUID(), otherWorkspace = randomUUID();
  for (const id of [account, other]) {
    await db.person.insertOne({ uuid: id, firstName: 'Synthetic', lastName: 'Epoch Test' });
    await db.account.insertOne({ uuid: id });
    await db.socialId.insertOne({ type: 'email', value: id + '@fixture.invalid', personUuid: id, verifiedOn: Date.now() });
  }
  await db.workspace.insertOne({ uuid: workspace, name: 'Synthetic epoch workspace', url: 'epoch-' + workspace });
  await db.workspace.insertOne({ uuid: otherWorkspace, name: 'Other synthetic workspace', url: 'epoch-' + otherWorkspace });
  await db.assignWorkspace(account, workspace, 'USER');
  await db.batchAssignWorkspace([[other, workspace, 'USER'], [account, otherWorkspace, 'USER']]);
  const epoch = async () => (await db.getWorkspaceMembers(workspace)).find(m => m.person === account).membershipEpoch;
  const first = await epoch(); assert.match(first, /^[a-f0-9-]{36}$/);
  const otherEpoch = (await db.getWorkspaceMembers(workspace)).find(m => m.person === other).membershipEpoch;
  assert.notEqual(otherEpoch, first);
  await db.setWorkspaceMemberUnread(account, workspace, true); await db.updateWorkspaceRole(account, workspace, 'USER');
  assert.equal(await epoch(), first);
  checks.push('Complete native Accounts migrations apply twice; single/batch joins receive distinct epochs; unread and unchanged-role updates preserve them');
  await sql`CREATE SCHEMA backfill_accounts`;
  await sql`CREATE TABLE backfill_accounts.workspace_members (account_uuid UUID PRIMARY KEY)`;
  await sql`INSERT INTO backfill_accounts.workspace_members (account_uuid) VALUES (${account}), (${other})`;
  await sql.unsafe(getMigrations('backfill_accounts', 'cockroach').at(-1)[1]);
  const backfilled = await sql`SELECT membership_epoch FROM backfill_accounts.workspace_members`;
  assert.equal(new Set(backfilled.map(row => row.membership_epoch)).size, 2);
  assert.ok(backfilled.every(row => /^[a-f0-9-]{36}$/.test(row.membership_epoch)));
  checks.push('Additive Accounts migration gives existing members distinct non-null epochs');
  // HTTP identity/Employee adapters are explicit fixtures. Epochs and membership
  // operations below use the exact production Accounts SQL implementation.
  let accountsUrl = 'http://fixture/accounts';
  const signingKey = randomBytes(32).toString('hex');
  const signedBody = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ account, workspace, extra: { authMethod: 'password' } })).toString('base64url');
  const token = signedBody + '.' + createHmac('sha256', signingKey).update(signedBody).digest('base64url');
  if (process.argv.includes('--account-image') || process.argv.includes('--release-image')) {
    accountImage = docker(['image', 'inspect', 'chief-account:con01-epochs', '--format', '{{.Id}}']);
    const envPath = join(directory, 'account.env');
    await writeFile(envPath, [`SERVER_SECRET=${signingKey}`, `DB_URL=postgres://root@host.docker.internal:${dbPort}/defaultdb?sslmode=disable`,
      'DB_NS=epoch_accounts', 'TRANSACTOR_URL=ws://127.0.0.1:3333', 'FRONT_URL=http://127.0.0.1', 'DISABLE_SIGNUP=true', 'ENABLE_CONSOLE=false'].join('\n'));
    docker(['run', '--detach', '--name', accountName, '--label', 'io.chief.verification=' + label, '--memory', '512m', '--cpus', '1',
      '--publish', '127.0.0.1::3000', '--env-file', envPath, accountImage]); accountCreated = true;
    const [pod] = JSON.parse(docker(['inspect', accountName]));
    accountsUrl = 'http://127.0.0.1:' + pod.NetworkSettings.Ports['3000/tcp'][0].HostPort;
    let podReady = false;
    for (let i = 0; i < 40; i++) {
      try {
        const r = await fetch(accountsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ method: 'getWorkspaceMembers', params: {} }), signal: AbortSignal.timeout(2000) });
        const value = await r.json(); if (value.result?.some(m => m.membershipEpoch === first)) { podReady = true; break; }
      } catch {} await new Promise(r => setTimeout(r, 400));
    }
    assert.ok(podReady, 'Candidate Accounts pod must serve its current epoch through authenticated RPC');
    checks.push('Actual candidate Accounts container authenticates a synthetic signed member JWT and returns authoritative membership epochs over HTTP');
  }
  let authorityDown = false, omitEpoch = false;
  const verifier = accountsMemberVerifier({ accountsUrl, transactorUrl: 'http://fixture/transactor', fetcher: async (url, init) => {
    if (authorityDown) throw Error('Synthetic outage');
    if (String(url).includes('/transactor')) return new Response(JSON.stringify({ dataType: 'TotalArray', value: [{ _id: 'epoch-person' }] }));
    const method = JSON.parse(init.body).method;
    if (accountCreated) {
      const r = await fetch(url, init);
      if (!omitEpoch || method !== 'getWorkspaceMembers') return r;
      const value = await r.json();
      return new Response(JSON.stringify({ ...value, result: value.result?.map(({ person, role }) => ({ person, role })) }));
    }
    if (method === 'getLoginInfoByToken') return new Response(JSON.stringify({ result: { account, workspace, role: await db.getWorkspaceRole(account, workspace) } }));
    const members = await db.getWorkspaceMembers(workspace);
    return new Response(JSON.stringify({ result: omitEpoch ? members.map(({ person, role }) => ({ person, role })) : members }));
  } });
  // Exercise v1 -> v2 upgrade, preserving the immutable v1 migration.
  const initialSql = await readFile(join(ROOT, 'integrations/platform/lifecycle/001-pairing.sql'), 'utf8');
  await sql.unsafe(initialSql);
  await sql`INSERT INTO chief_lifecycle.schema_version (version, checksum) VALUES (1, ${digest(initialSql)})`;
  const legacy = randomUUID();
  await sql`INSERT INTO chief_lifecycle.member_session (id, workspace, account, person, secret_hash, credential, expires_at)
    VALUES (${legacy}, ${workspace}, ${account}, 'legacy-person', ${digest(secret())}, 'legacy-encrypted', now()+INTERVAL '1 hour')`;
  await migratePairing(sql); await migratePairing(sql); await verifySchema(sql);
  assert.ok((await sql`SELECT revoked_at FROM chief_lifecycle.member_session WHERE id=${legacy}`)[0].revoked_at);
  checks.push('Lifecycle v1 upgrades to v2 and repeats safely; pre-epoch sessions are permanently revoked');
  const key = randomBytes(32);
  const entitlement = async () => ({ pairing: true, bots: ['epoch-specialist'], scopes: ['workspace:read'] });
  let service = new PairingService({ sql, verifyMember: verifier, encryptionKey: key, entitlement });
  const denied = action => assert.rejects(action, e => e instanceof AccessError && e.status === 403);
  const pair = async () => {
    const session = await service.openSession(token);
    const invitation = await service.challenge(token, session.secret);
    const keys = generateKeyPairSync('ed25519');
    const claim = { challenge: invitation.challenge, runtimeId: randomUUID(), publicKey: keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'), bots: ['epoch-specialist'], scopes: ['workspace:read'] };
    const result = await service.complete({ ...claim, signature: sign(null, signedClaim(claim), keys.privateKey).toString('base64url') });
    result.connection = await service.confirm(token, session.secret, result.connection.id, result.connection.keyFingerprint);
    const authorize = () => {
      const proof = { connectionId: result.connection.id, generation: result.connection.generation, nonce: secret(), timestamp: Date.now(), bot: 'epoch-specialist', scope: 'workspace:read' };
      return service.authorizeRuntime(result.runtimeSecret, { ...proof, signature: sign(null, runtimeMessage(proof), keys.privateKey).toString('base64url') });
    };
    await authorize(); return { session, result, authorize };
  };
  const original = await pair();
  await db.unassignWorkspace(account, workspace); await db.assignWorkspace(account, workspace, 'USER');
  assert.notEqual(await epoch(), first);
  // No lifecycle call observes the absence: this is the formerly missing case.
  service = new PairingService({ sql, verifyMember: verifier, encryptionKey: key, entitlement });
  await denied(original.authorize);
  assert.equal((await sql`SELECT state FROM chief_lifecycle.member_connection WHERE id=${original.result.connection.id}`)[0].state, 'revoked');
  checks.push('Native Accounts removal/re-add entirely between authorization calls and a lifecycle restart permanently rejects the old signed runtime');
  const replacement = await pair();
  await db.updateWorkspaceRole(account, workspace, 'GUEST'); await db.updateWorkspaceRole(account, workspace, 'USER');
  await denied(() => service.memberSession(token, replacement.session.secret)); await denied(replacement.authorize);
  checks.push('Role downgrade/restore between checks invalidates the browser session and runtime; a fresh pairing is required');
  const pendingSession = await service.openSession(token);
  const pendingInvitation = await service.challenge(token, pendingSession.secret);
  const pendingKeys = generateKeyPairSync('ed25519');
  const pendingClaim = { challenge: pendingInvitation.challenge, runtimeId: randomUUID(), publicKey: pendingKeys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'), bots: ['epoch-specialist'], scopes: ['workspace:read'] };
  await db.unassignWorkspace(account, workspace); await db.assignWorkspace(account, workspace, 'USER');
  await denied(() => service.complete({ ...pendingClaim, signature: sign(null, signedClaim(pendingClaim), pendingKeys.privateKey).toString('base64url') }));
  checks.push('A pending invitation cannot be completed after membership removal/re-add, even with its original runtime proof');
  const current = await pair();
  authorityDown = true; await assert.rejects(current.authorize, e => e.status === 503);
  authorityDown = false; await current.authorize();
  omitEpoch = true; await assert.rejects(current.authorize, e => e.status === 503); await assert.rejects(() => service.openSession(token), e => e.status === 503);
  omitEpoch = false; await current.authorize();
  assert.equal((await db.getWorkspaceMembers(workspace)).find(m => m.person === other).membershipEpoch, otherEpoch);
  checks.push('Authority outage/missing epoch fails closed without destroying a valid session; other members remain unchanged');
  if (process.argv.includes('--release-image')) {
    const body = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ account: other, workspace, extra: { authMethod: 'otp' } })).toString('base64url');
    const otherToken = body + '.' + createHmac('sha256', signingKey).update(body).digest('base64url');
    // Explicit Employee stub for this container-only test. It accepts only the
    // two generated tokens and exact workspace/query shape; no owner authority.
    const employee = createServer((req, res) => {
      const accepted = req.headers.authorization === 'Bearer ' + token ? account : req.headers.authorization === 'Bearer ' + otherToken ? other : undefined;
      const url = new URL(req.url, 'http://fixture');
      const expected = JSON.stringify({ personUuid: accepted, active: true });
      if (!accepted || req.method !== 'GET' || url.pathname !== '/api/v1/find-all/' + workspace || url.searchParams.get('class') !== 'contact:mixin:Employee' || url.searchParams.get('query') !== expected) {
        res.writeHead(403); res.end('{}'); return;
      }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ dataType: 'TotalArray', value: [{ _id: 'synthetic-' + accepted }] }));
    });
    await new Promise(resolve => employee.listen(0, '0.0.0.0', resolve));
    try {
      const transactorUrl = 'http://127.0.0.1:' + employee.address().port;
      const manifest = join(directory, 'synthetic-authority.json');
      await writeFile(manifest, JSON.stringify({ kind: 'chief-epoch-synthetic-authority', createdAt: new Date().toISOString(),
        accountContainer: accountName, accountImage, tokens: [token, otherToken], accountsUrl, transactorUrl,
        containerAccountsUrl: accountsUrl.replace('127.0.0.1', 'host.docker.internal'), containerTransactorUrl: transactorUrl.replace('127.0.0.1', 'host.docker.internal') }), { mode: 0o600 });
      const output = createWriteStream(join(directory, 'release.log'));
      const child = spawn(process.execPath, ['--experimental-strip-types', join(ROOT, 'scripts/verify-chief-lifecycle-release.mjs'), '--synthetic-authority', manifest], { cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.pipe(output, { end: false }); child.stderr.pipe(output, { end: false });
      const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
      await new Promise(resolve => output.end(resolve));
      assert.equal(code, 0, 'Combined container release checks failed; see private release.log');
      checks.push('Epoch-enabled Accounts candidate also passes the complete isolated lifecycle/nginx release suite; see chief-lifecycle-epochs-release.json');
    } finally { await new Promise(resolve => employee.close(resolve)); }
  }
  const receipt = { passed: true, capturedAt: new Date().toISOString(), checks,
    sourceHashes: Object.fromEntries(await Promise.all(nativeFiles.map(async f => [f, digest(await readFile(join(source, f)))]))),
    migration: getMigrations('epoch_accounts', 'cockroach').at(-1)[0],
    accountImage,
    scope: accountCreated ? 'Actual Accounts candidate container authenticated RPC + native SQL/migrations + strict lifecycle service on disposable CockroachDB. Active Employee and outage adapters are fixtures; no full workbench or owner deployment acceptance.' : 'Actual native Accounts SQL/migrations plus strict lifecycle service in disposable CockroachDB; RPC authentication and active Employee are explicit fixtures, not full Accounts pod or live deployment acceptance' };
  await writeFile(join(ROOT, 'docs/verification/evidence', accountCreated ? 'chief-membership-epochs-container.json' : 'chief-membership-epochs.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
} catch (error) {
  await writeFile(join(directory, 'failure.txt'), String(error.stack ?? error));
  console.error('Epoch verification failed; private diagnostic: ' + join(directory, 'failure.txt')); process.exitCode = 1;
} finally {
  await sql?.end({ timeout: 3 });
  if (accountCreated) {
    const [pod] = JSON.parse(docker(['inspect', accountName])); assert.equal(pod.Config.Labels['io.chief.verification'], label);
    assert.deepEqual(pod.Mounts, []); docker(['rm', '--force', accountName]);
  }
  if (created) {
    const [container] = JSON.parse(docker(['inspect', name])); assert.equal(container.Config.Labels['io.chief.verification'], label);
    assert.deepEqual(container.Mounts, []); docker(['rm', '--force', name]);
  }
  assert.deepEqual(docker(['ps', '--format', '{{.ID}}']).split('\n').sort(), before);
}
