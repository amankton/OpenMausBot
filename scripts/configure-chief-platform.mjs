#!/usr/bin/env node
// Chief deployment tooling. Retained configuration provenance: integrations/platform/NOTICE.md.
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, readFile, writeFile, lstat, realpath } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accountOverlayArgs } from './chief-account-overlay.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PROJECT = 'chief-platform';
export const URL = 'http://localhost:18087';
export const SOURCE = '03b7aad7dc562f4f9769c51a4df08191a0393997';
export const REQUIRED_DOCKER_GIB = 5;
export const REQUIRED_HOST_GIB = 2;
const PRIVATE = join(ROOT, '.chief-local', 'platform');
const ENV_FILE = join(PRIVATE, 'platform.env');
const MANIFEST = join(PRIVATE, 'manifest.json');
const COMPOSE = join(ROOT, 'integrations', 'platform', 'compose.json');
const LOCK = join(ROOT, 'integrations', 'platform', 'image-lock.json');
const services = ['nginx', 'cockroach', 'redpanda', 'minio', 'elastic', 'rekoni', 'print', 'transactor', 'collaborator', 'account', 'workspace', 'front', 'fulltext', 'stats', 'kvs'];
const volumes = ['cr_data', 'cr_certs', 'redpanda', 'files', 'elastic'];

