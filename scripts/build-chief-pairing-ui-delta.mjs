// Scoped UI-only image: inherit the accepted runtime/assets, replace only the
// settings chunk plus its exact hash references. No media or auth code rebuild.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { ROOT, dockerEnvironment } from './configure-chief-platform.mjs';
import { verifyFrontendPatchStack } from '../integrations/platform/patches/verify-frontend-patch-stack.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const local=join(ROOT,'.chief-local/platform'), proof=join(ROOT,'.chief-local/m1-pairing/pairing-ui');
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const baselineBytes=await readFile(join(proof,'production-build-before.json'));
const baseline=JSON.parse(baselineBytes), previous=await json(join(local,'front-image.json'));
assert.equal(previous.webpackReceiptSha256,hash(baselineBytes));
const buildBytes=await readFile(join(ROOT,'.chief-local/platform-build-logs/production-build-receipt.json'));
const build=JSON.parse(buildBytes), browser=await json(join(proof,'browser-receipt.json'));
const component='plugins/setting-resources/src/components/integrations/ChiefPairing.svelte';
assert.equal(build.productionConfigurationsPassed,2);assert.equal(browser.passed,true);assert.equal(browser.syntheticOnly,true);
assert.equal(browser.sourceSha256,build.inputs[component]);
assert.deepEqual(Object.keys(build.inputs).sort(),Object.keys(baseline.inputs).sort());
assert.deepEqual(Object.keys(build.inputs).filter(k=>build.inputs[k]!==baseline.inputs[k]),[component]);
assert.deepEqual(build.buildRecipe,baseline.buildRecipe);
const changed=Object.keys(build.assets).filter(k=>build.assets[k].sha256!==baseline.assets[k]?.sha256);
assert.equal(changed.length,6);
const chunk=changed.find(k=>/^37731\.[a-f0-9]+\.js$/.test(k));
const bundle=changed.find(k=>/^bundle\.[a-f0-9]+\.js$/.test(k));assert.ok(chunk&&bundle);
assert.deepEqual(new Set(changed),new Set([chunk,chunk+'.gz',bundle,bundle+'.gz','index.html','index.html.gz']));
const oldChunk=Object.keys(baseline.assets).find(k=>/^37731\.[a-f0-9]+\.js$/.test(k));
const oldBundle=Object.keys(baseline.assets).find(k=>/^bundle\.[a-f0-9]+\.js$/.test(k));
const dist=join(ROOT,'.chief-local/platform-source/dev/prod/dist');
assert.equal((await readFile(join(dist,bundle),'utf8')).replaceAll(chunk.split('.')[1],oldChunk.split('.')[1]),await readFile(join(dist,oldBundle),'utf8'));
// The baseline index is taken from the immutable deployed image below.
const docker=args=>execFileSync('docker',args,{env:dockerEnvironment(),encoding:'utf8',windowsHide:true,timeout:180000,stdio:['ignore','pipe','pipe']}).trim();
assert.equal(docker(['inspect','chief-platform-front-1','--format','{{.Image}}']),previous.image);
const stack=await verifyFrontendPatchStack();
const context=await mkdtemp(join(ROOT,'.chief-local/pairing-ui-image-'));
const copy=async(from,to)=>{await mkdir(dirname(to),{recursive:true});await copyFile(from,to);};
const snapshot=docker(['create','--network','none',previous.image]);
try{docker(['cp',snapshot+':/app/dist/index.html',join(context,'index.before.html')]);}
finally{docker(['rm',snapshot]);}
assert.equal(hash(await readFile(join(context,'index.before.html'))),baseline.assets['index.html'].sha256);
assert.equal((await readFile(join(dist,'index.html'),'utf8')).replaceAll(bundle,oldBundle),await readFile(join(context,'index.before.html'),'utf8'));
for(const name of changed){const bytes=await readFile(join(dist,name));assert.equal(hash(bytes),build.assets[name].sha256);await copy(join(dist,name),join(context,'dist',name));}
for(const name of ['0012-chief-member-pairing.patch','chief-member-pairing-provenance.json'])await copy(join(ROOT,'integrations/platform/patches',name),join(context,'source-notice',name));
await copy(join(proof,'browser-receipt.json'),join(context,'source-notice/pairing-ui-browser.json'));
await writeFile(join(context,'source-notice/pairing-ui-build.json'),buildBytes);
const baseTag='chief-platform-front:pairing-base-'+previous.image.slice(7,19);
docker(['tag',previous.image,baseTag]);assert.equal(docker(['image','inspect',baseTag,'--format','{{.Id}}']),previous.image);
await writeFile(join(context,'Dockerfile'),`FROM ${baseTag}\nCOPY dist/ /app/dist/\nCOPY source-notice/ /usr/share/doc/chief-platform-source/\n`);
await writeFile(join(context,'.dockerignore'),'*\n!Dockerfile\n!dist/\n!dist/**\n!source-notice/\n!source-notice/**\n');
const tag='chief-platform-front:pairing-ui-'+Date.now();
docker(['build','--pull=false','--network=none','--iidfile',join(context,'image-id'),'--tag',tag,context]);
const image=(await readFile(join(context,'image-id'),'utf8')).trim();assert.match(image,/^sha256:[a-f0-9]{64}$/);
const receipt={...previous,image,tag,builtAt:new Date().toISOString(),webpackReceiptSha256:hash(buildBytes),patchHashes:stack.patchHashes,patchStack:stack,
  scopedUiUpdate:{baselineImage:previous.image,baselineBuildReceiptSha256:hash(baselineBytes),changedInputs:[component],changedAssets:changed,browser,
    unchangedFeatureEvidence:'Prior media/capture/template checks are inherited for byte-identical assets, not claimed as freshly rerun.',serverBundle:'Unchanged',oldContentHashedAssetsRetained:true},deploymentChanged:false};
await writeFile(join(proof,'front-image.before.json'),JSON.stringify(previous,null,2));
await writeFile(join(local,'front-image.json'),JSON.stringify(receipt,null,2));
console.log(JSON.stringify({image,tag,changedAssets:changed,inheritedBaseline:previous.image}));
