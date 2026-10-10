// Frontend-only rollout. Keep every existing service, volume and private setting.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, PROJECT, dockerEnvironment, validateBoundaries } from './configure-chief-platform.mjs';
import { mergeMeetingConfig } from './launch-chief-platform-meetings.mjs';
import { verifyFrontendPatchStack } from '../integrations/platform/patches/verify-frontend-patch-stack.mjs';
import { accountOverlayArgs } from './chief-account-overlay.mjs';

const apply = process.argv.includes('--apply');
if (process.argv.slice(2).some(arg => !['--apply', '--check'].includes(arg))) throw Error('Use --check or --apply');
const local = join(ROOT, '.chief-local/platform');
const integration = join(ROOT, 'integrations/platform');
const hash = value => createHash('sha256').update(value).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const run = args => {
  try { return execFileSync('docker', args, { cwd: ROOT, env: dockerEnvironment(), encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { throw Error('Docker operation failed; private configuration output suppressed.'); }
};
const compose = (...args) => ['compose', '--project-name', PROJECT, '--project-directory', integration,
  '--env-file', join(local, 'platform.env'), '--env-file', join(local, 'meetings.env'),
  '--env-file', join(ROOT, '.chief-local/meeting-capture/capture.env'), '--env-file', join(local, 'meeting-images.env'),
  '--file', join(integration, 'compose.json'), '--file', join(integration, 'meetings.compose.json'), ...accountOverlayArgs(ROOT), ...args];
const snapshot = () => {
  const ids = run(['ps', '-a', '--filter', `label=com.docker.compose.project=${PROJECT}`, '--format', '{{.ID}}']).split(/\r?\n/).filter(Boolean);
  if (ids.length !== 17) throw Error('Expected exactly 17 existing Chief services.');
  return JSON.parse(run(['inspect', ...ids])).map(c => ({ id: c.Id, name: c.Name, service: c.Config.Labels['com.docker.compose.service'], image: c.Image,
    running: c.State.Running, health: c.State.Health?.Status ?? null,
    mounts: c.Mounts.map(m => ({ type: m.Type, name: m.Name ?? null, source: m.Source, destination: m.Destination, rw: m.RW })).sort((a, b) => a.destination.localeCompare(b.destination)) }));
};
const image = await json(join(local, 'front-image.json'));
const build = await readFile(join(ROOT, '.chief-local/platform-build-logs/production-build-receipt.json'));
const stack = await verifyFrontendPatchStack();
if (!/^sha256:[a-f0-9]{64}$/.test(image.image) || image.webpackReceiptSha256 !== hash(build) ||
    Object.entries(stack.patchHashes).some(([name, expected]) => image.patchHashes?.[name] !== expected)) throw Error('Matching verified branding image required.');
if (run(['image', 'inspect', '--format', '{{.Id}}', image.image]) !== image.image) throw Error('Immutable frontend image is not installed.');
const before = snapshot();
const priorManifest = await json(join(local, 'manifest.json'));
if (priorManifest.project !== PROJECT || priorManifest.status !== 'ready') throw Error('Expected ready Chief deployment manifest.');
const priorFront = before.find(item => item.service === 'front');
if (!priorFront || before.some(item => !item.running || (item.health && item.health !== 'healthy'))) throw Error('Existing Chief runtime must be healthy.');
const envPath = join(local, 'meeting-images.env');
const originalEnv = await readFile(envPath, 'utf8');
const key = /^CHIEF_PLATFORM_FRONT_IMAGE=sha256:[a-f0-9]{64}$/gm;
if ([...originalEnv.matchAll(key)].length !== 1 || !originalEnv.includes(`CHIEF_PLATFORM_FRONT_IMAGE=${priorFront.image}`)) throw Error('Existing frontend pin differs from its running image.');
const previousConfig = JSON.parse(run(compose('config', '--format', 'json')));
const images = Object.fromEntries(['front', 'love', 'transactor', 'workspace'].map(name => [name, name === 'front' ? image.image : previousConfig.services[name].image]));
// The existing boundary validator expects source Compose syntax, before Docker
// expands networks, mounts, ports and environment into normalized objects.
validateBoundaries(mergeMeetingConfig(await json(join(integration, 'compose.json')),
  await json(join(integration, 'meetings.compose.json')), images), await json(join(integration, 'image-lock.json')), images);
const candidateEnv = originalEnv.replace(key, `CHIEF_PLATFORM_FRONT_IMAGE=${image.image}`);
const planned = { previousImage: priorFront.image, nextImage: image.image, services: before.length, changedServices: ['front'], applied: false };
if (!apply) { console.log(JSON.stringify(planned)); process.exit(0); }
const backup = join(local, `branding-rollout-${Date.now()}`);
await mkdir(backup);
await copyFile(envPath, join(backup, 'meeting-images.env'));
await copyFile(join(local, 'manifest.json'), join(backup, 'manifest.json'));
await writeFile(join(backup, 'before.json'), JSON.stringify(before, null, 2));
try {
  await writeFile(envPath, candidateEnv, { mode: 0o600 });
  const config = JSON.parse(run(compose('config', '--format', 'json')));
  const expected = structuredClone(previousConfig); expected.services.front.image = image.image;
  if (JSON.stringify(config) !== JSON.stringify(expected)) throw Error('Compose configuration changed beyond the frontend image.');
  run(compose('up', '--detach', '--no-deps', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '90', 'front'));
  let ready = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const response = await fetch('http://localhost:18087/', { signal: AbortSignal.timeout(3000) });
      const avatar = await fetch('http://localhost:18087/chief/avatar.svg', { signal: AbortSignal.timeout(3000) });
      const logo = await fetch('http://localhost:18087/chief/icon-ink.svg', { signal: AbortSignal.timeout(3000) });
      ready = response.ok && (await response.text()).includes('<title>Chief Executive Suite</title>') && avatar.ok && hash(await avatar.text()) === hash(await readFile(join(ROOT, 'public/brand/chief-avatar-ink.svg'))) && logo.ok && hash(await logo.text()) === hash(await readFile(join(ROOT, '.chief-local/platform-source/dev/prod/public/chief/icon-ink.svg')));
      if (ready) break;
    } catch { /* Allow the existing proxy's DNS cache to refresh. */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!ready) throw Error('New frontend did not serve the verified Chief entry and avatar.');
  const after = snapshot();
  for (const prior of before) {
    const current = after.find(item => item.service === prior.service);
    if (!current?.running || (current.health && current.health !== 'healthy') || JSON.stringify(current.mounts) !== JSON.stringify(prior.mounts)) throw Error('A service or persistent mount changed unexpectedly.');
    if (prior.service === 'front' ? current.image !== image.image : current.id !== prior.id || current.image !== prior.image) throw Error('Unexpected service replacement.');
  }
  const receipt = { ...planned, applied: true, passed: true, checkedAt: new Date().toISOString(), backup, buildReceiptSha256: hash(build),
    originalMountsPreserved: true, nonFrontendContainersPreserved: true, before, after };
  await writeFile(join(ROOT, 'docs/verification/evidence/chief-branding-rollout.json'), JSON.stringify(receipt, null, 2));
  await writeFile(join(local, 'manifest.json'), JSON.stringify({ ...priorManifest, updatedAt: receipt.checkedAt,
    images: { ...priorManifest.images, front: image.image } }, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ ...planned, applied: true, passed: true, originalMountsPreserved: true, nonFrontendContainersPreserved: true }));
} catch (error) {
  await writeFile(envPath, originalEnv, { mode: 0o600 });
  run(compose('up', '--detach', '--no-deps', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '90', 'front'));
  await copyFile(join(backup, 'manifest.json'), join(local, 'manifest.json'));
  await writeFile(join(ROOT, 'docs/verification/evidence/chief-branding-rollout.json'), JSON.stringify({ ...planned,
    passed: false, rolledBack: true, backup, checkedAt: new Date().toISOString() }, null, 2));
  throw error;
}
