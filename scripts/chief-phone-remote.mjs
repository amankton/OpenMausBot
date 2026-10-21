// Owner-only setup for the development companion. The public tunnel targets
// its per-launch pipe, never the backend or either administration listener.
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCompanionAccountService, DEFAULT_COMPANION_CONTROL_PLANE_URL } from '../electron/companion-account-service.mjs';
import { createControlPlaneClient } from '../electron/control-plane-client.mjs';
import { createManagedCompanionTunnel, managedCompanionTunnelAccess, resolveCloudflaredBinary } from '../electron/managed-companion-tunnel.mjs';
import { openTunnelCredentials } from '../server/tunnel.ts';
import { protectPairingPath } from '../server/chief-pairing-storage.ts';

const PAGE = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Chief · Phone anywhere</title>
<style>body{font:17px/1.55 system-ui;background:#111820;color:#eef4f7;margin:0;padding:32px}main{max-width:650px;margin:auto}h1{line-height:1.2}label{display:block;margin:18px 0 6px}input,button{box-sizing:border-box;font:inherit;border-radius:8px;padding:12px}input{width:100%;background:#202c38;color:inherit;border:1px solid #738392}button{background:#9aefcf;color:#14231d;border:0;cursor:pointer;margin:14px 8px 0 0}button:disabled{opacity:.5;cursor:wait}a{color:#9aefcf}#status{padding:18px;background:#202c38;border-radius:10px;white-space:pre-wrap;overflow-wrap:anywhere}.note{color:#bfccd6}code{overflow-wrap:anywhere}</style>
<main><p>CHIEF EXECUTIVE SUITE</p><h1>Use your phone anywhere</h1><p>Connect to your existing team over cellular or another Wi-Fi network. Keep this computer awake and Chief running.</p>
<p class="note">Secure HTTPS uses MausBot’s account service and an outbound Cloudflare connection. Your phone still needs its pairing permission.</p>
<p id="status" role="status" aria-live="polite">Checking connection…</p>
<form id="request"><label for="email">Email for secure connection setup</label><input id="email" type="email" autocomplete="email" required maxlength="254"><button>Email me a code</button></form>
<form id="verify"><label for="code">Eight-digit email verification code</label><input id="code" type="password" inputmode="numeric" autocomplete="one-time-code" maxlength="8" pattern="[0-9]{8}" required><button>Verify and enable HTTPS</button></form>
<button id="retry" type="button">Retry connection</button><button id="disable" type="button">Disconnect HTTPS</button>
<p><a href="http://127.0.0.1:18911" target="_blank" rel="noreferrer">Phone pairing and device permissions</a></p>
<p class="note">Once HTTPS is ready, open MausBot on your phone while still on home Wi-Fi so it can learn the new address. Then turn Wi-Fi off and test a message over cellular. If needed, enter the HTTPS address on your phone and use a fresh code from the pairing page.</p></main>
<script nonce="__NONCE__">
const token='__TOKEN__';let busy=false;const byId=id=>document.getElementById(id);
function show(s){byId('status').textContent=s.ready?'HTTPS is ready: '+s.endpoint:(s.message||'Connection: '+s.status);}
async function action(path,body){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Chief-Setup':token},body:JSON.stringify(body)});const s=await r.json();if(!r.ok)throw Error(s.error||'Setup failed.');show(s);}catch(e){byId('status').textContent=e.message;}finally{busy=false;byId('code').value='';document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
byId('request').onsubmit=e=>{e.preventDefault();action('/request-code',{email:byId('email').value});};
byId('verify').onsubmit=e=>{e.preventDefault();const code=byId('code').value;byId('code').value='';action('/verify-code',{email:byId('email').value,code});};
byId('retry').onclick=()=>action('/retry',{});
byId('disable').onclick=()=>{if(confirm('Disconnect secure HTTPS? Local phone pairing will stay available.'))action('/disconnect',{});};
async function poll(){if(!busy){try{const r=await fetch('/state');if(r.ok)show(await r.json());}catch{byId('status').textContent='Chief phone connector is unavailable.';}}setTimeout(poll,5000);}poll();
</script></html>`;

export function createPhoneRemoteSetup({ state, requestCode, verifyCode, retry, disconnect }) {
  const token = randomBytes(32).toString('hex');
  const nonce = randomBytes(24).toString('base64');
  let busy = false;
  let lastRequest = 0;
  const server = createServer(async (req, res) => {
    const authority = `127.0.0.1:${server.address()?.port}`;
    const origin = `http://${authority}`;
    const json = (code, value) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('referrer-policy', 'no-referrer');
    if (req.headers.host !== authority || (req.headers.origin && req.headers.origin !== origin) ||
        req.headers['sec-fetch-site'] === 'cross-site' || req.headers.forwarded || req.headers['x-forwarded-for'] || req.headers['x-forwarded-host']) {
      req.resume(); return json(403, { error: 'Open this page directly on this computer.' });
    }
    try {
      if (req.method === 'GET' && req.url === '/') {
        res.setHeader('content-security-policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(PAGE.replaceAll('__TOKEN__', token).replaceAll('__NONCE__', nonce));
      }
      if (req.method === 'GET' && req.url === '/state') return json(200, await state());
      if (req.method !== 'POST' || !['/request-code', '/verify-code', '/retry', '/disconnect'].includes(req.url)) {
        req.resume(); return json(404, { error: 'Not found.' });
      }
      if (req.headers['x-chief-setup'] !== token || req.headers['content-type'] !== 'application/json') {
        req.resume(); return json(403, { error: 'Reload this local setup page.' });
      }
      if (busy) { req.resume(); return json(409, { error: 'Wait for the current request to finish.' }); }
      busy = true;
      try {
        let raw = '';
        for await (const chunk of req) {
          raw += chunk.toString();
          if (Buffer.byteLength(raw) > 2048) return json(413, { error: 'Request too large.' });
        }
        const body = JSON.parse(raw);
        if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'Invalid request.' });
        const keys = Object.keys(body).sort().join(',');
        if (req.url === '/request-code' || req.url === '/verify-code') {
          if (keys !== (req.url === '/request-code' ? 'email' : 'code,email') || typeof body.email !== 'string' ||
              body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) ||
              (req.url === '/verify-code' && (typeof body.code !== 'string' || !/^\d{8}$/.test(body.code)))) return json(400, { error: 'Enter a valid email and, when requested, the eight-digit code.' });
        } else if (keys) return json(400, { error: 'Invalid request.' });
        if (req.url === '/request-code') {
          if (Date.now() - lastRequest < 60000) return json(429, { error: 'Wait one minute before requesting another email.' });
          lastRequest = Date.now();
          await requestCode(body.email);
        } else if (req.url === '/verify-code') await verifyCode(body.email, body.code);
        else if (req.url === '/retry') await retry();
        else await disconnect();
        return json(200, await state());
      } finally { busy = false; }
    } catch { return json(400, { error: 'Secure connection setup could not finish. Check the connection status and try again.' }); }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  return server;
}

