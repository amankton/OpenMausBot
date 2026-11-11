import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { atomicJson } from './core.mjs';

export async function freePort() {
  return new Promise((done, fail) => { const server = createServer(); server.once('error', fail); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => done(port)); }); });
}
export function composeForInstallation(base, { project, workspacePort, images = {} }) {
  if (!/^chief-pilot-[a-f0-9]{12}$/.test(project) || !Number.isInteger(workspacePort) || workspacePort < 1024 || workspacePort > 65535) throw Error('Invalid installation identity or port');
  const config = structuredClone(base); config.name = project;
  for (const [name, volume] of Object.entries(config.volumes)) volume.name = `${project}_${name}`;
  for (const [name, network] of Object.entries(config.networks)) network.name = `${project}_${name}`;
  for (const [name, service] of Object.entries(config.services)) {
    service.platform = 'linux/amd64'; // Retained binaries are amd64; ARM hosts use Docker emulation.
    if (images[name]) service.image = images[name];
    service.environment = service.environment?.map(value => value.replaceAll('localhost:18087', `localhost:${workspacePort}`));
    if (name === 'nginx') { service.ports = [`127.0.0.1:${workspacePort}:80`]; service.volumes = ['./nginx.conf:/etc/nginx/conf.d/default.conf:ro']; }
    else if (service.ports?.length) throw Error('Unexpected shared workspace port');
  }
  return config;
}
export function composeArguments(home, ...args) {
  return ['compose', '--project-directory', join(home, 'platform'), '--env-file', join(home, 'platform/environment'), '--file', join(home, 'platform/compose.json'), ...args];
}
export async function preparePlatform(root, home, identity, ports, overlayManifest) {
  const folder = join(home, 'platform'); await mkdir(folder, { recursive: true, mode: 0o700 });
  const base = JSON.parse(await readFile(join(root, 'integrations/platform/compose.json'), 'utf8'));
  const project = 'chief-pilot-' + identity.id.replaceAll('-', '').slice(0, 12);
  const images = Object.fromEntries(Object.keys(overlayManifest.images).map(name => [name, `${project}-${name}:pilot`]));
  const config = composeForInstallation(base, { project, workspacePort: ports.workspace, images });
  const proxy = await readFile(join(root, 'integrations/platform/lifecycle/nginx-location.conf'), 'utf8');
  const nginx = await readFile(join(root, 'integrations/platform/nginx.conf'), 'utf8');
  await writeFile(join(folder, 'nginx.conf'), nginx.replace('    location / {', proxy + '\n    location / {'), { mode: 0o600 });
  try { await readFile(join(folder, 'environment')); } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    const secret = () => randomBytes(32).toString('hex'), db = secret(), access = 'chief' + randomBytes(8).toString('hex'), storage = secret();
    await writeFile(join(folder, 'environment'), [
      `CHIEF_PLATFORM_SECRET=${secret()}`, `CHIEF_PLATFORM_DB_PASSWORD=${db}`, `CHIEF_PLATFORM_DB_URL=postgresql://chief_platform:${db}@cockroach:26257/chief_platform?sslmode=disable`,
      `CHIEF_PLATFORM_STORAGE_USER=${access}`, `CHIEF_PLATFORM_STORAGE_PASSWORD=${storage}`, `CHIEF_PLATFORM_QUEUE_PASSWORD=${secret()}`,
      `CHIEF_PLATFORM_STORAGE=minio|minio?accessKey=${access}&secretKey=${storage}`,
    ].join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  }
  const secrets = join(folder, '.secrets'), bootstrap = join(folder, '.bootstrap');
  await mkdir(secrets, { recursive: true, mode: 0o700 }); await mkdir(bootstrap, { recursive: true, mode: 0o700 });
  const fresh = async (name, make) => { const file = join(secrets, name); try { return await readFile(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; const value = make(); await writeFile(file, value, { flag: 'wx', mode: 0o600 }); return value; } };
  const runtimePassword = await fresh('runtime_password', () => randomBytes(32).toString('hex'));
  const migrationPassword = await fresh('migration_password', () => randomBytes(32).toString('hex'));
  const key = await fresh('member_key', () => randomBytes(32).toString('hex'));
  await fresh('encryption_key', () => randomBytes(32).toString('base64url'));
  await fresh('runtime_url', () => `postgresql://chief_lifecycle:${runtimePassword}@cockroach:26257/chief_lifecycle?sslmode=disable`);
  await fresh('migration_url', () => `postgresql://chief_lifecycle_migrator:${migrationPassword}@cockroach:26257/chief_lifecycle?sslmode=disable`);
  const environment = await readFile(join(folder, 'environment'), 'utf8');
  const dbPassword = /^CHIEF_PLATFORM_DB_PASSWORD=([a-f0-9]{64})$/m.exec(environment)?.[1];
  if (!dbPassword || ![runtimePassword, migrationPassword, key].every(v => /^[a-f0-9]{64}$/.test(v))) throw Error('Invalid private bootstrap credentials');
  await writeFile(join(bootstrap, 'initialize.sql'), `CREATE USER IF NOT EXISTS chief_platform WITH PASSWORD '${dbPassword}';\nCREATE DATABASE IF NOT EXISTS chief_platform;\nGRANT ALL ON DATABASE chief_platform TO chief_platform;\nCREATE USER IF NOT EXISTS chief_lifecycle_migrator WITH PASSWORD '${migrationPassword}';\nCREATE USER IF NOT EXISTS chief_lifecycle WITH PASSWORD '${runtimePassword}';\nCREATE DATABASE IF NOT EXISTS chief_lifecycle;\nGRANT ALL ON DATABASE chief_lifecycle TO chief_lifecycle_migrator;\n`, { mode: 0o600 });
  const tables = ['member_session', 'connection_challenge', 'member_connection', 'runtime_nonce', 'tracker_action'];
  await writeFile(join(bootstrap, 'grants.sql'), ['USE chief_lifecycle;', 'GRANT USAGE ON SCHEMA chief_lifecycle TO chief_lifecycle;', 'GRANT SELECT ON TABLE chief_lifecycle.schema_version TO chief_lifecycle;', ...tables.map(t => `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE chief_lifecycle.${t} TO chief_lifecycle;`)].join('\n'), { mode: 0o600 });
  config.services.cockroach.volumes.push('./.bootstrap:/chief-bootstrap:ro');
  await mkdir(join(home, 'member-bridge'), { recursive: true, mode: 0o700 });
  const lifecycleImage = `${project}-lifecycle:pilot`;
  const common = {
    image: lifecycleImage, platform: 'linux/amd64', init: true, read_only: true, user: `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
    cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'], networks: ['backend'], tmpfs: ['/tmp:rw,noexec,nosuid,size=16m'],
    environment: {
      CHIEF_LIFECYCLE_MODE: 'staging', CHIEF_LIFECYCLE_ALLOW_PLAINTEXT_DB: '1', CHIEF_LIFECYCLE_HOST: '0.0.0.0', CHIEF_LIFECYCLE_PORT: '8097',
      CHIEF_LIFECYCLE_ORIGIN: `http://localhost:${ports.workspace}`, CHIEF_LIFECYCLE_ACCOUNTS_URL: 'http://account:3000', CHIEF_LIFECYCLE_TRANSACTOR_URL: 'http://transactor:3333', CHIEF_LIFECYCLE_COLLABORATOR_URL: 'http://collaborator:3078',
      CHIEF_LIFECYCLE_DATABASE_URL_FILE: '/run/secrets/runtime_url', CHIEF_LIFECYCLE_ENCRYPTION_KEY_FILE: '/run/secrets/encryption_key',
      CHIEF_LOCAL_MEMBER_BRIDGE_DIRECTORY: '/run/member-bridge', CHIEF_LOCAL_MEMBER_KEY_FILE: '/run/secrets/member_key',
    },
    secrets: ['runtime_url', 'encryption_key', 'member_key'], volumes: [{ type: 'bind', source: join(home, 'member-bridge'), target: '/run/member-bridge' }],
  };
  config.services['chief-lifecycle'] = { ...common, restart: 'unless-stopped', mem_limit: '256m', cpus: 0.5,
    healthcheck: { test: ['CMD', 'node', '-e', "require('node:http').get('http://127.0.0.1:8097/chief/v1/status',{headers:{Host:new URL(process.env.CHIEF_LIFECYCLE_ORIGIN).host}},r=>{r.resume();process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"], interval: '15s', timeout: '5s', retries: 5 } };
  config.services['chief-lifecycle-migrate'] = { ...common, profiles: ['setup'], command: ['node', 'main.mjs', 'migrate'], environment: { ...common.environment, CHIEF_LIFECYCLE_DATABASE_URL_FILE: '/run/secrets/migration_url' }, secrets: ['migration_url', 'encryption_key', 'member_key'] };
  config.secrets = Object.fromEntries(['runtime_url', 'migration_url', 'encryption_key', 'member_key'].map(name => [name, { file: `./.secrets/${name}` }]));
  await atomicJson(join(folder, 'compose.json'), config);
  return { project, config, images, lifecycleImage };
}
export function parseVmMemory(text) {
  const match = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(text);
  if (!match) throw Error('Docker VM available memory could not be measured');
  return Number(match[1]) * 1024;
}
