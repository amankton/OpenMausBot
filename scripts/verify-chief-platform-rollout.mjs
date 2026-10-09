// Read-only runtime comparison with the private pre-capture rollout snapshot.
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('..',import.meta.url));
const json=path=>JSON.parse(readFileSync(join(root,path),'utf8'));
const before=json('.chief-local/platform/before-capture-rollout.json');
assert.equal(before.length,17);
const docker=args=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true}).trim();
const ids=docker(['ps','-a','--filter','label=com.docker.compose.project=chief-platform','--format','{{.ID}}']).split(/\r?\n/);
assert.equal(ids.length,17);
const current=JSON.parse(docker(['inspect',...ids]));
const mounts=value=>value.map(m=>({type:m.Type,name:m.Name??null,source:m.Source,destination:m.Destination,rw:m.RW})).sort((a,b)=>a.destination.localeCompare(b.destination));
const changed=[];
for(const prior of before){
 const actual=current.find(item=>item.Name===prior.name);assert.ok(actual,'Same service name required');
 assert.equal(actual.Config.Labels['com.docker.compose.project'],'chief-platform');
 assert.equal(actual.State.Running,true);
 if(actual.State.Health)assert.equal(actual.State.Health.Status,'healthy');
 const service=actual.Config.Labels['com.docker.compose.service'];
 const priorMounts=mounts(prior.mounts),actualMounts=mounts(actual.Mounts);
 for(const mount of priorMounts)assert.deepEqual(actualMounts.find(value=>value.destination===mount.destination),mount);
 if(service==='love'){
  assert.equal(actual.Image,json('.chief-local/platform/love-image.json').image);
  const extra=actualMounts.filter(m=>!priorMounts.some(p=>p.destination===m.destination));
  assert.equal(extra.length,1);assert.equal(extra[0].name,'chief-platform_capture_metadata');assert.equal(extra[0].destination,'/var/lib/chief-capture');
 }else{
  assert.deepEqual(actualMounts,priorMounts);
  if(service==='front')assert.equal(actual.Image,json('.chief-local/platform/front-image.json').image);
  else{assert.equal(actual.Id,prior.id);assert.equal(actual.Image,prior.image);}
 }
 if(actual.Id!==prior.id)changed.push(service);
}
assert.deepEqual(changed.sort(),['front','love']);
const receipt={passed:true,verifiedAt:new Date().toISOString(),servicesRunning:17,changedServices:changed,
 originalServiceImagesAndIdsPreservedExcept:changed,allOriginalMountsPreserved:true,
 additiveVolume:'chief-platform_capture_metadata',workspaceMigrationsPerformed:false,
 images:Object.fromEntries(current.filter(c=>['front','love'].includes(c.Config.Labels['com.docker.compose.service'])).map(c=>[c.Config.Labels['com.docker.compose.service'],c.Image]))};
writeFileSync(join(root,'docs/verification/evidence/chief-platform-capture-rollout.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt));
