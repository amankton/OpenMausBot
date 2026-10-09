// Executes retained source policy with controlled Platform documents. No accounts/devices/live data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import * as crypto from 'node:crypto';
import ts from 'typescript';
const path=new URL('../../../.chief-local/platform-source/services/love/src/admission.ts',import.meta.url);
const source=readFileSync(path,'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
assert.equal(compiled.diagnostics?.length,0);
const love={class:{MeetingMinutes:'Meeting',Room:'Room',UserMeetingInvite:'Invite'}};
const contact={class:{PersonSpace:'Space',SocialIdentity:'Social'},mixin:{Employee:'Employee'}};
const RoomAccess={Open:0,Knock:1,DND:2},MeetingStatus={Active:0,Finished:1,Pending:2};
let ids=0;const modules={'node:crypto':crypto,'@hcengineering/contact':{default:contact},'@hcengineering/core':{AccountRole:{Guest:'GUEST',ReadOnlyGuest:'READONLYGUEST'},generateId:()=>`invite-${++ids}`,TxFactory:class {constructor(author){this.author=author}createTxCreateDoc(c,space,attributes,id){return {_class:'TxCreateDoc',objectClass:c,objectSpace:space,attributes,objectId:id,modifiedBy:this.author}}}},'@hcengineering/love':{default:love,RoomAccess,MeetingStatus}};
const exports={};runInNewContext(compiled.outputText,{exports,Buffer,Date,require:n=>{if(!modules[n])throw Error(n);return modules[n]}});
const {MeetingAdmission,signReceipt,readReceipt}=exports;
const secret='synthetic-verification-secret-not-a-service-key';
function fixture({access=1,meetingAccess=access,owner='host',role='USER',workspace='workspace',visible=true}={}){
 const docs=[{_class:'Employee',_id:'guest',personUuid:'account',active:true,name:'Verified Member'}, {_class:'Employee',_id:'host',personUuid:'host-account',active:true,name:'Host'}, {_class:'Employee',_id:'third',personUuid:'third-account',active:true,name:'Third'}, {_class:'Space',_id:'guest-space',person:'guest'}, {_class:'Space',_id:'host-space',person:'host'}, {_class:'Space',_id:'third-space',person:'third'}, {_class:'Room',_id:'room',person:owner,access}, {_class:'Meeting',_id:'meeting',attachedTo:'room',createdBy:'host-social',status:0,access:meetingAccess}, {_class:'Social',_id:'host-social',attachedTo:'host'}];
 const matches=(d,c,q)=>d._class===c&&Object.entries(q).every(([k,v])=>d[k]===v);
 const client={async findOne(c,q){return docs.find(d=>matches(d,c,q))},async findAll(c,q){return docs.filter(d=>matches(d,c,q))},async createDoc(c,space,data,id){const doc={_class:c,_id:id,space,...data};docs.push(doc);if(c==='Invite')docs.push({...doc,_id:'response-'+id,kind:'invite-response',space:data.to+'-space'});return id},async update(doc,update){Object.assign(doc,update)}};
 const transactions=[]; const caller={...client,async getAccount(){return {uuid:'account',primarySocialId:'guest-social'}},async createDoc(){throw Error('Forbidden: system account required for direct operations')},async tx(tx){transactions.push(tx);return client.createDoc(tx.objectClass,tx.objectSpace,tx.attributes,tx.objectId)},async findOne(c,q){if(!visible&&(c==='Room'||c==='Meeting'))return;return client.findOne(c,q)}};
 const auth={account:'account',workspace,role};
 return {docs,client,caller,auth,transactions,admission:new MeetingAdmission(auth,caller,client,secret),forPerson(person){const account=person==='guest'?'account':person+'-account';return new MeetingAdmission({...auth,account},{...caller,async getAccount(){return {uuid:account,primarySocialId:person+'-social'}}},client,secret)}};
}
const denies=async(fn,status=403)=>assert.rejects(fn,e=>e.status===status);
test('open room self-join uses authenticated active person; no browser identity input',async()=>{const f=fixture({access:0});assert.equal((await f.admission.requireJoin('meeting'))._id,'guest');f.docs.find(d=>d._id==='guest').active=false;await denies(()=>f.admission.requireJoin('meeting'))});
test('workspace ACL denial, missing/finished meeting and DND fail closed',async()=>{for(const settings of [{visible:false},{access:2},{meetingAccess:2}])await denies(()=>fixture(settings).admission.requireJoin('meeting'));const f=fixture({access:0});f.docs.find(d=>d._id==='meeting').status=1;await denies(()=>f.admission.requireJoin('meeting'));await denies(()=>fixture().admission.requireJoin('missing'))});
test('read-only guests cannot join even open; guest sign-ins need acceptance',async()=>{await denies(()=>fixture({access:0,role:'READONLYGUEST'}).admission.requireJoin('meeting'));await denies(()=>fixture({access:0,role:'GUEST'}).admission.requireJoin('meeting'))});
test('Knock denies pending and forged accepted status, permits explicit host acceptance',async()=>{const f=fixture();await f.admission.invite('host','meeting');const request=f.docs.find(d=>d.kind==='invite-request');await denies(()=>f.admission.requireJoin('meeting'));request.status='accepted';await denies(()=>f.admission.requireJoin('meeting'));request.status='pending';await f.forPerson('host').respond('response-'+request._id,true,'meeting');assert.equal((await f.admission.requireJoin('meeting'))._id,'guest');assert.equal(readReceipt(request.admission,secret).state,'accepted')});
test('only addressed recipient can accept, mismatched meetings rejected',async()=>{const f=fixture();await f.admission.invite('host','meeting');const response=f.docs.find(d=>d.kind==='invite-response');await denies(()=>f.forPerson('third').respond(response._id,true,'meeting'));await denies(()=>f.forPerson('host').respond(response._id,true,'other'),400)});
test('declined and cancelled invitations never admit',async()=>{const f=fixture();await f.admission.invite('host','meeting');await f.forPerson('host').respond(f.docs.find(d=>d.kind==='invite-response')._id,false);await denies(()=>f.admission.requireJoin('meeting'));const g=fixture();await g.admission.invite('host','meeting');const response=g.docs.find(d=>d.kind==='invite-response');g.docs.splice(g.docs.findIndex(d=>d.kind==='invite-request'),1);await denies(()=>g.forPerson('host').respond(response._id,true,'meeting'))});
test('signed receipts reject tamper, expiry, wrong workspace/person/meeting/room',async()=>{const f=fixture();await f.admission.invite('host','meeting');const r=f.docs.find(d=>d.kind==='invite-request');await f.forPerson('host').respond('response-'+r._id,true,'meeting');const original=r.admission;assert.equal(readReceipt(original+'x',secret),undefined);const proof=readReceipt(original,secret);assert.equal(readReceipt(signReceipt({...proof,expires:1},secret),secret),undefined);for(const change of [{workspace:'other'},{from:'third'},{meeting:'other'},{room:'other'},{request:'other'}]){r.admission=signReceipt({...proof,...change},secret);await denies(()=>f.admission.requireJoin('meeting'))}r.admission=original;assert.equal((await f.admission.requireJoin('meeting')).name,'Verified Member')});
test('ordinary member cannot invite stranger into restricted room or approve another host room',async()=>{const f=fixture();await denies(()=>f.admission.invite('third','meeting'));await f.admission.invite('host','meeting');f.docs.find(d=>d._id==='room').person='third';await denies(()=>f.forPerson('host').respond(f.docs.find(d=>d.kind==='invite-response')._id,true,'meeting'))});
test('knock without meeting is accepted only into recipient own office',async()=>{const f=fixture();await f.admission.invite('host');await f.forPerson('host').respond(f.docs.find(d=>d.kind==='invite-response')._id,true,'meeting');assert.equal((await f.admission.requireJoin('meeting'))._id,'guest')});

test('public shared rooms retain guest self-join semantics',async()=>{assert.equal((await fixture({access:0,owner:null,role:'GUEST'}).admission.requireJoin('meeting'))._id,'guest')});

test('legitimate host can start a restricted shared meeting without inviting themselves',async()=>{const f=fixture({owner:null});assert.equal((await f.forPerson('host').requireJoin('meeting'))._id,'host');await denies(()=>f.admission.requireJoin('meeting'))});
test('recipient cancellation before accept never grants a token',async()=>{const f=fixture();await f.admission.invite('host','meeting');const response=f.docs.find(d=>d.kind==='invite-response');response.status='declined';await denies(()=>f.forPerson('host').respond(response._id,true,'meeting'));await denies(()=>f.admission.requireJoin('meeting'))});
test('accept and decline races have one ordered decision; decline never overwrites acceptance',async()=>{const f=fixture();await f.admission.invite('host','meeting');const response=f.docs.find(d=>d.kind==='invite-response');const results=await Promise.allSettled([f.forPerson('host').respond(response._id,true,'meeting'),f.forPerson('host').respond(response._id,false)]);assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');assert.equal(results[1].reason.status,409);assert.equal((await f.admission.requireJoin('meeting'))._id,'guest')});
test('retry after response-write failure recovers accepted request without a second admission',async()=>{const f=fixture();await f.admission.invite('host','meeting');const response=f.docs.find(d=>d.kind==='invite-response');const update=f.client.update;let fail=true;f.client.update=async(doc,value)=>{if(doc.kind==='invite-response'&&fail){fail=false;throw Error('synthetic write interruption')}return update(doc,value)};await assert.rejects(()=>f.forPerson('host').respond(response._id,true,'meeting'));await f.forPerson('host').respond(response._id,true,'meeting');assert.equal((await f.admission.requireJoin('meeting'))._id,'guest')});

async function frontendMeeting({denied=false,participation={meeting:'previous',room:'previous-room'}}={}){
 const calls=[],room={_id:'room',_class:'Room',type:0,access:0,width:4,height:3};const meeting={_id:'meeting',attachedTo:'room',attachedToClass:'Room',access:0};
 const store=value=>({value});const updates={myConnectingSessionId:{set(value){calls.push(['connecting',value])}},rooms:store([room]),myInfo:store(participation),myOffice:store(undefined),infos:store([]),meetings:store([meeting])};
 const client={async findOne(){return room},async diffUpdate(){calls.push(['presence'])}};
 const deps={'@hcengineering/core':{default:{space:{Workspace:'workspace'}},AccountRole:{ReadOnlyGuest:'READONLYGUEST',Guest:'GUEST'},getCurrentAccount:()=>({role:'USER'})},'@hcengineering/love':{default:love,RoomAccess,MeetingStatus,RoomType:{Video:0},isOffice:()=>false,getFreeRoomPlace:()=>({x:1,y:1})},'@hcengineering/presentation':{default:{metadata:{SessionId:'session'}},getClient:()=>client},'./utils':{navigateToOfficeDoc:async()=>{},getLiveKitEndpoint:()=> 'ws://fixture',navigateToMeetingMinutes:async()=>{},loveClient:{async getRoomToken(){calls.push(['token']);if(denied)throw Error('denied');return 'fixture'}},liveKitClient:{async connect(){calls.push(['connect'])}}},'svelte/store':{get:store=>store.value},'./stores':updates,'@hcengineering/contact':{getCurrentEmployee:()=> 'guest'},'@hcengineering/contact-resources':{getPersonByPersonRef:async()=>({_id:'guest'})},'@hcengineering/platform':{getMetadata:()=> 'fixture-session'},'./invites':{sendInvites:async()=>{},unsubscribeFromIncomingInvites(){}},'./liveKitClient':{lkIsConnecting:store(false)}};
 const filename=new URL('../../../.chief-local/platform-source/plugins/love-resources/src/meetings.ts',import.meta.url);
 const output=ts.transpileModule(readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const result={};runInNewContext(output,{exports:result,require:name=>{if(!deps[name])throw Error(name);return deps[name]},console:{error(){}},setTimeout});
 return {calls,join:()=>result.joinMeeting(meeting),result};
}
test('denied token never moves an existing presence tile or starts media connection',async()=>{const f=await frontendMeeting({denied:true});await assert.rejects(f.join);assert.equal(f.calls.some(c=>c[0]==='presence'||c[0]==='connect'),false);assert.equal(f.result.currentMeeting,undefined)});
test('presence movement follows admission and completed LiveKit connection',async()=>{const f=await frontendMeeting();await f.join();assert.ok(f.calls.findIndex(c=>c[0]==='token')<f.calls.findIndex(c=>c[0]==='connect'));assert.ok(f.calls.findIndex(c=>c[0]==='connect')<f.calls.findIndex(c=>c[0]==='presence'))});

test('invite uses member tx with authenticated social author, never system-only direct create',async()=>{
 const f=fixture({access:0}); await f.admission.invite('third','meeting');
 assert.equal(f.transactions.length,1); assert.equal(f.transactions[0].modifiedBy,'guest-social');
 assert.equal(f.transactions[0].objectSpace,'guest-space'); assert.equal(f.transactions[0].attributes.from,'guest');
});
test('invite refuses mismatched REST account or missing social identity before writing',async()=>{
 for(const account of [{uuid:'other',primarySocialId:'other-social'},{uuid:'account'}]){
  const f=fixture({access:0}); f.caller.getAccount=async()=>account;
  await denies(()=>f.admission.invite('third','meeting')); assert.equal(f.transactions.length,0);
 }
});
test('denied member transaction propagates without retrying a privileged service write',async()=>{
 const f=fixture({access:0}); f.caller.tx=async()=>{throw Error('space permission denied')};
 await assert.rejects(()=>f.admission.invite('third','meeting'),/space permission denied/);
 assert.equal(f.docs.some(d=>d.kind==='invite-request'),false);
});
test('same-meeting webhook presence with sentinel coordinates is repaired after connection',async()=>{
 const f=await frontendMeeting({participation:{_id:'presence',meeting:'meeting',room:'room',x:-1,y:-1}});
 await f.join(); assert.equal(f.calls.filter(c=>c[0]==='presence').length,1);
});
test('same-meeting valid position is retained after connection',async()=>{
 const f=await frontendMeeting({participation:{_id:'presence',meeting:'meeting',room:'room',x:2,y:1}});
 await f.join(); assert.equal(f.calls.filter(c=>c[0]==='presence').length,0);
});

test('restricted room host invitation retains the host social author',async()=>{
 const f=fixture({owner:null});await f.forPerson('host').invite('guest','meeting');
 assert.equal(f.transactions[0].modifiedBy,'host-social');assert.equal(f.transactions[0].attributes.from,'host');
});
