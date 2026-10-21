import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { GeminiAudioBridge } from './gemini-audio-bridge.ts';
import type { GeminiLiveSocket } from './gemini-live.ts';
import { json, readBody } from './harness/http.ts';
import { dispatchRoutes } from './routes/table.ts';
const resources:Array<{server:Server;bridge:GeminiAudioBridge}>=[];
afterEach(async()=>{for(const {server,bridge}of resources.splice(0)){bridge.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}});
async function fixture(){
 const auth={kind:'loopback' as const,scopes:['admin','client'] as ('admin'|'client')[]};let active=true;
 const bridge=new GeminiAudioBridge(id=>active&&id==='fixture');
 const input:string[]=[];const session={readyState:1,bindBrowser(send:any){send({type:'event',event:{type:'session.started'}});},browserInput(data:string){input.push(data);return true;},close(){}} as unknown as GeminiLiveSocket;
 bridge.register('fixture',session);
 const handle=async(req:any,res:any)=>{const url=new URL(req.url,'http://localhost');if(!await dispatchRoutes([bridge.route],{req,res,url,path:url.pathname,method:req.method,auth,json,readBody}))json(res,404,{});};
 const server=createServer(handle);bridge.attach(server,handle);resources.push({server,bridge});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 return{bridge,origin,auth,input,deactivate(){active=false;},ticket(){return bridge.ticket('fixture',origin,auth);}};
}
function connect(url:string,origin:string){return new Promise<WebSocket>((resolve,reject)=>{const ws=new WebSocket(url,{origin});ws.once('open',()=>resolve(ws));ws.once('error',reject);});}
it('binds ticket to exact origin and consumes it once',async()=>{
 const t=await fixture();const path=t.ticket();const url=t.origin.replace('http:','ws:')+path;
 await expect(connect(url,'http://localhost:9999')).rejects.toThrow('403');
 const socket=await connect(url,t.origin);
 await expect(connect(url,t.origin)).rejects.toThrow('403');
 socket.close();await new Promise(resolve=>socket.once('close',resolve));
});
it('refuses missing ticket and a ticket whose call has ended',async()=>{
 const t=await fixture();await expect(connect(t.origin.replace('http:','ws:')+'/api/live/gemini-audio',t.origin)).rejects.toThrow('403');const path=t.ticket();t.deactivate();await expect(connect(t.origin.replace('http:','ws:')+path,t.origin)).rejects.toThrow('403');
});
it('requires an actual valid browser origin before issuing tickets',async()=>{
 const t=await fixture();expect(()=>t.bridge.ticket('fixture','null',t.auth)).toThrow();expect(()=>t.bridge.ticket('fixture','https://example.test/path',t.auth)).toThrow();
});