function run(executable, args, options = {}) {
  try { return execFileSync(executable, args, { cwd: ROOT, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim(); }
  catch { throw new Error(`${executable} command failed; captured output was suppressed to protect private configuration.`); }
}

// Prevent shell-exported Compose settings or credentials from overriding this project's private file.
export function dockerEnvironment(environment = process.env) {
  return Object.fromEntries(Object.entries(environment).filter(([key]) => !/^(COMPOSE_|CHIEF_PLATFORM_|CHIEF_CAPTURE_)/i.test(key)));
}
function docker(args, options = {}) { return run('docker', args, { env: dockerEnvironment(), ...options }); }
function composeArgs(...args) { return ['compose', '--project-name', PROJECT, '--project-directory', dirname(COMPOSE), '--env-file', ENV_FILE, '--file', COMPOSE, ...accountOverlayArgs(ROOT), ...args]; }
function samePath(a, b) { return resolve(a).toLowerCase() === resolve(b).toLowerCase(); }

export function validateBoundaries(config, lock, meetingImages) {
  for (const name of ['transactor', 'account', 'workspace', 'fulltext', ...(meetingImages ? ['love'] : [])]) {
    if (config.services?.[name]?.depends_on?.redpanda?.condition !== 'service_healthy') throw new Error('Queue clients must wait for a healthy message broker.');
  }
  if (meetingImages && (Object.keys(meetingImages).sort().join() !== 'front,love,transactor,workspace' || Object.values(meetingImages).some(image => !/^sha256:[a-f0-9]{64}$/.test(image)))) throw new Error('All four reviewed meeting image IDs are required.');
  const expectedServices = meetingImages ? [...services, 'love', 'livekit'] : services;
  if (config.name !== PROJECT || Object.keys(config.services).sort().join() !== [...expectedServices].sort().join()) throw new Error('Unexpected Compose project or service set.');
  const expectedVolumes = meetingImages ? [...volumes, 'capture_metadata'] : volumes;
  if (Object.keys(config.volumes).sort().join() !== [...expectedVolumes].sort().join()) throw new Error('Unexpected persistent volume set.');
  for (const name of expectedVolumes) if (config.volumes[name].name !== `${PROJECT}_${name}` || config.volumes[name].external || config.volumes[name].driver_opts) throw new Error('Persistent volumes must be private Chief named volumes.');
  if (Object.keys(config.networks).join() !== 'backend' || config.networks.backend.name !== `${PROJECT}_backend` || config.networks.backend.external) throw new Error('Unexpected network boundary.');
  for (const [name, service] of Object.entries(config.services)) {
    const localImage = meetingImages && ['front', 'transactor', 'workspace', 'love'].includes(name) ? meetingImages[name] : undefined;
    const expectedImage = localImage ?? (name === 'livekit' && meetingImages ? 'livekit/livekit-server@sha256:d0c04791bf63ca8dcea123571827d56ba9504bd57c8d5de60ee03b5408cc3154' : lock.images[name]?.digest);
    if (service.image !== expectedImage || !(localImage ? /^sha256:[a-f0-9]{64}$/ : /@sha256:[a-f0-9]{64}$/).test(service.image)) throw new Error(`Unpinned image: ${name}`);
    if (service.pull_policy !== 'never' || service.build || service.container_name || service.privileged || service.network_mode || service.pid || service.devices || service.cap_add || service.volumes_from || service.env_file) throw new Error(`Unsafe service override: ${name}`);
    if (JSON.stringify(service.networks) !== '["backend"]') throw new Error(`Unexpected service network: ${name}`);
    if (name === 'nginx') {
      const nginxMount = meetingImages ? './nginx-meetings.conf:/etc/nginx/conf.d/default.conf:ro' : './nginx.conf:/etc/nginx/conf.d/default.conf:ro';
      const nginxMounts = meetingImages ? [nginxMount, './theme:/usr/share/nginx/crewframe-theme:ro'] : [nginxMount];
      if (JSON.stringify(service.ports) !== '["127.0.0.1:18087:80"]' || JSON.stringify(service.volumes) !== JSON.stringify(nginxMounts)) throw new Error('Only the loopback Chief proxy may publish a port.');
    } else if (name === 'livekit' && meetingImages) {
      if (JSON.stringify(service.ports) !== '["127.0.0.1:18088:18088/tcp","127.0.0.1:18089:18089/udp"]' || JSON.stringify(service.volumes) !== '["../../.chief-local/platform/livekit.json:/etc/livekit.json:ro"]') throw new Error('Unexpected media network or configuration mount.');
    } else if (service.ports?.length) throw new Error(`Unexpected published port: ${name}`);
    for (const mount of service.volumes ?? []) {
      if (name === 'nginx' || (name === 'livekit' && meetingImages)) continue;
      if (meetingImages && name === 'love' && mount === 'capture_metadata:/var/lib/chief-capture') continue;
      if (typeof mount !== 'string' || !volumes.includes(mount.split(':')[0])) throw new Error(`Unexpected host or external mount: ${name}`);
    }
    if (meetingImages && name === 'love' && (JSON.stringify(service.volumes) !== '["capture_metadata:/var/lib/chief-capture"]' || !service.environment?.includes('CHIEF_CAPTURE_DIRECTORY=/var/lib/chief-capture') || !service.environment?.includes('CHIEF_CAPTURE_WORKER_SECRET=${CHIEF_CAPTURE_WORKER_SECRET:?Prepare the private capture worker configuration}'))) throw new Error('Private capture storage and credential placeholders are required.');
    if (name !== 'love' && service.environment?.some(item => /CHIEF_CAPTURE_/.test(item))) throw new Error('Only Love receives capture credentials.');
  }
  if (lock.platformSourceRevision !== SOURCE || lock.platformRelease !== 's0.7.426') throw new Error('Unexpected source/release lock.');
}

async function writeManifest(status, extra = {}) {
  let previous = {};
  try { previous = JSON.parse(await readFile(MANIFEST, 'utf8')); } catch {}
  const manifest = { url: URL, project: PROJECT, sourceRevision: SOURCE, selfhostSourceRevision: '42fdd73311843cea76fb7f9dade9d7397b358368', release: 's0.7.426', status, updatedAt: new Date().toISOString(), ...(previous.runtimeProfile ? { runtimeProfile: previous.runtimeProfile } : {}), ...(previous.images ? { images: previous.images } : {}), ...(previous.resourceCheck ? { resourceCheck: previous.resourceCheck } : {}), blockers: [], ...extra };
  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return manifest;
}

async function privateDirectory() {
  const local = join(ROOT, '.chief-local');
  await mkdir(local, { recursive: true, mode: 0o700 });
  for (const path of [local, PRIVATE]) {
    try { if ((await lstat(path)).isSymbolicLink()) throw new Error('Private configuration directory must not be a link.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await mkdir(PRIVATE, { mode: 0o700, recursive: true });
  if (!samePath(await realpath(PRIVATE), PRIVATE)) throw new Error('Private configuration directory resolves outside its expected path.');
  run('git', ['check-ignore', '--quiet', '.chief-local/platform/platform.env']);
  if (process.platform === 'win32') {
    const sid = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value']);
    if (!/^S-1-[\d-]+$/.test(sid)) throw new Error('Cannot identify private configuration owner.');
    run('icacls.exe', [PRIVATE, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F']);
  }
}

export function freshEnvironment() {
  const secret = () => randomBytes(32).toString('hex');
  const db = secret(), storage = secret();
  return {
    CHIEF_PLATFORM_SECRET: secret(), CHIEF_PLATFORM_DB_PASSWORD: db,
    CHIEF_PLATFORM_DB_URL: `postgresql://chief_platform:${db}@cockroach:26257/chief_platform?sslmode=disable`,
    CHIEF_PLATFORM_STORAGE_USER: `chief${randomBytes(8).toString('hex')}`,
    CHIEF_PLATFORM_STORAGE_PASSWORD: storage, CHIEF_PLATFORM_QUEUE_PASSWORD: secret(),
  };
}

export async function prepare() {
  const config = JSON.parse(await readFile(COMPOSE, 'utf8'));
  const lock = JSON.parse(await readFile(LOCK, 'utf8'));
  validateBoundaries(config, lock);
  await privateDirectory();
  let exists = false;
  try { const info = await lstat(ENV_FILE); if (!info.isFile() || info.isSymbolicLink()) throw new Error('Private environment is not a regular file.'); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!exists) {
    const environment = freshEnvironment();
    environment.CHIEF_PLATFORM_STORAGE = `minio|minio?accessKey=${environment.CHIEF_PLATFORM_STORAGE_USER}&secretKey=${environment.CHIEF_PLATFORM_STORAGE_PASSWORD}`;
    await writeFile(ENV_FILE, Object.entries(environment).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
  }
  // Parse/validate without emitting the interpolated config or touching any running project.
  docker(composeArgs('config', '--quiet'));
  for (const { digest } of Object.values(lock.images)) docker(['image', 'inspect', digest, '--format', '{{json .RepoDigests}}']);
  return { config, lock };
}

export function resourceResult(vmMemInfo, hostMemory) {
  const available = vmMemInfo.match(/^MemAvailable:\s+(\d+)\s+kB$/m);
  const dockerAvailableGiB = available ? Number(available[1]) / 1024 ** 2 : NaN;
  const hostAvailableGiB = Number(hostMemory.FreePhysicalMemory) / 1024 ** 2;
  if (!Number.isFinite(dockerAvailableGiB) || !Number.isFinite(hostAvailableGiB) || hostAvailableGiB < 0) throw new Error('Available memory could not be verified; startup is blocked.');
  const blockers = [];
  if (dockerAvailableGiB < REQUIRED_DOCKER_GIB) blockers.push(`Docker VM needs at least ${REQUIRED_DOCKER_GIB} GiB available; measured ${dockerAvailableGiB.toFixed(2)} GiB.`);
  if (hostAvailableGiB < REQUIRED_HOST_GIB) blockers.push(`Windows needs at least ${REQUIRED_HOST_GIB} GiB available; measured ${hostAvailableGiB.toFixed(2)} GiB.`);
  return { resourceCheck: { dockerAvailableGiB, hostAvailableGiB, requiredDockerGiB: REQUIRED_DOCKER_GIB, requiredHostGiB: REQUIRED_HOST_GIB, checkedAt: new Date().toISOString() }, blockers };
}

function verifyDaemon() {
  if (process.env.DOCKER_HOST && !/^(npipe|unix):\/\//.test(process.env.DOCKER_HOST)) throw new Error('Only a local Docker daemon is allowed.');
  const context = docker(['context', 'show']);
  const endpoint = docker(['context', 'inspect', context, '--format', '{{.Endpoints.docker.Host}}']);
  if (!/^(npipe|unix):\/\//.test(endpoint)) throw new Error('Selected Docker context is not local.');
}

function verifyExistingProject() {
  const output = docker(['ps', '-a', '--filter', `label=com.docker.compose.project=${PROJECT}`, '--format', '{{.Label "com.docker.compose.project.config_files"}}|{{.Label "com.docker.compose.project.working_dir"}}']);
  for (const row of output.split('\n').filter(Boolean)) {
    const [file, directory] = row.split('|');
    if (!samePath(file, COMPOSE) || !samePath(directory, dirname(COMPOSE))) throw new Error('Existing chief-platform containers belong to another configuration; refusing to modify them.');
  }
  for (const name of volumes) {
    const found = docker(['volume', 'ls', '--filter', `name=^${PROJECT}_${name}$`, '--format', '{{.Name}}|{{.Label "com.docker.compose.project"}}']);
    if (found && found !== `${PROJECT}_${name}|${PROJECT}`) throw new Error('A Chief volume name is owned outside this Compose project.');
  }
  const network = docker(['network', 'ls', '--filter', `name=^${PROJECT}_backend$`, '--format', '{{.Name}}|{{.Label "com.docker.compose.project"}}']);
  if (network && network !== `${PROJECT}_backend|${PROJECT}`) throw new Error('Chief network name belongs to another project.');
}

async function verifyPort() {
  const own = docker(composeArgs('ps', '--status', 'running', '--quiet', 'nginx'));
  if (own) return;
  await new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error('Loopback port 18087 is already in use; nothing was stopped.')));
    server.listen(18087, '127.0.0.1', () => server.close(resolvePromise));
  });
}

export async function preflight() {
  verifyDaemon();
  await prepare();
  verifyExistingProject();
  await verifyPort();
  if (process.platform !== 'win32') throw new Error('This launcher requires verified Windows and Docker Desktop memory metrics.');
  const memory = run('wsl.exe', ['-d', 'docker-desktop', '--', 'cat', '/proc/meminfo']);
  const host = JSON.parse(run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_OperatingSystem | Select-Object FreePhysicalMemory | ConvertTo-Json -Compress']));
  const result = resourceResult(memory, host);
  await writeManifest(result.blockers.length ? 'blocked-resources' : 'prepared', result);
  return result;
}

async function readiness() {
  const output = docker(composeArgs('ps', '--all', '--format', 'json'));
  const rows = output.startsWith('[') ? JSON.parse(output) : output.split('\n').filter(Boolean).map(row => JSON.parse(row));
  if (rows.length !== services.length || rows.some(row => row.State !== 'running' || (row.Health && row.Health !== 'healthy'))) return false;
  for (const pathname of ['/', '/config.json']) {
    const response = await fetch(`${URL}${pathname}`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!response.ok) return false;
    if (pathname === '/config.json') { const body = await response.json(); if (!body || typeof body !== 'object') return false; }
  }
  return true;
}

async function main() {
  const mode = process.argv[2] ?? '--configure';
  let activeProfile;
  try { activeProfile = JSON.parse(await readFile(MANIFEST, 'utf8')).runtimeProfile; } catch {}
  if (process.argv[3] === '--meetings' || activeProfile === 'meetings') {
    if (process.argv.length > 4 || (process.argv[3] && process.argv[3] !== '--meetings')) throw new Error('Use a deployment action with optional --meetings.');
    const { meetingsMain } = await import('./launch-chief-platform-meetings.mjs');
    await meetingsMain(mode);
    return;
  }
  if (process.argv.length > 3 || !['--configure', '--preflight', '--start', '--status'].includes(mode)) throw new Error('Use --configure, --preflight, --status, or the explicit --start action.');
  if (mode === '--configure') { await prepare(); const result = await writeManifest('prepared'); console.log(JSON.stringify({ ...result, message: 'Private configuration validated. No containers were started.' })); return; }
  if (mode === '--status') { verifyDaemon(); await prepare(); verifyExistingProject(); const ready = await readiness().catch(() => false); console.log(JSON.stringify(await writeManifest(ready ? 'ready' : 'unavailable'))); return; }
  const result = await preflight();
  if (result.blockers.length) { console.log(JSON.stringify({ project: PROJECT, status: 'blocked-resources', ...result })); process.exitCode = 2; return; }
  if (mode === '--preflight') { console.log(JSON.stringify({ project: PROJECT, status: 'prepared', ...result })); return; }
  await writeManifest('starting');
  // Never pull, build, remove volumes, or stop another project. Preflight has no bypass flag.
  docker(composeArgs('up', '--detach', '--pull', 'never', '--no-build', '--wait', '--wait-timeout', '180'), { timeout: 240000 });
  if (!(await readiness())) throw new Error('Chief containers started but application readiness was not verified. Volumes and containers were preserved.');
  console.log(JSON.stringify(await writeManifest('ready', { readiness: 'All 15 services running, declared health checks healthy, front HTML and config reachable. Module behavior acceptance remains separate.' })));
}

if (process.argv[1] && samePath(process.argv[1], fileURLToPath(import.meta.url))) {
  main().catch(async error => {
    // Do not forward Docker output, resolved configuration, or error causes containing credentials.
    const message = error instanceof Error ? error.message : 'Deployment preparation failed.';
    // Any failure before startup changes the manifest must preserve the current
    // ready deployment. Failed image/model gates have not stopped its services.
    try {
      const previous = JSON.parse(await readFile(MANIFEST, 'utf8'));
      if (previous.status !== 'ready') await writeManifest('unavailable', { blockers: [message] });
    } catch {}
    console.error(message); process.exitCode = 1;
  });
}
