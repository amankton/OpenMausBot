import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readSessionState } from './session';
beforeEach(()=>vi.useFakeTimers());afterEach(()=>vi.useRealTimers());
it.each(['fetch','body'])('bounds a stalled %s and aborts without trusting the connection',async stage=>{
 let signal:AbortSignal|undefined;
 const fetcher=vi.fn((_url, init)=>{signal=init?.signal;return stage==='fetch'?new Promise<Response>(()=>{}):Promise.resolve({json:()=>new Promise(()=>{}),ok:true,status:200} as Response);});
 const result=readSessionState(fetcher);
 await vi.advanceTimersByTimeAsync(12_000);
 expect(await result).toMatchObject({kind:'unreachable',error:expect.stringContaining('12 seconds')});
 expect(signal?.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
});
it('rejects unreadable successful bodies rather than assuming loopback',async()=>{
 expect(await readSessionState(vi.fn(async()=>new Response('broken')))).toMatchObject({kind:'unreachable'});
 expect(vi.getTimerCount()).toBe(0);
});
it.each([[200,{kind:'loopback'},{kind:'loopback'}],[200,{trust:'service'},{kind:'loopback',trust:'service'}],[401,{error:'pair'},{kind:'unauthenticated',error:'pair'}],[200,{kind:'session',id:'fixture',label:'x',scopes:['client'],expiresAt:1},{kind:'session',id:'fixture',label:'x',scopes:['client'],expiresAt:1}]])('preserves valid auth response %j',async(status,body,expected)=>{
 expect(await readSessionState(vi.fn(async()=>new Response(JSON.stringify(body),{status:status as number})))).toEqual(expected);
 expect(vi.getTimerCount()).toBe(0);
});


it.each([401,403])('preserves denied status %s with empty/non-JSON response',async status=>{
 for(const body of ['', 'access denied']) expect(await readSessionState(vi.fn(async()=>new Response(body,{status})))).toEqual({kind:'unauthenticated',error:String(status)});
 expect(vi.getTimerCount()).toBe(0);
});
it('does not classify a stalled denied body as authenticated or paired',async()=>{
 const result=readSessionState(vi.fn(async()=>({status:401,json:()=>new Promise(()=>{})}) as Response));
 await vi.advanceTimersByTimeAsync(12_000);expect(await result).toMatchObject({kind:'unreachable'});
});
