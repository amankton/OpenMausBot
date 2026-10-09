// Executes retained source against synthetic Blob, storage, and media boundaries only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../../.chief-local/platform-source/', import.meta.url));
const recorderRoot = 'plugins/recorder-resources/src/';
const flush = () => new Promise(resolve => setImmediate(resolve));
async function load(path, modules = {}, globals = {}) {
  const source = await readFile(resolve(root, path), 'utf8');
  const output = ts.transpileModule(source, { fileName: path, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true });
  assert.equal(output.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  const exports = {};
  runInNewContext(output.outputText, { exports, require: key => { assert.ok(key in modules, `Unmocked ${key}`); return modules[key]; }, Error, Blob, File, AbortController, setTimeout, clearTimeout, console: { debug() {}, warn() {}, error() {} }, ...globals });
  return exports;
}
async function fixture(upload = async () => ({ uuid: 'owned-blob' }), repair = async blob => blob, duration = 1500) {
  const calls = [], deleted = [];
  let workspace = 'source-workspace';
  const presentation = { default: { metadata: { Token: 'token' } }, generateFileId: () => 'owned-blob', getCurrentWorkspaceUuid: () => workspace,
    getFileStorage: () => ({ deleteFile: async (...args) => { deleted.push(args); } }),
    uploadFile: async (...args) => { calls.push(args); return await upload(...args); } };
  const { ChunkReader } = await load(recorderRoot + 'stream.ts');
  const { FileStorageUploader, MAX_RECORDING_BYTES } = await load(recorderRoot + 'uploader.ts', { '@fix-webm-duration/fix': { fixWebmDuration: repair }, '@hcengineering/platform': { getMetadata: () => 'synthetic-token' }, '@hcengineering/presentation': presentation });
  const reader = new ChunkReader();
  const uploader = new FileStorageUploader(reader, { workspace, width: 640, height: 480, contentType: 'video/webm;codecs=vp8,opus', durationMs: () => duration });
  return { reader, uploader, calls, deleted, MAX_RECORDING_BYTES, setWorkspace: value => { workspace = value; } };
}
test('collects a real WebM File, preserves bytes/dimensions, and performs one guarded upload', async () => {
  const f = await fixture(); f.uploader.start(); f.reader.push(new Blob(['header'])); f.reader.push(new Blob(['tail'])); f.reader.close();
  const result = await f.uploader.wait();
  assert.equal(result.size, 10); assert.equal(await result.file.text(), 'headertail'); assert.equal(result.file.type, 'video/webm'); assert.equal(result.file.name, 'Recording.webm');
  assert.equal(result.width, 640); assert.equal(f.calls.length, 1); assert.equal(f.calls[0][2].expectedWorkspace, 'source-workspace');
  await result.discard(); await result.discard(); assert.equal(f.deleted.length, 1);
});
test('repair receives recorded duration and uploads repaired bytes with the real final size', async () => {
  let received;
  const f = await fixture(undefined, async (blob, duration, options) => { received = { duration, options }; return new Blob([blob, 'metadata'], { type: blob.type }); }, 1234);
  f.reader.push(new Blob(['raw'])); f.reader.close(); const result = await f.uploader.wait();
  assert.equal(received.duration, 1234); assert.equal(received.options.logger, false);
  assert.equal(await result.file.text(), 'rawmetadata'); assert.equal(result.size, result.file.size); assert.equal(result.size, 11);
});
test('repair output cannot exceed the byte cap and invalid duration never reaches repair/upload', async () => {
  const f = await fixture(undefined, async () => ({ size: 64 * 1024 * 1024 + 1 })); f.reader.push(new Blob(['raw'])); f.reader.close();
  await assert.rejects(f.uploader.wait(), /64 MiB/); assert.equal(f.calls.length, 0);
  for (const duration of [NaN, Infinity, 0, -1]) {
    const invalid = await fixture(undefined, async () => { throw Error('repair should not run'); }, duration);
    invalid.reader.push(new Blob(['raw'])); invalid.reader.close(); await assert.rejects(invalid.uploader.wait(), /valid duration/); assert.equal(invalid.calls.length, 0);
  }
});
test('cancel during stalled repair settles without uploading; late repair cannot resume upload', async () => {
  let complete; const f = await fixture(undefined, () => new Promise(resolve => { complete = resolve; }));
  f.reader.push(new Blob(['raw'])); f.reader.close(); const pending = f.uploader.wait(); await flush(); await f.uploader.cancel();
  await assert.rejects(pending, /cancelled/); complete(new Blob(['fixed'])); await flush(); assert.equal(f.calls.length, 0); assert.equal(f.deleted.length, 0);
});
test('workspace changes during repair reject before upload', async () => {
  let complete; const f = await fixture(undefined, () => new Promise(resolve => { complete = resolve; }));
  f.reader.push(new Blob(['raw'])); f.reader.close(); const pending = f.uploader.wait(); await flush(); f.setWorkspace('other'); complete(new Blob(['fixed']));
  await assert.rejects(pending, /original workspace/); assert.equal(f.calls.length, 0);
});
test('overflow rejects without allocating a huge File or uploading partial data', async () => {
  const f = await fixture(); f.uploader.start(); f.reader.push({ size: f.MAX_RECORDING_BYTES + 1 }); f.reader.close();
  await assert.rejects(f.uploader.wait(), /64 MiB/); assert.equal(f.calls.length, 0);
});
test('read failure and empty recording never become successful uploads', async () => {
  const f = await fixture(); f.uploader.start(); f.reader.push(new Blob(['partial'])); f.reader.fail(new Error('capture failed'));
  await assert.rejects(f.uploader.wait(), /capture failed/); assert.equal(f.calls.length, 0);
  const empty = await fixture(); empty.reader.close(); await assert.rejects(empty.uploader.wait(), /empty/);
});
test('cancel while collecting settles pending read and never uploads', async () => {
  const f = await fixture(); f.uploader.start(); await f.uploader.cancel(); await assert.rejects(f.uploader.wait(), /cancelled/); assert.equal(f.calls.length, 0);
});
test('cancel during upload aborts transport and removes only owned UUID in original workspace', async () => {
  const f = await fixture(async (file, uuid, { signal }) => await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })));
  f.uploader.start(); f.reader.push(new Blob(['data'])); f.reader.close(); await flush(); f.setWorkspace('another-workspace');
  await f.uploader.cancel(); assert.equal(f.calls[0][2].signal.aborted, true); assert.deepEqual(f.deleted, [['synthetic-token', 'source-workspace', 'owned-blob']]);
});
test('workspace switch before upload rejects; switching after upload prevents attachment and retains original cleanup context', async () => {
  const before = await fixture(); before.setWorkspace('wrong'); before.reader.push(new Blob(['data'])); before.reader.close();
  await assert.rejects(before.uploader.wait(), /original workspace/); assert.equal(before.calls.length, 0);
  const after = await fixture(); after.reader.push(new Blob(['data'])); after.reader.close(); const result = await after.uploader.wait();
  after.setWorkspace('wrong'); assert.throws(result.assertWorkspace, /original workspace/); await result.discard(); assert.equal(after.deleted[0][1], 'source-workspace');
});
test('presentation preserves upload guard, captures credentials and forwards progress/abort options', async () => {
  const metadata = { token: 'synthetic-token', workspace: 'source-workspace' }; const calls = [];
  metadata.storage = { uploadFile: async (...args) => { calls.push(args); } };
  const p = await load('packages/presentation/src/file.ts', {
    '@hcengineering/platform': { getMetadata: key => metadata[key] }, '@hcengineering/storage-client': { createFileStorage() {} }, uuid: { v4: () => 'generated' },
    './plugin': { default: { metadata: { Token: 'token', WorkspaceUuid: 'workspace', FileStorage: 'storage' } } }, './filetypes': { getFileMetadata: async () => ({}) }
  });
  const file = new File(['bytes'], 'clip.webm', { type: 'video/webm' });
  p.setUploadGuard(() => { throw new p.UploadRestrictedError('blocked'); }); await assert.rejects(p.uploadFile(file), /blocked/); assert.equal(calls.length, 0);
  p.setUploadGuard(() => { metadata.workspace = 'switched'; }); await assert.rejects(p.uploadFile(file, 'id', { expectedWorkspace: 'source-workspace' }), /workspace changed/); assert.equal(calls.length, 0);
  metadata.workspace = 'source-workspace'; p.setUploadGuard(undefined); const signal = new AbortController().signal, onProgress = () => {};
  await p.uploadFile(file, 'id', { signal, onProgress, expectedWorkspace: 'source-workspace' });
  assert.equal(calls[0][0], 'synthetic-token'); assert.equal(calls[0][1], 'source-workspace'); assert.equal(calls[0][4].signal, signal); assert.equal(calls[0][4].onProgress, onProgress);
});
test('upload cancellation settles even if optional metadata provider never completes', async () => {
  const controller = new AbortController();
  const p = await load('packages/presentation/src/file.ts', {
    '@hcengineering/platform': { getMetadata: key => key === 'storage' ? { uploadFile: async () => {} } : 'synthetic' }, '@hcengineering/storage-client': { createFileStorage() {} }, uuid: { v4: () => 'id' },
    './plugin': { default: { metadata: { Token: 'token', WorkspaceUuid: 'workspace', FileStorage: 'storage' } } }, './filetypes': { getFileMetadata: () => new Promise(() => {}) }
  });
  const pending = p.uploadFile(new File(['data'], 'clip.webm'), 'id', { signal: controller.signal }); await flush(); controller.abort(new Error('cancelled metadata'));
  await assert.rejects(pending, /cancelled metadata/);
});
test('two-minute wall timer requests stop and capture is cleaned before upload completion', async () => {
  let timer, timerMs, captureStopped = false, finishUpload;
  const { ScreenRecorder } = await load(recorderRoot + 'screen-recorder.ts', {
    '@hcengineering/presentation': { getCurrentWorkspaceUuid: () => 'source' }, './const': {}, './recorder': {}, './uploader': { MAX_RECORDING_MS: 120000 }, './utils': {}
  }, { setTimeout: (fn, ms) => { timer = fn; timerMs = ms; return 1; }, clearTimeout() {} });
  let automatic = 0;
  const screen = new ScreenRecorder({}, { start() {}, stop: async () => {} }, { start() {}, wait: () => new Promise(resolve => { finishUpload = resolve; }) }, () => { automatic++; }, () => { captureStopped = true; });
  await screen.start(); assert.equal(timerMs, 120000); timer(); assert.equal(automatic, 1);
  const pending = screen.stop(); await flush(); assert.equal(captureStopped, true); finishUpload({ size: 1 }); await pending;
});

