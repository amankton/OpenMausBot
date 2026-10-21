import { afterEach, expect, it, vi } from 'vitest';
import { GeminiLiveSocket } from './gemini-live.ts';
import type { LiveSocket } from './live-call-controller.ts';
class FakeSocket implements LiveSocket {
 readyState=0; bufferedAmount=0; sent:any[]=[];
 onopen:LiveSocket['onopen']=null;onmessage:LiveSocket['onmessage']=null;onerror:LiveSocket['onerror']=null;onclose:LiveSocket['onclose']=null;
 send(raw:string){this.sent.push(JSON.parse(raw));}close(){this.readyState=3;this.onclose?.({});}
 open(){this.readyState=1;this.onopen?.({});}receive(value:unknown){this.onmessage?.({data:JSON.stringify(value)});}
}
const opened:GeminiLiveSocket[]=[];
afterEach(()=>{for(const socket of opened.splice(0))socket.close();vi.useRealTimers();});
function fixture(){const upstream=new FakeSocket();const adapter=new GeminiLiveSocket({key:'fixture-key',bot:{name:'Fixture'},cloudHome:false,open:()=>upstream});opened.push(adapter);const controller:any[]=[];const browser:any[]=[];adapter.onmessage=e=>controller.push(JSON.parse(String(e.data)));adapter.bindBrowser(e=>browser.push(e));return{upstream,adapter,controller,browser,ready(){upstream.open();upstream.receive({setupComplete:{}});}};}
it('sends native setup first, waits for setupComplete and never leaks the key',()=>{
 const t=fixture();t.upstream.open();expect(t.adapter.readyState).toBe(0);
 expect(t.upstream.sent[0]).toMatchObject({setup:{model:'models/gemini-3.8-live',generationConfig:{responseModalities:['AUDIO']},inputAudioTranscription:{},outputAudioTranscription:{},tools:[{functionDeclarations:[{name:'ask_chief',behavior:'NON_BLOCKING'}]}]}});
 expect(t.adapter.browserInput(JSON.stringify({type:'audio',data:'AAAAAA==',sampleRate:16000}))).toBe(true);expect(t.upstream.sent).toHaveLength(1);
 t.upstream.receive({setupComplete:{}});expect(t.adapter.readyState).toBe(1);expect(t.upstream.sent[1]).toEqual({realtimeInput:{audio:{data:'AAAAAA==',mimeType:'audio/pcm;rate=16000'}}});
 expect(JSON.stringify([...t.browser,...t.controller,...t.upstream.sent])).not.toContain('fixture-key');
});
it('admits only bounded PCM input and end-of-stream; rejects injected tools',()=>{
 const t=fixture();t.ready();for(const message of [{type:'toolCall',request:'run'}, {type:'audio',data:'AAAAAA==',sampleRate:24000},{type:'audio.end',command:'run'},{type:'audio',data:'!',sampleRate:16000}])expect(t.adapter.browserInput(JSON.stringify(message))).toBe(false);
 expect(t.adapter.browserInput(JSON.stringify({type:'audio.end'}))).toBe(true);expect(t.upstream.sent.at(-1)).toEqual({realtimeInput:{audioStreamEnd:true}});
 expect(t.adapter.browserInput('x'.repeat(50000))).toBe(false);
});
it('normalizes captions, PCM output and interruptions without passing tool calls to browser',()=>{
 const t=fixture();t.ready();t.upstream.receive({serverContent:{inputTranscription:{text:'hello'},outputTranscription:{text:'hi'},interrupted:true,modelTurn:{parts:[{inlineData:{data:'AAAAAA==',mimeType:'audio/pcm;rate=24000'}}]}}});
 expect(t.browser).toContainEqual({type:'interrupted'});expect(t.browser).toContainEqual({type:'audio',data:'AAAAAA==',sampleRate:24000});expect(t.controller).toContainEqual(expect.objectContaining({type:'session.input_transcript.delta',delta:'hello'}));
 t.upstream.receive({toolCall:{functionCalls:[{id:'tool-1',name:'ask_chief',args:{request:'Check the fixture'}}]}});
 expect(t.controller.at(-1)).toMatchObject({type:'session.delegation.created',delegation:{id:'tool-1',target:'client'},request:'Check the fixture'});expect(JSON.stringify(t.browser)).not.toContain('Check the fixture');
});
it('maps final commentary to native tool response once with scheduling inside response',async()=>{
 const t=fixture();t.ready();t.upstream.receive({toolCall:{functionCalls:[{id:'a',name:'ask_chief',args:{request:'A'}}]}});
 t.adapter.send(JSON.stringify({type:'session.thinking.append',delegation_id:'a',content:'Working'}));expect(t.upstream.sent.at(-1)).toHaveProperty('clientContent');
 t.adapter.send(JSON.stringify({type:'session.commentary.append',delegation_id:'a',content:'One'}));t.adapter.send(JSON.stringify({type:'session.commentary.append',delegation_id:'a',content:'Two'}));await Promise.resolve();
 expect(t.upstream.sent.at(-1)).toEqual({toolResponse:{functionResponses:[{id:'a',name:'ask_chief',response:{result:'One\nTwo',scheduling:'WHEN_IDLE'}}]}});
 expect(t.upstream.sent.some(e=>'type'in e)).toBe(false);
});
it('cancellation suppresses obsolete responses without issuing a harness stop',async()=>{
 const t=fixture();t.ready();t.upstream.receive({toolCall:{functionCalls:[{id:'a',name:'ask_chief',args:{request:'A'}}]}});const before=t.controller.length;
 t.upstream.receive({toolCallCancellation:{ids:['a']}});t.adapter.send(JSON.stringify({type:'session.commentary.append',delegation_id:'a',content:'Result'}));await Promise.resolve();expect(t.controller).toHaveLength(before);expect(t.upstream.sent).toHaveLength(1);
});
it('bounds setup time and upstream backpressure',async()=>{
 vi.useFakeTimers();const waiting=fixture();waiting.upstream.open();await vi.advanceTimersByTimeAsync(10000);expect(waiting.adapter.readyState).toBe(3);
 const slow=fixture();slow.ready();slow.upstream.bufferedAmount=600000;slow.adapter.browserInput(JSON.stringify({type:'audio.end'}));expect(slow.adapter.readyState).toBe(3);
});

it('projects usage counters without raw metadata or invented cost',()=>{
 const t=fixture();t.ready();t.upstream.receive({usageMetadata:{promptTokenCount:10,responseTokenCount:20,totalTokenCount:30,private:'do-not-forward'}});
 expect(t.browser.at(-1)).toEqual({type:'event',event:{type:'session.usage.updated',provider:'gemini',model:'gemini-3.8-live',usage:{input_tokens:10,output_tokens:20,total_tokens:30}}});
});

it('maps depleted-credit closes to safe billing advice without reflecting raw details',()=>{
 const t=fixture();t.upstream.open();t.upstream.onclose?.({code:1011,reason:'Your prepayment credits are depleted. fixture-private-detail'});
 expect(t.browser).toContainEqual({type:'event',event:{type:'error',error:{code:'gemini_connection',message:'Gemini Live needs available billing credits. Check billing in Google AI Studio.'}}});
 expect(JSON.stringify(t.browser)).not.toContain('fixture-private-detail');expect(t.adapter.readyState).toBe(3);
});
