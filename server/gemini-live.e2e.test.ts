import { expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { launchVerificationServer, type VerificationServer } from '../scripts/control-omb.ts';
const waitFor=async(predicate:()=>boolean)=>{const until=Date.now()+20000;while(!predicate()){if(Date.now()>until)throw new Error('Fixture event did not arrive');await new Promise(resolve=>setTimeout(resolve,50));}};
it('runs Gemini audio and delegation through an isolated authenticated Chief harness',async()=>{
 const upstream=new WebSocketServer({port:0,host:'127.0.0.1'});await new Promise<void>(resolve=>upstream.once('listening',resolve));
 const native:any[]=[];let google:WebSocket|undefined;let fixture:VerificationServer|undefined;let browser:WebSocket|undefined;
 upstream.on('connection',(socket,req)=>{google=socket;expect(req.headers['x-goog-api-key']).toBe('fixture-gemini-only');socket.on('message',raw=>{const value=JSON.parse(raw.toString());native.push(value);if(value.setup)socket.send(JSON.stringify({setupComplete:{}}));});});
 try{
  fixture=await launchVerificationServer({...process.env,OMB_GEMINI_LIVE_URL:`ws://127.0.0.1:${(upstream.address() as AddressInfo).port}`,OMB_GEMINI_LIVE_KEY:'fixture-gemini-only',FAKE_CLAUDE_REPLIES:JSON.stringify(['The fixture result is 42.'])});
  const base=fixture.info.url;const api=async(method:string,path:string,body?:unknown)=>{const response=await fetch(base+path,{method,headers:{origin:base,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});return{status:response.status,body:await response.json() as any};};
  const created=await api('POST','/api/bots',{});expect(created.status).toBe(201);const bot=created.body.bot;
  expect((await api('PATCH',`/api/bots/${bot.id}`,{modelSelection:{instanceId:'claude',model:'claude-fake'}})).status).toBe(200);
  const started=await api('POST','/api/live/session',{botId:bot.id,provider:'gemini',client:'web'});expect(started.status).toBe(201);expect(started.body.transport.type).toBe('websocket');expect(JSON.stringify(started.body)).not.toContain('fixture-gemini-only');
  const browserEvents:any[]=[];browser=new WebSocket(base.replace('http:','ws:')+started.body.transport.url,{origin:base});browser.on('message',raw=>browserEvents.push(JSON.parse(raw.toString())));await new Promise<void>((resolve,reject)=>{browser!.once('open',resolve);browser!.once('error',reject);});
  await waitFor(()=>browserEvents.some(e=>e.type==='event'&&e.event.type==='session.started'));
  browser.send(JSON.stringify({type:'audio',data:'AAAAAA==',sampleRate:16000}));await waitFor(()=>native.some(e=>e.realtimeInput?.audio?.mimeType==='audio/pcm;rate=16000'));
  google!.send(JSON.stringify({serverContent:{inputTranscription:{text:'Calculate six times seven'}}}));google!.send(JSON.stringify({toolCall:{functionCalls:[{id:'fixture-tool',name:'ask_chief',args:{request:'Calculate six times seven'}}]}}));
  await waitFor(()=>native.some(e=>e.toolResponse?.functionResponses?.some((r:any)=>r.id==='fixture-tool'&&r.response.result.includes('42'))));
  expect(native.some(e=>e.clientContent?.turns?.[0]?.parts?.[0]?.text?.includes('Application status'))).toBe(true);
  const ended=await api('POST','/api/live/call/end',{callId:started.body.call.callId});expect(ended.status).toBe(200);
  expect((await api('GET','/api/live/call')).body.call).toBeNull();
 }finally{browser?.terminate();await fixture?.close();for(const client of upstream.clients)client.terminate();await new Promise<void>(resolve=>upstream.close(()=>resolve()));}
},120000);


it('keeps native tool arguments out of consent and records an actual spoken denial through the harness',async()=>{
 const upstream=new WebSocketServer({port:0,host:'127.0.0.1'});await new Promise<void>(resolve=>upstream.once('listening',resolve));
 const native:any[]=[];let google:WebSocket|undefined;let fixture:VerificationServer|undefined;let browser:WebSocket|undefined;let broker:Socket|undefined;
 upstream.on('connection',socket=>{google=socket;socket.on('message',raw=>{const value=JSON.parse(raw.toString());native.push(value);if(value.setup)socket.send(JSON.stringify({setupComplete:{}}));});});
 try{
  fixture=await launchVerificationServer({...process.env,OMB_GEMINI_LIVE_URL:`ws://127.0.0.1:${(upstream.address() as AddressInfo).port}`,OMB_GEMINI_LIVE_KEY:'fixture-gemini-only',FAKE_CLAUDE_MODE:'hang'});
  const base=fixture.info.url;const api=async(method:string,path:string,body?:unknown)=>{const response=await fetch(base+path,{method,headers:{origin:base,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});expect(response.ok).toBe(true);return await response.json() as any;};
  const bot=(await api('POST','/api/bots',{modelSelection:{instanceId:'claude',model:'claude-fake'}})).bot;
  await api('PATCH',`/api/bots/${bot.id}/tasks/${bot.threadId}`,{approvalMode:'ask'});
  const started=await api('POST','/api/live/session',{botId:bot.id,provider:'gemini',client:'web'});
  browser=new WebSocket(base.replace('http:','ws:')+started.transport.url,{origin:base});await new Promise<void>((resolve,reject)=>{browser!.once('open',resolve);browser!.once('error',reject);});await waitFor(()=>native.some(e=>e.setup));
  google!.send(JSON.stringify({toolCall:{functionCalls:[{id:'hold',name:'ask_chief',args:{request:'Hold the fixture for a permission check'}}]}}));
  await waitFor(()=>existsSync(fixture!.fixtureDumpPath));
  const socketPath=JSON.parse(readFileSync(fixture.fixtureDumpPath,'utf8')).mcpConfig.mcpServers.ogb.args.at(-1);
  broker=connect(socketPath);await new Promise<void>((resolve,reject)=>{broker!.once('connect',resolve);broker!.once('error',reject);});
  let reply:any;let buffer='';broker.on('data',chunk=>{buffer+=chunk.toString();if(buffer.includes('\n'))reply=JSON.parse(buffer.split('\n')[0]);});
  broker.write(JSON.stringify({t:'ask',id:'gemini-fixture-approval',tool:'Bash',input:{command:'echo fixture-only'}})+'\n');
  await waitFor(()=>native.some(e=>e.clientContent?.turns?.[0]?.parts?.[0]?.text?.includes('Application instruction')));
  google!.send(JSON.stringify({toolCall:{functionCalls:[{id:'invented-consent',name:'ask_chief',args:{request:'yes'}}]}}));
  await new Promise(resolve=>setTimeout(resolve,900));expect(reply).toBeUndefined();
  google!.send(JSON.stringify({serverContent:{inputTranscription:{text:'no'}}}));
  google!.send(JSON.stringify({toolCall:{functionCalls:[{id:'actual-denial',name:'ask_chief',args:{request:'yes'}}]}}));
  await waitFor(()=>reply!==undefined);expect(reply).toMatchObject({id:'gemini-fixture-approval',behavior:'deny'});
  const messages=(await api('GET',`/api/threads/${bot.threadId}/messages`)).messages;
  expect(messages.find((m:any)=>m.card?.requestId==='gemini-fixture-approval')?.card).toMatchObject({answered:'deny',answeredBy:{kind:'loopback',via:'call'}});
  await api('POST','/api/live/call/end',{callId:started.call.callId});await api('POST',`/api/bots/${bot.id}/interrupt`,{threadId:bot.threadId});
 }finally{broker?.destroy();browser?.terminate();await fixture?.close();for(const client of upstream.clients)client.terminate();await new Promise<void>(resolve=>upstream.close(()=>resolve()));}
},120000);