test('actual Recorder restricts MIME to WebM, stops near size limit, and rejects oversized final chunk', async () => {
  const instances = [];
  class MediaRecorder {
    static isTypeSupported(type) { return type.startsWith('video/webm'); }
    constructor() { this.state = 'inactive'; this.listeners = {}; instances.push(this); }
    addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
    emit(name, event = {}) { this[`on${name}`]?.(event); for (const fn of this.listeners[name] ?? []) fn(event); }
    start() { this.state = 'recording'; }
    requestData() { this.emit('dataavailable', { data: new Blob(['tail']), timecode: 0 }); }
    stop() { this.state = 'inactive'; this.emit('stop'); }
  }
  const { ChunkReader } = await load(recorderRoot + 'stream.ts');
  const cap = 64 * 1024 * 1024; let stopRequested = 0, released = 0;
  const { Recorder } = await load(recorderRoot + 'recorder.ts', { '@hcengineering/media': { releaseStream: () => { released++; } }, './stream': { ChunkReader }, './utils': { formatElapsedTime: () => '' }, './uploader': { MAX_RECORDING_BYTES: cap } }, { MediaRecorder });
  const recorder = new Recorder({}, { onAutoStop: () => { stopRequested++; } }); recorder.start();
  assert.ok(recorder.mimeType.startsWith('video/webm'));
  instances[0].emit('dataavailable', { data: { size: cap - 1024 }, timecode: 0 }); assert.equal(stopRequested, 1);
  instances[0].emit('dataavailable', { data: { size: 2048 }, timecode: 0 });
  await assert.rejects(recorder.asStream().read(), /64 MiB/); await recorder.stop(); assert.ok(released > 0);
});

