// Add the Card-body action wiring over the frozen accepted capture release.
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const directory=join(root,'integrations/platform/patches');
const source=join(root,'.chief-local/platform-source');
const baseline=join(root,'.chief-local/card-editor-baseline');
const hash=value=>createHash('sha256').update(value).digest('hex');
const manifest=JSON.parse(readFileSync(join(baseline,'manifest.json'),'utf8'));
const previous=JSON.parse(readFileSync(join(directory,'meeting-capture-provenance.json'),'utf8'));
if(manifest.sourceRevision!==previous.sourceRevision||manifest.files.length!==1||manifest.files[0].file!=='plugins/card-resources/src/components/ContentEditor.svelte')throw Error('Expected exact scoped Card source baseline');
const frozen={...previous.previousPatches,[previous.patch]:previous.patchSha256};
for(const [name,expected] of Object.entries(frozen))if(hash(readFileSync(join(directory,name)))!==expected)throw Error('Accepted patch changed: '+name);
const temporary=mkdtempSync(join(root,'.chief-local/card-editor-export-'));
const inputs=[];
for(const input of manifest.files){
 const before=readFileSync(join(baseline,input.file)),after=readFileSync(join(source,input.file));
 if(hash(before)!==input.beforeSha256||hash(after)!==input.sha256)throw Error('Card source differs from frozen input');
 for(const [side,bytes] of [['old',before],['new',after]]){const path=join(temporary,side,input.file);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);}
 inputs.push({file:input.file,beforeSha256:hash(before),sha256:hash(after)});
}
const diff=spawnSync('git',['-c','core.autocrlf=false','diff','--no-index','--no-ext-diff','--','old','new'],{cwd:temporary,encoding:'utf8',maxBuffer:1024*1024});
if(diff.status!==1)throw Error('Expected the scoped additive Card diff');
const patch=diff.stdout.replaceAll('a/old/','a/').replaceAll('b/new/','b/');
const name='0006-card-body-editor-actions.patch';
writeFileSync(join(directory,name),patch);
const receipt={sourceRevision:previous.sourceRevision,createdAt:new Date().toISOString(),patch:name,patchSha256:hash(patch),previousPatches:frozen,inputs};
writeFileSync(join(directory,'card-editor-provenance.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({patch:name,sha256:receipt.patchSha256,files:inputs.length}));
