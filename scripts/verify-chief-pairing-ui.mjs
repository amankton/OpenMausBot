// Isolated UI fixture: actual component, synthetic records, no owner credentials.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../', import.meta.url));
const source = join(root, '.chief-local/platform-source');
const require = createRequire(join(source, 'packages/ui/package.json'));
const svelte = require('svelte/compiler'), preprocess = require('svelte-preprocess');
const component = join(source, 'plugins/setting-resources/src/components/integrations/ChiefPairing.svelte');
const connections = [
  { id: 'synthetic-pending', bots: ['test-agent-1', 'test-agent-2'], scopes: ['workspace:read','tracker:read','tracker:write'], state: 'pending', expiresAt: new Date(Date.now()+3600000).toISOString(), keyFingerprint: 'a'.repeat(64) },
  { id: 'synthetic-read-only', bots: ['test-agent-1'], scopes: ['workspace:read'], state: 'active', expiresAt: new Date(Date.now()+3600000).toISOString(), keyFingerprint: 'b'.repeat(64) },
  { id: 'synthetic-expired', bots: ['test-agent-1'], scopes: ['workspace:read'], state: 'pending', expiresAt: '2026-01-01T00:00:00.000Z', keyFingerprint: 'c'.repeat(64) }
];
const actions = [];
const result = await build({ stdin: { contents: `import Component from ${JSON.stringify(component)};new Component({target:document.querySelector('#app')});`, loader: 'ts', resolveDir: root }, bundle: true, write: false, format: 'esm', platform: 'browser', plugins: [{ name: 'synthetic-pairing', setup(builder) {
  builder.onResolve({filter:/^@hcengineering\/(platform|presentation)$/},()=>({path:'platform',namespace:'fixture'}));
  builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export function getMetadata(){return 'synthetic-ui-only'};export function rememberChiefSession(){};export async function withChiefSessionLock(fn){return fn()};export default {metadata:{Token:'fixture'}};`,loader:'js'}));
  builder.onResolve({filter:/^svelte(?:\/.*)?$/},args=>({path:require.resolve(args.path,{conditions:new Set(['browser','import','default'])})}));
  builder.onLoad({filter:/\.svelte$/},async args=>{const input=await svelte.preprocess(await readFile(args.path,'utf8'),preprocess(),{filename:args.path});return {contents:svelte.compile(input.code,{filename:args.path,css:'injected'}).js.code,loader:'js',resolveDir:source};});
} }] });
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  const json=value=>{res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  if(path==='/chief/v1/status')return json({enabled:true});
  if(path==='/chief/v1/connections')return json({connections});
  if(path==='/chief/v1/connections/synthetic-pending/confirm'&&req.method==='POST'){connections[0].state='active';actions.push('approved-synthetic');return json({});}
  if(path.startsWith('/chief/')){res.writeHead(403).end();return;}
  if(path==='/fixture.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(result.outputFiles[0].text);return;}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chief connection — synthetic UI verification</title><style>body{margin:0;background:#151a21;color:#eee;font:14px system-ui}main{max-width:800px;margin:auto}h1{margin:24px;font-size:18px}</style></head><body><main><h1>Synthetic UI verification · no live access</h1><div id="app"></div></main><script type="module" src="/fixture.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const evidence=join(root,'.chief-local/m1-pairing/pairing-ui');await mkdir(evidence,{recursive:true});
await writeFile(join(evidence,'fixture.json'),JSON.stringify({url:'http://127.0.0.1:'+server.address().port,pid:process.pid}));
console.log(JSON.stringify({url:'http://127.0.0.1:'+server.address().port,pid:process.pid,syntheticOnly:true}));
process.on('SIGINT',()=>server.close());
