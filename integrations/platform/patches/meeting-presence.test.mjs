// Runs the retained position allocator and webhook handler; no devices or live writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const root=new URL('../../../.chief-local/platform-source/',import.meta.url);
function load(path,deps){
 const source=readFileSync(new URL(path,root),'utf8');
 const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};runInNewContext(output,{exports,require:name=>{if(!(name in deps))throw Error(name);return deps[name]},console});return exports;
}
const love={class:{MeetingMinutes:'Meeting',Room:'Room',ParticipantInfo:'Info'}};
const core={default:{space:{Workspace:'workspace'}},generateId:()=> 'new-info'};
const {getFreeRoomPlace}=load('plugins/love/src/utils.ts',{'@hcengineering/core':core,'./plugin':{default:love},'./types':{}});
const room={_id:'room',width:4,height:3};
test('default, malformed and out-of-bounds preferred places allocate visible unoccupied cells',()=>{
 for(const pref of [undefined,{x:-1,y:-1},{x:4,y:0},{x:0,y:3},{x:0.5,y:1},{x:NaN,y:0}]){
  const p=getFreeRoomPlace(room,[{x:0,y:0}],'person',pref);assert.deepEqual({...p},{x:1,y:0});
 }
});
test('valid preference is preserved, occupied preference is not reused',()=>{
 assert.deepEqual({...getFreeRoomPlace(room,[],'person',{x:2,y:1})},{x:2,y:1});
 assert.deepEqual({...getFreeRoomPlace(room,[{x:2,y:1}],'person',{x:2,y:1})},{x:0,y:0});
});
const {WorkspaceClient}=load('services/love/src/workspaceClient.ts',{
 '@hcengineering/activity':{},'@hcengineering/attachment':{},'@hcengineering/contact':{},
 '@hcengineering/core':core,'@hcengineering/love':{default:love,getFreeRoomPlace},
 '@hcengineering/server-token':{},'./client':{},'./preset':{}
});
function fixture(existing){
 const rows=[...(existing?[{_class:'Info',_id:'existing',person:'person',meeting:'meeting',sessionId:'session',room:'room',...existing}]:[]),{_class:'Info',_id:'other',person:'other',meeting:'meeting',sessionId:'other-session',room:'room',x:0,y:0}];
 const failures=[];const client=Object.create(WorkspaceClient.prototype);client.ctx={info(){},warn(){},error(...args){failures.push(args)}};
 client.client={async findOne(c){return c==='Meeting'?{_id:'meeting',attachedTo:'room'}:room},async findAll(c,q){return rows.filter(row=>Object.entries(q).every(([k,v])=>row[k]===v))},async update(doc,patch){Object.assign(doc,patch)},async createDoc(c,space,data,id){rows.push({_id:id,_class:c,space,...data})}};
 return {rows,failures,join:()=>client.upsertParticipantFromLiveKit('person','Member','account','meeting','session',{x:-1,y:-1})};
}
test('webhook creation never writes the token sentinel outside the room grid',async()=>{
 const f=fixture();await f.join();assert.equal(f.failures.length,0);const row=f.rows.find(r=>r.person==='person');assert.equal(row.x,1);assert.equal(row.y,0);
});
test('repeated webhook repairs invalid existing placement without duplicate participant',async()=>{
 const f=fixture({x:-1,y:-1});await f.join();await f.join();assert.equal(f.failures.length,0);const rows=f.rows.filter(r=>r.person==='person');assert.equal(rows.length,1);assert.equal(rows[0].x,1);assert.equal(rows[0].y,0);
});
test('repeated webhook preserves a valid user-selected cell',async()=>{
 const f=fixture({x:2,y:1});await f.join();assert.equal(f.failures.length,0);const row=f.rows.find(r=>r.person==='person');assert.equal(row.x,2);assert.equal(row.y,1);
});
