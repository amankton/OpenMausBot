// Executes patched release modules with fake media/SDK boundaries; never accesses real devices.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../../.chief-local/platform-source/', import.meta.url));
const flush = () => new Promise(resolve => setImmediate(resolve));
const quiet = { log() {}, warn() {}, error() {}, debug() {} };
function writable(initial) {
  let value = initial;
  const subscribers = new Set();
  return { subscribe(fn) { subscribers.add(fn); fn(value); return () => subscribers.delete(fn); }, set(next) { value = next; for (const fn of subscribers) fn(value); }, update(fn) { this.set(fn(value)); } };
}
function get(store) { let result; store.subscribe(value => { result = value; })(); return result; }
function derived(stores, fn) {
  const many = Array.isArray(stores), list = many ? stores : [stores];
  return { subscribe(observer) { const values = list.map(get); const emit = () => observer(fn(many ? values : values[0])); return (() => { const off = list.map((store, index) => store.subscribe(value => { values[index] = value; emit(); })); return () => off.forEach(fn => fn()); })(); } };
}
const stores = { writable, get, derived, readable: (value, start) => { const store = writable(value); start?.(value => store.set(value)); return store; } };
function stream(kinds = ['video', 'audio']) {
  const tracks = kinds.map(kind => ({ kind, stopped: false, stop() { this.stopped = true; } }));
  return { getTracks: () => tracks, getVideoTracks: () => tracks.filter(t => t.kind === 'video'), getAudioTracks: () => tracks.filter(t => t.kind === 'audio') };
}
const releaseStream = value => value?.getTracks().forEach(track => track.stop());
class FakeMediaStream {
  constructor(tracks) { this.tracks = tracks; }
  getTracks() { return this.tracks; }
}
async function load(path, modules, globals = {}, append = '') {
  let source = await readFile(resolve(root, path), 'utf8');
  if (path.endsWith('.svelte')) source = source.match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  const result = ts.transpileModule(source + append, { fileName: path.replace('.svelte', '.ts'), compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true });
  assert.equal(result.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error).length ?? 0, 0, path);
  const exports = {};
  runInNewContext(result.outputText, { exports, require: name => { if (!(name in modules)) throw new Error(`Unmocked dependency: ${name}`); return modules[name]; }, console: quiet, window: { addEventListener() {} }, setTimeout, clearTimeout, setInterval, clearInterval, MediaStream: FakeMediaStream, ...globals }, { filename: path });
  return exports;
}
async function recorderFixture({ capture = async () => stream(), display = async () => stream(['video']) } = {}) {
  const calls = [];
  const exports = await load('plugins/recorder-resources/src/stores/manager.ts', {
    'svelte/store': stores,
    '@hcengineering/media': { getSelectedCamId: () => 'camera', getSelectedMicId: () => 'mic', releaseStream, getDisplayMedia: options => { calls.push(['screen', options]); return display(); } },
    '../const': { DefaultFps: 30 },
    '../utils': { getUseScreenShareSound: () => false, getRecordingResolution: () => 720, getRecordingCameraSize: () => 'small', getRecordingCameraPosition: () => 'right', setRecordingCameraPosition() {}, setRecordingCameraSize() {}, setRecordingResolution() {}, setUseScreenShareSound() {}, whenStreamEnded() {} }
  }, { navigator: { mediaDevices: { getDisplayMedia() {}, getUserMedia: options => { calls.push(['devices', options]); return capture(options); } } } });
  return { ...exports, calls };
}

