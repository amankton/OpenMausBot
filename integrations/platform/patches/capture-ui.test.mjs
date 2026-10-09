import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import ts from 'typescript';

const source = fileURLToPath(new URL('../../../.chief-local/platform-source/plugins/love-resources/src/', import.meta.url));
async function load(file, modules = {}, globals = {}) {
  const text = await readFile(resolve(source, file), 'utf8');
  const code = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  runInNewContext(code, { exports, require: name => { assert.ok(name in modules, `Unexpected import ${name}`); return modules[name]; }, TextEncoder, Date, Error, Set, Map, Number, JSON, AbortSignal, ...globals });
  return exports;
}
const session = () => ({ id: 'session', workspace: 'workspace', meetingId: 'meeting', title: 'Weekly review', revision: 1, state: 'ready', requestedBy: 'p1', requestedAt: 1000,
  participants: [{ personId: 'p1', name: 'A', consent: 'accepted' }], segments: [{ id: 's1', personId: 'p1', speaker: 'A', startMs: 0, endMs: 1000, text: 'We decided to ship Friday.' }],
  suggestions: [{ id: 'i1', kind: 'decision', text: 'Ship Friday', sourceSegmentId: 's1', personId: 'p1' }], workerToken: 'must-not-export', rawPath: '/private/audio', arbitraryExtra: '<script>bad</script>' });
const edit = () => [{ id: 'i1', text: 'Reviewed: ship next Friday ✅', selected: true }];
const { reviewedBundle } = await load('capture-export.ts');

test('export whitelists reviewed edits and source provenance, omits transcript/credentials by default', () => {
  const result = JSON.parse(reviewedBundle(session(), 'p1', edit(), false, true));
  assert.equal(result.format, 'chief.meeting-review'); assert.equal(result.version, 1);
  assert.equal(result.items[0].text, edit()[0].text); assert.equal(result.items[0].source.text, session().segments[0].text);
  assert.equal(result.items[0].source.segmentId, 's1'); assert.ok(!('transcript' in result));
  assert.ok(!JSON.stringify(result).includes('must-not-export')); assert.ok(!JSON.stringify(result).includes('private/audio'));
  assert.ok(!JSON.stringify(result).includes('arbitraryExtra'));
});
test('export requires confirmation, completed authorized session and explicit material selection', () => {
  for (const args of [[session(), 'p1', edit(), false, false], [{ ...session(), state: 'capturing' }, 'p1', edit(), false, true], [session(), 'outsider', edit(), false, true], [session(), 'p1', [], false, true]]) assert.throws(() => reviewedBundle(...args));
});
test('optional transcript is explicit and Unicode/HTML-looking source stays inert JSON text', () => {
  const value = session(); value.segments[0].text = '<img onerror="bad"> Καλημέρα 🌱';
  const bundle = JSON.parse(reviewedBundle(value, 'p1', [], true, true));
  assert.equal(bundle.transcript[0].text, value.segments[0].text); assert.equal(bundle.items.length, 0);
});
test('selected suggestions must retain an existing attributed source; unknown/duplicate selections fail', () => {
  for (const value of [{ ...session(), segments: [] }, { ...session(), suggestions: [{ ...session().suggestions[0], personId: 'wrong' }] }]) assert.throws(() => reviewedBundle(value, 'p1', edit(), false, true), /source/);
  assert.throws(() => reviewedBundle(session(), 'p1', [{ id: 'injected', text: 'x', selected: true }], false, true), /source/);
  assert.throws(() => reviewedBundle(session(), 'p1', [...edit(), ...edit()], false, true), /distinct/);
});
test('export enforces item, field, transcript and UTF-8 byte bounds without silent truncation', () => {
  assert.throws(() => reviewedBundle(session(), 'p1', Array.from({ length: 101 }, (_, i) => ({ id: '' + i, selected: true, text: 'x' })), false, true), /100/);
  assert.throws(() => reviewedBundle(session(), 'p1', [{ ...edit()[0], text: 'x'.repeat(4001) }], false, true), /too long/);
  assert.throws(() => reviewedBundle({ ...session(), title: 'x'.repeat(201) }, 'p1', edit(), false, true), /title/);
  assert.throws(() => reviewedBundle({ ...session(), segments: Array.from({ length: 2001 }, (_, i) => ({ ...session().segments[0], id: '' + i })) }, 'p1', [], true, true), /2000/);
  assert.throws(() => reviewedBundle({ ...session(), segments: Array.from({ length: 100 }, (_, i) => ({ ...session().segments[0], id: '' + i, text: '🌱'.repeat(3000) })) }, 'p1', [], true, true), /512/);
});
test('invalid timing or session provenance never exports', () => {
  assert.throws(() => reviewedBundle({ ...session(), revision: 0 }, 'p1', edit(), false, true), /provenance/);
  assert.throws(() => reviewedBundle({ ...session(), segments: [{ ...session().segments[0], endMs: -1 }] }, 'p1', edit(), false, true), /timing/);
});

