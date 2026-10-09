import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateBoundaries, resourceResult, freshEnvironment, dockerEnvironment } from '../../scripts/configure-chief-platform.mjs';

const config = JSON.parse(await readFile(new URL('./compose.json', import.meta.url), 'utf8'));
const lock = JSON.parse(await readFile(new URL('./image-lock.json', import.meta.url), 'utf8'));

test('retained deployment is pinned with one loopback port and private volumes', () => {
  assert.doesNotThrow(() => validateBoundaries(config, lock));
});

for (const [name, mutate] of [
  ['public proxy', c => { c.services.nginx.ports = ['18087:80']; }],
  ['additional service port', c => { c.services.print.ports = ['127.0.0.1:4005:4005']; }],
  ['foreign volume', c => { c.volumes.files.name = 'reference_files'; }],
  ['external volume', c => { c.volumes.files.external = true; }],
  ['host mount', c => { c.services.front.volumes = ['C:/private:/data']; }],
  ['tag replacing digest', c => { c.services.front.image = 'platformcollective/front:latest'; }],
  ['privilege', c => { c.services.front.privileged = true; }],
  ['host network', c => { c.services.front.network_mode = 'host'; }],
  ['source build', c => { c.services.front.build = '.'; }],
  ['foreign project', c => { c.name = 'reference'; }],
  ['external network', c => { c.networks.backend.external = true; }],
  ['environment file override', c => { c.services.front.env_file = ['other.env']; }],
  ['queue client starting before broker health', c => { c.services.transactor.depends_on.redpanda.condition = 'service_started'; }],
]) {
  test(`refuses ${name}`, () => {
    const changed = structuredClone(config);
    mutate(changed);
    assert.throws(() => validateBoundaries(changed, lock));
  });
}

test('resource checks require both available-memory thresholds', () => {
  const check = (vm, host) => resourceResult(`MemAvailable: ${vm * 1024 ** 2} kB`, { FreePhysicalMemory: host * 1024 ** 2 });
  assert.equal(check(5, 2).blockers.length, 0);
  assert.equal(check(4, 3).blockers.length, 1);
  assert.equal(check(6, 1).blockers.length, 1);
  assert.equal(check(2, 1).blockers.length, 2);
  assert.throws(() => resourceResult('MemTotal: 99999999 kB', { FreePhysicalMemory: 99999999 }));
  assert.throws(() => resourceResult('MemAvailable: 99999999 kB', {}));
});

test('new credentials are independently generated and reused coherently within one environment', () => {
  const first = freshEnvironment(), second = freshEnvironment();
  for (const key of ['CHIEF_PLATFORM_SECRET', 'CHIEF_PLATFORM_DB_PASSWORD', 'CHIEF_PLATFORM_STORAGE_PASSWORD', 'CHIEF_PLATFORM_QUEUE_PASSWORD']) {
    assert.match(first[key], /^[a-f0-9]{64}$/);
    assert.notEqual(first[key], second[key]);
  }
  assert.equal(new Set([first.CHIEF_PLATFORM_SECRET, first.CHIEF_PLATFORM_DB_PASSWORD, first.CHIEF_PLATFORM_STORAGE_PASSWORD, first.CHIEF_PLATFORM_QUEUE_PASSWORD]).size, 4);
  const db = new URL(first.CHIEF_PLATFORM_DB_URL);
  assert.equal(db.hostname, 'cockroach');
  assert.equal(db.username, 'chief_platform');
  assert.equal(db.password, first.CHIEF_PLATFORM_DB_PASSWORD);
  assert.equal(db.pathname, '/chief_platform');
});

test('ambient Compose and Chief credentials cannot override private configuration', () => {
  assert.deepEqual(dockerEnvironment({ PATH: 'safe', COMPOSE_FILE: 'foreign', compose_project_name: 'foreign', CHIEF_PLATFORM_SECRET: 'synthetic', chief_platform_db_url: 'synthetic', CHIEF_CAPTURE_WORKER_SECRET: 'synthetic', chief_capture_directory: '/foreign' }), { PATH: 'safe' });
});

test('retained source blob hashes match the provenance manifest', async () => {
  const source = JSON.parse(await readFile(new URL('./upstream/source.json', import.meta.url), 'utf8'));
  for (const item of source.files) {
    const bytes = await readFile(new URL(`./upstream/${item.path}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256, item.path);
  }
});
