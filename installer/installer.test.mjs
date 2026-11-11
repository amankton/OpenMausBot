import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, readdir, mkdir } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { digest, verifyPayload, acquireLock, download } from './core.mjs';
import { composeForInstallation, parseVmMemory } from './platform.mjs';
import { importSelected } from './import-agents.mjs';
import { setupServer } from './setup.mjs';
import { createEngine } from './engine.mjs';

async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), 'chief-setup-test-'));
  t.after(async () => { assert.equal(basename(root).startsWith('chief-setup-test-'), true); assert.equal(resolve(root).startsWith(resolve(tmpdir())), true); await rm(root, { recursive: true, force: true }); });
  return root;
}
test('transfer integrity detects modified source and path traversal', async t => {
  const root = await temporary(t); await writeFile(join(root, 'source.js'), 'original');
  const manifest = { schemaVersion: 1, kind: 'engineering-test-bundle', files: [{ path: 'source.js', sha256: digest('original') }] };
  assert.equal(await verifyPayload(root, manifest), 1);
  await writeFile(join(root, 'source.js'), 'modified'); await assert.rejects(verifyPayload(root, manifest), /integrity/);
  manifest.files[0].path = '../outside'; await assert.rejects(verifyPayload(root, manifest), /escapes/);
});
test('setup lock prevents concurrent mutation and unlock checks ownership', async t => {
  const root = await temporary(t), unlock = await acquireLock(root);
  await assert.rejects(acquireLock(root), /Another Chief setup/); await unlock();
  const second = await acquireLock(root); await second();
});
test('downloader refuses unapproved redirects and removes corrupt partial bytes', async t => {
  const root = await temporary(t), target = join(root, 'asset');
  await assert.rejects(download({ url: 'https://nodejs.org/fixture', sha256: digest('safe') }, target, { fetcher: async () => new Response('', { status: 302, headers: { location: 'https://untrusted.invalid/asset' } }) }), /Unapproved/);
  await assert.rejects(download({ url: 'https://nodejs.org/fixture', sha256: digest('safe') }, target, { fetcher: async () => new Response('modified') }), /checksum/);
  assert.deepEqual(await readdir(root), []);
  await assert.rejects(download({ url: 'https://nodejs.org/fixture', sha256: digest('large') }, target, { maxBytes: 2, fetcher: async () => new Response('large') }), /size/);
});
test('two installations receive distinct volumes and loopback-only publication', () => {
  const base = { name: 'old', services: { nginx: { ports: ['0.0.0.0:80:80'], volumes: [], environment: ['URL=http://localhost:18087'] }, app: {} }, volumes: { files: { name: 'old_files' } }, networks: { backend: { name: 'old_backend' } } };
  const a = composeForInstallation(base, { project: 'chief-pilot-012345abcdef', workspacePort: 20001 }), b = composeForInstallation(base, { project: 'chief-pilot-abcdef012345', workspacePort: 20002 });
  assert.notEqual(a.volumes.files.name, b.volumes.files.name); assert.deepEqual(a.services.nginx.ports, ['127.0.0.1:20001:80']);
  assert.equal(a.services.nginx.environment[0], 'URL=http://localhost:20001'); assert.equal(base.name, 'old');
  assert.throws(() => composeForInstallation(base, { project: 'arbitrary-project', workspacePort: 20001 }), /Invalid/);
  assert.equal(parseVmMemory('MemAvailable: 6291456 kB\n'), 6 * 1024 ** 3); assert.throws(() => parseVmMemory('unknown'), /could not/);
});
test('agent import reconciles an uncertain committed POST without duplicates or edits', async t => {
  const home = await temporary(t), bots = [], role = { id: 'operator', name: 'Operator', title: 'Operations', description: 'A role', division: 'Core', soul: 'Role instructions', color: 'blue', revision: 'r1' };
  let failOnce = true, writes = 0;
  const request = async (_path, options = {}) => {
    if (options.method !== 'POST') return { bots };
    writes++; bots.push({ ...options.body.settings, id: 'installed-1' }); if (failOnce) { failOnce = false; throw Error('response lost'); } return { bot: bots.at(-1) };
  };
  const input = { catalog: { agents: [role] }, selected: ['operator'], home, request, protocol: 'Bounded routine execution' };
  await assert.rejects(importSelected(input), /response lost/);
  bots[0].soul += '\nCustomer edit'; const expected = bots[0].soul;
  const result = await importSelected(input); assert.equal(result[0].state, 'existing'); assert.equal(writes, 1); assert.equal(bots[0].soul, expected);
  assert.equal(JSON.parse(await readFile(join(home, 'agent-mapping.json'), 'utf8')).operator.targetId, 'installed-1');
});
test('name-only profile conflict is preserved and invalid selection has no effects', async t => {
  const home = await temporary(t), role = { id: 'one', name: 'Existing', revision: 'r1' }; let writes = 0;
  const request = async (_path, options) => { if (options) writes++; return { bots: [{ id: 'customer-owned', name: 'Existing', soul: 'Customer instructions' }] }; };
  const input = { catalog: { agents: [role] }, selected: ['one'], home, request, protocol: '' };
  assert.equal((await importSelected(input))[0].state, 'conflict'); assert.equal(writes, 0);
  await assert.rejects(importSelected({ ...input, selected: ['unknown'] }), /Invalid/); assert.equal(writes, 0);
});
test('wizard rejects unauthenticated, cross-origin and replayed mutations', async t => {
  const calls = []; const engine = { catalog: { agents: [] }, status: async () => ({ fixture: true }), select: async ids => calls.push(ids), close: async () => {}, action: async () => { await new Promise(done => setTimeout(done, 100)); } };
  const ui = await setupServer(engine); t.after(() => ui.close()); const origin = ui.origin;
  assert.equal((await fetch(origin + '/api/status')).status, 403);
  const capability = new URL(ui.launchUrl).hash.slice(1);
  const response = await fetch(origin + '/api/session', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ capability }) });
  assert.equal(response.status, 200); const cookie = response.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(origin + '/api/status', { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(origin + '/api/selection', { method: 'POST', headers: { Cookie: cookie, Origin: 'https://evil.invalid', 'Content-Type': 'application/json', 'X-Chief-Setup': '1' }, body: '{"selected":[]}' })).status, 403);
  assert.equal((await fetch(origin + '/api/selection', { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: '{"selected":[]}' })).status, 403);
  assert.equal(calls.length, 0);
  const headers = { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', 'X-Chief-Setup': '1' };
  assert.equal((await fetch(origin + '/api/selection', { method: 'POST', headers, body: '{"selected":["a"]}' })).status, 200); assert.deepEqual(calls, [['a']]);
  assert.equal((await fetch(origin + '/api/action/workspace', { method: 'POST', headers, body: '{}' })).status, 202);
  assert.equal((await fetch(origin + '/api/action/workspace', { method: 'POST', headers, body: '{}' })).status, 409);
  assert.equal((await fetch(origin + '/api/session', { method: 'POST', headers, body: JSON.stringify({ capability }) })).status, 404);
});
test('engine persists selections across restart and never mutates a remote Docker context', async t => {
  const parent = await temporary(t), root = join(parent, 'source'), home = join(parent, 'private');
  await mkdir(join(root, 'installer/payload/platform'), { recursive: true });
  await writeFile(join(root, 'installer/dependencies.json'), JSON.stringify({ pnpmVersion: '10.33.0', uv: {}, docker: {} }));
  await writeFile(join(root, 'installer/payload/agents.json'), JSON.stringify({ agents: [{ id: 'bacca' }, { id: 'solo' }] }));
  await writeFile(join(root, 'installer/payload/platform/manifest.json'), JSON.stringify({ images: {} }));
  const calls = [], run = async (_command, args) => {
    calls.push(args);
    if (args.join(' ') === 'context show') return 'remote-fixture';
    if (args[0] === 'context' && args[1] === 'inspect') return 'ssh://remote.invalid';
    if (args[0] === '--version') return 'Docker fixture';
    throw Error('Unexpected mutating command');
  };
  let engine = await createEngine({ root, home, run, platform: 'win32', arch: 'x64' });
  const first = await engine.status(); await engine.select(['solo'], { coordinator: '', operator: 'solo' }); await engine.close();
  engine = await createEngine({ root, home, run, platform: 'win32', arch: 'x64' });
  try {
    const second = await engine.status(); assert.deepEqual(second.state.selected, ['solo']); assert.deepEqual(second.ports, first.ports);
    const outcome = await engine.action('docker'); assert.equal(outcome.state, 'needs permission');
    assert.equal(calls.some(args => args.includes('pull') || args.includes('up') || args.includes('build')), false);
    await assert.rejects(engine.select(['invalid']), /valid catalog/);
    await assert.rejects(engine.action('unrecognized'), /Unknown/);
    const stopped = await engine.install(); assert.equal(stopped.state, 'failed');
    assert.equal((await engine.status()).busy, false);
    assert.equal(calls.some(args => args.includes('pull') || args.includes('up') || args.includes('build')), false);
  } finally { await engine.close(); }
});

