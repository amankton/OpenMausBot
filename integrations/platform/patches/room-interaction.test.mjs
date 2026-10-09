import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const root=new URL('../../../.chief-local/platform-source/plugins/love-resources/src/',import.meta.url);
async function fixture({member=true,meeting,deny=false}={}) {
 const calls=[];
 const exports={};
 const source=await readFile(new URL('room-invitation.ts',root),'utf8');
 const modules={
  '@hcengineering/contact':{default:{mixin:{Employee:'employee'}},getCurrentEmployee:()=> 'self'},
  '@hcengineering/love':{default:{class:{MeetingMinutes:'meeting'}},RoomAccess:{DND:'dnd'},MeetingStatus:{Active:'active',Pending:'pending'},isOffice:r=>r.office===true},
  '@hcengineering/presentation':{getClient:()=>({findOne:async(cls)=>cls==='employee'?(member?{personUuid:'synthetic-account'}:undefined):meeting})},
  '@hcengineering/ui':{getCurrentLocation:()=>({path:['workbench','synthetic','card']})},
  './invites':{sendInvites:async(persons,id)=>{calls.push(['invite',persons,id]);if(deny)throw Error('denied');}},
  './meetings':{createMeeting:async room=>{calls.push(['self-join',room._id]);return {_id:'meeting'};},createMeetingDocument:async room=>{calls.push(['pending',room._id]);return {_id:'meeting'};}}
 };
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 runInNewContext(js,{exports,require:name=>modules[name],console});
 return {...exports,calls};
}
test('person drops are bound to the workspace and reject malformed or oversized data',async()=>{
 const f=await fixture();
 assert.equal(f.readDraggedPerson('{"workspace":"synthetic","person":"person-1"}','synthetic'),'person-1');
 for(const data of ['{',JSON.stringify({workspace:'other',person:'person-1'}),JSON.stringify({workspace:'synthetic',person:'../bad'}),'x'.repeat(1025)]) assert.equal(f.readDraggedPerson(data,'synthetic'),undefined);
});
test('dropping another member creates a pending meeting and invites without joining or capturing',async()=>{
 const f=await fixture();assert.equal(await f.placePersonInRoom('other',{_id:'room',access:'open'}),'invited');
 assert.deepEqual(JSON.parse(JSON.stringify(f.calls)),[['pending','room'],['invite',['other'],'meeting']]);
});
test('self drop uses normal join; existing meeting invitation retains its authoritative ID',async()=>{
 const f=await fixture({meeting:{_id:'existing'}});
 await f.placePersonInRoom('self',{_id:'room',access:'open'});
 await f.placePersonInRoom('other',{_id:'room',access:'open'});
 assert.deepEqual(JSON.parse(JSON.stringify(f.calls)),[['self-join','room'],['invite',['other'],'existing']]);
});
test('DND, contacts without accounts, and empty foreign offices cannot receive a new room invitation',async()=>{
 const f=await fixture();await assert.rejects(f.placePersonInRoom('other',{_id:'room',access:'dnd'}));
 await assert.rejects(f.placePersonInRoom('other',{_id:'room',access:'open',office:true,person:'someone'}));
 const g=await fixture({member:false});await assert.rejects(g.placePersonInRoom('other',{_id:'room',access:'open'}));
 assert.equal(f.calls.length+g.calls.length,0);
});
test('server invitation denial propagates instead of reporting a joined or invited result',async()=>{
 const f=await fixture({meeting:{_id:'existing'},deny:true});await assert.rejects(f.placePersonInRoom('other',{_id:'room',access:'open'}),/denied/);
 assert.equal(f.calls.some(c=>c[0]==='self-join'),false);
});
test('meeting navigation preserves non-Office routes, but opens meeting details from full Office',async()=>{
 const source=await readFile(new URL('utils.ts',root),'utf8');
 const start=source.indexOf('export async function navigateToOfficeDoc (');
 const end=source.indexOf('\nexport async function navigateToMeetingMinutes',start);
 const js=ts.transpileModule(source.slice(start,end),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 for(const app of ['card','contact','document','love']){
  const calls=[];const exports={};
  runInNewContext(js,{exports,loveId:'love',getCurrentLocation:()=>({path:['workbench','synthetic',app]}),getClient:()=>({getHierarchy:()=>({classHierarchyMixin:()=>({component:'panel'})})}),view:{mixin:{ObjectPanel:'panel'},component:{EditDoc:'edit'}},getObjectLinkFragment:async()=>({path:['workbench','synthetic',app],query:{a:1}}),navigate:loc=>calls.push(loc)});
  await exports.navigateToOfficeDoc({_class:'meeting'});
  assert.equal(calls.length,app==='love'?1:0);
 }
});

test('joining from a Card preserves Office, Calendar, or closed companion while making meeting controls available',async()=>{
 const source=await readFile(new URL('utils.ts',root),'utf8');
 const start=source.indexOf('export function createMeetingWidget (');
 const end=source.indexOf('\nexport function createMeetingVideoWidgetTab',start);
 const js=ts.transpileModule(source.slice(start,end),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 for(const app of ['card','love'])for(const selected of ['office','calendar',undefined]){
  let state={widget:selected,variant:selected?'expanded':'mini',widgetsState:new Map()};
  const before={...state};const exports={};
  const sidebarStore={update:fn=>{state=fn(state);}};
  runInNewContext(js,{exports,sidebarStore,get:()=>state,loveId:'love',getCurrentLocation:()=>({path:['workbench','synthetic',app]}),love:{string:{Video:'Video',Transcription:'Transcription'},icon:{Cam:'cam'}},chunter:{string:{Chat:'Chat'}},view:{icon:{Bubble:'chat',Feather:'transcript'}},
   openWidget:(widget,data,params,tabs)=>{state={...state,variant:'expanded',widget:params.active?widget._id:state.widget,widgetsState:new Map(state.widgetsState).set(widget._id,{data,tabs})};}});
  exports.createMeetingWidget({_id:'meeting'},'room',true);
  assert.ok(state.widgetsState.has('meeting'));
  assert.equal(state.widget,app==='card'?before.widget:'meeting');
  assert.equal(state.variant,app==='card'?before.variant:'expanded');
 }
});
