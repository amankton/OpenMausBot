import { expect, it } from 'vitest';
import { connect, type Socket } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { launchVerificationServer } from '../scripts/control-omb.ts';
import { startFakeOpenAiLive } from './testing/fake-openai-live.ts';
const waitFor=async(predicate:()=>boolean)=>{const until=Date.now()+15000;while(!predicate()){if(Date.now()>until)throw new Error('Fixture event did not arrive');await new Promise(resolve=>setTimeout(resolve,50));}};
async function setup(hang=false,custom=false,replies=['The fixture result is 42.']){
 const live=await startFakeOpenAiLive();
 try{
 const fixture=await launchVerificationServer({...process.env,OMB_OPENAI_LIVE_URL:live.url,OMB_OPENAI_LIVE_KEY:'fixture-openai-only',FAKE_CLAUDE_MODE:hang?'hang':'happy',FAKE_CLAUDE_REPLIES:JSON.stringify(replies)});
 const base=fixture.info.url;
 const api=async(method:string,path:string,body?:unknown)=>{const response=await fetch(base+path,{method,headers:{origin:base,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});expect(response.ok).toBe(true);return await response.json() as any;};
 const bot=(await api('POST','/api/bots',{modelSelection:{instanceId:'claude',model:'claude-fake'}})).bot;
 if(custom){await api('PATCH','/api/live/settings',{voice:'voice_Fixture123',voicePrompt:'Keep the pitch and speak modestly quicker.'});}
 const started=await api('POST','/api/live/session',{botId:bot.id,sdp:'v=0\r\n',client:'web'});
 const session=live.sessions[0];await live.waitForAttach(session.id);
 const say=(text:string,id:string,offset:number)=>{live.emit(session.id,{type:'session.input_transcript.delta',delta:text,start_ms:offset,end_ms:offset+100});live.emit(session.id,{type:'session.delegation.created',offset_ms:offset+101,delegation:{id,target:'client'}});};
 return{live,fixture,api,bot,started,session,say,async close(){await fixture.close();await live.stop();}};
 }catch(error){await live.stop();throw error;}
}
it('runs default OpenAI delegation, progress and final commentary through the real isolated harness',async()=>{
 const t=await setup();try{
 expect(t.started.transport.type).toBe('webrtc');expect(t.started.call.provider).toBe('openai');expect(JSON.stringify(t.started)).not.toContain('fixture-openai-only');
 t.say('Calculate six times seven','fixture-first',100);
 const result=await t.live.waitForCommand(t.session.id,c=>c.type==='session.commentary.append'&&String(c.content).includes('42'),20000);expect(result.delegation_id).toBe('fixture-first');
 expect(t.session.commands.some(c=>c.type==='session.thinking.append')).toBe(true);
 const messages=(await t.api('GET',`/api/threads/${t.bot.threadId}/messages`)).messages;expect(messages.some((m:any)=>m.role==='user'&&m.via==='call'&&m.text==='Calculate six times seven')).toBe(true);
 const ended=await t.api('POST','/api/live/call/end',{callId:t.started.call.callId});expect(ended.call.status).toBe('ended');expect(t.session.commands.some(c=>c.type==='session.close')).toBe(true);
 expect((await t.api('GET','/api/live/call')).call).toBeNull();
 }finally{await t.close();}
},120000);
it('delivers a spoken denial to the real permission broker and preserves explicit stop',async()=>{
 const t=await setup(true);let broker:Socket|undefined;try{
 await t.api('PATCH',`/api/bots/${t.bot.id}/tasks/${t.bot.threadId}`,{approvalMode:'ask'});
 t.say('Hold the fixture for its approval check','hold',100);await waitFor(()=>existsSync(t.fixture.fixtureDumpPath));
 const socketPath=JSON.parse(readFileSync(t.fixture.fixtureDumpPath,'utf8')).mcpConfig.mcpServers.ogb.args.at(-1);
 broker=connect(socketPath);await new Promise<void>((resolve,reject)=>{broker!.once('connect',resolve);broker!.once('error',reject);});let reply:any;let buffer='';broker.on('data',chunk=>{buffer+=chunk.toString();if(buffer.includes('\n'))reply=JSON.parse(buffer.split('\n')[0]);});
 broker.write(JSON.stringify({t:'ask',id:'openai-fixture-approval',tool:'Bash',input:{command:'echo fixture-only'}})+'\n');
 await t.live.waitForCommand(t.session.id,c=>c.type==='session.instructions.append',15000);expect(reply).toBeUndefined();
 t.say('no','deny',5000);await waitFor(()=>reply!==undefined);expect(reply).toMatchObject({id:'openai-fixture-approval',behavior:'deny'});
 const messages=(await t.api('GET',`/api/threads/${t.bot.threadId}/messages`)).messages;expect(messages.find((m:any)=>m.card?.requestId==='openai-fixture-approval')?.card).toMatchObject({answered:'deny',answeredBy:{kind:'loopback',via:'call'}});
 await t.api('POST','/api/live/call/end',{callId:t.started.call.callId});await t.api('POST',`/api/bots/${t.bot.id}/interrupt`,{threadId:t.bot.threadId});expect((await t.api('GET','/api/live/call')).call).toBeNull();
 }finally{broker?.destroy();await t.close();}
},120000);

it('persists the shared custom voice and sends the approved prompt through the real harness',async()=>{
 const t=await setup(false,true);try{
 const settings=(await t.api('GET','/api/config')).live;
 expect(settings.voice).toBe('voice_Fixture123');
 expect(settings.voicePrompt).toBe('Keep the pitch and speak modestly quicker.');
 const session=t.session.body.session as any;
 expect(session.audio.output.voice).toEqual({id:'voice_Fixture123'});
 expect(session.instructions).toContain(settings.voicePrompt);
 expect(session.instructions).toContain('Would you like me to keep going?');
 const soul='Answer first with economical words. Would you like me to keep going? Only for lengthy optional explanations.';
 await t.api('PATCH',`/api/bots/${t.bot.id}/profile`,{soul});
 expect((await t.api('GET','/api/bots')).bots.find((b:any)=>b.id===t.bot.id).soul).toBe(soul);
 t.say('What is six times seven?','style-fixture',100);
 await t.live.waitForCommand(t.session.id,c=>c.type==='session.commentary.append'&&String(c.content).includes('42'),20000);
 const dump=JSON.parse(readFileSync(t.fixture.fixtureDumpPath,'utf8'));
 expect(dump.systemPrompt).toContain(soul);
 const stored=JSON.parse(readFileSync(t.fixture.info.dataDir+'/config.json','utf8'));
 expect(stored.live.voice).toBe(settings.voice);expect(stored.live.voicePrompt).toBe(settings.voicePrompt);
 await t.api('POST','/api/live/call/end',{callId:t.started.call.callId});
 }finally{await t.close();}
},120000);

it('keeps the complete request and visual result while asking for a single spoken summary',async()=>{
 const report='Detailed specialist finding with precise constraints. '.repeat(80)+'FINAL BLOCKER: production approval is missing.';
 const request='Review the full specification. '+('Preserve this exact requirement and its acceptance criteria. '.repeat(40))+'Do not omit the final security constraint.';
 const t=await setup(false,false,[report]);try{
 t.say(request,'full-brief',100);
 const command=await t.live.waitForCommand(t.session.id,c=>c.type==='session.commentary.append'&&String(c.content).includes('Result context complete'),20000);
 expect(command.content).toContain('one concise summary');
 const thinking=t.session.commands.filter(c=>c.type==='session.thinking.append').map(c=>String(c.content)).join(' ');
 expect(thinking).toContain(report);
 expect(t.session.commands.filter(c=>c.type==='session.commentary.append')).toHaveLength(1);
 const messages=(await t.api('GET',`/api/threads/${t.bot.threadId}/messages`)).messages;
 expect(messages.some((m:any)=>m.role==='user'&&m.text===request)).toBe(true);
 expect(messages.some((m:any)=>m.role==='bot'&&m.text===report)).toBe(true);
 expect(JSON.stringify(JSON.parse(readFileSync(t.fixture.fixtureDumpPath,'utf8')).prompt)).toContain(request);
 await t.api('POST','/api/live/call/end',{callId:t.started.call.callId});
 }finally{await t.close();}
},120000);