test('AI reload refuses active workflows and busy chats without writing a supervisor command', async t => {
  const parent = await temporary(t), root = join(parent, 'source'), home = join(parent, 'private');
  await mkdir(join(root, 'installer/payload/platform'), { recursive: true });
  await writeFile(join(root, 'installer/dependencies.json'), '{}');
  await writeFile(join(root, 'installer/payload/agents.json'), JSON.stringify({ agents: [] }));
  await writeFile(join(root, 'installer/payload/platform/manifest.json'), JSON.stringify({ images: {} }));
  let phase = 'background', engine;
  const fetcher = async url => {
    const path = new URL(url).pathname;
    return Response.json(path === '/api/health' ? { app: 'openmausbot', pid: 19777 } : path === '/api/customer-workflow' ? { background: phase === 'background' ? [{ terminal: false }] : [] } : { bots: [{ busy: true }] });
  };
  engine = await createEngine({ root, home, fetcher, run: async () => { throw Error('Unexpected external command'); } });
  try {
    await writeFile(join(home, 'runtime-children.json'), JSON.stringify({ chief: { pid: 19777, installationId: engine.identity.id } }));
    assert.match((await engine.action('reload')).message, /Stop active or waiting background/);
    phase = 'chat'; assert.match((await engine.action('reload')).message, /Finish or stop current chats/);
    assert.equal((await readdir(home)).includes('supervisor-control.json'), false);
  } finally { await engine.close(); }
});
