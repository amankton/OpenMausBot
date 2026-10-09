// Apply only the verified account-cookie proxy adaptation; preserve all services.
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { ROOT, dockerEnvironment } from './configure-chief-platform.mjs';

const apply = process.argv[2] === '--apply';
if (process.argv.length !== 3 || !['--check', '--apply'].includes(process.argv[2])) throw Error('Use --check or --apply');
const config = join(ROOT, 'integrations/platform/nginx-meetings.conf');
const prior = join(ROOT, '.chief-local/session-persistence/nginx.before.conf');
const evidence = join(ROOT, 'docs/verification/evidence');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const run = args => {
  try { return execFileSync('docker', args, { env: dockerEnvironment(), encoding: 'utf8', windowsHide: true, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { throw Error('Docker operation failed; private output suppressed'); }
};
const snapshot = () => {
  const ids = run(['ps', '-a', '--filter', 'label=com.docker.compose.project=chief-platform', '--format', '{{.ID}}']).split(/\r?\n/).filter(Boolean);
  if (ids.length !== 17) throw Error('Expected all 17 Chief services');
  return JSON.parse(run(['inspect', ...ids])).map(c => ({ id: c.Id, service: c.Config.Labels['com.docker.compose.service'], image: c.Image,
    running: c.State.Running, health: c.State.Health?.Status ?? null,
    mounts: c.Mounts.map(m => ({ type: m.Type, source: m.Source, destination: m.Destination, rw: m.RW })).sort((a, b) => a.destination.localeCompare(b.destination)) })).sort((a, b) => a.service.localeCompare(b.service));
};
const bytes = await readFile(config), priorBytes = await readFile(prior);
const candidate = await json(join(evidence, 'chief-session-candidate.json'));
const baseline = await json(join(evidence, 'chief-session-baseline.json'));
if (!candidate.passed || candidate.mode !== 'candidate' || candidate.nginxConfigSha256 !== hash(bytes) ||
    !baseline.passed || baseline.mode !== 'baseline' || baseline.nginxConfigSha256 !== hash(priorBytes)) throw Error('Matching before/after session evidence required');
const restored = bytes.toString().replace(/    # Account cookies need their own browser partition[\s\S]*?    location \/_accounts \{/, '    location /_accounts {');
if (restored.replaceAll('\r\n', '\n') !== priorBytes.toString().replaceAll('\r\n', '\n')) throw Error('Unexpected changes outside account-cookie adaptation');
const before = snapshot();
if (before.some(c => !c.running || (c.health && c.health !== 'healthy'))) throw Error('All original services must be healthy');
const nginx = before.find(c => c.service === 'nginx');
if (!nginx.mounts.some(m => m.destination === '/etc/nginx/conf.d/default.conf' && resolve(m.source).toLowerCase() === resolve(config).toLowerCase() && !m.rw)) throw Error('Unexpected proxy configuration mount');
const front = before.find(c => c.service === 'front');
const image = await json(join(ROOT, '.chief-local/platform/front-image.json'));
if (front.image !== image.image) throw Error('Frontend image changed since branding verification');
run(['exec', nginx.id, 'nginx', '-t']);
if (!apply) { console.log(JSON.stringify({ checked: true, change: 'graceful account-cookie proxy reload', servicesPreserved: before.length })); process.exit(0); }
const receiptPath = join(evidence, 'chief-session-rollout.json');
const receipt = { checkedAt: new Date().toISOString(), candidateConfigSha256: hash(bytes), previousConfigSha256: hash(priorBytes), before, applied: false, passed: false };
await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
try {
  run(['exec', nginx.id, 'nginx', '-s', 'reload']);
  receipt.applied = true;
  execFileSync(process.execPath, ['scripts/verify-chief-session-persistence.mjs', 'deployed'], { cwd: ROOT, env: process.env, windowsHide: true, timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'] });
  const deployed = await json(join(evidence, 'chief-session-deployed.json'));
  if (!deployed.passed || deployed.nginxConfigSha256 !== hash(bytes)) throw Error('Deployed session evidence mismatch');
  const after = snapshot();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('An existing container, image, health state or mount changed');
  if (hash(await readFile(config)) !== hash(bytes)) throw Error('Proxy source changed during rollout');
  receipt.passed = true; receipt.after = after; receipt.allContainersAndMountsPreserved = true;
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ applied: true, passed: true, all17ContainersAndMountsPreserved: true, sessionChecks: deployed.checks }));
} catch {
  if (hash(await readFile(config)) !== hash(bytes)) throw Error('Proxy source changed concurrently; automatic rollback refused');
  await copyFile(prior, config);
  run(['exec', nginx.id, 'nginx', '-t']); run(['exec', nginx.id, 'nginx', '-s', 'reload']);
  receipt.rolledBack = true;
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  throw Error('Session rollout failed and prior proxy configuration was restored; inspect synthetic failure evidence');
}
