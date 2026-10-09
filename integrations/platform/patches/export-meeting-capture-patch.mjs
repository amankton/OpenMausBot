// Additive export over frozen patches0001–0004, with exact pre-edit baselines.
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,mkdtempSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const directory=join(root,'integrations/platform/patches'), source=join(root,'.chief-local/platform-source');
const baseline=join(root,'.chief-local/capture-baseline');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const ui=JSON.parse(readFileSync(join(baseline,'ui-manifest.json'),'utf8'));
const backend=JSON.parse(readFileSync(join(baseline,'backend/baseline.json'),'utf8'));
const prior=JSON.parse(readFileSync(join(directory,'raw-recording-provenance.json'),'utf8'));
const frozen={...prior.previousPatches,'0004-bounded-raw-recording.patch':prior.patchSha256};
for(const [name,expected] of Object.entries(frozen))if(hash(readFileSync(join(directory,name)))!==expected)throw Error('Frozen patch changed: '+name);
const inputs=[...Object.entries(ui).map(([file,beforeSha256])=>({file,beforeSha256,baseline:join(baseline,file)})),
 ...backend.files.map(({path:file,sha256:beforeSha256})=>({file,beforeSha256,baseline:join(baseline,'backend',file.split('/').at(-1))})),
 ...['services/love/src/capture.ts','services/love/src/captureRoutes.ts',
 'plugins/love-resources/src/capture-client.ts','plugins/love-resources/src/capture-state.ts','plugins/love-resources/src/capture-export.ts',
 'plugins/love-resources/src/components/CapturePanel.svelte','plugins/love-resources/src/components/CaptureNotice.svelte'].map(file=>({file,beforeSha256:null}))];
const temp=mkdtempSync(join(root,'.chief-local/capture-patch-export-'));
mkdirSync(join(temp,'old'));mkdirSync(join(temp,'new'));
for(const input of inputs){
 if(!/^[\w./-]+$/.test(input.file)||input.file.split('/').includes('..'))throw Error('Invalid source path');
 const target=join(temp,'new',input.file);mkdirSync(dirname(target),{recursive:true});copyFileSync(join(source,input.file),target);
 input.sha256=hash(readFileSync(target));
 if(input.baseline){const bytes=readFileSync(input.baseline);if(hash(bytes)!==input.beforeSha256)throw Error('Baseline changed: '+input.file);const old=join(temp,'old',input.file);mkdirSync(dirname(old),{recursive:true});writeFileSync(old,bytes);}
}
const diff=spawnSync('git',['-c','core.autocrlf=false','diff','--no-index','--no-ext-diff','--','old','new'],{cwd:temp,encoding:'utf8',maxBuffer:8*1024*1024});
if(diff.status!==1)throw Error('Expected additive capture diff');
const patch=diff.stdout.replaceAll('a/old/','a/').replaceAll('b/new/','b/').replaceAll('a/new/','a/');
const name='0005-consented-meeting-capture.patch';
writeFileSync(join(directory,name),patch);
const receipt={sourceRevision:prior.sourceRevision,createdAt:new Date().toISOString(),patch:name,patchSha256:hash(patch),previousPatches:frozen,
 inputs:inputs.map(({file,beforeSha256,sha256})=>({file,beforeSha256,sha256})),deployed:false};
writeFileSync(join(directory,'meeting-capture-provenance.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({patch:name,sha256:receipt.patchSha256,files:inputs.length}));