export async function startPhoneRemote({ root, directory, controlOrigin, setupPort = 18912 }) {
  const privateDir = join(directory, 'remote-private');
  mkdirSync(privateDir, { recursive: true, mode: 0o700 });
  protectPairingPath(privateDir, true);
  const accountFile = join(privateDir, 'tunnel-account.json');
  if (existsSync(accountFile)) protectPairingPath(accountFile, false);
  const credentials = openTunnelCredentials(privateDir);
  if (credentials.status === 'unavailable') throw Error('Saved remote account is unreadable. It was preserved.');
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  let target = null;
  let current = { status: 'stopped', ready: false };
  let advertised = null;
  let publication = Promise.resolve();
  const publish = () => {
    const owned = target;
    const endpoint = current.ready ? current.endpoint : null;
    publication = publication.catch(() => {}).then(async () => {
      if (!owned || target !== owned) return;
      const state = await (await fetch(controlOrigin + '/state', { signal: AbortSignal.timeout(3000) })).json();
      if (state.pid !== owned.pid) throw Error('Companion identity changed.');
      const response = await fetch(controlOrigin + '/hosted-endpoint', { method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: endpoint }), signal: AbortSignal.timeout(3000) });
      if (!response.ok || target !== owned) throw Error('Companion publication failed.');
      advertised = endpoint;
    });
    return publication;
  };
  const connector = createManagedCompanionTunnel({
    binaryPath: resolveCloudflaredBinary({ isPackaged: false, appPath: root }),
    guardianEntry: join(root, 'electron/managed-companion-guardian-main.mjs'),
    runtimeRoot: join(privateDir, 'connector'),
    onChange: state => { current = state; void publish().catch(() => { advertised = null; }); },
  });
  const activate = async () => {
    const access = managedCompanionTunnelAccess(credentials.read());
    if (target && access) await connector.start({ ...access, originTarget: target });
    await publish();
    return current;
  };
  const stop = async () => { await connector.stop(); await publish(); };
  const service = createCompanionAccountService({
    client: createControlPlaneClient({ baseURL: DEFAULT_COMPANION_CONTROL_PLANE_URL }),
    readCredentials: () => credentials.read(),
    updateCredentials: (derive, afterPersist) => credentials.update(derive, afterPersist),
    identity: { name: 'Chief Development', platform: process.platform === 'win32' ? 'windows' : process.platform, appVersion: version },
    newClientInstanceId: randomUUID,
    activatePersistedEndpoint: activate, stopManagedEndpoint: stop,
    managedConnectionState: () => current, companionIsOn: () => target !== null, autoRecover: true,
    // The service emits only error codes, HTTP status, references and delays.
    log: line => console.log(line),
  });
  const state = async () => {
    const account = await service.state();
    await publish().catch(() => { advertised = null; });
    const ready = Boolean(target && current.ready && advertised);
    return { ...account, ready, endpoint: ready ? advertised : null,
      status: ready ? 'ready' : account.status === 'ready' ? current.status : account.status,
      ...(!target ? { message: 'Waiting for the Chief phone connector.' } : {}) };
  };
  const server = createPhoneRemoteSetup({ state, requestCode: email => service.requestCode(email),
    verifyCode: (email, code) => service.verifyCode(email, code), retry: () => service.retry(), disconnect: () => service.signOut() });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(setupPort, '127.0.0.1', resolve); });
  return {
    async attach(next) { target = next; advertised = null; await activate(); await service.restore(); },
    async detach() { await stop().catch(() => {}); target = null; advertised = null; },
    async close() { service.dispose(); await stop().catch(() => {}); target = null; server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}
