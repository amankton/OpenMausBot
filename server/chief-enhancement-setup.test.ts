import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { CHIEF_ENHANCEMENT_ADDENDUM, CHIEF_ENHANCEMENT_SKILLS, MAIL_REVIEW_ADDENDUM, type ChiefEnhancementBundle, type ChiefSetupBotSnapshot, type ChiefSetupReceipt } from "../shared/chief-enhancement-setup.ts";
import { ChiefEnhancementSetupRuntime, type ChiefSetupSupportedAdapter } from "./chief-enhancement-setup-runtime.ts";
import { ChiefEnhancementSetupService, chiefSetupHash, chiefSetupSnapshotHash } from "./chief-enhancement-setup.ts";
import { applyStagedSkillWrite, listSkills, listStagedSkillWrites, readSkillFile, rejectStagedSkillWrite, removeSkill, setSkillEnabled, stageSkillWrite } from "./skills.ts";
import { DATA_DIR } from "./config.ts";
import { workspaceDir } from "./workspace.ts";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
const bundle = (): ChiefEnhancementBundle => ({release:"1",chiefAddendum:CHIEF_ENHANCEMENT_ADDENDUM,mailAddendum:MAIL_REVIEW_ADDENDUM,skills:CHIEF_ENHANCEMENT_SKILLS.map(name=>({name,content:readFileSync(new URL(`../skills/${name}/SKILL.md`,import.meta.url),"utf8")}))});
function fixture() {
  const id=`setup-test-${randomUUID()}`,dir=mkdtempSync(join(tmpdir(),"chief-setup-supported-"));
  let soul="Original custom identity",revision=0,deny=false;
  const stageIds=new Map<string,string>();
  const snapshot=():ChiefSetupBotSnapshot=>({id,name:"Existing Chief",roles:["existing"],soul,profileRevision:String(revision),skillAssignmentRevision:"unchanged",protectedStateHash:chiefSetupHash({model:"preserved",teams:["same"],grants:["existing"],schedules:[]}),skillMode:"local",skills:listSkills(id).map(skill=>({name:skill.name,content:readSkillFile(id,skill.name),source:skill.source,kind:"local",enabled:skill.enabled,assigned:true,revision:skill.sha256}))});
  const requireSuccess=(result:unknown)=>{ if(result&&typeof result==="object"&&"error" in result)throw new Error(String(result.error)); };
  const adapter:ChiefSetupSupportedAdapter={snapshot:()=>snapshot(),assertCurrent(){if(deny)throw new Error("synthetic revoked owner");},
    stageSkill(bot,input){const result=stageSkillWrite(bot,{action:"create",files:[{path:"SKILL.md",content:input.content}],source:input.source});if("error" in result)throw new Error(result.error);stageIds.set(result.id,input.name);return {id:result.id,source:result.source};},
    commitStagedSkill(bot,stage,expectedSha256){requireSuccess(applyStagedSkillWrite(bot,stage,{expectedSha256}));},
    discardStagedSkill(bot,stage){const result=rejectStagedSkillWrite(bot,stage);if("error" in result&&result.error!=="no such staged skill")throw new Error(result.error);},
    setSkillEnabled(bot,name,enabled){requireSuccess(setSkillEnabled(bot,name,enabled));},
    removeSkill(bot,name){requireSuccess(removeSkill(bot,name));},setSoul(_bot,next){soul=next;revision++;},
  };
  let runtime=new ChiefEnhancementSetupRuntime(dir,adapter);
  cleanups.push(()=>{runtime.close();rmSync(dir,{recursive:true,force:true});rmSync(workspaceDir(id),{recursive:true,force:true});rmSync(join(DATA_DIR,"skill-state",id),{recursive:true,force:true});});
  let currentBundle=bundle();
  const service=new ChiefEnhancementSetupService({roster:()=>[{id,name:"Existing Chief",roles:["existing"]}],bundle:()=>currentBundle,runtime:{snapshot:bot=>runtime.snapshot(bot),receipt:hash=>runtime.receipt(hash),apply:preview=>runtime.apply(preview)},assertOwner(){if(deny)throw new Error("synthetic revoked owner");}});
  const preview=()=>service.preview({chiefBotId:id,reviewerBotId:id});
  const request=(p=preview())=>({chiefBotId:id,reviewerBotId:id,previewHash:p.previewHash,catalogFingerprint:p.catalogFingerprint,reviewed:true as const});
  return {id,dir,adapter,service,preview,request,snapshot,stageIds,runtime:()=>runtime,reopen(){runtime.close();runtime=new ChiefEnhancementSetupRuntime(dir,adapter);},changeBundle(){currentBundle={...currentBundle,chiefAddendum:`${currentBundle.chiefAddendum} New reviewed text.`};},revoke(){deny=true;}};
}
it("installs all eight exact bundled files through real supported stage/apply APIs and retries without duplicate writes",()=>{
  const f=fixture(),p=f.preview(),before=f.snapshot(),request=f.request(p),receipt=f.service.apply(request);
  expect(receipt.state).toBe("applied");expect(listStagedSkillWrites(f.id)).toEqual([]);expect(listSkills(f.id)).toHaveLength(8);
  for(const skill of p.bundle.skills)expect(readSkillFile(f.id,skill.name)).toBe(skill.content);
  expect(f.snapshot().protectedStateHash).toBe(before.protectedStateHash);expect(f.snapshot().soul.startsWith(before.soul)).toBe(true);
  expect(f.service.apply(request)).toEqual(receipt);expect(f.runtime().apply(p)).toEqual(receipt);expect(f.preview().changesNeeded).toBe(false);
  f.changeBundle();expect(()=>f.service.apply(request)).toThrow(/changed|refresh/);
});
it("cleans durable owned stages after an interrupted pre-write run and allows an unchanged reviewed retry",()=>{
  const f=fixture(),p=f.preview(),skill=p.targets[0]!.skills[0]!,source=`chief-enhancement:${p.release}:${p.previewHash}`;
  const stage=f.adapter.stageSkill(f.id,{name:skill.name,content:skill.content,source,kind:"local"});
  const receipt:ChiefSetupReceipt={previewHash:p.previewHash,catalogFingerprint:p.catalogFingerprint,state:"working",at:1,targetIds:[f.id],selection:{chiefBotId:f.id,reviewerBotId:f.id},readbackHashes:{[f.id]:chiefSetupSnapshotHash(f.snapshot())},restoredTargets:[],preservedNewerTargets:[],gaps:[]};
  const db=new DatabaseSync(join(f.dir,"chief-enhancement-setup.db"));db.prepare("INSERT INTO chief_setup_receipts VALUES(?,?)").run(p.previewHash,JSON.stringify(receipt));db.prepare("INSERT INTO chief_setup_stages VALUES(?,?,?)").run(p.previewHash,f.id,stage.id);db.close();
  f.reopen();expect(f.runtime().receipt(p.previewHash)?.state).toBe("failed");expect(listStagedSkillWrites(f.id)).toEqual([]);expect(f.service.apply(f.request(p)).state).toBe("applied");
});
it("retains an interrupted run as partial when target state changed and refuses blind replay",()=>{
  const f=fixture(),p=f.preview(),receipt:ChiefSetupReceipt={previewHash:p.previewHash,catalogFingerprint:p.catalogFingerprint,state:"working",at:1,targetIds:[f.id],selection:{chiefBotId:f.id,reviewerBotId:f.id},readbackHashes:{[f.id]:chiefSetupSnapshotHash(f.snapshot())},restoredTargets:[],preservedNewerTargets:[],gaps:[]};
  const db=new DatabaseSync(join(f.dir,"chief-enhancement-setup.db"));db.prepare("INSERT INTO chief_setup_receipts VALUES(?,?)").run(p.previewHash,JSON.stringify(receipt));db.close();f.adapter.setSoul(f.id,"Owner newer edit");f.reopen();
  expect(f.runtime().receipt(p.previewHash)?.state).toBe("partial");expect(()=>f.runtime().apply(p)).toThrow(/partial|interrupted/);expect(f.snapshot().soul).toBe("Owner newer edit");expect(listSkills(f.id)).toEqual([]);
});
it("does not prevent server startup when interrupted target readback is unavailable",()=>{
  const f=fixture(),p=f.preview(),receipt:ChiefSetupReceipt={previewHash:p.previewHash,catalogFingerprint:p.catalogFingerprint,state:"working",at:1,targetIds:[f.id],selection:{chiefBotId:f.id,reviewerBotId:f.id},readbackHashes:{[f.id]:chiefSetupSnapshotHash(f.snapshot())},restoredTargets:[],preservedNewerTargets:[],gaps:[]};
  const db=new DatabaseSync(join(f.dir,"chief-enhancement-setup.db"));db.prepare("INSERT INTO chief_setup_receipts VALUES(?,?)").run(p.previewHash,JSON.stringify(receipt));db.close();
  f.adapter.snapshot=()=>{throw new Error("Synthetic pending editor change");};expect(()=>f.reopen()).not.toThrow();expect(f.runtime().receipt(p.previewHash)?.state).toBe("partial");
});
it("closes owner authority before staging or publication",()=>{const f=fixture(),p=f.preview();f.revoke();expect(()=>f.service.apply(f.request(p))).toThrow();expect(listSkills(f.id)).toEqual([]);expect(listStagedSkillWrites(f.id)).toEqual([]);});
it("uses supported library assignments without enabling shared disabled content or touching another agent",()=>{
  const dir=mkdtempSync(join(tmpdir(),"chief-setup-assignment-")),files=bundle();
  const bot:ChiefSetupBotSnapshot={id:"existing",name:"Chief",roles:[],soul:"Existing",profileRevision:"1",skillAssignmentRevision:"1",protectedStateHash:"same-model-grants",skillMode:"assignment",skills:files.skills.map(skill=>({name:skill.name,content:skill.content,source:"shared-reviewed",kind:"assigned",enabled:true,assigned:false,revision:"1"}))};
  const anotherAgentAssignments=["unrelated","scan-mail"],assignmentBefore=JSON.stringify(anotherAgentAssignments);let assignmentWrites=0,stageWrites=0;
  const adapter:ChiefSetupSupportedAdapter={snapshot:()=>structuredClone(bot),stageSkill(){stageWrites++;throw new Error("Existing shared content requires assignment only");},commitStagedSkill(){throw new Error("No install expected");},discardStagedSkill(){},setSkillEnabled(){throw new Error("Never enable globally");},setSkillAssigned(_id,name,assigned){bot.skills.find(skill=>skill.name===name)!.assigned=assigned;bot.skillAssignmentRevision=String(++assignmentWrites);},removeSkill(){throw new Error("No removal expected");},setSoul(_id,soul){bot.soul=soul;bot.profileRevision="2";}};
  const runtime=new ChiefEnhancementSetupRuntime(dir,adapter);cleanups.push(()=>{runtime.close();rmSync(dir,{recursive:true,force:true});});
  const service=new ChiefEnhancementSetupService({assertOwner(){},runtime,bundle:()=>files,roster:()=>[{id:bot.id,name:bot.name,roles:[]}]});
  let p=service.preview({chiefBotId:bot.id,reviewerBotId:bot.id});expect(p.targets[0]!.skills.every(skill=>skill.action==="assign")).toBe(true);
  bot.skills[0]!.enabled=false;const conflict=service.preview({chiefBotId:bot.id,reviewerBotId:bot.id});expect(conflict.conflicts.join(" ")).toContain("disabled");expect(()=>service.apply({chiefBotId:bot.id,reviewerBotId:bot.id,previewHash:conflict.previewHash,catalogFingerprint:conflict.catalogFingerprint,reviewed:true})).toThrow();expect(assignmentWrites).toBe(0);
  bot.skills[0]!.enabled=true;p=service.preview({chiefBotId:bot.id,reviewerBotId:bot.id});expect(service.apply({chiefBotId:bot.id,reviewerBotId:bot.id,previewHash:p.previewHash,catalogFingerprint:p.catalogFingerprint,reviewed:true}).state).toBe("applied");expect(assignmentWrites).toBe(8);expect(stageWrites).toBe(0);expect(JSON.stringify(anotherAgentAssignments)).toBe(assignmentBefore);
});
