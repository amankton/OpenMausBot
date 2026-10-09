// Isolated real Chief host + compiled native ChiefBrand component. The work
// content is synthetic; this is not deployed Platform acceptance.
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createServer as createViteServer } from "vite";
import { launchVerificationServer } from "./control-omb.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = join(root, ".chief-local/platform-source");
const require = createRequire(join(source, "packages/ui/package.json"));
const { compile, preprocess } = require("svelte/compiler");
const preprocessor = require("svelte-preprocess");
const esbuild = require("esbuild");
const filename = join(source, "packages/ui/src/components/internal/ChiefBrand.svelte");
const input = await preprocess(await readFile(filename, "utf8"), preprocessor(), { filename });
const compiled = compile(input.code, { filename, css: "injected" });
const bundle = await esbuild.build({ stdin: { contents: compiled.js.code, resolveDir: join(source, "packages/ui") }, bundle: true, write: false, format: "iife", globalName: "ChiefBrand", conditions: ["svelte", "browser"], platform: "browser" });
const avatar = await readFile(join(root, "public/brand/chief-avatar-ink.svg"));
let available = true;
const synthetic = createServer((req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.url === "/config.json") { res.writeHead(available ? 200 : 503, { "Content-Type": "application/json" }); res.end("{}"); return; }
  if (req.url === "/chief/avatar.svg") { res.writeHead(200, { "Content-Type": "image/svg+xml" }); res.end(avatar); return; }
  if (req.url === "/brand.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); res.end(bundle.outputFiles[0].text); return; }
  if (req.url === "/availability/off") { available = false; res.end("Fixture unavailable"); return; }
  if (req.url === "/availability/on") { available = true; res.end("Fixture available"); return; }
  res.writeHead(200, { "Content-Type": "text/html;charset=utf-8" });
  res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chief Executive Suite</title>
    <style>*{box-sizing:border-box}body{margin:0;font:14px system-ui;color:#222;background:#f8f9fc}.bar{height:36px;display:flex;align-items:center;padding:0 16px;gap:16px;background:#fff;border-bottom:1px solid #ddd}.bar p{margin-left:auto;font-size:12px}.content{padding:28px;max-width:850px}h1{font-size:28px}textarea{display:block;min-height:160px;width:100%;padding:16px;border:1px solid #ddd;border-radius:8px;font:inherit}button{padding:8px 12px;border:1px solid #ddd;border-radius:6px;background:white;margin:8px 8px 8px 0}.note{color:#64748b;line-height:1.5}</style></head>
    <body><header class="bar"><div id="chief"></div><p>Shared workspace</p></header><main class="content"><p class="note">ISOLATED PREVIEW</p><h1>Your workspace, with room to work.</h1><p class="note">Real Chief host and compiled Chief top-bar component. This sample work surface contains no owner data.</p><label>Draft note<textarea placeholder="An unsaved draft stays here during a connection check."></textarea></label><button id="interact">Test interaction</button><output id="count">0</output><button id="bad-slot">Test invalid slot</button><button id="escape">Test top navigation</button><output id="escape-status"></output></main>
    <script src="/brand.js"></script><script>new ChiefBrand.default({target:document.getElementById('chief')});document.getElementById('interact').onclick=()=>document.getElementById('count').textContent=String(Number(document.getElementById('count').textContent)+1);document.getElementById('bad-slot').onclick=()=>parent.postMessage({type:'chief:workspace:slot',rect:{x:0,y:0,width:9999,height:9999}},'*');document.getElementById('escape').onclick=()=>{try{top.location.href=location.origin+'/escape';document.getElementById('escape-status').textContent='requested'}catch{document.getElementById('escape-status').textContent='blocked'}};</script></body></html>`);
});
await new Promise<void>(resolve => synthetic.listen(0, "127.0.0.1", resolve));
const address = synthetic.address();
if (!address || typeof address === "string") throw Error("No fixture port");
const platformUrl = `http://localhost:${address.port}/`;
const fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, undefined, [], undefined, { platformUrl });
let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;
try {
const prepare = await fetch(`${fixture.info.url}/api/config`, { method: "PUT", headers: { "content-type": "application/json", origin: fixture.info.url }, body: JSON.stringify({ onboarding: { completedAt: new Date().toISOString(), version: 1, reelSeen: true, hintsSeen: [] }, profile: { name: "Branding verifier", email: "fixture@example.test" } }) });
if (!prepare.ok) throw Error("Could not prepare isolated fixture");
vite = await createViteServer({ root, logLevel: "error", server: { host: "127.0.0.1", port: 0, proxy: { "/api": { target: fixture.info.url, ws: true } } } });
await vite.listen();
const preview = { url: new URL("workspace", vite.resolvedUrls!.local[0]).href, platformUrl, fixture: fixture.info, scope: "Synthetic content; compiled ChiefBrand component; real isolated Chief host" };
await mkdir(join(root, "work"), { recursive: true });
await writeFile(join(root, "work/chief-branding-preview.json"), JSON.stringify(preview, null, 2));
console.log(JSON.stringify(preview));
let closing = false;
const close = async () => { if (closing) return; closing = true; await vite?.close(); synthetic.close(); await fixture.close(); process.exit(0); };
process.on("SIGINT", () => { void close(); });
process.on("SIGTERM", () => { void close(); });
} catch (error) {
  await vite?.close();
  synthetic.close();
  await fixture.close();
  throw error;
}
