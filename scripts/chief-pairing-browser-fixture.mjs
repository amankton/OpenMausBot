// Compiles the actual pairing components into an isolated browser harness.
// Only the synthetic acceptance members are exposed; never use owner state.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';
import { createLifecycleServer } from '../integrations/platform/lifecycle/http.mjs';
import { createChiefPairingRoutes } from '../server/routes/chief-pairing.ts';
import { json, readBody } from '../server/harness/http.ts';

export async function runPairingBrowserFixture({ root, pairing, tokens }) {
  const directory = await mkdtemp(join(root, '.chief-local/m1-pairing/browser-'));
  const source = join(root, '.chief-local/platform-source');
  const require = createRequire(join(source, 'packages/ui/package.json'));
  const svelte = require('svelte/compiler'), preprocess = require('svelte-preprocess');
  const sessionPath = join(source, 'packages/presentation/src/chief-session.ts');
  const componentPath = join(source, 'plugins/setting-resources/src/components/integrations/ChiefPairing.svelte');
  let activeLifecycle;
  const bundles = new Map();
  const send = (res, type, body) => { res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
  const child = createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(childOrigin).host) { res.writeHead(403).end(); return; }
      const path = new URL(req.url, childOrigin).pathname;
      if (path.startsWith('/chief/v1/')) { activeLifecycle.emit('request', req, res); return; }
      if (path === '/fixture.js') { send(res, 'text/javascript', bundles.get('workspace')); return; }
      const session = /^\/fixture-session\/([01])$/.exec(path);
      if (session) { json(res, 200, { token: tokens[Number(session[1])] }); return; }
      send(res, 'text/html', `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{background:#151a21;color:#eee;font:14px system-ui;margin:0}nav{padding:16px;display:flex;gap:12px}button{padding:8px}</style></head><body><nav><button id="member0">Test member 1</button><button id="member1">Test member 2</button><button id="logout">Sign out test member</button></nav><p id="identity"></p><p id="fixture-error" role="alert"></p><div id="app"></div><script type="module" src="/fixture.js"></script></body></html>`);
    } catch { res.writeHead(503).end('Fixture request failed'); }
  });
  await new Promise(resolve => child.listen(0, '127.0.0.1', resolve));
  const childOrigin = 'http://localhost:' + child.address().port;
  activeLifecycle = createLifecycleServer({ pairing, origin: childOrigin });
  const routes = createChiefPairingRoutes({ directory: join(directory, 'runtime'), origin: childOrigin, localOnly: true,
    bots: () => [{ id: 'synthetic-specialist-0', name: 'Test specialist 1' }, { id: 'synthetic-specialist-1', name: 'Test specialist 2' }] });
  const host = createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(hostOrigin).host) { res.writeHead(403).end(); return; }
      const url = new URL(req.url, hostOrigin), path = url.pathname;
      if (path.startsWith('/api/chief-pairing')) {
        await routes({ req, res, url, path, method: req.method, auth: { kind: 'loopback', scopes: ['admin'] }, json, readBody }); return;
      }
      if (path === '/fixture.js') { send(res, 'text/javascript', bundles.get('personal')); return; }
      send(res, 'text/html', `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{background:#10151c;color:#eee;font:14px system-ui;margin:0}main{display:grid;grid-template-columns:minmax(280px,380px) 1fr;min-height:100vh}#personal{padding:18px;border-right:1px solid #555}textarea{display:block;width:100%;min-height:100px}code{display:block;overflow-wrap:anywhere}button{margin:8px 6px 8px 0;padding:8px}label{display:block;margin:8px 0}iframe{width:100%;height:100vh;border:0}p{line-height:1.5}@media(max-width:600px){main{display:block}iframe{height:800px}}</style></head><body><main><div id="personal"></div><iframe title="Synthetic Chief workspace" src="${childOrigin}" sandbox="allow-scripts allow-same-origin allow-forms" allow="local-network ${childOrigin}; loopback-network ${childOrigin}"></iframe></main><script type="module" src="/fixture.js"></script></body></html>`);
    } catch { res.writeHead(503).end('Fixture request failed'); }
  });
  await new Promise(resolve => host.listen(0, '127.0.0.1', resolve));
  const hostOrigin = 'http://127.0.0.1:' + host.address().port;
  try {
    const platform = `let token; export function getMetadata(){return token} export default {metadata:{Token:'fixture'}}; export * from ${JSON.stringify(sessionPath)}; export async function changeMember(index){const r=await fetch('/fixture-session/'+index);return (await r.json()).token} export function setToken(value){token=value}`;
    const workspaceEntry = `import Component from ${JSON.stringify(componentPath)}; import {changeMember,setToken,reconcileChiefSession,revokeChiefSession} from 'fixture-platform'; let app; async function select(index){try{const token=await changeMember(index);await reconcileChiefSession(token);setToken(token);app?.$destroy();app=new Component({target:document.querySelector('#app')});document.querySelector('#identity').textContent='Synthetic member '+(index+1);document.querySelector('#fixture-error').textContent=''}catch{document.querySelector('#fixture-error').textContent='Session transition failed'}} document.querySelector('#member0').onclick=()=>select(0);document.querySelector('#member1').onclick=()=>select(1);document.querySelector('#logout').onclick=async()=>{try{await revokeChiefSession();setToken(undefined);app?.$destroy();app=undefined;document.querySelector('#identity').textContent='Signed out'}catch{document.querySelector('#fixture-error').textContent='Sign out failed'}};void select(0);`;
    const result = await build({ stdin: { contents: workspaceEntry, loader: 'ts', resolveDir: root }, bundle: true, write: false, format: 'esm', platform: 'browser', plugins: [{ name: 'native-pairing-fixture', setup(builder) {
      builder.onResolve({ filter: /^(@hcengineering\/platform|@hcengineering\/presentation|fixture-platform)$/ }, () => ({ path: 'fixture-platform', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: platform, loader: 'ts', resolveDir: root }));
      builder.onResolve({ filter: /^svelte(?:\/.*)?$/ }, args => ({ path: require.resolve(args.path, { conditions: new Set(['browser', 'import', 'default']) }) }));
      builder.onLoad({ filter: /\.svelte$/ }, async args => {
        const input = await svelte.preprocess(await readFile(args.path, 'utf8'), preprocess(), { filename: args.path });
        return { contents: svelte.compile(input.code, { filename: args.path, css: 'injected' }).js.code, loader: 'js' };
      });
    } }] });
    bundles.set('workspace', result.outputFiles[0].text);
    const personal = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{ChiefPairingPanel}from'./src/components/ChiefPairingPanel';createRoot(document.querySelector('#personal')).render(React.createElement(ChiefPairingPanel));`, resolveDir: root, loader: 'tsx' }, bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', plugins: [{ name: 'personal-api', setup(builder) {
      builder.onResolve({ filter: /^@\/state\/store$/ }, () => ({ path: 'api', namespace: 'fixture-api' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture-api' }, () => ({ contents: `export async function api(path,init={}){const r=await fetch(path,{...init,headers:{'Content-Type':'application/json',...init.headers}});const value=await r.json();if(!r.ok)throw new Error(value.error);return value}` }));
    } }] });
    bundles.set('personal', personal.outputFiles[0].text);
    const stopFile = join(directory, 'stop');
    await writeFile(join(root, '.chief-local/m1-pairing/browser-current.json'), JSON.stringify({ url: hostOrigin, childOrigin, directory, stopFile }));
    console.log(JSON.stringify({ browserFixtureReady: true, url: hostOrigin, childOrigin, stopFile, components: 'Actual Svelte and React pairing components; fixture login controls and API transport' }));
    for (;;) { try { await access(stopFile); break; } catch { await new Promise(resolve => setTimeout(resolve, 1000)); } }
  } finally {
    await Promise.all([new Promise(resolve => host.close(resolve)), new Promise(resolve => child.close(resolve))]);
  }
}