function writable(initial) { let value = initial; const listeners = new Set(); return { subscribe(fn) { listeners.add(fn); fn(value); return () => listeners.delete(fn); }, set(next) { value = next; for (const fn of listeners) fn(value); } }; }
const { createCaptureController } = await load('capture-state.ts', { 'svelte/store': { writable }, '@hcengineering/presentation': { getCurrentWorkspaceUuid: () => 'workspace' }, './capture-client': {} });
const snapshot = controller => { let value; controller.subscribe(v => { value = v; })(); return value; };
test('opening/refresh performs only authenticated reads; server states and attendance stop propagate without auto consent', async () => {
  const calls = []; let state = 'pending';
  const controller = createCaptureController({ call: async (path, method, body) => { calls.push({ path, method, body }); return path.startsWith('/history') ? { sessions: [] } : { joined: true, available: true, selfPersonId: 'p1', session: { ...session(), state } }; } }, 'meeting');
  await controller.refresh(); assert.equal(snapshot(controller).status.session.state, 'pending');
  state = 'cancelled'; await controller.refresh(); assert.equal(snapshot(controller).status.session.state, 'cancelled');
  assert.ok(calls.every(call => call.method === undefined && call.body === undefined));
});
test('explicit consent sends no claimed person or workspace; no optimistic capturing state', async () => {
  const calls = []; const controller = createCaptureController({ call: async (path, method, body) => { calls.push({ path, method, body }); return path.startsWith('/history') ? { sessions: [] } : { session: { ...session(), state: 'pending' } }; } }, 'meeting');
  await controller.refresh(); await controller.mutate('/consent', { sessionId: 'session', revision: 1, accept: false });
  const mutation = calls.find(call => call.method === 'POST'); assert.deepEqual(mutation.body, { sessionId: 'session', revision: 1, accept: false });
  assert.equal(snapshot(controller).status.session.state, 'pending');
});
test('authorization loss clears private state/history, disables mutations, and clear invalidates late responses', async () => {
  let fail = false; const controller = createCaptureController({ call: async path => { if (fail) throw Error('Access revoked'); return path.startsWith('/history') ? { sessions: [session()] } : { session: session() }; } }, 'meeting');
  await controller.refresh(); fail = true; await controller.refresh();
  assert.equal(snapshot(controller).status, undefined); assert.equal(snapshot(controller).history.length, 0); assert.equal(snapshot(controller).fresh, false);
  await controller.mutate('/request', { meetingId: 'meeting' }); assert.equal(snapshot(controller).fresh, false);
  let resolveStatus; const late = createCaptureController({ call: path => path.startsWith('/history') ? Promise.resolve({ sessions: [session()] }) : new Promise(resolve => { resolveStatus = resolve; }) }, 'meeting');
  const pending = late.refresh(); late.clear(); resolveStatus({ session: session() }); await pending; assert.equal(snapshot(late).status, undefined);
});
test('concurrent views share in-flight reads rather than duplicating a capture operation', async () => {
  let reads = 0, finish; const controller = createCaptureController({ call: path => { reads++; return path.startsWith('/history') ? Promise.resolve({ sessions: [] }) : new Promise(resolve => { finish = resolve; }); } }, 'meeting');
  const a = controller.refresh(), b = controller.refresh(); assert.equal(reads, 1); finish({}); await Promise.all([a, b]); assert.equal(reads, 2);
});
test('client uses captured workspace and current bearer, never cookies, and rejects a changed workspace response', async () => {
  let workspace = 'w', captured;
  const { CaptureClient } = await load('capture-client.ts', { '@hcengineering/core': { concatLink: (a, b) => a + b }, '@hcengineering/love': { default: { metadata: { ServiceEndpoint: 'endpoint' } } }, '@hcengineering/platform': { getMetadata: () => 'http://localhost/_love' }, '@hcengineering/presentation': { getCurrentWorkspaceUuid: () => workspace }, './utils': { getPlatformToken: () => 'synthetic' } }, { fetch: async (url, init) => { captured = { url, init }; return { ok: true, json: async () => ({}) }; } });
  const client = new CaptureClient('w'); await client.call('/status'); assert.equal(captured.init.credentials, 'omit'); assert.equal(captured.init.headers.Authorization, 'Bearer synthetic'); assert.equal(captured.init.method, 'GET');
  workspace = 'other'; await assert.rejects(client.call('/request', 'POST', {}), /not available/);
});