test('ChunkReader failure rejects waiting and subsequent readers and discards queued chunks', async () => {
  const { ChunkReader } = await load(recorderRoot + 'stream.ts');
  const reader = new ChunkReader(); const waiting = reader.read(); reader.fail(new Error('failed'));
  await assert.rejects(waiting, /failed/); await assert.rejects(reader.read(), /failed/);
  reader.push(new Blob(['ignored'])); await assert.rejects(reader.read(), /failed/);
});

test('recorder store upload failure is visible and cleanup does not leave stopping state or devices', async () => {
  function writable(initial) { let value = initial; const subs = new Set(); return { subscribe(fn) { subs.add(fn); fn(value); return () => subs.delete(fn); }, update(fn) { value = fn(value); for (const sub of subs) sub(value); } }; }
  function get(store) { let value; store.subscribe(v => { value = v; })(); return value; }
  const cam = writable(null), screen = writable(null); let managerCleaned = 0, composerCleaned = 0, shown = 0, cancelled = 0;
  const manager = { subscribe: writable({ screenStream: null, micStream: null }).subscribe, setCallbacks() {}, initialize() {}, cleanup() { managerCleaned++; } };
  const composer = { initialize() {}, updateCameraStream() {}, updateScreenStream() {}, getStream: () => null, cleanup() { composerCleaned++; } };
  const { recorder } = await load(recorderRoot + 'stores/recorder.ts', {
    'svelte/store': { writable, get }, '../screen-recorder': { createScreenRecorder: async () => ({ start: async () => {}, stop: async () => { throw new Error('synthetic network failure'); }, cancel: async () => { cancelled++; } }) },
    '../stores/composer': { composer }, '../stores/manager': { manager, camStream: cam, screenStream: screen }, '@hcengineering/presentation': { getCurrentWorkspaceUuid: () => 'source' }
  }, { MediaStream: class { getTracks() { return []; } }, window: { setInterval: () => 1 }, clearInterval() {} });
  await recorder.initialize({ onStopped: () => { shown++; } }); await recorder.start(); await recorder.stop();
  assert.equal(get(recorder).state, 'error'); assert.match(get(recorder).error, /network failure/); assert.equal(shown, 1); assert.ok(managerCleaned > 0 && composerCleaned > 0);
  await recorder.cancel(); assert.equal(get(recorder).state, 'idle'); assert.equal(get(recorder).result, null); assert.equal(cancelled, 0);
});

