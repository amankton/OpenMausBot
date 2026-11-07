import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHIEF_ENHANCEMENT_ADDENDUM, CHIEF_ENHANCEMENT_RELEASE, CHIEF_ENHANCEMENT_SKILLS, MAIL_REVIEW_ADDENDUM, type ChiefEnhancementBundle, type ChiefSetupBotSnapshot } from "../shared/chief-enhancement-setup.ts";
import { ChiefEnhancementSetupError, ChiefEnhancementSetupService, chiefSetupHash } from "./chief-enhancement-setup.ts";
import { ChiefEnhancementSetupRuntime } from "./chief-enhancement-setup-runtime.ts";
import { profileRevision } from "./profile-revision.ts";
import { soulFile } from "./bot-folder.ts";
import { applyStagedSkillWrite, listSkills, readSkillFile, rejectStagedSkillWrite, removeSkill, setSkillEnabled, stageSkillWrite } from "./skills.ts";
import { listLibrarySkills, readLibrarySkillFile } from "./skill-library.ts";
import type { BotRecord } from "./store.ts";

/** Electron supplies its resources directory. The sibling fallback works in
 * both server/*.ts and the packaged dist-server/index.js bundle. */
export function loadChiefEnhancementBundle(root = process.env.OMB_SKILLS_DIR || fileURLToPath(new URL("../skills/",import.meta.url))): ChiefEnhancementBundle {
  return {release:CHIEF_ENHANCEMENT_RELEASE,chiefAddendum:CHIEF_ENHANCEMENT_ADDENDUM,mailAddendum:MAIL_REVIEW_ADDENDUM,skills:CHIEF_ENHANCEMENT_SKILLS.map(name=>{
    const path=join(root,name,"SKILL.md");
    if(statSync(path).size>32768)throw new ChiefEnhancementSetupError("Bundled enhancement skills exceed the supported review limit",503);
    return {name,content:readFileSync(path,"utf8")};
  })};
}

export function createChiefEnhancementSetupApp(deps:{
  dataDir:string; bots():readonly BotRecord[]; bot(id:string):BotRecord|null|undefined;
  libraryEnabled():boolean; patchSoul(id:string,soul:string):void;
  setAssignments(id:string,names:string[]):void;
  bundle?():ChiefEnhancementBundle;
}) {
  const authority=new AsyncLocalStorage<()=>void>();
  const assertCurrent=()=>{const check=authority.getStore();if(!check)throw new ChiefEnhancementSetupError("A current owner review is required",403);check();};
  const existing=(id:string)=>{const bot=deps.bot(id);if(!bot||bot.hidden)throw new ChiefEnhancementSetupError("This existing agent is unavailable",404);return bot;};
  const snapshot=(id:string):ChiefSetupBotSnapshot|undefined=>{
    const bot=deps.bot(id);if(!bot||bot.hidden)return undefined;
    const soul=bot.soul??"",mirror=soulFile(id);
    // Preserve local editor changes instead of silently replacing them with
    // the canonical profile while installing an unrelated addendum.
    if(existsSync(mirror)&&(statSync(mirror).size>24000||readFileSync(mirror,"utf8")!==soul))throw new ChiefEnhancementSetupError("Review the selected agent's pending SOUL.md edits in its existing profile editor before setup");
    const own=listSkills(id),ownNames=new Set(own.map(skill=>skill.name));
    const skills:ChiefSetupBotSnapshot["skills"]=own.map(skill=>({name:skill.name,content:readSkillFile(id,skill.name),source:skill.source,enabled:skill.enabled,assigned:true,kind:"local",revision:chiefSetupHash(skill)}));
    if(deps.libraryEnabled())for(const skill of listLibrarySkills())if(!ownNames.has(skill.name))skills.push({name:skill.name,content:readLibrarySkillFile(skill.name),source:skill.source,enabled:skill.enabled,assigned:bot.assignedSkills?.includes(skill.name)??false,kind:"assigned",revision:chiefSetupHash(skill)});
    const {soul:_soul,soulHash:_soulHash,soulDrift:_drift,assignedSkills:_assigned,tasks:_tasks,resumeCursors:_resume,...protectedState}=bot;
    return {id,name:bot.name,title:bot.title,roles:bot.chiefOfStaff?["chief"]:[],soul,profileRevision:profileRevision(bot),skillAssignmentRevision:chiefSetupHash({library:deps.libraryEnabled(),assigned:bot.assignedSkills??[]}),protectedStateHash:chiefSetupHash(protectedState),skills,skillMode:"local"};
  };
  const checked=<T>(result:T|{error:string}):T=>{if(result&&typeof result==="object"&&"error" in result)throw new ChiefEnhancementSetupError("A supported skill operation could not commit the reviewed setup",409);return result as T;};
  const runtime=new ChiefEnhancementSetupRuntime(deps.dataDir,{
    snapshot,assertCurrent,
    stageSkill(id,input){assertCurrent();existing(id);if(input.kind!=="local")throw new ChiefEnhancementSetupError("Only private staged file installation is supported",503);const staged=checked(stageSkillWrite(id,{action:"create",files:[{path:"SKILL.md",content:input.content}],source:input.source}));return {id:staged.id,source:staged.source};},
    commitStagedSkill(id,stage,expectedSha256){assertCurrent();existing(id);checked(applyStagedSkillWrite(id,stage,{expectedSha256}));},
    // Exact setup-owned staging cleanup never promotes or rewrites live data.
    discardStagedSkill(id,stage){const result=rejectStagedSkillWrite(id,stage);if("error" in result&&result.error!=="no such staged skill")checked(result);},
    setSkillEnabled(id,name,enabled){assertCurrent();existing(id);checked(setSkillEnabled(id,name,enabled));},
    setSkillAssigned(id,name,assigned){assertCurrent();const bot=existing(id);if(!deps.libraryEnabled())throw new ChiefEnhancementSetupError("Library assignments changed during setup");const names=new Set(bot.assignedSkills??[]);if(assigned)names.add(name);else names.delete(name);deps.setAssignments(id,[...names]);},
    removeSkill(id,name,source){assertCurrent();existing(id);if(listSkills(id).find(skill=>skill.name===name)?.source!==source)throw new ChiefEnhancementSetupError("Setup skill provenance changed");checked(removeSkill(id,name));},
    setSoul(id,soul){assertCurrent();existing(id);deps.patchSoul(id,soul);},
  });
  return {runtime,service(assertOwner:()=>void){return new ChiefEnhancementSetupService({assertOwner,bundle:deps.bundle??loadChiefEnhancementBundle,roster:()=>deps.bots().filter(bot=>!bot.hidden).map(bot=>({id:bot.id,name:bot.name,title:bot.title,roles:bot.chiefOfStaff?["chief"]:[]})),runtime:{snapshot,receipt:hash=>runtime.receipt(hash),apply:preview=>authority.run(assertOwner,()=>runtime.apply(preview))}});}};
}
