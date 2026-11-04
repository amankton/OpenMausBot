import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, openSync, closeSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { launchVerificationServer, verificationServerEnvironment } from './control-omb.ts';
import { freePortBlock } from '../server/testing/ports.ts';
import { removeTempDir, waitForExit } from '../server/testing/cleanup.ts';

const fixture = await launchVerificationServer();
const directory = mkdtempSync(join(tmpdir(), 'chief-phone-verification-'));
const port = await freePortBlock([0, 1]);
const deviceOrigin = `http://127.0.0.1:${port}`;
const controlOrigin = `http://127.0.0.1:${port + 1}`;
const logPath = join(tmpdir(), `chief-phone-verification-${Date.now()}.log`);
const log = openSync(logPath, 'a', 0o600);
const env = verificationServerEnvironment(process.env, directory, Number(new URL(fixture.info.url).port));
const child = spawn(process.execPath, ['--experimental-strip-types', 'companion/src/index.ts'], {
  cwd: process.cwd(), windowsHide: true, stdio: ['ignore', log, log],
  env: { ...env, OMB_COMPANION_PORT: String(port), OMB_CONTROL_PORT: String(port + 1), OMB_COMPANION_DIR: directory, OMB_COMPANION_NAME: 'Synthetic Chief phone' },
});
closeSync(log);
try {
  const deadline = Date.now() + 30000;
  for (;;) {
    try { if ((await fetch(controlOrigin + '/state')).ok) break; } catch { /* starting */ }
    assert.ok(child.exitCode === null && Date.now() < deadline, 'Fixture companion did not start');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.equal((await fetch(deviceOrigin + '/api/bots')).status, 401);
  const offer = await (await fetch(controlOrigin + '/pairing', { method: 'POST' })).json();
  assert.match(offer.code, /^\d{6}$/);
  const paired = await fetch(deviceOrigin + '/api/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: offer.code, deviceName: 'Synthetic iPhone' }) });
  assert.equal(paired.status, 201);
  const credential = await paired.json();
  const headers = { Authorization: `Bearer ${credential.token}` };
  const roster = await fetch(deviceOrigin + '/api/bots', { headers });
  assert.equal(roster.status, 200);
  assert.ok(Array.isArray((await roster.json()).bots));
  assert.notEqual((await fetch(deviceOrigin + '/pairing', { method: 'POST', headers })).status, 201);
  assert.notEqual((await fetch(deviceOrigin + '/api/auth/pairing', { method: 'POST', headers })).status, 201);
  const receipt = { passed: true, verifiedAt: new Date().toISOString(), syntheticOnly: true, sixDigitPairing: true,
    unauthenticatedRosterRejected: true, authenticatedRosterReachable: true, ownerControlNotExposed: true,
    actualIPhoneTested: false, logPath };
  writeFileSync('docs/verification/evidence/chief-phone.json', JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
} finally { await waitForExit(child, { signal: 'SIGTERM' }); await fixture.close(); await removeTempDir(directory); }
