import assert from 'node:assert/strict';
import { delimiter, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { chiefPodmanEnvironment } from './chief-podman-env.ts';
import { launchVerificationServer } from './control-omb.ts';

// Read-only machine discovery through a disposable personal server. Never
// create, start, stop, or change containers during this verification.
const env = chiefPodmanEnvironment();
const fixture = await launchVerificationServer(process.env, undefined, {
  binDir: env.OMB_EXTRA_PATH.split(delimiter)[0], host: env.CONTAINER_HOST,
  sshKey: env.CONTAINER_SSHKEY, staticDir: resolve('dist'),
});
try {
  const response = await fetch(fixture.info.url + '/api/local-computer');
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(status.runtime, 'podman');
  assert.equal(status.daemonUp, true);
  const receipt = { passed: true, verifiedAt: new Date().toISOString(),
    isolatedServer: true, machineOperations: 'read-only discovery',
    runtime: status.runtime, daemonUp: status.daemonUp,
    desktopReady: status.desktopReady, container: status.container };
  writeFileSync('docs/verification/evidence/chief-podman.json', JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
} finally { await fixture.close(); }
