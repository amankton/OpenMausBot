// Actual Chief API + lifecycle container + fresh SQL migrations and nginx.
// Accounts/Employee authority is explicitly synthetic; no owner account/model.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { preparePlatform, freePort, composeArguments } from './platform.mjs';
import { execute, atomicJson } from './core.mjs';
import { launchVerificationServer } from '../scripts/control-omb.ts';

const root = resolve('.'), home = await mkdtemp(join(tmpdir(), 'chief-workflow-native-fixture-'));
const context = 'desktop-linux';
const docker = async (...args) => {
  const chunks = [];
  try { return await execute('docker', ['--context', context, ...args], { cwd: root, timeout: 600000, onOutput: part => chunks.push(part) }); }
  catch (e) { e.message += '\n' + chunks.join('').replace(/PASSWORD\s+'[^']*'/gi, 'PASSWORD [REDACTED]').replace(/[a-f0-9]{64}/gi, '[REDACTED]').slice(-3000); throw e; }
};
let chief, project, composeReady = false;
const checks = [];
try {
  assert.match((await docker('context', 'inspect', context, '--format', '{{.Endpoints.docker.Host}}')).trim(), /^(unix|npipe):\/\//);
  const port = await freePort();
  chief = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, undefined, [], undefined, { lifecycleOrigin: `http://localhost:${port}` }, undefined, true);
  const prepared = await preparePlatform(root, home, { id: randomUUID() }, { workspace: port }, { images: {} });
  project = prepared.project;
  const config = prepared.config;
  config.services.cockroach.command = ['start-single-node', '--accept-sql-without-tls', '--cache=64MiB', '--max-sql-memory=64MiB'];
  config.services.cockroach.mem_limit = '1g';
  for (const service of ['chief-lifecycle', 'chief-lifecycle-migrate']) {
    config.services[service].image = 'chief-lifecycle:installer-workflow-20261104';
    config.services[service].environment.CHIEF_LIFECYCLE_ACCOUNTS_URL = 'http://synthetic-authority:8080';
    config.services[service].environment.CHIEF_LIFECYCLE_TRANSACTOR_URL = 'http://synthetic-authority:8080';
    delete config.services[service].environment.CHIEF_LIFECYCLE_COLLABORATOR_URL;
    config.services[service].volumes = [{ type: 'bind', source: join(chief.info.dataDir, 'member-bridge'), target: '/run/member-bridge' }];
  }
  await writeFile(join(home, 'platform/.secrets/member_key'), await readFile(join(chief.info.dataDir, 'member-key')), { mode: 0o600 });
  const workspace = randomUUID(), members = [0, 1].map(() => ({ account: randomUUID(), membershipEpoch: randomUUID() }));
  const authorityFile = join(home, 'synthetic-authority.mjs');
  await writeFile(authorityFile, `import{createServer}from'node:http';const members=${JSON.stringify(members)},workspace=${JSON.stringify(workspace)};let removed=false;createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');let value={};try{if(req.url==='/remove'){removed=true;res.end('{}');return;}const claims=JSON.parse(Buffer.from((req.headers.authorization||'').slice(7).split('.')[1],'base64url'));const member=members.find(m=>m.account===claims.account);if(!member||claims.workspace!==workspace)throw Error();if(req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);value={result:body.method==='getLoginInfoByToken'?{account:member.account,workspace,role:'USER'}:members.filter((m,i)=>!(removed&&i===0)).map(m=>({person:m.account,role:'USER',membershipEpoch:m.membershipEpoch}))};}else value={dataType:'TotalArray',value:[{_id:'person-'+member.account,personUuid:member.account,active:true}]};res.end(JSON.stringify(value));}catch{res.statusCode=403;res.end('{}');}}).listen(8080,'0.0.0.0');`, { mode: 0o600 });
  config.services['synthetic-authority'] = { image: 'chief-lifecycle:installer-workflow-20261104', platform: 'linux/amd64', user: `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`, command: ['node', '/fixture/authority.mjs'], networks: ['backend'], mem_limit: '128m', volumes: [{ type: 'bind', source: authorityFile, target: '/fixture/authority.mjs', read_only: true }] };
  await atomicJson(join(home, 'platform/compose.json'), config); composeReady = true;
  const compose = (...args) => docker(...composeArguments(home, ...args));
  await compose('up', '-d', '--pull', 'never', '--no-build', 'cockroach');
  let initialized = false, bootstrapFailure = '';
  for (let n = 0; n < 10; n++) { try { await compose('exec', '-T', '--user', '0', 'cockroach', './cockroach', 'sql', '--certs-dir=certs', '--host=127.0.0.1:26257', '--user=root', '--database=defaultdb', '--file=/chief-bootstrap/initialize.sql'); initialized = true; break; } catch (e) { bootstrapFailure = e.message.replace(/[a-f0-9]{64}/gi, '[REDACTED]'); await new Promise(done => setTimeout(done, 500)); } }
  if (!initialized) { console.error(bootstrapFailure); console.error((await compose('logs', '--tail', '20', 'cockroach')).replace(/[a-f0-9]{64}/gi, '[REDACTED]')); }
  assert.equal(initialized, true, 'Fresh database bootstrap');
  await compose('run', '--rm', '--no-deps', 'chief-lifecycle-migrate');
  await compose('run', '--rm', '--no-deps', 'chief-lifecycle-migrate');
  await compose('exec', '-T', '--user', '0', 'cockroach', './cockroach', 'sql', '--certs-dir=certs', '--host=127.0.0.1:26257', '--user=root', '--database=defaultdb', '--file=/chief-bootstrap/grants.sql');
  checks.push('Fresh database creation, repeat-safe migrations and restricted runtime grants');
  console.log('Fresh SQL bootstrap, repeat migrations and runtime grants passed');
  await compose('up', '-d', '--pull', 'never', '--no-build', '--no-deps', 'synthetic-authority', 'chief-lifecycle', 'nginx');
  const origin = `http://localhost:${port}`, base = origin;
  const rpc = async (path, { method = 'GET', token, cookie, body } = {}) => {
    const response = await fetch(base + '/chief/v1' + path, { method, headers: { Host: `localhost:${port}`, Origin: origin, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
    const value = await response.json(); return { response, value };
  };
  let ready = false, readinessFailure = '';
  for (let n = 0; n < 40; n++) { try { const r = await rpc('/status'); ready = r.response.ok; readinessFailure = JSON.stringify({ status: r.response.status, body: r.value }); if (ready) break; } catch (e) { readinessFailure = e.message; } await new Promise(done => setTimeout(done, 500)); }
  if (!ready) { console.error(readinessFailure); console.error((await compose('logs', '--tail', '15', 'chief-lifecycle', 'nginx')).replace(/[a-f0-9]{64}/gi, '[REDACTED]')); }
  assert.equal(ready, true, 'Lifecycle through actual nginx');
  const personal = async (path, body, method = 'GET') => {
    const response = await fetch(chief.info.url + path, { method, headers: { Origin: chief.info.url, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
    return { response, value: await response.json() };
  };
  const sessions = [];
  for (const member of members) {
    const token = Buffer.from('{}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ account: member.account, workspace })).toString('base64url') + '.synthetic';
    const opened = await rpc('/sessions', { method: 'POST', token, body: {} }); assert.equal(opened.response.status, 201, opened.value.error);
    sessions.push({ token, cookie: opened.response.headers.get('set-cookie').split(';')[0] });
  }
  const profiles = (await personal('/api/customer-workflow')).value;
  assert.equal(profiles.automaticMemberProvisioning, true); assert.equal(profiles.members.length, 2);
  assert.notEqual(profiles.members[0].botId, profiles.members[1].botId);
  assert.equal(profiles.scheduler.policy.requests, 20); assert.equal(profiles.scheduler.policy.activeMs, 600000);
  checks.push('Authenticated synthetic membership provisions two distinct real Chief profiles and enables runtime budgets');
  const first = sessions[0];
  const invitation = await rpc('/connections/challenges', { method: 'POST', ...first, body: {} }); assert.equal(invitation.response.status, 201);
  const assigned = profiles.members.find(m => m.account === members[0].account);
  const wrong = profiles.members.find(m => m.account === members[1].account);
  const refused = await personal('/api/chief-pairing', { invitation: invitation.value, bots: [wrong.botId] }, 'POST'); assert.equal(refused.response.status, 403);
  const paired = await personal('/api/chief-pairing', { invitation: invitation.value, bots: [assigned.botId] }, 'POST'); assert.equal(paired.response.status, 201, paired.value.error);
  const connection = paired.value.connection;
  assert.deepEqual(connection.scopes, ['tracker:read', 'workspace:read']);
  const pending = await personal(`/api/chief-pairing/${connection.id}/check`, {}, 'POST'); assert.equal(pending.response.status, 403);
  const confirmed = await rpc(`/connections/${connection.id}/confirm`, { method: 'POST', ...first, body: { keyFingerprint: connection.keyFingerprint } }); assert.equal(confirmed.response.status, 200);
  const checked = await personal(`/api/chief-pairing/${connection.id}/check`, {}, 'POST'); assert.equal(checked.response.status, 200, checked.value.error);
  checks.push('Automatic member/profile selection, cross-member denial, two-sided confirmation and default read-only connection');
  await compose('restart', 'chief-lifecycle');
  await new Promise(done => setTimeout(done, 1000));
  const repeated = await rpc('/sessions', { method: 'POST', token: first.token, body: {} }); assert.equal(repeated.response.status, 201, repeated.value.error);
  assert.equal((await personal('/api/customer-workflow')).value.members.length, 2);
  checks.push('Lifecycle restart retains SQL state and repeated sign-in creates no duplicate profiles');
  await compose('exec', '-T', 'synthetic-authority', 'node', '-e', "fetch('http://127.0.0.1:8080/remove',{method:'POST'}).then(r=>{if(!r.ok)process.exit(1)})");
  const revoked = await personal(`/api/chief-pairing/${connection.id}/check`, {}, 'POST'); assert.equal(revoked.response.status, 403);
  checks.push('Current membership removal revokes paired runtime access');
  const restrictions = await compose('exec', '-T', 'chief-lifecycle', 'node', '--input-type=module', '-e', "import postgres from './driver.mjs';import{readFileSync}from'node:fs';const sql=postgres(readFileSync(process.env.CHIEF_LIFECYCLE_DATABASE_URL_FILE,'utf8'),{onnotice(){}});let denied=false;try{await sql`CREATE TABLE chief_lifecycle.unwanted(id INT)`}catch{denied=true}await sql.end();if(!denied)process.exit(1);console.log('DDL_DENIED')");
  assert.match(restrictions, /DDL_DENIED/); checks.push('Runtime database identity cannot create lifecycle tables');
  console.log(JSON.stringify({ passed: true, actualChiefApi: true, actualLifecycleImage: true, freshDisposableSql: true, authority: 'synthetic Accounts/Employee stub', providerCalls: 0, checks }, null, 2));
} finally {
  if (composeReady && /^chief-pilot-[a-f0-9]{12}$/.test(project)) await docker(...composeArguments(home, 'down', '--volumes', '--remove-orphans')).catch(() => {});
  if (chief) await chief.close();
  assert.equal(basename(home).startsWith('chief-workflow-native-fixture-'), true); assert.equal(resolve(home).startsWith(resolve(tmpdir())), true);
  await rm(home, { recursive: true, force: true });
}
