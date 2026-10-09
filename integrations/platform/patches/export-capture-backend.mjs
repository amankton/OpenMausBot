// Export only the backend increment over the frozen deployed source; never rewrite patches 0001–0004.
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,mkdtempSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';import {tmpdir} from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const dir=path.join(repo,'integrations/platform/patches');const base=path.join(repo,'.chief-local/capture-baseline/backend');
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const manifest=JSON.parse(readFileSync(path.join(base,'baseline.json'),'utf8'));
const expected={'main.ts':'0c007a4169babc491a432c501270b0fb65ca1684ace4b500953bcbdff6097d6c','config.ts':'afcfa2298b81ffa1cf59fba3f729a702ce40d580918b059430f120808db59b13'};
for(const [name,hash] of Object.entries(expected))if(sha(path.join(base,name))!==hash||manifest.files.find(f=>f.path==='services/love/src/'+name)?.sha256!==hash)throw Error('Backend baseline mismatch: '+name);
const temporary=mkdtempSync(path.join(tmpdir(),'chief-capture-export-'));const files=[];
try{
 for(const name of ['main.ts','config.ts','capture.ts','captureRoutes.ts']){
  const relative='services/love/src/'+name;const src=path.join(repo,'.chief-local/platform-source',relative);const target=path.join(dir,'capture-backend-source',relative);
  mkdirSync(path.dirname(target),{recursive:true});copyFileSync(src,target);
  const old=path.join(temporary,'old',relative);const next=path.join(temporary,'new',relative);mkdirSync(path.dirname(old),{recursive:true});mkdirSync(path.dirname(next),{recursive:true});
  if(name in expected)copyFileSync(path.join(base,name),old);copyFileSync(src,next);
  files.push({path:relative,beforeSha256:expected[name]??null,sha256:sha(src)});
 }
 const result=spawnSync('git',['diff','--no-index','--no-ext-diff','--','old','new'],{cwd:temporary,encoding:'utf8',maxBuffer:4*1024*1024});
 if(![0,1].includes(result.status))throw Error(result.stderr);
 const patch=result.stdout.replaceAll('a/old/','a/').replaceAll('b/new/','b/').replaceAll('a/new/','a/');
 const patchPath=path.join(dir,'0005-capture-backend.fragment.patch');writeFileSync(patchPath,patch);
 const frozen=['0001-explicit-media-consent.patch','0002-member-meeting-admission.patch','0003-room-interaction.patch','0004-bounded-raw-recording.patch'];
 const receipt={version:1,kind:'backend-fragment-not-deployment',createdAt:new Date().toISOString(),sourceRevision:manifest.sourceRevision,baselineReceipt:'.chief-local/capture-baseline/backend/baseline.json',files,patch:{path:path.basename(patchPath),sha256:sha(patchPath)},frozen: frozen.map(name=>{try{return {path:name,sha256:sha(path.join(dir,name))}}catch{return {path:name,status:'verify exact frozen filename in combined export'}}})};
 writeFileSync(path.join(dir,'capture-backend-provenance.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({files:files.length,patch:receipt.patch}));
}finally{rmSync(temporary,{recursive:true,force:true})}
