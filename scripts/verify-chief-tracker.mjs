// Isolated lifecycle database + existing synthetic Huly acceptance workspace.
// No owner token, record, pairing, policy or running service is modified.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { join } from 'node:path';
import postgres from '../integrations/platform/lifecycle/driver.mjs';
import { accountsMemberVerifier } from '../integrations/platform/lifecycle/member.mjs';
import { PairingService, migratePairing } from '../integrations/platform/lifecycle/pairing.mjs';
import { AccessError } from '../integrations/platform/lifecycle/security.mjs';
import { TrackerClient } from '../integrations/platform/lifecycle/tracker.mjs';
import { createLifecycleServer } from '../integrations/platform/lifecycle/http.mjs';
import { ChiefPairingRuntime } from '../server/chief-pairing.ts';
import { mountChatTools } from '../server/drivers/chat-mcp-tools.ts';
import { hulyIntegration } from '../server/huly-tools.ts';
import { ROOT, dockerEnvironment } from './configure-chief-platform.mjs';

const docker = args => execFileSync('docker', args, { env: dockerEnvironment(), encoding: 'utf8', windowsHide: true, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const dir = await mkdtemp(join(ROOT, '.chief-local/m1-pairing/tracker-fixture-'));
const origin = 'http://localhost:18087';
const verifyMember = accountsMemberVerifier({ accountsUrl: origin + '/_accounts', transactorUrl: origin + '/_transactor' });
const tokens = [];
for (const file of ['acceptance-state.json', 'acceptance-partner-state.json']) {
  const state = JSON.parse(await readFile(join(ROOT, '.chief-local/platform', file), 'utf8'));
  assert.ok(!JSON.stringify(state).includes('chiefexecutivesuite'), 'Owner state forbidden');
  const token = state.cookies.find(c => c.name === 'presentation-metadata-Token' && c.path.startsWith('/files/'))?.value;
  assert.ok(token); tokens.push(token);
}
const members = await Promise.all(tokens.map(verifyMember));
assert.equal(members[0].workspaceSlug, 'chiefacceptance');
assert.equal(members[1].workspace, members[0].workspace);
assert.notEqual(members[0].account, members[1].account);
const name = 'chief-tracker-fixture-' + randomBytes(4).toString('hex');
const checks = []; let sql, http, started = false;
const tracker = new TrackerClient({ origin, transactorUrl: origin + '/_transactor', collaboratorUrl: origin + '/_collaborator', fetcher: async (...input) => { const response = await fetch(...input); if (!response.ok) console.error(JSON.stringify({ upstreamStatus: response.status, path: new URL(input[0]).pathname, txClass: input[1]?.body ? JSON.parse(input[1].body)._class : undefined, txTarget: input[1]?.body ? JSON.parse(input[1].body).objectClass : undefined, space: input[1]?.body ? JSON.parse(input[1].body).objectSpace : undefined, diagnostic: (await response.clone().json().catch(() => ({}))).error?.code })); return response; } });
const direct = { token: tokens[0], member: members[0], workspaceSlug: 'chiefacceptance', recheck: async () => { await verifyMember(tokens[0]); } };
try {
  docker(['run', '-d', '--name', name, '--label', 'io.chief.verification=tracker-tools', '-p', '127.0.0.1::26257',
    'cockroachdb/cockroach@sha256:885d9b0e3243f262976763717e547dbbe75ca999548f7a4ea95fcd30a9aee66c', 'start-single-node', '--insecure', '--store=type=mem,size=0.25', '--cache=64MiB', '--max-sql-memory=64MiB']); started = true;
  const port = JSON.parse(docker(['inspect', name]))[0].NetworkSettings.Ports['26257/tcp'][0].HostPort;
  sql = postgres(`postgres://root@127.0.0.1:${port}/defaultdb?sslmode=disable`, { max: 4, connect_timeout: 2, onnotice() {} });
  let ready = false;
  for (let i = 0; i < 25; i++) { try { await sql`SELECT 1`; ready = true; break; } catch { await new Promise(r => setTimeout(r, 300)); } }
  assert.ok(ready); await migratePairing(sql); await migratePairing(sql);
  const policies = new Map(members.map((m, i) => [m.account, { pairing: true, bots: ['fixture-bot-' + i], scopes: ['workspace:read', 'tracker:read', 'tracker:write'] }]));
  const pairing = new PairingService({ sql, verifyMember, entitlement: async m => policies.get(m.account), encryptionKey: randomBytes(32) });
  const sessions = await Promise.all(tokens.map(t => pairing.openSession(t)));
  const probe = createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const servicePort = probe.address().port; await new Promise(r => probe.close(r));
  const serviceOrigin = 'http://127.0.0.1:' + servicePort;
  http = createLifecycleServer({ pairing, tracker, origin: serviceOrigin }); await new Promise(r => http.listen(servicePort, '127.0.0.1', r));
  const runtime = new ChiefPairingRuntime({ directory: dir, origin: serviceOrigin, hasBot: id => id === 'fixture-bot-0' });
  const challenge = await pairing.challenge(tokens[0], sessions[0].secret);
  const connection = await runtime.pair(JSON.parse(JSON.stringify(challenge)), ['fixture-bot-0'], true);
  await pairing.confirm(tokens[0], sessions[0].secret, connection.id, connection.keyFingerprint); await runtime.check(connection.id);
  const call = (op, args) => runtime.tracker(connection.id, 'fixture-bot-0', op, args);
  const { projects } = await call('projects', {}); assert.ok(projects.length);
  const base = await tracker.project(direct, projects[0].id);
  const projectId = randomBytes(12).toString('hex');
  await tracker.write(direct, tracker.tx(direct, 'core:class:TxCreateDoc', projectId, base.space, { objectClass: 'tracker:class:Project', createdBy: members[0].socialId,
    attributes: { name, description: 'Isolated Chief Tracker tool acceptance', identifier: 'CFT' + randomBytes(3).toString('hex').toUpperCase(), sequence: 0,
      archived: false, private: true, members: [members[0].account], type: base.type, defaultIssueStatus: base.defaultIssueStatus,
      defaultTimeReportDay: base.defaultTimeReportDay ?? 'CurrentWorkDay' } }));
  const args = { projectId, title: 'Fixture issue ' + name, description: 'Persisted member-scoped description\nSecond paragraph', requestId: randomUUID() };
  const created = await call('create_issue', args);
  assert.equal(created.title, args.title); assert.equal(created.description, args.description); assert.equal(created.projectId, projectId); assert.ok(created.identifier);
  const mounted = await mountChatTools({ custom: { huly: hulyIntegration(dir, serviceOrigin, 'fixture-bot-0') } }, new AbortController().signal);
  try {
    assert.ok(mounted.definitions.some(t => t.function.name === 'huly_create_issue'));
    const result = await mounted.execute('huly_issue', { connectionId: connection.id, projectId, issueId: created.id }, new AbortController().signal);
    assert.equal(result.ok, true); assert.equal(JSON.parse(result.text).description, args.description);
    assert.ok(!result.text.includes(tokens[0]));
  } finally { await mounted.close(); }
  checks.push('Packaged-path MCP stdio tools mount through the real chat broker and return saved issue readback without credentials');
  const replay = await call('create_issue', args); assert.equal(replay.id, created.id);
  const restart = new ChiefPairingRuntime({ directory: dir, origin: serviceOrigin, hasBot: id => id === 'fixture-bot-0' });
  assert.equal((await restart.tracker(connection.id, 'fixture-bot-0', 'create_issue', args)).id, created.id);
  assert.equal((await call('issues', { projectId, title: args.title })).issues.length, 1);
  checks.push('Actual member Transactor/Collaborator create and saved description readback; repeated request and runtime restart produce exactly one issue');
  await assert.rejects(() => call('create_issue', { ...args, title: 'Changed arguments' }));
  await assert.rejects(() => runtime.tracker(connection.id, 'fixture-bot-1', 'issue', { projectId, issueId: created.id }));
  const otherCtx = { token: tokens[1], member: members[1], workspaceSlug: 'chiefacceptance', recheck: async () => { await verifyMember(tokens[1]); } };
  await assert.rejects(() => tracker.run(otherCtx, 'issue', { projectId, issueId: created.id }));
  checks.push('Different bot/member and private project isolation; changed-argument replay rejected');
  policies.get(members[0].account).scopes = ['workspace:read', 'tracker:read'];
  await assert.rejects(() => call('update_issue', { projectId, issueId: created.id, title: 'Forbidden change', requestId: randomUUID() }));
  assert.equal((await call('issue', { projectId, issueId: created.id })).title, args.title);
  policies.get(members[0].account).scopes.push('tracker:write');
  const updated = await call('update_issue', { projectId, issueId: created.id, title: args.title + ' updated', requestId: randomUUID() });
  assert.equal(updated.title, args.title + ' updated');
  checks.push('Live policy removal denies writes while read access remains; authorized title update reads back');
  const tampered = new ChiefPairingRuntime({ directory: dir, origin: serviceOrigin, hasBot: () => true, fetcher: async (url, init) => {
    const body = JSON.parse(init.body); body.arguments.projectId = 'other-project';
    return fetch(url, { ...init, body: JSON.stringify(body) });
  } });
  await assert.rejects(() => tampered.tracker(connection.id, 'fixture-bot-0', 'issues', { projectId }));
  checks.push('Signed operation arguments cannot be changed in transit');
  const uncertainArgs = { projectId, title: 'Uncertain fixture ' + name, description: 'Recovered without another write', requestId: randomUUID() };
  const run = tracker.run.bind(tracker); let loseReply = true;
  tracker.run = async (...input) => { const result = await run(...input); if (input[1] === 'create_issue' && loseReply) { loseReply = false; throw new AccessError(503, 'Fixture response loss'); } return result; };
  await assert.rejects(() => call('create_issue', uncertainArgs));
  const recovered = await call('create_issue', uncertainArgs); assert.equal(recovered.description, uncertainArgs.description);
  assert.equal((await call('issues', { projectId, title: uncertainArgs.title })).issues.length, 1);
  checks.push('Lost successful write response is recovered by deterministic saved issue ID without duplicate creation');
  await pairing.closeBrowserSession(sessions[0].secret);
  await assert.rejects(() => call('issue', { projectId, issueId: created.id }));
  checks.push('Member logout immediately revokes Tracker tools');
  await writeFile(join(dir, 'receipt.json'), JSON.stringify({ passed: true, checks, projectId, issueId: created.id, syntheticWorkspace: members[0].workspace, at: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, receipt: join(dir, 'receipt.json') }, null, 2));
} finally {
  if (http) { http.closeAllConnections(); await new Promise(r => http.close(r)); }
  if (sql) await sql.end({ timeout: 5 });
  if (started) {
    assert.equal(docker(['inspect', name, '--format', '{{index .Config.Labels "io.chief.verification"}}']), 'tracker-tools');
    docker(['rm', '-f', name]);
  }
}
