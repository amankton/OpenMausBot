import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { CHIEF_ENHANCEMENT_ADDENDUM, CHIEF_ENHANCEMENT_SKILLS, MAIL_REVIEW_ADDENDUM, type ChiefEnhancementBundle, type ChiefSetupBotSnapshot } from "../shared/chief-enhancement-setup.ts";
import { ChiefEnhancementSetupError, ChiefEnhancementSetupService, chiefSetupSemanticSnapshot } from "./chief-enhancement-setup.ts";
import { ChiefEnhancementSetupRuntime, type ChiefSetupSupportedAdapter } from "./chief-enhancement-setup-runtime.ts";

const owned: Array<{runtime:ChiefEnhancementSetupRuntime;dir:string}> = [];
afterEach(() => { for (const f of owned.splice(0)) { f.runtime.close(); rmSync(f.dir,{recursive:true,force:true}); } });
const clone = <T>(v:T):T => JSON.parse(JSON.stringify(v)) as T;
function fixture() {
  const bots = new Map<string,ChiefSetupBotSnapshot>(["chief","reviewer"].map(id => [id,{id,name:id,roles:[],soul:`Existing ${id}`,profileRevision:"1",skillAssignmentRevision:"1",protectedStateHash:"preserved",skills:[],skillMode:"local"}]));
  const bundle:ChiefEnhancementBundle = {release:"1",chiefAddendum:CHIEF_ENHANCEMENT_ADDENDUM,mailAddendum:MAIL_REVIEW_ADDENDUM,skills:CHIEF_ENHANCEMENT_SKILLS.map(name => ({name,content:readFileSync(new URL(`../skills/${name}/SKILL.md`,import.meta.url),"utf8")}))};
  const stages = new Map<string,{botId:string;name:string;content:string;source:string;kind:"local"|"assigned"}>();
  let sequence=0, commits=0, discards=0;
  const hooks:{commit?:(botId:string,index:number)=>void;soul?:(botId:string,soul:string)=>void;discard?:()=>void;stage?:()=>void;snapshot?:(botId:string)=>void} = {};
  const bump = (bot:ChiefSetupBotSnapshot) => { bot.profileRevision=String(++sequence); };
  const adapter:ChiefSetupSupportedAdapter = {
    snapshot:id => { hooks.snapshot?.(id);const bot=bots.get(id);return bot?clone(bot):undefined; },
    stageSkill:(botId,input) => { hooks.stage?.(); const id=String(++sequence);stages.set(id,{botId,...input});return {id,source:input.source}; },
    commitStagedSkill:(botId,id) => { const stage=stages.get(id)!;const bot=bots.get(botId)!;bot.skills.push({name:stage.name,content:stage.content,source:stage.source,kind:stage.kind,enabled:true,assigned:true,revision:String(++sequence)});bump(bot);hooks.commit?.(botId,++commits); },
    discardStagedSkill:(_bot,id) => { discards++;hooks.discard?.();stages.delete(id); },
    setSkillEnabled:(id,name,enabled) => { const bot=bots.get(id)!;bot.skills.find(s=>s.name===name)!.enabled=enabled;bump(bot); },
    setSkillAssigned:(id,name,assigned) => { const bot=bots.get(id)!;bot.skills.find(s=>s.name===name)!.assigned=assigned;bump(bot); },
    removeSkill:(id,name,source) => { const bot=bots.get(id)!;bot.skills=bot.skills.filter(s=>s.name!==name||s.source!==source);bump(bot); },
    setSoul:(id,soul) => { hooks.soul?.(id,soul);const bot=bots.get(id)!;bot.soul=soul;bump(bot); },
  };
  const dir=mkdtempSync(join(tmpdir(),"chief-setup-runtime-independent-")),runtime=new ChiefEnhancementSetupRuntime(dir,adapter);owned.push({runtime,dir});
  const service=new ChiefEnhancementSetupService({assertOwner:()=>{},roster:()=>[...bots.values()].map(({id,name,roles})=>({id,name,roles})),bundle:()=>bundle,runtime});
  const preview=service.preview({chiefBotId:"chief",reviewerBotId:"reviewer"});
  const request={chiefBotId:"chief",reviewerBotId:"reviewer",previewHash:preview.previewHash,catalogFingerprint:preview.catalogFingerprint,reviewed:true as const};
  return {bots,hooks,stages,runtime,service,preview,request,commits:()=>commits,discards:()=>discards};
}