test('opening recorder and choosing saved device IDs never requests capture', async () => {
  const f = await recorderFixture();
  f.manager.initialize();
  f.manager.setCamDeviceId('other-camera'); f.manager.setMicDeviceId('other-mic');
  await flush();
  assert.equal(f.calls.length, 0);
  assert.equal(get(f.manager).camEnabled, false); assert.equal(get(f.manager).micEnabled, false);
});
test('explicit recorder camera/mic controls acquire only selected devices and cleanup releases tracks', async () => {
  const captures = [];
  const f = await recorderFixture({ capture: async options => { const value = stream([...(options.video ? ['video'] : []), ...(options.audio ? ['audio'] : [])]); captures.push(value); return value; } });
  f.manager.initialize(); f.manager.toggleCam(); await flush();
  assert.equal(f.calls[0][1].audio, false); assert.ok(f.calls[0][1].video);
  f.manager.toggleMic(); await flush();
  assert.ok(f.calls[1][1].audio); assert.ok(captures[0].getTracks().every(t => t.stopped));
  f.manager.cleanup(); assert.ok(captures[1].getTracks().every(t => t.stopped));
});
test('late camera permission after recorder cancellation releases the returned stream', async () => {
  let finish;
  const late = stream(['video']);
  const f = await recorderFixture({ capture: () => new Promise(resolve => { finish = resolve; }) });
  f.manager.initialize(); f.manager.toggleCam(); await flush(); f.manager.cleanup(); finish(late); await flush();
  assert.ok(late.getTracks().every(t => t.stopped)); assert.equal(get(f.manager).camStream, null);
});
test('late screen permission after cancellation or Stop sharing cannot restart capture', async () => {
  for (const stop of ['cleanup', 'stopScreenShare']) {
    let finish;
    const late = stream(['video']);
    const f = await recorderFixture({ display: () => new Promise(resolve => { finish = resolve; }) });
    f.manager.initialize(); const pending = f.manager.shareScreen(); await f.manager[stop](); finish(late); await pending;
    assert.ok(late.getTracks().every(t => t.stopped)); assert.equal(get(f.manager).screenStream, null);
  }
});
test('denied recorder permission leaves no captured stream', async () => {
  const f = await recorderFixture({ capture: async () => { throw new Error('Permission denied'); } });
  f.manager.initialize(); f.manager.toggleMic(); await flush();
  assert.equal(get(f.manager).micStream, null); assert.equal(get(f.manager).loading, false);
  f.manager.cleanup();
});

async function loveFixture() {
  const published = [], deviceRequests = [], sessions = [];
  class Room {
    constructor(options) { this.options = options; this.remoteParticipants = new Map(); this.state = 'disconnected'; this.localParticipant = { setCameraEnabled: async value => published.push(['camera', value]), setMicrophoneEnabled: async value => published.push(['microphone', value]), setScreenShareEnabled: async value => published.push(['screen', value]) }; }
    on() {} off() {} async connect() { this.state = 'connected'; } async disconnect() { this.state = 'disconnected'; }
  }
  const media = { getMediaDevices: async (mic, cam) => { deviceRequests.push([mic, cam]); return {}; }, getSelectedSpeakerId() {} };
  const mediaExports = await load('plugins/media-resources/src/utils.ts', {
    '@hcengineering/media': media, '@hcengineering/platform': {}, './plugin': {}, events: { default: EventEmitter }, svelte: { onDestroy() {} }, 'svelte/store': stores,
    './stores': { registerSession: session => sessions.push(session), unregisterSession() {}, sessions: writable([]), state: writable({}) }
  });
  const f = await load('plugins/love-resources/src/liveKitClient.ts', {
    'livekit-client': { Room, RoomEvent: {}, ConnectionState: { Connected: 'connected' }, Track: { Source: {} } },
    '@hcengineering/platform': {}, '@hcengineering/media': media, '@hcengineering/love': {}, '@hcengineering/media-resources': mediaExports,
    'svelte/store': stores, '@hcengineering/analytics': {}, '@hcengineering/ui': {}, '@hcengineering/theme': {}, './components/meeting/LastParticipantNotification.svelte': {}, './plugin': {},
    './stores': { $myPreferences: { camEnabled: true, micEnabled: true, speakingWhileMutedAlert: true } }, './meetings': {}
  });
  return { ...f, published, deviceRequests, sessions };
}
test('Office connection ignores remembered capture preferences for video and audio rooms', async () => {
  for (const video of [false, true]) {
    const f = await loveFixture(), client = new f.LiveKitClient();
    await client.connect('ws://test.invalid', 'synthetic', video);
    assert.equal(f.deviceRequests.length, 1); assert.equal(f.deviceRequests[0].every(value => value === false), true);
    assert.equal(f.published.some(([, enabled]) => enabled), false);
    assert.equal(get(f.mutedDetectionEnabled), false);
  }
});
test('explicit Office device controls still publish and consent resets after disconnect', async () => {
  const f = await loveFixture(), client = new f.LiveKitClient();
  await client.connect('ws://test.invalid', 'synthetic', true);
  await client.setCameraEnabled(true); await client.setMicrophoneEnabled(true);
  assert.ok(f.published.some(([device, enabled]) => device === 'camera' && enabled));
  assert.ok(f.published.some(([device, enabled]) => device === 'microphone' && enabled));
  f.mutedDetectionEnabled.set(true); await client.disconnect(); assert.equal(get(f.mutedDetectionEnabled), false);
});
test('muted watcher cannot capture on mount; explicit session opt-in allows it and cancellation releases late stream', async () => {
  const connected = writable(true), consent = writable(false), mediaState = writable({ microphone: { enabled: false } });
  let captures = 0, finish;
  const f = await load('plugins/love-resources/src/speakingWhileMuted.ts', {
    '@hcengineering/media': { getSelectedMicId() {}, releaseStream }, 'svelte/store': stores, '@hcengineering/media-resources': { state: mediaState },
    './liveKitClient': { lkSessionConnected: connected, mutedDetectionEnabled: consent }, './stores': { speakingWhileMuted: writable(false) }
  }, { navigator: { mediaDevices: { getUserMedia: () => { captures++; return new Promise(resolve => { finish = resolve; }); } } } });
  const release = f.acquireSpeakingWhileMutedWatch(); await flush(); assert.equal(captures, 0);
  consent.set(true); assert.equal(captures, 1); consent.set(false);
  const late = stream(['audio']); finish(late); await flush(); assert.ok(late.getTracks().every(t => t.stopped)); release();
});

