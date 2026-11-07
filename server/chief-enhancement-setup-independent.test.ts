import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { CHIEF_ENHANCEMENT_ADDENDUM, CHIEF_ENHANCEMENT_SKILLS, MAIL_REVIEW_ADDENDUM, type ChiefEnhancementBundle, type ChiefSetupBotSnapshot, type ChiefSetupReceipt } from "../shared/chief-enhancement-setup.ts";
import { ChiefEnhancementSetupService, chiefSetupSnapshotHash } from "./chief-enhancement-setup.ts";

function fixture() {
  const bundle: ChiefEnhancementBundle = {release:"1",chiefAddendum:CHIEF_ENHANCEMENT_ADDENDUM,mailAddendum:MAIL_REVIEW_ADDENDUM,skills:CHIEF_ENHANCEMENT_SKILLS.map(name => ({name,content:readFileSync(new URL(`../skills/${name}/SKILL.md`,import.meta.url),"utf8")}))};
  const bots = new Map<string,ChiefSetupBotSnapshot>(["chief","reviewer"].map(id => [id,{id,name:id,roles:[],soul:`Existing ${id} identity and custom instructions`,profileRevision:"profile-1",skillAssignmentRevision:"assignment-1",protectedStateHash:"unchanged-model-teams-permissions",skills:[],skillMode:"local"}]));
  const receipts = new Map<string,ChiefSetupReceipt>(); let owner = true, applies = 0;
  const service = new ChiefEnhancementSetupService({assertOwner:() => { if (!owner) throw new Error("owner authority revoked"); },roster:() => [...bots.values()].map(({id,name,roles}) => ({id,name,roles})),bundle:() => bundle,runtime:{
    snapshot:id => bots.get(id),receipt:hash => receipts.get(hash),apply:preview => {
      const {chiefBotId,reviewerBotId}=preview.selection;
      if(!chiefBotId||!reviewerBotId)throw new Error("Fixture apply requires both selected roles");
      applies++;
      for (const target of preview.targets) {
        const before = bots.get(target.botId)!;
        bots.set(target.botId,{...before,soul:target.nextSoul,profileRevision:"profile-2",skills:target.skills.map(skill => ({name:skill.name,content:skill.content,enabled:true,assigned:true,kind:"local",source:"fixture",revision:"skill-2"}))});
      }
      const receipt = {previewHash:preview.previewHash,catalogFingerprint:preview.catalogFingerprint,state:"applied" as const,at:Date.now(),targetIds:preview.targets.map(t => t.botId),readbackHashes:Object.fromEntries(preview.targets.map(t => [t.botId,chiefSetupSnapshotHash(bots.get(t.botId)!)])),restoredTargets:[],preservedNewerTargets:[],gaps:[],selection:{chiefBotId,reviewerBotId}};
      receipts.set(receipt.previewHash,receipt); return receipt;
    },
  }});
  const preview = () => service.preview({chiefBotId:"chief",reviewerBotId:"reviewer"});
  const request = (p = preview()) => ({chiefBotId:"chief",reviewerBotId:"reviewer",previewHash:p.previewHash,catalogFingerprint:p.catalogFingerprint,reviewed:true as const});
  return {service,bots,bundle,preview,request,applies:() => applies,revokeOwner:() => {owner=false;}};
}

it("previews missing roles without creating agents or mutating existing profiles",() => {
  const f = fixture(), before = JSON.stringify([...f.bots]); const p = f.service.preview({});
  expect(p.missingRoles).toEqual(["chief","mail-reviewer"]); expect(p.targets).toHaveLength(0); expect(f.applies()).toBe(0); expect(JSON.stringify([...f.bots])).toBe(before);
});
it("deduplicates one selected identity while showing both exact addenda and all eight documents",() => {
  const f = fixture(), p = f.service.preview({chiefBotId:"chief",reviewerBotId:"chief"});
  expect(p.targets).toHaveLength(1); const target = p.targets[0]; expect(target.roles).toEqual(["chief","mail-reviewer"]); expect(target.skills).toHaveLength(8); expect(new Set(target.skills.map(s => s.name)).size).toBe(8);
  expect(target.nextSoul).toContain("Existing chief identity and custom instructions"); expect(target.addenda.map(a => a.content)).toEqual([CHIEF_ENHANCEMENT_ADDENDUM,MAIL_REVIEW_ADDENDUM]); expect(f.applies()).toBe(0);
});
it("keeps distinct role assignments and protects model/permission state",() => {
  const f = fixture(), p = f.preview(); expect(p.targets.map(t => t.skills.length)).toEqual([4,4]); f.service.apply(f.request(p));
  for (const id of ["chief","reviewer"]) expect(f.bots.get(id)?.protectedStateHash).toBe("unchanged-model-teams-permissions");
});
it("refuses conflicting same-name content rather than overwriting it",() => {
  const f = fixture(); f.bots.get("chief")!.skills.push({name:"executive-check-in",content:"Different existing user skill",enabled:true,assigned:true,kind:"local",source:"fixture",revision:"existing"});
  const p = f.preview(); expect(p.conflicts.length).toBeGreaterThan(0); expect(() => f.service.apply(f.request(p))).toThrow(/conflicts/); expect(f.applies()).toBe(0);
});
it.each(["profile","assignment","skill","catalog"])("rejects a stale reviewed %s snapshot without writes",change => {
  const f = fixture(), p = f.preview();
  if (change === "profile") f.bots.get("chief")!.soul += " New owner edit";
  if (change === "assignment") f.bots.get("chief")!.skillAssignmentRevision = "assignment-2";
  if (change === "skill") f.bots.get("chief")!.skills.push({name:"executive-check-in",content:f.bundle.skills[0].content,enabled:true,assigned:true,kind:"local",source:"fixture",revision:"new-skill"});
  if (change === "catalog") f.bundle.chiefAddendum += " New release content";
  expect(() => f.service.apply(f.request(p))).toThrow(/changed|fresh/); expect(f.applies()).toBe(0);
});
it("retries an exact applied request without duplicated addenda or writes",() => {
  const f = fixture(), request = f.request(); const first = f.service.apply(request); const second = f.service.apply(request);
  expect(second).toEqual(first); expect(f.applies()).toBe(1); expect(f.preview().changesNeeded).toBe(false);
});
it("rejects a cached retry whose role mapping differs despite matching target IDs",() => {
  const f = fixture(), request = f.request(); f.service.apply(request);
  expect(() => f.service.apply({...request,chiefBotId:"reviewer",reviewerBotId:"chief"})).toThrow(/changed|mapping|selection|review/); expect(f.applies()).toBe(1);
});
it("preserves a newer user edit when retrying an old successful request",() => {
  const f = fixture(), request = f.request(); f.service.apply(request); f.bots.get("chief")!.soul += " Newer user content";
  expect(() => f.service.apply(request)).toThrow(/changed/); expect(f.bots.get("chief")!.soul).toContain("Newer user content"); expect(f.applies()).toBe(1);
});
it("requires affirmative review and current owner authority",() => {
  const f = fixture(), request = f.request(); expect(() => f.service.apply({...request,reviewed:false})).toThrow(); f.revokeOwner(); expect(() => f.service.apply(request)).toThrow(/authority/); expect(f.applies()).toBe(0);
});
