import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, openSync, closeSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { createPhoneRemoteSetup } from './chief-phone-remote.mjs';
import { createCompanionOriginEndpoint, createCompanionOriginGateway, cleanupCompanionOriginEndpoint } from '../electron/companion-origin-gateway.mjs';
import { launchVerificationServer, verificationServerEnvironment } from './control-omb.ts';
import { freePortBlock } from '../server/testing/ports.ts';
import { removeTempDir, waitForExit } from '../server/testing/cleanup.ts';

const calls = [];
const admin = createPhoneRemoteSetup({ state: async () => ({ status: 'signed-out', ready: false }),
  requestCode: async email => calls.push(['request', email]), verifyCode: async email => calls.push(['verify', email]),
  retry: async () => calls.push(['retry']), disconnect: async () => calls.push(['disconnect']) });
admin.listen(0, '127.0.0.1');
await once(admin, 'listening');
const origin = `http://127.0.0.1:${admin.address().port}`;
const forgedHost = () => new Promise((resolve, reject) => {
  const req = http.get(origin + '/state', { headers: { host: 'evil.example' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  req.on('error', reject);
});
try {
  const response = await fetch(origin);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const page = await response.text();
  const csrf = page.match(/const token='([a-f0-9]+)'/)[1];
  const headers = { 'content-type': 'application/json', 'x-chief-setup': csrf, origin };
  assert.equal(await forgedHost(), 403);
  assert.equal((await fetch(origin + '/state', { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(origin + '/state', { headers: { 'x-forwarded-for': '203.0.113.7' } })).status, 403);
  assert.equal((await fetch(origin + '/retry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await fetch(origin + '/retry', { method: 'POST', headers: { ...headers, origin: 'null' }, body: '{}' })).status, 403);
  assert.equal((await fetch(origin + '/verify-code', { method: 'POST', headers, body: JSON.stringify({ email: 'fixture@example.test', code: 'bad' }) })).status, 400);
  assert.equal((await fetch(origin + '/request-code', { method: 'POST', headers, body: JSON.stringify({ email: 'fixture@example.test' }) })).status, 200);
  assert.equal((await fetch(origin + '/request-code', { method: 'POST', headers, body: JSON.stringify({ email: 'fixture@example.test' }) })).status, 429);
  assert.equal((await fetch(origin + '/verify-code', { method: 'POST', headers, body: JSON.stringify({ email: 'fixture@example.test', code: '12345678' }) })).status, 200);
  assert.equal((await fetch(origin + '/retry', { method: 'POST', headers, body: '{}' })).status, 200);
  assert.deepEqual(calls, [['request', 'fixture@example.test'], ['verify', 'fixture@example.test'], ['retry']]);
} finally { admin.closeAllConnections(); await new Promise(resolve => admin.close(resolve)); }

const fixture = await launchVerificationServer();
const directory = mkdtempSync(join(tmpdir(), 'chief-remote-phone-'));
const port = await freePortBlock([0, 1]);
const controlOrigin = `http://127.0.0.1:${port + 1}`;
const deviceOrigin = `http://127.0.0.1:${port}`;
const privateOrigin = createCompanionOriginEndpoint();
const logPath = join(tmpdir(), `chief-remote-phone-${Date.now()}.log`);
const log = openSync(logPath, 'a', 0o600);
const child = spawn(process.execPath, ['--experimental-strip-types', 'companion/src/index.ts'], {
  cwd: process.cwd(), windowsHide: true, stdio: ['ignore', log, log],
  env: { ...verificationServerEnvironment(process.env, directory, Number(new URL(fixture.info.url).port)),
    OMB_COMPANION_PORT: String(port), OMB_CONTROL_PORT: String(port + 1), OMB_COMPANION_DIR: directory,
    OMB_COMPANION_INTERNAL_ORIGIN: privateOrigin.socketPath, OMB_COMPANION_HOSTED_URL: '', OMB_PHONE_SECRET_PUBLIC_KEY: '' },
});
closeSync(log);
const gateway = createCompanionOriginGateway({ target: { pid: child.pid, socketPath: privateOrigin.socketPath }, originPort: 0,
  isTargetAlive: () => child.exitCode === null && child.signalCode === null });
try {
  const deadline = Date.now() + 30000;
  for (;;) {
    try { if ((await fetch(controlOrigin + '/state')).ok) break; } catch { /* Starting. */ }
    assert.ok(child.exitCode === null && Date.now() < deadline, 'Fixture companion did not start');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const address = await gateway.start();
  const publicRoute = `http://127.0.0.1:${address.port}`;
  assert.equal((await fetch(publicRoute + '/api/bots')).status, 401);
  const offer = await (await fetch(controlOrigin + '/pairing', { method: 'POST' })).json();
  const paired = await fetch(deviceOrigin + '/api/pair', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: offer.code, deviceName: 'Synthetic phone already paired on LAN' }) });
  assert.equal(paired.status, 201);
  const headers = { authorization: `Bearer ${(await paired.json()).token}` };
  assert.equal((await fetch(publicRoute + '/api/bots', { headers })).status, 200);
  for (const path of ['/pairing', '/api/auth/pairing', '/request-code', '/state']) {
    assert.ok([403, 404, 405].includes((await fetch(publicRoute + path, { method: 'POST', headers })).status), `Owner control leaked: ${path}`);
  }
  const setEndpoint = url => fetch(controlOrigin + '/hosted-endpoint', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) });
  assert.equal((await setEndpoint('https://fixture.example.test')).status, 200);
  const endpoints = await (await fetch(publicRoute + '/api/companion/endpoints', { headers })).json();
  assert.ok(JSON.stringify(endpoints).includes('https://fixture.example.test'), 'Existing phone learns the hosted route');
  assert.equal((await setEndpoint(null)).status, 200);
  assert.ok(!JSON.stringify(await (await fetch(deviceOrigin + '/api/companion/endpoints', { headers })).json()).includes('https://fixture.example.test'));
  await waitForExit(child, { signal: 'SIGTERM' });
  assert.equal((await fetch(publicRoute + '/api/bots', { headers })).status, 503);
  const receipt = { passed: true, syntheticOnly: true, verifiedAt: new Date().toISOString(),
    localSetupHostOriginCsrfAndRateLimit: true, pairedLanCredentialWorksThroughPrivatePipe: true,
    unauthenticatedRemoteDenied: true, ownerControlsDenied: true, endpointRefreshAndWithdrawal: true,
    companionExitFailsClosed: true, actualCellularTested: false, logPath };
  writeFileSync('docs/verification/evidence/chief-phone-remote.json', JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
} finally {
  await gateway.close();
  await waitForExit(child, { signal: 'SIGTERM' });
  cleanupCompanionOriginEndpoint(privateOrigin);
  await fixture.close();
  await removeTempDir(directory);
}
