import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForExit } from '../server/testing/cleanup.ts';
import { createCompanionOriginEndpoint, cleanupCompanionOriginEndpoint, type CompanionOriginEndpoint } from '../electron/companion-origin-gateway.mjs';
import { startPhoneRemote } from './chief-phone-remote.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = join(root, '.chief-local', 'phone');
mkdirSync(directory, { recursive: true, mode: 0o700 });
let child: ChildProcess | undefined;
let backend = '';
let closing = false;
let origin: CompanionOriginEndpoint | undefined;
const remote = await startPhoneRemote({ root, directory, controlOrigin: 'http://127.0.0.1:18911' });
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function stopCompanion() {
  await remote.detach();
  if (child) await waitForExit(child, { signal: 'SIGTERM' });
  child = undefined;
  backend = '';
  if (origin) cleanupCompanionOriginEndpoint(origin);
  origin = undefined;
}
async function close() {
  closing = true;
  await stopCompanion();
  await remote.close();
}
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());

// Follow the saved development server across its dynamic-port restarts. Never
// discover or attach to the separate installed desktop app on port 8899.
while (!closing) {
  try {
    const manifest = JSON.parse(readFileSync(join(root, '.chief-local/preview.json'), 'utf8'));
    const url = new URL(manifest.url);
    if (url.origin !== manifest.url || url.hostname !== '127.0.0.1' || url.protocol !== 'http:' || !url.port ||
        manifest.previewUrl !== 'http://127.0.0.1:5299' || !existsSync(join(manifest.dataDir, 'bots.json'))) throw Error('Invalid saved Chief runtime');
    const identity = `${url.origin}:${manifest.pid}`;
    const response = await fetch(url.origin + '/api/health', { signal: AbortSignal.timeout(3000) });
    if (!response.ok || (await response.json()).app !== 'openmausbot') throw Error('Chief is not ready');
    if (!child || child.exitCode !== null || child.signalCode !== null || identity !== backend) {
      await stopCompanion();
      if (closing) break;
      origin = createCompanionOriginEndpoint();
      const log = openSync(join(directory, 'companion.log'), 'a', 0o600);
      child = spawn(process.execPath, ['--experimental-strip-types', join(root, 'companion/src/index.ts')], {
        cwd: root, windowsHide: true, stdio: ['ignore', log, log],
        env: { ...process.env, OMB_PORT: url.port, OMB_WEBHOOK_PORT: String(Number(url.port) + 1),
          OMB_COMPANION_PORT: '18910', OMB_CONTROL_PORT: '18911', OMB_COMPANION_DIR: directory,
          OMB_COMPANION_NAME: 'Chief Development', OMB_COMPANION_HOSTED_URL: '', OMB_COMPANION_INTERNAL_ORIGIN: origin.socketPath, OMB_PHONE_SECRET_PUBLIC_KEY: '' },
      });
      closeSync(log);
      backend = identity;
      const started = Date.now();
      while (!closing) {
        try {
          const state = await (await fetch('http://127.0.0.1:18911/state', { signal: AbortSignal.timeout(1000) })).json();
          if (state.pid === child.pid) break;
        } catch { /* Waiting for this exact companion generation. */ }
        if (child.exitCode !== null || Date.now() - started > 15000) throw Error('Companion failed to start');
        await delay(200);
      }
      if (!closing && child.pid) await remote.attach({ pid: child.pid, socketPath: origin.socketPath });
      console.log('Chief phone ready; pairing: http://127.0.0.1:18911; secure HTTPS setup: http://127.0.0.1:18912');
    }
  } catch {
    // No phone is allowed to use a stale backend while Chief is restarting.
    if (child) await stopCompanion();
  }
  if (!closing) await delay(5000);
}
