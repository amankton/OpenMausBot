// Explicit local-only rollout. No owner sessions are created or confirmed here.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { ROOT, dockerEnvironment } from './configure-chief-platform.mjs';

assert.equal(process.argv[2], '--apply', 'Use --apply only for the owner-authorized Tracker rollout');
const docker = args => {
  try { return execFileSync('docker', args, { env: dockerEnvironment(), windowsHide: true, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { throw Error('Tracker rollout Docker operation failed; private diagnostics suppressed. Inspect local recovery evidence.'); }
};
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const deployment = join(ROOT, '.chief-local/m1-pairing/deployment');
const recovery = join(ROOT, '.chief-local/m1-pairing', 'pre-tracker-' + Date.now()); await mkdir(recovery);
const composeFile = join(deployment, 'compose.json'), policyFile = join(deployment, 'policy/grants.json');
const compose = await read(composeFile), policy = await read(policyFile), service = compose.services['chief-lifecycle'];
assert.equal(service.environment.CHIEF_LIFECYCLE_ORIGIN, 'http://localhost:18087'); assert.equal(service.ports, undefined);
const receipt = await read(process.argv[3]); assert.equal(receipt.passed, true); assert.ok(receipt.checks.some(c => c.includes('MCP')));
const image = docker(['image', 'inspect', 'chief-lifecycle:tracker-20261021', '--format', '{{.Id}}']);
const fileHash = createHash('sha256').update(await readFile(join(ROOT, 'integrations/platform/lifecycle/tracker.mjs'))).digest('hex');
assert.equal(docker(['run', '--rm', '--read-only', '--network', 'none', image, 'node', '-e', "console.log(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync('tracker.mjs')).digest('hex'))"]), fileHash);
await copyFile(composeFile, join(recovery, 'compose.before.json')); await copyFile(policyFile, join(recovery, 'grants.before.json'));
const before = JSON.parse(docker(['inspect', ...docker(['ps', '-q', '--filter', 'label=com.docker.compose.project=chief-platform']).split(/\r?\n/)]));
const [db] = before.filter(c => c.Name === '/chief-platform-cockroach-1'); assert.ok(db);
const env = Object.fromEntries(db.Config.Env.map(value => { const i = value.indexOf('='); return [value.slice(0, i), value.slice(i + 1)]; }));
const admin = new URL('postgres://localhost:26257/chief_platform?sslmode=disable'); admin.username = env.COCKROACH_USER; admin.password = env.COCKROACH_PASSWORD;
const sql = statement => docker(['exec', 'chief-platform-cockroach-1', '/cockroach/cockroach', 'sql', '--url', admin.href, '--format=csv', '--execute', statement]);
const backup = 'chief-tracker-before-' + Date.now();
assert.ok(sql(`BACKUP DATABASE chief_platform INTO 'nodelocal://1/${backup}'`).includes('succeeded'));
docker(['cp', 'chief-platform-cockroach-1:/cockroach/cockroach-data/extern/' + backup, recovery]);
await writeFile(join(recovery, 'backup.json'), JSON.stringify({ backup, at: new Date().toISOString() }));
const composeArgs = (...args) => ['compose', '--project-name', 'chief-lifecycle-local', '--file', composeFile, ...args];
docker(composeArgs('stop', 'chief-lifecycle'));
try {
  const migrationEnv = { ...service.environment, CHIEF_LIFECYCLE_DATABASE_URL_FILE: '/run/chief/migration-db' };
  docker(['run', '--rm', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--network', 'chief-platform_backend',
    ...Object.entries(migrationEnv).flatMap(([k, v]) => ['--env', k + '=' + v]),
    '--mount', `type=bind,src=${join(deployment, 'migration-db')},dst=/run/chief/migration-db,readonly`,
    '--mount', `type=bind,src=${join(deployment, 'encryption-key')},dst=/run/chief/encryption-key,readonly`, image, 'node', 'main.mjs', 'migrate']);
  sql('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE chief_lifecycle.tracker_action TO chief_lifecycle_runtime');
  const ownerRows = sql("SELECT m.account_uuid AS account,m.workspace_uuid AS workspace FROM global_account.workspace_members m JOIN global_account.workspace w ON w.uuid=m.workspace_uuid WHERE w.url='chiefexecutivesuite' AND m.role='OWNER'").split(/\r?\n/);
  assert.equal(ownerRows.length, 2); const [account, workspace] = ownerRows[1].split(',');
  const grant = policy.grants.find(g => g.account === account && g.workspace === workspace); assert.ok(grant);
  for (const bot of ['30159ee3-44b9-4d4e-9b9d-86f84c18fc9d', '68b115df-b58b-448d-803f-18ae360e9506']) assert.ok(grant.bots.includes(bot));
  grant.scopes = [...new Set([...grant.scopes, 'tracker:read', 'tracker:write'])];
  // Eligibility is not a connection grant: owner confirmation is still required.
  await writeFile(policyFile, JSON.stringify(policy, null, 2));
  service.image = image; service.environment.CHIEF_LIFECYCLE_COLLABORATOR_URL = 'http://collaborator:3078';
  await writeFile(composeFile, JSON.stringify(compose, null, 2));
  docker(composeArgs('up', '--detach', '--no-deps', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '60', 'chief-lifecycle'));
  docker(['exec', 'chief-platform-nginx-1', 'nginx', '-t']); docker(['exec', 'chief-platform-nginx-1', 'nginx', '-s', 'reload']);
  assert.ok((await fetch('http://localhost:18087/chief/v1/status', { signal: AbortSignal.timeout(5000) })).ok);
  for (const old of before) {
    const [now] = JSON.parse(docker(['inspect', old.Id])); assert.equal(now.State.Running, true); assert.equal(now.Id, old.Id);
  }
  await writeFile(join(recovery, 'receipt.json'), JSON.stringify({ passed: true, image, backup, recovery, originalPlatformContainersPreserved: before.length, at: new Date().toISOString(), pairingStillRequired: true }, null, 2));
  console.log(JSON.stringify({ passed: true, image, recovery, pairingStillRequired: true }));
} catch (error) {
  await copyFile(join(recovery, 'grants.before.json'), policyFile);
  // Additive schema v3 cannot be served by the old v2 schema checker. The new
  // image without Tracker configured is the safe compatibility rollback.
  service.image = image; delete service.environment.CHIEF_LIFECYCLE_COLLABORATOR_URL;
  await writeFile(composeFile, JSON.stringify(compose, null, 2));
  docker(composeArgs('up', '--detach', '--no-deps', '--no-build', '--pull', 'never', 'chief-lifecycle'));
  throw error;
}