it("stages all eight documents before the first promotion and persists exact readback",()=>{
  const f=fixture();f.hooks.commit=()=>expect(f.stages.size).toBe(8);
  const receipt=f.service.apply(f.request);expect(receipt.state).toBe("applied");expect(Object.keys(receipt.readbackHashes)).toHaveLength(2);expect(f.runtime.receipt(receipt.previewHash)?.state).toBe("applied");expect(f.discards()).toBe(8);expect(f.stages.size).toBe(0);
});
it("rolls back only its unchanged writes across both targets when a later profile write fails",()=>{
  const f=fixture(),before=[...f.bots.values()].map(chiefSetupSemanticSnapshot);f.hooks.soul=(id,soul)=>{if(id==="reviewer"&&soul!=="Existing reviewer")throw new Error("synthetic late profile failure");};
  expect(()=>f.service.apply(f.request)).toThrow(ChiefEnhancementSetupError);
  expect([...f.bots.values()].map(chiefSetupSemanticSnapshot)).toEqual(before);expect(f.runtime.receipt(f.preview.previewHash)).toMatchObject({state:"failed",restoredTargets:["reviewer","chief"],preservedNewerTargets:[]});expect(f.stages.size).toBe(0);
});
it("preserves a newer user edit and reports partial instead of overwriting it during rollback",()=>{
  const f=fixture();f.hooks.commit=(id,index)=>{if(index===2){f.bots.get(id)!.soul="Newer owner content";throw new Error("synthetic concurrent edit");}};
  expect(()=>f.service.apply(f.request)).toThrow(ChiefEnhancementSetupError);expect(f.bots.get("chief")!.soul).toBe("Newer owner content");expect(f.runtime.receipt(f.preview.previewHash)).toMatchObject({state:"partial",preservedNewerTargets:["chief"]});
  expect(()=>f.service.apply(f.request)).toThrow(/fresh|changed|partial/);expect(f.commits()).toBe(2);
});
it("makes no live writes if staging fails and keeps a durable failed receipt",()=>{
  const f=fixture(),before=JSON.stringify([...f.bots]);let staged=0;f.hooks.stage=()=>{if(++staged===3)throw new Error("synthetic stage failure");};
  expect(()=>f.service.apply(f.request)).toThrow();expect(f.commits()).toBe(0);expect(JSON.stringify([...f.bots])).toBe(before);expect(f.runtime.receipt(f.preview.previewHash)?.state).toBe("failed");expect(f.stages.size).toBe(0);
});
it("persists a staged-cleanup failure diagnostic for later owner readback",()=>{
  const f=fixture();f.hooks.discard=()=>{throw new Error("synthetic stage cleanup failure");};
  const receipt=f.service.apply(f.request);expect(receipt.gaps.some(g=>g.includes("cleanup"))).toBe(true);expect(f.runtime.receipt(receipt.previewHash)?.gaps.some(g=>g.includes("cleanup"))).toBe(true);
});
it("records an unavailable readback after a committed write as partial without clobbering it",()=>{
  const f=fixture();f.hooks.commit=id=>{f.hooks.snapshot=target=>{if(target===id)throw new Error("synthetic committed profile readback unavailable");};};
  expect(()=>f.service.apply(f.request)).toThrow(ChiefEnhancementSetupError);
  expect(f.runtime.receipt(f.preview.previewHash)).toMatchObject({state:"partial",preservedNewerTargets:["chief"]});
  expect(f.bots.get("chief")!.skills).toHaveLength(1);
});
