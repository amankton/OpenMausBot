// Real tracked capture engine/routes; Accounts, record ACLs and RTC are synthetic.
// This is a boundary fixture, not a deployed Platform tenancy qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const source = new URL('./patches/capture-backend-source/services/love/src/', import.meta.url);
// Same already-installed Express as the retained Love service; no install/network.
const express = createRequire(new URL('../../.chief-local/platform-source/services/love/package.json', import.meta.url))('express');
function load(name, modules) {
  const result = ts.transpileModule(fs.readFileSync(new URL(name, source), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, reportDiagnostics: true,
  });
  assert.equal(result.diagnostics.length, 0);
  const exports = {};
  runInNewContext(result.outputText, { exports, Buffer, Date, Set, setInterval, clearInterval,
    require(name) { assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name]; } });
  return exports;
}
const core = load('capture.ts', { 'node:crypto': crypto, 'node:fs': fs, 'node:path': path });

test('two workspace capture sessions isolate colliding record IDs, credentials, history and mutations', async t => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'chief-stage0-capture-'));
  let capture, server;
  t.after(async () => {
    if (capture) await capture.close();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep));
    assert.ok(path.basename(directory).startsWith('chief-stage0-capture-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const identities = new Map(['a', 'b'].map(id => [id + '-token', { account: id + '-account', workspace: id + '-workspace', role: 'USER' }]));
  const revoked = new Set();
  const hidden = new Set();
  const clients = new Map(['a', 'b'].map(id => [id + '-workspace', {
    async findOne(kind, query) {
      if (hidden.has(id)) return undefined;
      // Deliberately identical room, meeting and person IDs in both tenants.
      const docs = [
        { _class: 'Employee', _id: 'person', personUuid: id + '-account', active: true, name: `Synthetic ${id}` },
        { _class: 'Meeting', _id: 'meeting', attachedTo: 'room', title: `PRIVATE_${id}`, access: 0 },
        { _class: 'Room', _id: 'room', access: 0 },
      ];
      return docs.find(d => d._class === kind && Object.entries(query).every(([k, v]) => d[k] === v));
    }, async findAll() { return []; },
  }]));
  class AdmissionError extends Error {}
  class MeetingAdmission {
    constructor(auth, caller, system) { Object.assign(this, { auth, caller, system }); }
    async actor() {
      const person = await this.caller.findOne('Employee', { personUuid: this.auth.account, active: true });
      if (!person) throw new core.CaptureError(403, 'No active member');
      return person;
    }
    async requireJoin() { return this.actor(); }
    async authority() { return false; }
  }
  const workerSecret = 'synthetic-stage0-worker-'.repeat(3);
  const config = { CaptureDirectory: directory, CaptureWorkerSecret: workerSecret, Secret: 'fixture-platform', ApiSecret: 'fixture-rtc', ApiKey: 'fixture', AccountsURL: 'fixture://accounts' };
  const modules = {
    'express': express, 'node:crypto': crypto,
    '@hcengineering/platform': { __esModule: true, default: { status: {} }, PlatformError: class extends Error {} },
    '@hcengineering/account-client': {
      isWorkspaceLoginInfo: v => v?.workspace != null,
      getClient: (_url, token) => ({
        async getLoginInfoByToken() { const identity = identities.get(token); if (!identity) throw new core.CaptureError(401, 'Invalid synthetic identity'); return identity; },
        async getWorkspaceMembers() { const i = identities.get(token); return revoked.has(i.workspace) ? [] : [{ person: i.account, role: i.role }]; },
      }),
    },
    '@hcengineering/contact': { __esModule: true, default: { mixin: { Employee: 'Employee' } } },
    '@hcengineering/core': { AccountRole: { User: 'USER', Guest: 'GUEST', Owner: 'OWNER', Admin: 'ADMIN', Maintainer: 'MAINTAINER' }, systemAccountUuid: 'system' },
    '@hcengineering/love': { __esModule: true, default: { class: { MeetingMinutes: 'Meeting', Room: 'Room', UserMeetingInvite: 'Invite' } }, RoomAccess: { Open: 0, DND: 2 } },
    '@hcengineering/server-token': { generateToken: account => account[0] + '-token' },
    'livekit-server-sdk': { AccessToken: class { addGrant() {} async toJwt() { return 'synthetic-rtc'; } } },
    './admission': { MeetingAdmission, AdmissionError, readReceipt: () => undefined },
    './client': { getClient: async (token, workspace) => { assert.equal(identities.get(token).workspace, workspace); return clients.get(workspace); } },
    './config': { __esModule: true, default: config },
    './workspaceClient': { WorkspaceClient: { create: async workspace => ({ getAdmissionClient: () => clients.get(workspace) }) } },
    './utils': { extractToken: headers => headers.authorization?.replace(/^Bearer /, ''), getRoomName: (w, m) => w + '_' + m },
    './capture': core,
  };
  const app = express();
  capture = await load('captureRoutes.ts', modules).installCapture(app, {
    listRooms: async () => [{}], listParticipants: async () => [{ identity: 'person', sid: 'synthetic-sid' }], removeParticipant: async () => {},
  }, { warn() {} });
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const request = async (token, route, body, method = body === undefined ? 'GET' : 'POST') => {
    const init = { method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, signal: AbortSignal.timeout(5000) };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(`http://127.0.0.1:${server.address().port}/capture${route}`, init);
    return { status: res.status, body: await res.json() };
  };
  assert.equal((await request(workerSecret, '/worker/poll', { workerId: 'worker', ready: true, model: 'synthetic' })).status, 200);
  const a = await request('a-token', '/request', { meetingId: 'meeting' });
  assert.equal(a.status, 200);
  // Existing capture service intentionally has a single global worker slot.
  assert.equal((await request('b-token', '/request', { meetingId: 'meeting' })).status, 409);
  assert.equal((await request('a-token', '/stop', { sessionId: a.body.session.id, revision: 1 })).status, 200);
  const b = await request('b-token', '/request', { meetingId: 'meeting' });
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.notEqual(a.body.session.id, b.body.session.id);
  for (const [token, own, foreign] of [['a-token', a, b], ['b-token', b, a]]) {
    assert.equal((await request(token, '/session/' + own.body.session.id)).status, 200);
    for (const method of ['GET', 'DELETE']) assert.equal((await request(token, '/session/' + foreign.body.session.id, undefined, method)).status, 403);
    assert.equal((await request(token, '/consent', { sessionId: foreign.body.session.id, revision: 1, accept: true })).status, 403);
    const history = await request(token, '/history?meetingId=meeting');
    assert.deepEqual(history.body.sessions.map(s => s.id), [own.body.session.id]);
    assert.equal((await request(token, '/worker/poll', { workerId: 'worker', ready: true, model: 'synthetic' })).status, 401);
  }
  assert.equal((await request('a-token', '/request', { meetingId: 'meeting', workspace: 'b-workspace' })).status, 400);
  revoked.add('a-workspace');
  assert.equal((await request('a-token', '/session/' + a.body.session.id)).status, 403);
  assert.equal((await request('b-token', '/session/' + b.body.session.id)).status, 200);
  hidden.add('b');
  assert.equal((await request('b-token', '/session/' + b.body.session.id)).status, 403);
  const reloaded = new core.CaptureStore(directory);
  assert.equal(reloaded.sessions.length, 2);
  assert.deepEqual(Array.from(reloaded.sessions, s => s.workspace).sort(), ['a-workspace', 'b-workspace']);
});
