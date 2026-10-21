// Disposable HTTP/UI fixture; browser interaction is performed separately.
import { createServer as httpServer } from 'node:http';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { launchVerificationServer } from '../control-omb.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
let label = 'Synthetic unified account';
const calls: string[] = [];
const embedded = httpServer((req, res) => {
  if (req.url === '/config.json') { res.setHeader('content-type', 'application/json'); res.end('{"synthetic":true}'); return; }
  res.setHeader('content-type', 'text/html');
  res.end('<!doctype html><title>Synthetic Chief Workspace</title><h1>Synthetic Chief Workspace</h1><label>Draft note <textarea aria-label="Draft note"></textarea></label><button onclick="parent.postMessage({type:\'chief:open-apps\'},\'*\')">Attempt iframe Apps request</button>');
});
await new Promise<void>(resolve => embedded.listen(0, resolve));
const address = embedded.address();
if (!address || typeof address === 'string') throw new Error('Fixture did not bind');
const fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, undefined, [], undefined, { platformUrl: `http://localhost:${address.port}/` });
const prepare = await fetch(fixture.info.url + '/api/config', { method: 'PUT', headers: { 'content-type': 'application/json', origin: fixture.info.url }, body: JSON.stringify({ onboarding: { completedAt: new Date().toISOString(), version: 1, reelSeen: true, hintsSeen: [] }, profile: { name: 'Synthetic Apps verifier', email: 'fixture@example.test' } }) });
if (!prepare.ok) throw new Error('Fixture configuration failed');
const services = () => ({ gmail: { connected: true, status: 'ACTIVE', accounts: [{ id: 'synthetic-account', alias: label, status: 'ACTIVE' }] } });
const ui = await createServer({ root, logLevel: 'error', plugins: [{ name: 'synthetic-unified-apps', configureServer(server) {
  server.middlewares.use((req, res, next) => {
    const url = new URL(req.url || '/', 'http://fixture');
    let data: unknown;
    if (url.pathname === '/__fixture/state' && req.method === 'GET') data = { label, calls };
    else if (url.pathname === '/__fixture/rotate' && req.method === 'POST') { label = 'Synthetic refreshed account'; data = { label }; }
    else if (url.pathname.startsWith('/api/connectors/')) {
      calls.push(req.method + ' ' + url.pathname);
      if (req.method !== 'GET') { res.statusCode = 405; data = { error: 'Fixture provider mutations disabled' }; }
      else if (url.pathname === '/api/connectors/catalog') data = { configured: true, setup: 'ready', mode: 'self-hosted', source: 'curated', cards: [{ slug: 'gmail', label: 'Gmail', blurb: 'Synthetic fixture only', logo: null, domain: null }] };
      else if (url.pathname === '/api/connectors/connected' || url.pathname === '/api/connectors/status') data = { configured: true, credentialStore: 'ok', services: services() };
      else data = { tools: [], services: services() };
    } else { next(); return; }
    res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(data));
  });
} }], server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: fixture.info.url, ws: true }, '/.well-known/openmausbot/environment': { target: fixture.info.url } } } });
await ui.listen();
console.log(JSON.stringify({ origin: ui.resolvedUrls!.local[0], backend: fixture.info.url, fixture: true, realProviderCalls: false }));
let stopping = false;
async function stop() { if (stopping) return; stopping = true; await ui.close(); embedded.close(); await fixture.close(); process.exit(0); }
process.on('SIGINT', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); });
process.stdin.on('data', chunk => { if (chunk.toString().trim() === 'stop') void stop(); });