test('actual Save handler passes real File and original dimensions to target callback without creating another Drive file', async () => {
  const source = await readFile(resolve(root, recorderRoot + 'components/RecordingPopup.svelte'), 'utf8');
  const script = source.match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  const ast = ts.createSourceFile('popup.ts', script, ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'handleCompleteRecording');
  const js = ts.transpileModule(fn.getText(ast) + '\nexports.save = handleCompleteRecording;', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const file = new File(['recorded bytes'], 'Recording.webm', { type: 'video/webm' });
  const events = [], exports = {};
  const context = { exports, Error, name: 'Clip', saving: false, saveError: '', state: { result: { uuid: 'owned', file, type: file.type, size: file.size, width: 640, height: 480, assertWorkspace() {} }, config: { target: { objectClass: 'card', objectId: 'selected-card' }, onFileUploaded: async params => { events.push(['attachment', params]); } } },
    cleanupRecording: async () => { events.push(['cleanup']); }, dispatch: event => events.push([event]), openDocFromRef: (...args) => events.push(['open', ...args]), getClient() { assert.fail('target callback must not create a Drive file'); } };
  runInNewContext(js, context); await exports.save();
  assert.equal(events[0][1].file, file); assert.equal(events[0][1].file.size, 14); assert.equal(events[0][1].name, 'Clip.webm'); assert.equal(events[0][1].metadata.originalWidth, 640);
  assert.deepEqual(events[1], ['open', 'card', 'selected-card']); assert.equal(context.saving, false); assert.equal(context.saveError, '');
  context.state.result.assertWorkspace = () => { throw new Error('workspace changed'); }; events.length = 0; await exports.save();
  assert.equal(events.length, 0); assert.match(context.saveError, /workspace changed/);
});

test('cancel while recorder initialization awaits video dimensions cannot start a late recording', async () => {
  function writable(initial) { let value = initial; return { subscribe(fn) { fn(value); return () => {}; }, update(fn) { value = fn(value); } }; }
  function get(store) { let value; store.subscribe(v => { value = v; })(); return value; }
  const empty = writable(null); let finish, started = 0, cancelled = 0;
  const { recorder } = await load(recorderRoot + 'stores/recorder.ts', {
    'svelte/store': { writable, get }, '../screen-recorder': { createScreenRecorder: () => new Promise(resolve => { finish = resolve; }) },
    '../stores/composer': { composer: { initialize() {}, updateCameraStream() {}, updateScreenStream() {}, getStream: () => null, cleanup() {} } },
    '../stores/manager': { manager: { subscribe: writable({ screenStream: null, micStream: null }).subscribe, setCallbacks() {}, initialize() {}, cleanup() {} }, camStream: empty, screenStream: empty },
    '@hcengineering/presentation': { getCurrentWorkspaceUuid: () => 'source' }
  }, { MediaStream: class { getTracks() { return []; } }, window: { setInterval: () => 1 }, clearInterval() {} });
  await recorder.initialize({}); const pending = recorder.start(); await recorder.cancel();
  finish({ start: async () => { started++; }, cancel: async () => { cancelled++; } }); await pending;
  assert.equal(started, 0); assert.equal(cancelled, 1); assert.equal(get(recorder).state, 'idle');
});
