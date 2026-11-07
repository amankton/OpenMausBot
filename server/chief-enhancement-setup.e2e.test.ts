import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect,it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";
import { CHIEF_ENHANCEMENT_SKILLS, type ChiefEnhancementPreview, type ChiefSetupReceipt } from "../shared/chief-enhancement-setup.ts";

it.each([false,true])("applies the actual owner-reviewed route with library=%s, verifies exact files, and preserves unrelated settings",async(library)=>{
  const token=randomBytes(32).toString("base64url"),realFetch=globalThis.fetch;
  let fixture:Awaited<ReturnType<typeof launchVerificationServer>>;
  // The launcher's deterministic starter rename is an ordinary owner write.
  globalThis.fetch=(input,init={})=>realFetch(input,{...init,headers:{...Object.fromEntries(new Headers(init.headers)),"x-openmausbot-desktop-owner":token}});
  try{fixture=await launchVerificationServer({OMB_TEST_DESKTOP_OWNER_TOKEN:token});}finally{globalThis.fetch=realFetch;}
  try{
    const root=fixture.info.url,headers={origin:root,"x-openmausbot-desktop-owner":token,"content-type":"application/json"};
    const call=async(path:string,method="GET",body?:unknown)=>fetch(root+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});
    expect((await fetch(root+"/api/chief-enhancement-setup",{headers:{origin:root}})).status).toBe(403);
    expect((await fetch(root+"/api/chief-enhancement-setup",{method:"HEAD",headers:{origin:root,authorization:"Bearer synthetic-internal-capability"}})).status).toBe(403);
    const list=await call("/api/bots");expect(list.status).toBe(200);const {bots}=await list.json() as {bots:Array<{id:string;soul?:string;modelSelection?:unknown;connectorTools?:unknown;toolScope?:unknown;section?:unknown}>};expect(bots).toHaveLength(1);const id=bots[0]!.id;
    if(library){
      expect((await call("/api/config","PATCH",{features:{skillsLibrary:true}})).status).toBe(200);
      const name=CHIEF_ENHANCEMENT_SKILLS[0],text=readFileSync(new URL(`../skills/${name}/SKILL.md`,import.meta.url),"utf8");
      expect((await call("/api/skills-library","POST",{text})).status).toBe(201);
      expect((await call(`/api/skills-library/${name}`,"PATCH",{enabled:true})).status).toBe(200);
    }
    const custom="Preserve this exact owner identity and personal instructions.\n";expect((await call(`/api/bots/${id}/profile`,"PATCH",{soul:custom})).status).toBe(200);
    const before=(await (await call("/api/bots")).json() as {bots:typeof bots}).bots[0]!;
    const catalog=await call("/api/chief-enhancement-setup");expect(catalog.status).toBe(200);const info=await catalog.json() as {bundle:{skills:unknown[]}};expect(info.bundle.skills).toHaveLength(8);
    const result=await call("/api/chief-enhancement-setup/preview","POST",{chiefBotId:id,reviewerBotId:id});expect(result.status).toBe(200);const {preview}=await result.json() as {preview:ChiefEnhancementPreview};expect(preview.targets).toHaveLength(1);expect(preview.targets[0]!.skills).toHaveLength(8);expect(preview.conflicts).toEqual([]);
    const request={chiefBotId:id,reviewerBotId:id,previewHash:preview.previewHash,catalogFingerprint:preview.catalogFingerprint,reviewed:true};
    const applied=await call("/api/chief-enhancement-setup/apply","POST",request);const response=await applied.json() as {receipt:ChiefSetupReceipt;error?:string};expect(applied.status,JSON.stringify(response)).toBe(200);expect(response.receipt.state).toBe("applied");
    const retried=await call("/api/chief-enhancement-setup/apply","POST",request);expect(retried.status).toBe(200);expect(await retried.json()).toEqual(response);
    const after=(await (await call("/api/bots")).json() as {bots:typeof bots}).bots[0]!;expect(after.soul?.startsWith(custom)).toBe(true);for(const field of ["modelSelection","connectorTools","toolScope","section"] as const)expect(after[field]).toEqual(before[field]);
    for(const name of CHIEF_ENHANCEMENT_SKILLS){const file=await call(`/api/bots/${id}/skills/${name}`);expect(file.status).toBe(200);expect((await file.json() as {text:string}).text).toBe(readFileSync(new URL(`../skills/${name}/SKILL.md`,import.meta.url),"utf8"));}
    const next=await call("/api/chief-enhancement-setup/preview","POST",{chiefBotId:id,reviewerBotId:id});expect((await next.json() as {preview:ChiefEnhancementPreview}).preview.changesNeeded).toBe(false);
    if(library){const skills=await (await call(`/api/bots/${id}/skills`)).json() as {assignedSkills:string[]};expect(skills.assignedSkills).toEqual([CHIEF_ENHANCEMENT_SKILLS[0]]);}
    expect((await (await call("/api/bots")).json() as {bots:unknown[]}).bots).toHaveLength(1);
    const history=await call(`/api/bots/${id}/history?full=1`);expect(history.status).toBe(200);expect(JSON.stringify(await history.json())).toContain(custom.trim());
    const newer=`${after.soul}\nA newer owner edit must survive stale setup replay.`;expect((await call(`/api/bots/${id}/profile`,"PATCH",{soul:newer})).status).toBe(200);
    expect((await call("/api/chief-enhancement-setup/apply","POST",request)).status).toBe(409);
    expect((await (await call("/api/bots")).json() as {bots:typeof bots}).bots[0]!.soul).toBe(newer);
  }finally{await fixture.close();}
},120000);
