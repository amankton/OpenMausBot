import { createHash } from "node:crypto";
import { parseSkillMd, scanSkillText } from "../shared/skill-md.ts";
import {
  CHIEF_ENHANCEMENT_SKILLS, chiefEnhancementApplyRequestSchema, chiefEnhancementPreviewRequestSchema,
  type ChiefEnhancementBundle, type ChiefEnhancementPreview, type ChiefEnhancementSelection,
  type ChiefSetupBotSnapshot, type ChiefSetupBotSummary, type ChiefSetupReceipt, type ChiefSetupTargetPlan,
} from "../shared/chief-enhancement-setup.ts";

export class ChiefEnhancementSetupError extends Error {
  readonly status: number;
  readonly receipt?: ChiefSetupReceipt;
  constructor(message: string, status = 409, receipt?: ChiefSetupReceipt) { super(message); this.name = "ChiefEnhancementSetupError"; this.status = status; this.receipt = receipt; }
}
function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
}
export const chiefSetupHash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
export const chiefSetupContentHash = (value: string) => createHash("sha256").update(value).digest("hex");
export function chiefSetupSnapshotHash(snapshot: ChiefSetupBotSnapshot) { return chiefSetupHash({...snapshot,skills: [...snapshot.skills].sort((a,b) => a.name.localeCompare(b.name))}); }
export function chiefSetupSemanticSnapshot(snapshot: ChiefSetupBotSnapshot) {
  const {profileRevision: _profileRevision,skillAssignmentRevision: _assignments,...bot} = snapshot;
  return {...bot,skills: bot.skills.map(({revision: _revision,...skill}) => skill).sort((a,b) => a.name.localeCompare(b.name))};
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function append(soul: string, role: "chief" | "mail-reviewer", text: string, release: string, conflicts: string[]) {
  const begin = `<!-- chief-enhancement:${release}:${role}:${chiefSetupContentHash(text)} -->`;
  const end = `<!-- /chief-enhancement:${release}:${role} -->`;
  const block = `${begin}\n${text}\n${end}`;
  const matching = soul.split(begin).length - 1;
  if (matching === 1 && soul.includes(block)) return soul;
  if (matching || soul.includes(`:${role}:`) && soul.includes("<!-- chief-enhancement:")) { conflicts.push(`The ${role} addendum already has a different or edited version; review it through the existing profile editor.`); return soul; }
  if (soul.includes(text)) return soul;
  return `${soul}${soul && !soul.endsWith("\n") ? "\n" : ""}${soul ? "\n" : ""}${block}\n`;
}
function checkedBundle(input: ChiefEnhancementBundle): ChiefEnhancementBundle {
  const bundle = copy(input);
  if (!/^[a-z0-9.-]{1,40}$/i.test(bundle.release) || !bundle.chiefAddendum?.trim() || !bundle.mailAddendum?.trim()) throw new ChiefEnhancementSetupError("The bundled enhancement release is invalid",503);
  if (bundle.skills.length !== 8 || new Set(bundle.skills.map(skill => skill.name)).size !== 8 || CHIEF_ENHANCEMENT_SKILLS.some(name => !bundle.skills.some(skill => skill.name === name))) throw new ChiefEnhancementSetupError("All eight exact bundled skills are required",503);
  for (const skill of bundle.skills) {
    const parsed = parseSkillMd(skill.content);
    if ("error" in parsed || parsed.name !== skill.name || Buffer.byteLength(skill.content) > 32768) throw new ChiefEnhancementSetupError("A bundled skill is invalid or exceeds the reviewed staging limit",503);
    // Use the same parser/scanner as the supported import path. Findings are
    // exposed in preview rather than bypassing normal content review.
    skill.warnings = scanSkillText(skill.content);
  }
  bundle.skills.sort((a,b) => CHIEF_ENHANCEMENT_SKILLS.indexOf(a.name) - CHIEF_ENHANCEMENT_SKILLS.indexOf(b.name));
  return bundle;
}
export interface ChiefSetupRuntime {
  snapshot(botId: string): ChiefSetupBotSnapshot | undefined;
  receipt(previewHash: string): ChiefSetupReceipt | undefined;
  apply(preview: ChiefEnhancementPreview): ChiefSetupReceipt;
}
export class ChiefEnhancementSetupService {
  private readonly deps: {roster(): ChiefSetupBotSummary[];bundle(): ChiefEnhancementBundle;runtime: ChiefSetupRuntime;assertOwner(): void};
  constructor(deps: ChiefEnhancementSetupService["deps"]) { this.deps = deps; }
  catalog() {
    this.deps.assertOwner(); const bundle = checkedBundle(this.deps.bundle());
    return {roster: copy(this.deps.roster()),bundle,catalogFingerprint: chiefSetupHash(bundle),guidance: ["Select existing agents. The same agent may serve both roles. Missing roles can be created only through the existing reviewed Team Setup flow."]};
  }
  preview(input: unknown): ChiefEnhancementPreview {
    this.deps.assertOwner(); const selection = chiefEnhancementPreviewRequestSchema.parse(input);
    const catalog = this.catalog(); const targets = new Map<string,ChiefSetupTargetPlan>(); const conflicts: string[] = [], missingRoles: string[] = [];
    for (const [role,id] of [["chief",selection.chiefBotId],["mail-reviewer",selection.reviewerBotId]] as const) {
      if (!id) { missingRoles.push(role); continue; }
      const summary = catalog.roster.find(bot => bot.id === id); const snapshot = summary ? this.deps.runtime.snapshot(id) : undefined;
      if (!snapshot || snapshot.id !== id) { missingRoles.push(role); continue; }
      let target = targets.get(id);
      if (!target) { const before = copy(snapshot); target = {botId: id,name: summary!.name,roles: [],expectedSnapshotHash: chiefSetupSnapshotHash(before),before,nextSoul: before.soul,addenda: [],skills: []}; targets.set(id,target); }
      target.roles.push(role);
      const content = role === "chief" ? catalog.bundle.chiefAddendum : catalog.bundle.mailAddendum;
      target.addenda.push({role,content,sha256: chiefSetupContentHash(content)});
      target.nextSoul = append(target.nextSoul,role,content,catalog.bundle.release,conflicts);
      const names = role === "chief" ? CHIEF_ENHANCEMENT_SKILLS.slice(0,4) : CHIEF_ENHANCEMENT_SKILLS.slice(4);
      for (const name of names) {
        const file = catalog.bundle.skills.find(skill => skill.name === name)!;
        const existing = target.before.skills.filter(skill => skill.name === name);
        let action: ChiefSetupTargetPlan["skills"][number]["action"] = "install";
        if (existing.length > 1 || existing.length === 1 && existing[0].content !== file.content) { action = "conflict"; conflicts.push(`${target.name}: existing skill ${name} has different or unreadable content; it will not be overwritten.`); }
        else if (existing.length) {
          const skill = existing[0];
          if (skill.kind === "assigned" && !skill.enabled) { action = "conflict"; conflicts.push(`${target.name}: shared library skill ${name} is disabled; review it through the existing library controls.`); }
          else action = skill.kind === "assigned" && !skill.assigned ? "assign" : !skill.enabled ? "enable" : "keep";
        }
        target.skills.push({name,content: file.content,sha256: chiefSetupContentHash(file.content),action});
      }
      if (Buffer.byteLength(target.nextSoul) > 24000) conflicts.push(`${target.name}: preserved instructions plus the addendum exceed the supported profile limit.`);
    }
    this.deps.assertOwner();
    const planned = [...targets.values()];
    const previewHash = chiefSetupHash({selection,release: catalog.bundle.release,catalogFingerprint: catalog.catalogFingerprint,targets: planned,conflicts,missingRoles});
    return {...catalog,selection,release: catalog.bundle.release,previewHash,targets: planned,conflicts,missingRoles,changesNeeded: planned.some(target => target.nextSoul !== target.before.soul || target.skills.some(skill => skill.action !== "keep"))};
  }
  apply(input: unknown): ChiefSetupReceipt {
    this.deps.assertOwner(); const request = chiefEnhancementApplyRequestSchema.parse(input);
    const old = this.deps.runtime.receipt(request.previewHash);
    if (old?.state === "applied") {
      if (old.catalogFingerprint !== this.catalog().catalogFingerprint || old.catalogFingerprint !== request.catalogFingerprint || old.selection.chiefBotId !== request.chiefBotId || old.selection.reviewerBotId !== request.reviewerBotId || old.targetIds.length !== new Set([request.chiefBotId,request.reviewerBotId]).size || !old.targetIds.every(id => [request.chiefBotId,request.reviewerBotId].includes(id)) || old.targetIds.some(id => { const current = this.deps.runtime.snapshot(id); return !current || chiefSetupSnapshotHash(current) !== old.readbackHashes[id]; })) throw new ChiefEnhancementSetupError("Saved setup changed after installation; refresh the preview before continuing");
      return old;
    }
    const preview = this.preview({chiefBotId: request.chiefBotId,reviewerBotId: request.reviewerBotId});
    if (preview.previewHash !== request.previewHash || preview.catalogFingerprint !== request.catalogFingerprint) throw new ChiefEnhancementSetupError("The exact target profile, skill assignments or bundled content changed; review a fresh preview");
    if (preview.conflicts.length || preview.missingRoles.length) throw new ChiefEnhancementSetupError("Resolve the displayed conflicts or select existing roles before applying");
    this.deps.assertOwner(); return this.deps.runtime.apply(preview);
  }
}
export type { ChiefEnhancementSelection };
