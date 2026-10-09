// Real Express routes and capture engine; only Accounts/Platform/LiveKit are synthetic.
import test from 'node:test';import assert from 'node:assert/strict';
import * as fs from 'node:fs';import * as path from 'node:path';import * as crypto from 'node:crypto';import {tmpdir} from 'node:os';import {runInNewContext} from 'node:vm';import {createRequire} from 'node:module';import ts from 'typescript';
const root=new URL('../../../.chief-local/platform-source/services/love/src/',import.meta.url);
const express=createRequire(new URL('../package.json',root))('express');
function load(name,modules){const exports={};const compiled=ts.transpileModule(fs.readFileSync(new URL(name,root),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}});runInNewContext(compiled.outputText,{exports,Buffer,Date,Set,setInterval,clearInterval,require:n=>{if(!(n in modules))throw Error(n);return modules[n]}});return exports}
const core=load('capture.ts',{'node:crypto':crypto,'node:fs':fs,'node:path':path});
async function fixture(t){
 const directory=fs.mkdtempSync(path.join(tmpdir(),'chief-capture-route-'));let revoked=false;let hidden=false;const grants=[];const members=[{person:'a-account',role:'USER'},{person:'b-account',role:'USER'},{person:'later-account',role:'USER'}];
 const docs=[...['a','b','later'].map(id=>({_class:'Employee',_id:id,name:'Member '+id,personUuid:id+'-account',active:true})),{_class:'Meeting',_id:'meeting',title:'Fixture',attachedTo:'room',status:0,access:0},{_class:'Room',_id:'room',access:0}];
 const client={async findOne(c,q){if(hidden&&(c==='Meeting'||c==='Room'))return;return docs.find(d=>d._class===c&&Object.entries(q).every(([k,v])=>d[k]===v))},async findAll(){return []}};
 class AdmissionError extends Error{};
 class MeetingAdmission {constructor(auth,caller,system){Object.assign(this,{auth,caller,system})}async actor(){const p=await client.findOne('Employee',{personUuid:this.auth.account,active:true});if(!p)throw new core.CaptureError(403,'No active person');return p}async requireJoin(){if(hidden)throw new core.CaptureError(403,'No room');return await this.actor()}async authority(){return false}}
 class PlatformError extends Error{constructor(code){super('Synthetic account error with private detail');this.status={code}}}
 const secret='fixture-worker-key-not-real-'.repeat(2);const config={CaptureDirectory:directory,CaptureWorkerSecret:secret,Secret:'different-fixture-platform-key',ApiSecret:'different-fixture-rtc-key',ApiKey:'fixture',AccountsURL:'fixture://accounts'};
 const accountClient=token=>({async getLoginInfoByToken(){if(token==='transport-error')throw Error('synthetic network failure');if(token?.startsWith('status-'))throw new PlatformError(token.slice(7));if(!token||!token.endsWith('-account'))throw new PlatformError('Unauthorized');return {account:token,workspace:'workspace',role:'USER'}},async getWorkspaceMembers(){return revoked?members.filter(m=>m.person!=='a-account'):members}});
 const accountCalls=[];
 const modules={'@hcengineering/platform':{default:{status:Object.fromEntries(['Unauthorized','TokenExpired','TokenNotActive','Forbidden','AccountNotFound','WorkspaceNotFound'].map(x=>[x,x]))},PlatformError,__esModule:true},'express':express,'node:crypto':crypto,'@hcengineering/account-client':{getClient:(_url,token)=>{accountCalls.push(token);return accountClient(token)},isWorkspaceLoginInfo:v=>v?.workspace!=null},'@hcengineering/contact':{default:{mixin:{Employee:'Employee'}},__esModule:true},'@hcengineering/core':{AccountRole:{User:'USER',Maintainer:'MAINTAINER',Owner:'OWNER',Admin:'ADMIN',Guest:'GUEST'},systemAccountUuid:'system'},'@hcengineering/love':{default:{class:{MeetingMinutes:'Meeting',Room:'Room',UserMeetingInvite:'Invite'}},RoomAccess:{Open:0,DND:2},__esModule:true},'@hcengineering/server-token':{generateToken:account=>account},'livekit-server-sdk':{AccessToken:class{constructor(key,secret,options){this.options=options}addGrant(grant){grants.push({options:this.options,...grant})}async toJwt(){return 'synthetic-listen-token'}}},'./admission':{MeetingAdmission,AdmissionError,readReceipt:()=>undefined},'./client':{getClient:async()=>client},'./config':{default:config,__esModule:true},'./workspaceClient':{WorkspaceClient:{create:async()=>({getAdmissionClient:()=>client})}},'./utils':{extractToken:headers=>/^Bearer /.test(headers.authorization??'')?headers.authorization.slice(7):undefined,getRoomName:(w,m)=>w+'_'+m},'./capture':core};
 const {installCapture}=load('captureRoutes.ts',modules);const app=express();const participants=['a','b'].map(identity=>({identity,sid:'sid-'+identity}));const removed=[];const rooms={listRooms:async()=>[{}],listParticipants:async()=>participants,removeParticipant:async(room,id)=>{removed.push([room,id])}};
 const capture=await installCapture(app,rooms,{warn(){}});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{await capture.close();await new Promise(r=>server.close(r));fs.rmSync(directory,{recursive:true,force:true})});
 const request=async(route,{token='a-account',body,method=body?'POST':'GET'}={})=>{const res=await fetch(url+'/capture'+route,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:res.status,body:await res.json()}};
 const poll=()=>request('/worker/poll',{token:secret,body:{workerId:'worker',ready:true,model:'tiny.en'}});
 return {request,poll,secret,grants,removed,docs,accountCalls,revoke:()=>{revoked=true},hide:()=>{hidden=true}};
}
test('worker and member credentials cannot cross; unknown claimed identity denied; exact subscribe-only grant',async t=>{
 const f=await fixture(t);assert.equal((await f.request('/worker/poll',{body:{workerId:'worker',ready:true,model:'tiny.en'}})).status,401);
 assert.equal((await f.request('/status?meetingId=meeting',{token:f.secret})).status,401);await f.poll();
 const response=await f.request('/request',{body:{meetingId:'meeting'}});assert.equal(response.status,200);const s=response.body.session;
 assert.equal((await f.request('/consent',{body:{sessionId:s.id,revision:1,accept:true,personId:'b'}})).status,400);
 await f.request('/consent',{body:{sessionId:s.id,revision:1,accept:true}});await f.request('/consent',{token:'b-account',body:{sessionId:s.id,revision:1,accept:true}});
 const command=(await f.poll()).body.command;assert.equal(command.kind,'capture');const grant=f.grants[0];assert.equal(grant.room,'workspace_meeting');assert.equal(grant.canPublish,false);assert.equal(grant.canPublishData,false);assert.equal(grant.canSubscribe,true);assert.equal(grant.canUpdateOwnMetadata,false);assert.ok(grant.options.ttl<=10);
});
test('current Accounts membership and current caller room ACL gate historical reads; later participants excluded',async t=>{
 const f=await fixture(t);await f.poll();const {body:{session:s}}=await f.request('/request',{body:{meetingId:'meeting'}});
 assert.equal((await f.request('/session/'+s.id,{token:'later-account'})).status,403);
 assert.equal((await f.request('/history?meetingId=meeting',{token:'later-account'})).body.sessions.length,0);
 assert.equal((await f.request('/session/'+s.id)).status,200);f.revoke();assert.equal((await f.request('/session/'+s.id)).status,403);
 f.hide();assert.equal((await f.request('/session/'+s.id,{token:'b-account'})).status,403);
});
test('deactivation and absent authenticated person deny before a capture request; no metadata identity override',async t=>{
 const f=await fixture(t);await f.poll();f.docs.find(d=>d._id==='a').active=false;assert.equal((await f.request('/request',{body:{meetingId:'meeting'}})).status,403);
 assert.equal((await f.request('/request',{token:'b-account',body:{meetingId:'meeting',workspace:'other'}})).status,400);
});

test('realistic Account PlatformError codes map auth denials; internal/transport errors stay503 without leaking details',async t=>{const f=await fixture(t);for(const [code,status] of [['Unauthorized',401],['TokenExpired',401],['TokenNotActive',401],['Forbidden',403],['AccountNotFound',403],['WorkspaceNotFound',403],['InternalServerError',503]]){const result=await f.request('/status?meetingId=meeting',{token:'status-'+code});assert.equal(result.status,status);assert.ok(!JSON.stringify(result.body).includes('private detail'));}assert.equal((await f.request('/status?meetingId=meeting',{token:'transport-error'})).status,503);});