test('guest opening has no preview/capture consent; explicit preview is cancelled safely', async () => {
  const mounted = [], destroyed = []; let captures = 0, finish;
  const f = await load('plugins/love-resources/src/components/guest/GuestJoinPopup.svelte', {
    svelte: { onMount: fn => mounted.push(fn), onDestroy: fn => destroyed.push(fn) }, 'svelte/store': stores,
    '@hcengineering/platform': {}, '../../plugin': { default: { string: {} } }, '../../utils': { lk: { off() {} } }, '../../liveKitClient': { lkSessionConnected: writable(false) },
    '@hcengineering/ui': {}, 'livekit-client': { RoomEvent: {} }, '@hcengineering/login-resources': {}, '@hcengineering/core': {}
  }, { $lkSessionConnected: false, localStorage: { getItem() { return null; } }, navigator: { mediaDevices: { getUserMedia: () => { captures++; return new Promise(resolve => { finish = resolve; }); } } } }, '\nexport const testApi = { setStartWithVideo, stopLocalPreview, getDefaults: () => ({ startWithVideo, startWithAudio, acceptRecording }), getStream: () => localStream };');
  mounted.forEach(fn => fn()); assert.equal(captures, 0); assert.ok(Object.values(f.testApi.getDefaults()).every(value => value === false));
  f.testApi.setStartWithVideo(true); assert.equal(captures, 1);
  destroyed.forEach(fn => fn()); const late = stream(['video']); finish(late); await flush();
  assert.ok(late.getTracks().every(t => t.stopped)); assert.equal(f.testApi.getStream(), null);
});

async function settingsPreviewFixture(capture) {
  const destroyed = [], calls = [];
  const f = await load('plugins/media-resources/src/components/MediaPopupCamPreview.svelte', {
    '@hcengineering/media': { releaseStream }, svelte: { onDestroy: fn => destroyed.push(fn) },
    '@hcengineering/ui': {}, '../plugin': {}
  }, { navigator: { mediaDevices: { getUserMedia: constraints => { calls.push(constraints); return capture(); } } } },
  '\nexport const testApi = { setPreview: (enabled, deviceId = "synthetic-camera") => { previewEnabled = enabled; return updateStream(deviceId, enabled); }, getStream: () => stream, isEnabled: () => previewEnabled };');
  return { ...f.testApi, calls, destroy: () => destroyed.forEach(fn => fn()) };
}

test('opening camera settings does not capture; explicit preview start and stop control tracks', async () => {
  const captured = stream(['video']);
  const f = await settingsPreviewFixture(async () => captured);
  assert.equal(f.calls.length, 0);
  await f.setPreview(true);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].audio, undefined);
  assert.equal(f.getStream(), captured);
  await f.setPreview(false);
  assert.ok(captured.getTracks().every(track => track.stopped)); assert.equal(f.getStream(), null);
  f.destroy();
});

