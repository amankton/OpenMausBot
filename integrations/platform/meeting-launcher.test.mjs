import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {ROOT,SOURCE,validateBoundaries} from '../../scripts/configure-chief-platform.mjs';
import {mergeMeetingConfig,ownedConfigFiles,validateMeetingModelReceipt} from '../../scripts/launch-chief-platform-meetings.mjs';
const base=JSON.parse(await readFile(new URL('./compose.json',import.meta.url),'utf8'));
const overlay=JSON.parse(await readFile(new URL('./meetings.compose.json',import.meta.url),'utf8'));
const lock=JSON.parse(await readFile(new URL('./image-lock.json',import.meta.url),'utf8'));
const images=Object.fromEntries(['front','love','transactor','workspace'].map((name,i)=>[name,'sha256:'+String(i+1).repeat(64)]));
test('meeting mode admits exactly the17 owned services with pinned local images and loopback RTC',()=>{
 const config=mergeMeetingConfig(base,overlay,images);
 assert.doesNotThrow(()=>validateBoundaries(config,lock,images));
 assert.equal(Object.keys(config.services).length,17);
 for(const item of base.services.front.environment.filter(value=>!value.startsWith('LIVEKIT_WS='))) assert.ok(config.services.front.environment.includes(item));
 assert.ok(config.services.front.environment.includes('LIVEKIT_WS=ws://localhost:18087/_livekit'));
 for(const [name,volume] of Object.entries(base.volumes))assert.deepEqual(config.volumes[name],volume);
 assert.equal(Object.keys(config.volumes).length,6);
 assert.deepEqual(config.volumes.capture_metadata,{name:'chief-platform_capture_metadata'});
 assert.throws(()=>validateBoundaries(config,lock));
});
for(const [name,change] of [
 ['meeting service starting before broker health',c=>{c.services.love.depends_on.redpanda.condition='service_started';}],
 ['public RTC',c=>{c.services.livekit.ports=['18088:18088'];}],
 ['additional media port',c=>{c.services.love.ports=['127.0.0.1:8096:8096'];}],
 ['foreign media mount',c=>{c.services.livekit.volumes=['/private:/data'];}],
 ['image tag',c=>{c.services.front.image='chief-platform-front:latest';}],
 ['wrong image',c=>{c.services.love.image='sha256:'+'9'.repeat(64);}],
 ['extra service',c=>{c.services.other={...c.services.front};}],
 ['host network',c=>{c.services.livekit.network_mode='host';}],
 ['foreign nginx',c=>{c.services.nginx.volumes=['./nginx.conf:/etc/nginx/conf.d/default.conf:ro'];}]
])test(`meeting mode refuses ${name}`,()=>{
 const config=mergeMeetingConfig(base,overlay,images);change(config);assert.throws(()=>validateBoundaries(config,lock,images));
});

for(const [name,change] of [
 ['capture mounted by front',c=>{c.services.front.volumes=['capture_metadata:/data'];}],
 ['capture external volume',c=>{c.volumes.capture_metadata.external=true;}],
 ['capture foreign name',c=>{c.volumes.capture_metadata.name='foreign';}],
 ['missing capture mount',c=>{c.services.love.volumes=[];}],
 ['extra Love persistent mount',c=>{c.services.love.volumes.push('files:/data');}],
 ['capture secret shared with front',c=>{c.services.front.environment.push('CHIEF_CAPTURE_WORKER_SECRET=secret');}],
 ['hardcoded capture secret',c=>{c.services.love.environment=c.services.love.environment.map(v=>v.startsWith('CHIEF_CAPTURE_WORKER_SECRET=')?'CHIEF_CAPTURE_WORKER_SECRET=secret':v);}]
])test(`capture boundary rejects ${name}`,()=>{const config=mergeMeetingConfig(base,overlay,images);change(config);assert.throws(()=>validateBoundaries(config,lock,images));});
test('meeting overlay cannot enable automatic agents or remove member-only mode',()=>{
 for(const key of ['AGENTS=','CHIEF_MEMBER_MEETINGS_ONLY=true']){
  const changed=structuredClone(overlay);changed.services.love.environment=changed.services.love.environment.filter(v=>v!==key);
  assert.throws(()=>mergeMeetingConfig(base,changed,images));
 }
});
test('missing reviewed image IDs and changed placeholder are rejected',()=>{
 assert.throws(()=>validateBoundaries(mergeMeetingConfig(base,overlay,images),lock,{front:images.front}));
 const changed=structuredClone(overlay);changed.services.front.image=images.front;
 assert.throws(()=>mergeMeetingConfig(base,changed,images));
});
test('ownership accepts only exact baseline or baseline+meeting files in order',()=>{
 const baseFile=join(ROOT,'integrations/platform/compose.json'),meetingFile=join(ROOT,'integrations/platform/meetings.compose.json');
 assert.equal(ownedConfigFiles(baseFile),true);
 assert.equal(ownedConfigFiles(`${baseFile},${meetingFile}`),true);
 assert.equal(ownedConfigFiles(`${meetingFile},${baseFile}`),false);
 assert.equal(ownedConfigFiles(`${baseFile},C:/foreign.json`),false);
 assert.equal(ownedConfigFiles(`${baseFile},${meetingFile},C:/foreign.json`),false);
});

test('meeting rollout requires both workspace backups, exact model images and preserved records',()=>{
 const digest='a'.repeat(64), modelImages={...images,tool:'sha256:'+'5'.repeat(64)};
 const receipt={schemaVersion:1,sourceRevision:SOURCE,patchSha256:digest,images:modelImages,
  workspaces:[['chiefacceptance','b3ece3dc-e200-41c7-a9d8-2cb86c8c9fdb'],['chiefexecutivesuite','5d4f208d-e8ca-4bec-809c-f8ea0556d37f']].map(([slug,uuid])=>({slug,uuid,
   backup:{status:'passed',receiptPath:`backups/${slug}.json`,receiptSha256:digest,manifestSha256:digest},
   modelLoad:{status:'passed',readOnly:true,completedAt:'2026-10-07T21:00:00.000Z',modelSha256:digest,logSha256:digest},
   verification:{status:'passed',optionalFields:['joined','admission'],existingRecordsPreserved:true}
  }))};
 assert.doesNotThrow(()=>validateMeetingModelReceipt(receipt,modelImages,digest));
 for(const change of [
  r=>{r.workspaces.pop();},r=>{r.workspaces[1].slug='foreign';},
  r=>{r.workspaces[0].uuid=r.workspaces[1].uuid;},
  r=>{r.images.tool=images.front;},r=>{r.patchSha256='b'.repeat(64);},
  r=>{r.workspaces[1].modelLoad.status='prepared';},r=>{r.workspaces[1].backup.status='pending';},
  r=>{r.workspaces[1].modelLoad.readOnly=false;},
  r=>{r.workspaces[1].verification.existingRecordsPreserved=false;},
  r=>{r.workspaces[1].verification.optionalFields=['admission'];},
  r=>{r.workspaces[1].backup.receiptPath='../foreign.json';},
  r=>{r.workspaces[1].backup.receiptSha256='unverified';}
 ]){const changed=structuredClone(receipt);change(changed);assert.throws(()=>validateMeetingModelReceipt(changed,modelImages,digest));}
});
