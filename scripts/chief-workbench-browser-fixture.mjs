// Full built workbench in an isolated browser origin; synthetic members only.
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, resolve, sep, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { createLifecycleServer } from '../integrations/platform/lifecycle/http.mjs';
import { ChiefPairingRuntime } from '../server/chief-pairing.ts';

export async function runWorkbenchBrowserFixture({ root, pairing, tokens }) {
  const directory = join(root, '.chief-local/m1-pairing/workbench-browser');
  await mkdir(directory, { recursive: true });
  const buildBytes = await readFile(join(root, '.chief-local/platform-build-logs/production-build-receipt.json'));
  const build = JSON.parse(buildBytes), hash = b => createHash('sha256').update(b).digest('hex');
  assert.equal(build.productionConfigurationsPassed, 2);
  const states = await Promise.all(['acceptance-state.json', 'acceptance-partner-state.json'].map(async name => {
    const state = JSON.parse(await readFile(join(root, '.chief-local/platform', name), 'utf8'));
    assert.ok(!JSON.stringify(state).includes('chiefexecutivesuite')); return state;
  }));
  const config = await (await fetch('http://localhost:18087/config.json')).json();
  const dist = join(root, '.chief-local/platform-source/dev/prod/dist');
  const publicDir = join(root, '.chief-local/platform-source/dev/prod/public');
  const events = [], served = new Set(); let origin, runtime, outage = false, stop = false;
  const server = createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(origin).host) { res.writeHead(403).end(); return; }
      const url = new URL(req.url, origin), path = url.pathname;
      if (/chiefexecutivesuite/i.test(decodeURIComponent(req.url))) { res.writeHead(403).end(); return; }
      if (path.startsWith('/chief/v1/')) {
        events.push({ at: new Date().toISOString(), method: req.method, path });
        if (outage) { res.writeHead(503).end('{}'); return; }
        lifecycle.emit('request', req, res); return;
      }
      const json = value => { res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(value)); };
      if (path === '/fixture/state') { json({ outage, connections: runtime.list(), events }); return; }
      if (path === '/fixture/stop' && req.method === 'POST') { stop = true; json({ stopped: true }); return; }
      if (path === '/fixture/outage' && req.method === 'POST') { outage = !outage; json({ outage }); return; }
      if (path === '/fixture/pair' && req.method === 'POST') {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks));
        json(await runtime.pair(body.invitation, [body.bot])); return;
      }
      if (path === '/fixture/check' && req.method === 'POST') {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        try { json({ authorized: true, connection: await runtime.check(JSON.parse(Buffer.concat(chunks)).id) }); }
        catch (error) { res.statusCode = error.status ?? 503; json({ authorized: false }); } return;
      }
      const member = /^\/fixture\/member\/([01])$/.exec(path);
      if (member) {
        const state = states[Number(member[1])];
        res.setHeader('Set-Cookie', state.cookies.map(c => `${c.name}=${c.value}; Path=${c.path}; HttpOnly; Secure; SameSite=None; Partitioned`));
        json(state.origins[0].localStorage.map(({name, value}) => ({ name, value: value.replaceAll('localhost:18087', new URL(origin).host) }))); return;
      }
      if (path === '/fixture') {
        res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><title>Chief workbench acceptance</title><h1>Synthetic workspace acceptance</h1><button onclick="select(0)">Open test member 1</button><button onclick="select(1)">Open test member 2</button><p>Each button opens the actual compiled workbench. Owner data is excluded.</p><script>async function select(i){const rows=await(await fetch('/fixture/member/'+i)).json();for(const row of rows)localStorage.setItem(row.name,row.value);location.href='/workbench/chiefacceptance/setting/integrations'}</script>`); return;
      }
      if (path === '/config.json') { json(JSON.parse(JSON.stringify(config).replaceAll('localhost:18087', new URL(origin).host))); return; }
      if (req.method === 'GET' && !path.startsWith('/_') && !path.startsWith('/files')) {
        const asset = path === '/' || path.startsWith('/workbench/') || path.startsWith('/login') ? 'index.html' : decodeURIComponent(path).slice(1);
        for (const base of [dist, publicDir]) {
          const file = resolve(base, asset);
          if (!file.startsWith(base + sep) || !(await stat(file).catch(() => null))?.isFile()) continue;
          const bytes = await readFile(file);
          if (base === dist) { assert.equal(hash(bytes), build.assets[asset]?.sha256); served.add(asset); }
          const mime = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.wasm':'application/wasm', '.woff2':'font/woff2' }[extname(file)] ?? 'application/octet-stream';
          res.setHeader('Content-Type', mime); res.setHeader('Cache-Control','no-store'); res.end(bytes); return;
        }
      }
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const upstream = await fetch('http://localhost:18087' + req.url, { method: req.method,
        headers: { ...req.headers, host: 'localhost:18087', origin: 'http://localhost:18087', 'accept-encoding':'identity' },
        ...(body.length ? { body } : {}), redirect:'manual', signal:AbortSignal.timeout(15000) });
      res.statusCode = upstream.status;
      for (const [k,v] of upstream.headers) if (!['content-length','content-encoding','transfer-encoding','set-cookie'].includes(k)) res.setHeader(k,v);
      const cookies = upstream.headers.getSetCookie();
      if (cookies.length) res.setHeader('Set-Cookie', cookies.map(c=>c.replace(/;\s*Domain=[^;]+/gi,'').replace(/;\s*SameSite=[^;]+/gi,'') + '; Secure; SameSite=None; Partitioned'));
      const bytes = Buffer.from(await upstream.arrayBuffer());
      res.end(upstream.headers.get('content-type')?.includes('application/json') ? bytes.toString().replaceAll('localhost:18087',new URL(origin).host) : bytes);
    } catch { if (!res.headersSent) res.writeHead(503); res.end('Fixture unavailable'); }
  });
  server.on('upgrade', (req, socket, head) => {
    if (req.headers.host !== new URL(origin).host || !req.url.startsWith('/_transactor/') && !req.url.startsWith('/_collaborator/')) { socket.destroy(); return; }
    // Only tokens already authenticated as the synthetic members may open a socket.
    if (!tokens.slice(0,2).some(token => req.url.includes(token))) { socket.destroy(); return; }
    const proxy = httpRequest({ hostname:'localhost',port:18087,path:req.url,headers:{...req.headers,host:'localhost:18087',origin:'http://localhost:18087'} });
    proxy.on('upgrade',(response,remote,remoteHead)=>{ socket.write('HTTP/1.1 101 Switching Protocols\r\n'+Object.entries(response.headers).map(([k,v])=>k+': '+v).join('\r\n')+'\r\n\r\n'); if(remoteHead.length)socket.write(remoteHead);if(head.length)remote.write(head);socket.pipe(remote).pipe(socket);remote.on('error',()=>socket.destroy());socket.on('error',()=>remote.destroy()); });
    proxy.on('error',()=>socket.destroy()); proxy.end();
  });
  await new Promise(r=>server.listen(0,'127.0.0.2',r)); origin='http://127.0.0.2:'+server.address().port;
  const lifecycle = createLifecycleServer({ pairing, origin });
  runtime = new ChiefPairingRuntime({directory:join(directory,'runtime-'+server.address().port),origin,hasBot:id=>['synthetic-specialist-0','synthetic-specialist-1'].includes(id)});
  await writeFile(join(directory,'running.json'),JSON.stringify({origin,buildReceiptSha256:hash(buildBytes)}));
  console.log(JSON.stringify({workbenchFixture:origin+'/fixture',scope:'Full compiled native workbench; synthetic existing Accounts identities; legacy Accounts epoch enforcement excluded here and covered by separate container suite'}));
  try { while(!stop) await new Promise(r=>setTimeout(r,500)); }
  finally { await writeFile(join(directory,'observations.json'),JSON.stringify({buildReceiptSha256:hash(buildBytes),served:[...served],events},null,2));server.closeAllConnections();await new Promise(r=>server.close(r)); }
}
