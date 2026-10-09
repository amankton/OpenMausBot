// Executes actual capture source against disposable files and synthetic authority/RTC only.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {tmpdir} from 'node:os';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../../../.chief-local/platform-source/services/love/src/capture.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
assert.equal(compiled.diagnostics?.length,0);
const chmodCalls=[];const captureFs={...fs,chmodSync:(...args)=>{chmodCalls.push(args);return fs.chmodSync(...args)}};
const exports={};runInNewContext(compiled.outputText,{exports,Buffer,Date,Set,require:n=>({'node:crypto':crypto,'node:fs':captureFs,'node:path':path})[n]});
const {MeetingCapture,CaptureStore,publicSession,exactBody,captureLimits}=exports;
function fixture(t){
 const dir=fs.mkdtempSync(path.join(tmpdir(),'chief-capture-unit-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let clock=100000;let roster=['a','b'].map(personId=>({personId,name:'Member '+personId,account:'account-'+personId,identity:personId,sid:'sid-'+personId}));let denied=false;let removeFails=false;
 const removals=[];const tokens=[]; const store=new CaptureStore(dir);
 const deps={now:()=>clock,roster:async()=>{if(denied)throw Error('membership revoked');return structuredClone(roster)},remove:async(...args)=>{removals.push(args);if(removeFails)throw Error('RTC unavailable')},token:async(s,expiresAt)=>{tokens.push([s.id,expiresAt]);return 'synthetic-rtc-token'}};
 const e=new MeetingCapture(store,deps);const c={workspace:'workspace',meetingId:'meeting',roomName:'workspace_meeting',title:'Fixture',personId:'a'};
 const poll=(extra={})=>e.serial(()=>e.poll({workerId:'worker',ready:true,model:'tiny.en',...extra}));
 const event=(s,type,extra={})=>e.serial(()=>e.event({workerId:'worker',sessionId:s.id,revision:s.revision,type,...extra}));
 const request=async()=>{await poll();return await e.serial(()=>e.request(c))};
 const start=async()=>{const s=await request();await e.serial(()=>e.consent(s,c,1,true));await e.serial(()=>e.consent(s,{...c,personId:'b'},1,true));const command=(await poll()).command;await event(s,'connected');return {s,command}};
 return {dir,e,store,deps,c,poll,event,request,start,removals,tokens,set roster(v){roster=v},get roster(){return roster},advance:n=>{clock+=n},deny:()=>{denied=true},failRemove:()=>{removeFails=true}};
}
test('no automatic capture; requester also consents; immutable identity/SID snapshot and unanimous start',async t=>{
 const f=fixture(t);assert.equal((await f.poll()).command.kind,'idle');assert.equal(f.store.sessions.length,0);
 const s=await f.request();assert.ok(s.participants.every(p=>p.consent==='pending'));assert.equal((await f.poll()).command.kind,'idle');
 await f.e.consent(s,f.c,1,true);assert.equal((await f.poll()).command.kind,'idle');await f.e.consent(s,{...f.c,personId:'b'},1,true);
 assert.equal(s.state,'starting');const command=(await f.poll()).command;assert.equal(command.kind,'capture');assert.equal(command.participants[0].sid,'sid-a');assert.equal(s.state,'starting');
 await f.event(s,'connected');assert.equal(s.state,'capturing');assert.equal(s.revision,1);
 const view=JSON.stringify(publicSession(s));assert.ok(!view.includes('sid-a')&&!view.includes('workerIdentity')&&!view.includes('account-a')&&!view.includes('synthetic-rtc-token'));
 assert.ok(!fs.readFileSync(path.join(f.dir,'sessions.json'),'utf8').includes('synthetic-rtc-token'));
});
test('decline cancels; stale/conflicting consent and claimed identity rejected',async t=>{
 const f=fixture(t);const s=await f.request();await assert.rejects(f.e.consent(s,f.c,2,true),/stale/);assert.throws(()=>exactBody({sessionId:s.id,revision:1,accept:true,personId:'b'},['sessionId','revision','accept']),/Unexpected/);
 await f.e.consent(s,f.c,1,true);await assert.rejects(f.e.consent(s,f.c,1,false),/already/);await f.e.consent(s,{...f.c,personId:'b'},1,false);assert.equal(s.state,'cancelled');assert.equal(f.tokens.length,0);
});
for(const change of ['join','leave','reconnect','revoked'])test(change+' stops exact listener and never resumes consent',async t=>{
 const f=fixture(t);const {s}=await f.start();
 if(change==='join')f.roster=[...f.roster,{personId:'c',name:'C',account:'c',identity:'c',sid:'sid-c'}];
 if(change==='leave')f.roster=f.roster.slice(0,1);
 if(change==='reconnect')f.roster=[{...f.roster[0],sid:'new-sid'},f.roster[1]];
 if(change==='revoked')f.deny();await f.e.tick();assert.equal(s.state,'stopping');assert.ok(f.removals.some(([room,id])=>room===s.roomName&&id===s.workerIdentity));
 await assert.rejects(f.e.consent(s,f.c,1,true),/ended/);assert.equal((await f.poll({activeSessionId:s.id})).command.kind,'stop');
});
test('verified short-lived attendance webhook stops even if roster returns to original before polling',async t=>{const f=fixture(t);const {s}=await f.start();await f.e.attendance(s.roomName,'participant_joined','new-person','new-sid');assert.equal(s.state,'stopping')});
test('heartbeat loss is checked before renewal and worker takeover cannot resume listener',async t=>{const f=fixture(t);const {s}=await f.start();f.advance(captureLimits.leaseMs+1);assert.equal((await f.poll({activeSessionId:s.id})).command.kind,'stop');assert.equal(s.state,'stopping')});
test('any snapshot participant may stop, unrelated/current later members cannot read',async t=>{const f=fixture(t);const {s}=await f.start();assert.throws(()=>f.e.authorize(s,{...f.c,personId:'outsider'}),/not available/);assert.throws(()=>f.e.authorize(s,{...f.c,workspace:'other'}),/not available/);await f.e.stop(s,{...f.c,personId:'b'},1);assert.equal(s.state,'stopping')});
test('failed RTC removal never reports processing or complete stop',async t=>{const f=fixture(t);const {s}=await f.start();f.failRemove();await assert.rejects(f.e.stop(s,f.c,1),/RTC/);assert.equal(s.state,'stopping');await assert.rejects(f.event(s,'stopped',{durationMs:0,bytes:0}),/RTC/);assert.equal(s.state,'stopping')});
test('quota stops, preserves valid earlier audio, server stamps transcript and idempotent result',async t=>{
 const f=fixture(t);const {s}=await f.start();f.advance(1000);await f.poll({activeSessionId:s.id,bytes:captureLimits.maxBytes,durationMs:1000});assert.equal(s.state,'stopping');
 await f.event(s,'stopped',{durationMs:1000,bytes:captureLimits.maxBytes});assert.equal(s.state,'processing');
 const segments=[{personId:'a',startMs:0,endMs:900,text:'We agreed to review the draft.'}];await f.event(s,'transcript',{segments});assert.equal(s.state,'ready');assert.equal(s.segments[0].speaker,'Member a');assert.equal(s.suggestions[0].sourceSegmentId,s.segments[0].id);
 await f.event(s,'transcript',{segments});await assert.rejects(f.event(s,'transcript',{segments:[{...segments[0],text:'Changed'}]}),/Conflicting/);
});
test('reject wrong speaker, workspace identity fields, bounds, future segments and unknown worker',async t=>{
 const f=fixture(t);const {s}=await f.start();f.advance(1000);await f.event(s,'stopped',{durationMs:1000,bytes:32000});
 for(const segment of [{personId:'outsider',startMs:0,endMs:1,text:'x'},{personId:'a',startMs:0,endMs:1001,text:'x'},{personId:'a',startMs:-1,endMs:0,text:'x'}])await assert.rejects(f.event(s,'transcript',{segments:[segment]}),/Invalid/);
 await assert.rejects(f.event(s,'transcript',{segments:[],workspace:'other'}),/Unexpected/);
 await assert.rejects(f.event(s,'transcript',{segments:[],workerId:'other'}),/lease/);
});
test('restart fails active state durably and evicts exact worker before accepting new work',async t=>{
 const f=fixture(t);const {s}=await f.start();const recovered=new MeetingCapture(new CaptureStore(f.dir),f.deps);await recovered.recover();assert.equal(recovered.find(s.id).state,'failed');assert.equal(recovered.workerState(),'offline');assert.equal(new CaptureStore(f.dir).sessions[0].state,'failed');assert.ok(f.removals.some(([,id])=>id===s.workerIdentity));
});
test('initiator deletion tombstone persists, removes content, worker gets cleanup command',async t=>{
 const f=fixture(t);const {s}=await f.start();await assert.rejects(f.e.delete(s,{...f.c,personId:'b'}),/requester/);await f.e.delete(s,f.c);assert.throws(()=>f.e.find(s.id),/unavailable/);assert.equal(new CaptureStore(f.dir).sessions[0].state,'deleted');assert.equal((await f.poll()).command.kind,'delete');await f.event(s,'deleted');assert.equal(s.deletedAck,true);
});
test('failed transcription retry only for initiator, returns transcribe without any RTC token',async t=>{
 const f=fixture(t);const {s}=await f.start();f.advance(1000);await f.event(s,'stopped',{durationMs:1000,bytes:32000});await f.event(s,'failed');await assert.rejects(f.e.retry(s,{...f.c,personId:'b'},1),/requester/);await f.e.retry(s,f.c,1);const command=(await f.poll()).command;assert.equal(command.kind,'transcribe');assert.equal(command.token,undefined);assert.equal(command.roomName,undefined);
});
test('serialized simultaneous requests cannot allocate two jobs',async t=>{const f=fixture(t);await f.poll();const results=await Promise.allSettled([f.e.serial(()=>f.e.request(f.c)),f.e.serial(()=>f.e.request(f.c))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.store.sessions.length,1)});
test('listener reconnect after completed stop is evicted even before roster polling',async t=>{const f=fixture(t);const {s}=await f.start();f.advance(1000);await f.event(s,'stopped',{durationMs:1000,bytes:32000});const before=f.removals.length;await f.e.attendance(s.roomName,'participant_joined',s.workerIdentity,'late-worker-sid');assert.equal(f.removals.length,before+1);assert.equal(s.state,'processing')});
test('connected retry is idempotent but an absent active worker session ends capture',async t=>{const f=fixture(t);const {s}=await f.start();await f.event(s,'connected');assert.equal(s.state,'capturing');await f.poll();assert.equal(s.state,'stopping')});
test('acknowledged expired deletion receipts compact durably before capacity check',async t=>{
 const f=fixture(t);const s=await f.request();await f.e.delete(s,f.c);await f.event(s,'deleted');
 for(let i=1;i<200;i++)f.store.sessions.push({...structuredClone(s),id:'deleted-'+i});f.store.save();
 f.advance(captureLimits.leaseMs+1);await f.poll();const next=await f.e.request(f.c);
 assert.equal(f.store.sessions.length,1);assert.equal(f.store.sessions[0].id,next.id);assert.equal(new CaptureStore(f.dir).sessions.length,1);
});
test('unacknowledged cleanup and still-valid listener identity tombstones never compact',async t=>{
 const f=fixture(t);const {s}=await f.start();await f.e.delete(s,f.c);await f.event(s,'deleted');
 const unacked={...structuredClone(s),id:'unacked',deletedAck:false,expiresAt:0};f.store.sessions.push(unacked);f.store.save();
 const next=await f.e.request(f.c);assert.equal(f.store.sessions.length,3);assert.ok(f.store.sessions.includes(s));
 await f.e.delete(next,f.c);await f.event(next,'deleted');f.advance(captureLimits.leaseMs*3);await f.poll();await f.e.request(f.c);
 assert.equal(f.store.sessions.length,2);assert.ok(f.store.sessions.some(item=>item.id==='unacked'));assert.ok(!f.store.sessions.some(item=>item.id===s.id));
});
test('existing named-volume directory is explicitly tightened to0700',t=>{
 const directory=fs.mkdtempSync(path.join(tmpdir(),'chief-capture-mode-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));fs.chmodSync(directory,0o755);
 new CaptureStore(directory);assert.ok(chmodCalls.some(([target,mode])=>target===directory&&mode===0o700));
 if(process.platform!=='win32')assert.equal(fs.statSync(directory).mode&0o777,0o700);
});
test('linked capture root or linked ancestor cannot chmod another directory',t=>{
 const directory=fs.mkdtempSync(path.join(tmpdir(),'chief-capture-link-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const target=path.join(directory,'target'),link=path.join(directory,'link');fs.mkdirSync(target);fs.symlinkSync(target,link,process.platform==='win32'?'junction':'dir');const count=chmodCalls.length;
 assert.throws(()=>new CaptureStore(link),/without links/);assert.throws(()=>new CaptureStore(path.join(link,'nested')),/without links/);assert.equal(chmodCalls.length,count);assert.equal(fs.existsSync(path.join(target,'nested')),false);
});
