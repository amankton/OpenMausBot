import { createServer, type Server } from "node:http";
import { afterEach, expect, it } from "vitest";
import { ChiefEnhancementSetupError, ChiefEnhancementSetupService } from "../chief-enhancement-setup.ts";
import { CHIEF_ENHANCEMENT_ADDENDUM, CHIEF_ENHANCEMENT_SKILLS, MAIL_REVIEW_ADDENDUM, type ChiefEnhancementPreview } from "../../shared/chief-enhancement-setup.ts";
import { createChiefEnhancementSetupRoutes } from "./chief-enhancement-setup.ts";
import { dispatchRoutes } from "./table.ts";
import { json, readBody } from "../harness/http.ts";

const servers:Server[]=[];
afterEach(async()=>{for(const server of servers.splice(0))await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();});});
async function fixture(){
  let live=true,applies=0;
  const service=new ChiefEnhancementSetupService({assertOwner(){if(!live)throw new ChiefEnhancementSetupError("Owner unavailable",403);},roster:()=>[{id:"existing",name:"Existing Chief",roles:[]}],
    bundle:()=>({release:"1",chiefAddendum:CHIEF_ENHANCEMENT_ADDENDUM,mailAddendum:MAIL_REVIEW_ADDENDUM,skills:CHIEF_ENHANCEMENT_SKILLS.map(name=>({name,content:`---\nname: ${name}\ndescription: Scoped synthetic fixture.\n---\n\nRead the reviewed task.\n`}))}),
    runtime:{snapshot:id=>({id,name:"Existing Chief",roles:[],soul:"Original profile",profileRevision:"1",skillAssignmentRevision:"1",protectedStateHash:"keep-model-teams-grants",skills:[]}),receipt:()=>undefined,apply(preview){applies++;return {previewHash:preview.previewHash,catalogFingerprint:preview.catalogFingerprint,state:"applied",at:1,targetIds:["existing"],selection:{chiefBotId:"existing",reviewerBotId:"existing"},readbackHashes:{existing:"fixture-only"},restoredTargets:[],preservedNewerTargets:[],gaps:[]};}},
  });
  const route=createChiefEnhancementSetupRoutes({assertAccess(auth){if(!live||auth.kind==="loopback"&&auth.trust==="service")throw new ChiefEnhancementSetupError("Private desktop owner required",403);},service:()=>service});
  const server=createServer((req,res)=>{void(async()=>{const url=new URL(req.url??"/","http://127.0.0.1");const handled=await dispatchRoutes([route],{req,res,url,path:url.pathname,method:req.method??"GET",auth:req.headers["x-synthetic-service"]?{kind:"loopback",trust:"service",scopes:["client"]}:{kind:"loopback",scopes:["admin","client"]},json,readBody});if(!handled)json(res,404,{error:"Not found"});})().catch(()=>json(res,500,{error:"Fixture failed"}));});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));servers.push(server);const address=server.address();if(!address||typeof address==="string")throw new Error("No fixture address");
  return {url:`http://127.0.0.1:${address.port}/api/chief-enhancement-setup`,revoke(){live=false;},applies:()=>applies};
}
const post=(body:unknown)=>({method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
it("serves exact catalog and full reviewed preview through owner routes, then applies only the bound review",async()=>{
  const f=await fixture(),catalog=await fetch(f.url);expect(catalog.status).toBe(200);expect(catalog.headers.get("cache-control")).toBe("no-store");expect((await catalog.json() as {bundle:{skills:unknown[]}}).bundle.skills).toHaveLength(8);
  const response=await fetch(`${f.url}/preview`,post({chiefBotId:"existing",reviewerBotId:"existing"}));const {preview}=await response.json() as {preview:ChiefEnhancementPreview};expect(preview.targets[0]!.before.soul).toBe("Original profile");expect(preview.targets[0]!.skills).toHaveLength(8);
  expect((await fetch(`${f.url}/apply`,post({chiefBotId:"existing",reviewerBotId:"existing",previewHash:preview.previewHash,catalogFingerprint:preview.catalogFingerprint,reviewed:false}))).status).toBe(400);
  expect((await fetch(`${f.url}/apply`,post({chiefBotId:"existing",reviewerBotId:"existing",previewHash:preview.previewHash,catalogFingerprint:preview.catalogFingerprint,reviewed:true}))).status).toBe(200);expect(f.applies()).toBe(1);
});
it("rejects service/internal profile reads, revoked sessions, body abuse and unsupported methods",async()=>{
  const f=await fixture();expect((await fetch(f.url,{headers:{"x-synthetic-service":"1"}})).status).toBe(403);
  expect((await fetch(`${f.url}?profile=existing`)).status).toBe(400);expect((await fetch(`${f.url}/preview`)).status).toBe(405);
  expect((await fetch(`${f.url}/preview`,{method:"POST",body:"{"})).status).toBe(400);
  expect((await fetch(`${f.url}/preview`,post({data:"x".repeat(9000)}))).status).toBe(413);
  f.revoke();expect((await fetch(f.url)).status).toBe(403);expect((await fetch(`${f.url}/preview`,post({chiefBotId:"existing"}))).status).toBe(403);expect(f.applies()).toBe(0);
});
