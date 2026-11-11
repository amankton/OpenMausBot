import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createEngine, ACTIONS } from './engine.mjs';
import { defaultHome, verifyPayload } from './core.mjs';

export async function setupServer(engine, { port = 0 } = {}) {
  const token = randomBytes(32).toString('hex'); let origin;
  const sameToken = value => typeof value === 'string' && value.length === token.length && timingSafeEqual(Buffer.from(value), Buffer.from(token));
  const send = (res, status, body, type = 'application/json') => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" }); res.end(type === 'application/json' ? JSON.stringify(body) : body); };
  const server = createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin) || (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))) return send(res, 403, { error: 'Open setup using its local launch address' });
      const path = new URL(req.url, origin).pathname;
      const cookie = /(?:^|;\s*)chief_setup=([^;]+)/.exec(req.headers.cookie || '')?.[1];
      if (req.method === 'POST' && path === '/api/session' && req.headers.origin === origin && req.headers['content-type'] === 'application/json' && !server.claimed) {
        let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 512) return send(res, 413, { error: 'Invalid launch' }); }
        if (!sameToken(JSON.parse(text).capability)) return send(res, 403, { error: 'Invalid launch' });
        server.claimed = true; res.setHeader('Set-Cookie', `chief_setup=${token}; HttpOnly; SameSite=Strict; Path=/`); return send(res, 200, { authorized: true });
      }
      if (req.method === 'GET' && path === '/') {
        return send(res, 200, await readFile(new URL('./web/index.html', import.meta.url)), 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && ['/setup.js', '/setup.css'].includes(path)) return send(res, 200, await readFile(new URL('./web' + path, import.meta.url)), path.endsWith('.js') ? 'text/javascript' : 'text/css');
      if (!sameToken(cookie)) return send(res, 403, { error: 'Setup session missing or expired' });
      if (req.method === 'GET' && path === '/api/status') return send(res, 200, await engine.status());
      if (req.method === 'GET' && path === '/api/catalog') return send(res, 200, { agents: engine.catalog.agents.map(({ id, name, title, description, division }) => ({ id, name, title, description, division })) });
      if (req.method !== 'POST' || req.headers.origin !== origin || req.headers['content-type']?.split(';')[0] !== 'application/json' || req.headers['x-chief-setup'] !== '1') return send(res, 403, { error: 'Same-origin setup action required' });
      let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 32000) return send(res, 413, { error: 'Setup request too large' }); }
      const value = JSON.parse(body || '{}');
      if (path === '/api/selection') { await engine.select(value.selected, value.roles); return send(res, 200, { saved: true }); }
      if (path === '/api/connect') { await engine.connectAi(); return send(res, 200, { message: 'Complete sign-in in the local terminal, then click Apply AI connection here.' }); }
      if (path === '/api/install') {
        if (engine.runningAction) return send(res, 409, { error: 'An installation action is already running' });
        engine.runningAction = true;
        void engine.install({ startup: value.startup !== false }).catch(() => {}).finally(() => { engine.runningAction = false; });
        return send(res, 202, { started: true, message: 'Setup is running. It pauses at a native permission, installer completion or failed step. Use this same button to resume.' });
      }
      if (path.startsWith('/api/action/') && ACTIONS.includes(path.slice(12))) {
        if (engine.runningAction) return send(res, 409, { error: 'An installation action is already running' });
        engine.runningAction = true;
        void engine.action(path.slice(12)).catch(() => {}).finally(() => { engine.runningAction = false; });
        return send(res, 202, { started: true });
      }
      return send(res, 404, { error: 'Unknown setup action' });
    } catch (error) { return send(res, 400, { error: error instanceof SyntaxError ? 'Invalid setup request' : error.message }); }
  });
  await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin, launchUrl: origin + '/#' + token, async close() { await new Promise(done => server.close(done)); await engine.close(); } };
}
async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), bundle = resolve(root, '..');
  const manifest = JSON.parse(await readFile(join(bundle, 'TRANSFER-MANIFEST.json'), 'utf8'));
  console.log('Checking transfer integrity…'); await verifyPayload(bundle, manifest);
  const engine = await createEngine({ root, home: defaultHome() });
  const ui = await setupServer(engine);
  console.log(`Chief setup: ${ui.origin}\nThe browser opens with a private one-use launch. Keep this terminal open while installing.`);
  if (!process.argv.includes('--no-open')) {
    const command = process.platform === 'darwin' ? '/usr/bin/open' : 'rundll32.exe';
    const args = process.platform === 'darwin' ? [ui.launchUrl] : ['url.dll,FileProtocolHandler', ui.launchUrl];
    spawn(command, args, { windowsHide: true, stdio: 'ignore' }).unref();
  } else console.log(ui.launchUrl);
  const close = async () => { if ((await engine.status()).busy) { console.log('Wait for the active install step to finish before closing setup.'); return; } await ui.close(); process.exit(0); };
  process.on('SIGINT', close); process.on('SIGTERM', close);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