test('stopping or closing camera settings releases a late preview permission result', async () => {
  for (const action of ['stop', 'destroy']) {
    let finish;
    const captured = stream(['video']);
    const f = await settingsPreviewFixture(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.setPreview(true);
    if (action === 'stop') await f.setPreview(false); else f.destroy();
    finish(captured); await pending;
    assert.ok(captured.getTracks().every(track => track.stopped)); assert.equal(f.getStream(), null);
  }
});

test('denied settings preview returns its control to the off state', async () => {
  const f = await settingsPreviewFixture(async () => { throw new Error('Permission denied'); });
  await f.setPreview(true);
  assert.equal(f.isEnabled(), false); assert.equal(f.getStream(), null);
  f.destroy();
});

test('hidden device labels have visible defaults and disclosed names are retained', async () => {
  const f = await load('plugins/media-resources/src/utils.ts', {
    '@hcengineering/media': { cleanupDeviceLabel: label => label },
    '@hcengineering/platform': { getEmbeddedLabel: label => label },
    './plugin': { default: { string: { DefaultMic: 'Default microphone', DefaultCam: 'Default camera', DefaultSpeaker: 'Default speaker' } } },
    events: { default: EventEmitter }, svelte: {}, 'svelte/store': stores, './stores': {}
  });
  for (const [kind, expected] of [['audioinput', 'Default microphone'], ['videoinput', 'Default camera'], ['audiooutput', 'Default speaker']]) {
    assert.equal(f.getDeviceLabel({ kind, label: '  ' }), expected);
    assert.equal(f.getDeviceLabel({ kind, label: 'USB Conference Unit' }), 'USB Conference Unit');
  }
});

test('enumerating hidden devices never erases saved mic or camera IDs or captures media', async () => {
  const values = new Map([['selectedDevice_mic', 'saved-mic'], ['selectedDevice_cam', 'saved-camera']]);
  const f = await load('plugins/media/src/utils.ts', {}, {
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    navigator: { mediaDevices: { enumerateDevices: async () => ['audioinput', 'videoinput'].map(kind => ({ kind, label: '', deviceId: '' })), getUserMedia: () => assert.fail('Enumeration must not capture') } }
  });
  await f.getMediaDevices(false, false);
  assert.equal(values.get('selectedDevice_mic'), 'saved-mic');
  assert.equal(values.get('selectedDevice_cam'), 'saved-camera');
});

async function devicePopupFixture(capture) {
  const destroyed = [], mounted = [], calls = [];
  let enumerated = 0;
  const f = await load('plugins/media-resources/src/components/MediaPopup.svelte', {
    '@hcengineering/media': { getMediaDevices: async (...args) => { enumerated++; assert.equal(args.every(value => value === false), true); return { devices: [{ kind: 'audioinput', label: 'USB Conference Unit' }] }; }, releaseStream },
    svelte: { onDestroy: fn => destroyed.push(fn), onMount: fn => mounted.push(fn) }, '../stores': {}
  }, { $micAccess: { state: 'prompt' }, $camAccess: { state: 'prompt' }, $state: {}, navigator: { mediaDevices: { getUserMedia: constraints => { calls.push(constraints); return capture(constraints); } } } },
  '\nexport const testApi = { revealDevice, refreshDevices, info: () => mediaInfo, error: () => error, busy: () => requesting };');
  await flush();
  return { ...f.testApi, calls, enumerated: () => enumerated, destroy: () => destroyed.forEach(fn => fn()) };
}

test('device name disclosure is explicit, input-specific, refreshed and immediately released', async () => {
  for (const kind of ['audio', 'video']) {
    const captured = stream([kind]);
    const f = await devicePopupFixture(async () => captured);
    assert.equal(f.calls.length, 0);
    const before = f.enumerated();
    await f.revealDevice(kind);
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [{ audio: kind === 'audio', video: kind === 'video' }]);
    assert.equal(f.enumerated(), before + 1);
    assert.equal(f.info().devices[0].label, 'USB Conference Unit');
    assert.ok(captured.getTracks().every(track => track.stopped));
    assert.equal(f.busy(), false);
    f.destroy();
  }
});

test('closing device settings releases late permission results and prevents another request', async () => {
  let finish;
  const captured = stream(['audio']);
  const f = await devicePopupFixture(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.revealDevice('audio');
  await f.revealDevice('video');
  assert.equal(f.calls.length, 1);
  const before = f.enumerated();
  f.destroy(); finish(captured); await pending;
  assert.ok(captured.getTracks().every(track => track.stopped));
  assert.equal(f.enumerated(), before);
  await f.revealDevice('audio'); assert.equal(f.calls.length, 1);
});

test('device permission denial is visible and can be retried', async () => {
  const f = await devicePopupFixture(async () => { throw new Error('NotAllowedError'); });
  await f.revealDevice('audio');
  assert.match(f.error(), /not granted/);
  assert.equal(f.busy(), false);
  await f.revealDevice('audio'); assert.equal(f.calls.length, 2);
  f.destroy();
});
