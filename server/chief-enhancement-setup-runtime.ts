import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ChiefEnhancementSetupError, chiefSetupHash, chiefSetupContentHash, chiefSetupSnapshotHash, chiefSetupSemanticSnapshot } from "./chief-enhancement-setup.ts";
import type { ChiefEnhancementPreview, ChiefSetupBotSnapshot, ChiefSetupReceipt, ChiefSetupTargetPlan } from "../shared/chief-enhancement-setup.ts";

export interface ChiefSetupStage {id: string;source: string}
export interface ChiefSetupSupportedAdapter {
  snapshot(botId: string): ChiefSetupBotSnapshot | undefined;
  /** Implement through stageSkillWrite/create-only, or a protected library
   * staging adapter. Exact source/content provenance must survive commit. */
  stageSkill(botId: string,input: {name: string;content: string;source: string;kind: "local" | "assigned"}): ChiefSetupStage;
  commitStagedSkill(botId: string,stageId: string,expectedSha256: string): void;
  discardStagedSkill(botId: string,stageId: string): void;
  setSkillEnabled(botId: string,name: string,enabled: boolean): void;
  setSkillAssigned?(botId: string,name: string,assigned: boolean): void;
  /** Remove only this exact source's new install/assignment through supported
   * helpers; never remove another bot's library assignment or shared content. */
  removeSkill(botId: string,name: string,source: string): void;
  /** Patch soul only through the supported profile/store history path. */
  setSoul(botId: string,soul: string): void;
  assertCurrent?(): void;
}
type Stage = ChiefSetupStage & {botId: string;name: string;sha256: string};
type Owned = {target: ChiefSetupTargetPlan;lastHash: string;changed: boolean;added: Set<string>;enabled: Set<string>;assigned: Set<string>;soul: boolean};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const semanticHash = (snapshot: ChiefSetupBotSnapshot) => chiefSetupHash(chiefSetupSemanticSnapshot(snapshot));

/** A concrete multi-file transaction coordinator around supported app APIs.
 * All live writes are synchronous: all targets are checked before staging,
 * again before the first write and before every mutation. Conditional rollback
 * never restores an old whole-bot record or clobbers a newer revision. */
export class ChiefEnhancementSetupRuntime {
  private readonly adapter: ChiefSetupSupportedAdapter;
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  constructor(dataDir: string,adapter: ChiefSetupSupportedAdapter,now: () => number = Date.now) {
    this.adapter = adapter; this.now = now; mkdirSync(dataDir,{recursive: true});
    const path = join(dataDir,"chief-enhancement-setup.db"); this.db = new DatabaseSync(path,{timeout: 5000}); chmodSync(path,0o600);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS chief_setup_receipts(preview_hash TEXT PRIMARY KEY,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chief_setup_events(id INTEGER PRIMARY KEY,preview_hash TEXT NOT NULL,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chief_setup_stages(preview_hash TEXT NOT NULL,bot_id TEXT NOT NULL,stage_id TEXT NOT NULL,PRIMARY KEY(preview_hash,bot_id,stage_id));`);
    for (const row of this.db.prepare("SELECT payload FROM chief_setup_receipts").all() as Array<{payload: string}>) {
      const receipt = JSON.parse(row.payload) as ChiefSetupReceipt;
      if (receipt.state === "working") {
        const unchanged = receipt.targetIds.every(id => { try { const snapshot = this.snapshot(id); return snapshot && chiefSetupSnapshotHash(snapshot) === receipt.readbackHashes[id]; } catch { return false; } });
        receipt.state = unchanged ? "failed" : "partial";
        receipt.gaps.push(unchanged ? "Setup was interrupted before any target changed. Review the current preview before retrying." : "Setup was interrupted; inspect saved state and review a fresh preview before continuing");
      }
      this.cleanupStages(receipt);
      this.save(receipt);
    }
  }
  close() { this.db.close(); }
  snapshot(botId: string) { const value = this.adapter.snapshot(botId); return value ? clone(value) : undefined; }
  receipt(previewHash: string): ChiefSetupReceipt | undefined { const row = this.db.prepare("SELECT payload FROM chief_setup_receipts WHERE preview_hash=?").get(previewHash) as {payload: string} | undefined; return row ? JSON.parse(row.payload) as ChiefSetupReceipt : undefined; }
  private save(receipt: ChiefSetupReceipt) {
    this.db.exec("BEGIN IMMEDIATE");
    try { const payload = JSON.stringify(receipt); this.db.prepare("INSERT INTO chief_setup_receipts VALUES(?,?) ON CONFLICT(preview_hash) DO UPDATE SET payload=excluded.payload").run(receipt.previewHash,payload); this.db.prepare("INSERT INTO chief_setup_events(preview_hash,payload) VALUES(?,?)").run(receipt.previewHash,payload); this.db.exec("COMMIT"); }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  private current(botId: string): ChiefSetupBotSnapshot { const value = this.snapshot(botId); if (!value) throw new ChiefEnhancementSetupError("A selected existing agent is unavailable"); return value; }
  private cleanupStages(receipt: ChiefSetupReceipt) {
    for (const row of this.db.prepare("SELECT bot_id,stage_id FROM chief_setup_stages WHERE preview_hash=?").all(receipt.previewHash) as Array<{bot_id: string;stage_id: string}>) {
      try { this.adapter.discardStagedSkill(row.bot_id,row.stage_id); this.db.prepare("DELETE FROM chief_setup_stages WHERE preview_hash=? AND bot_id=? AND stage_id=?").run(receipt.previewHash,row.bot_id,row.stage_id); }
      catch { const gap = "A setup-owned staged skill needs cleanup through the existing skill review controls"; if (!receipt.gaps.includes(gap)) receipt.gaps.push(gap); }
    }
  }
  private assertOwned(owned: Map<string,Owned>) { this.adapter.assertCurrent?.(); for (const [id,item] of owned) if (chiefSetupSnapshotHash(this.current(id)) !== item.lastHash) throw new ChiefEnhancementSetupError("A selected profile, skill content or assignment changed during setup"); }
  apply(preview: ChiefEnhancementPreview): ChiefSetupReceipt {
    if (preview.missingRoles.length || preview.conflicts.length || !preview.selection.chiefBotId || !preview.selection.reviewerBotId) throw new ChiefEnhancementSetupError("Select existing roles and resolve conflicts before applying setup");
    const old = this.receipt(preview.previewHash);
    if (old?.state === "applied") {
      if (old.catalogFingerprint !== preview.catalogFingerprint || old.selection.chiefBotId !== preview.selection.chiefBotId || old.selection.reviewerBotId !== preview.selection.reviewerBotId || old.targetIds.some(id => { const snapshot = this.snapshot(id); return !snapshot || chiefSetupSnapshotHash(snapshot) !== old.readbackHashes[id]; })) throw new ChiefEnhancementSetupError("Saved setup changed; review a fresh preview");
      return old;
    }
    if (old?.state === "partial" || old?.state === "working") throw new ChiefEnhancementSetupError("An interrupted or partial setup needs a fresh reviewed preview",409,old);
    if (old) { this.cleanupStages(old); this.save(old); if (this.db.prepare("SELECT 1 FROM chief_setup_stages WHERE preview_hash=? LIMIT 1").get(preview.previewHash)) throw new ChiefEnhancementSetupError("Setup-owned staged content must be cleaned up before retrying",409,old); }
    const owned = new Map<string,Owned>();
    for (const target of preview.targets) {
      if (chiefSetupSnapshotHash(this.current(target.botId)) !== target.expectedSnapshotHash) throw new ChiefEnhancementSetupError("The reviewed target snapshot changed before setup");
      if (target.skills.some(skill => skill.action === "assign") && !this.adapter.setSkillAssigned) throw new ChiefEnhancementSetupError("This installation needs its supported library assignment adapter",503);
      owned.set(target.botId,{target,lastHash: target.expectedSnapshotHash,changed: false,added: new Set(),enabled: new Set(),assigned: new Set(),soul: false});
    }
    const receipt: ChiefSetupReceipt = {previewHash: preview.previewHash,catalogFingerprint: preview.catalogFingerprint,state: "working",at: this.now(),selection: {chiefBotId: preview.selection.chiefBotId,reviewerBotId: preview.selection.reviewerBotId},targetIds: [...owned.keys()],readbackHashes: Object.fromEntries([...owned].map(([id,item]) => [id,item.lastHash])),restoredTargets: [],preservedNewerTargets: [],gaps: []};
    const stages: Stage[] = []; const source = `chief-enhancement:${preview.release}:${preview.previewHash}`;
    this.assertOwned(owned); this.save(receipt);
    const mutate = (item: Owned,expected: ChiefSetupBotSnapshot,action: () => void,onOwned: () => void) => {
      this.assertOwned(owned);
      let error: unknown;
      try { action(); } catch (caught) { error = caught; }
      const after = this.current(item.target.botId);
      if (semanticHash(after) === semanticHash(expected)) { item.changed = true; item.lastHash = chiefSetupSnapshotHash(after); onOwned(); }
      else if (!error) error = new ChiefEnhancementSetupError("A supported write did not read back as the exact reviewed change");
      if (error) throw error;
    };
    try {
      for (const item of owned.values()) for (const skill of item.target.skills.filter(skill => skill.action === "install")) {
        this.assertOwned(owned);
        const staged = this.adapter.stageSkill(item.target.botId,{name: skill.name,content: skill.content,source,kind: item.target.before.skillMode === "assignment" ? "assigned" : "local"});
        if (staged.id) this.db.prepare("INSERT INTO chief_setup_stages VALUES(?,?,?)").run(preview.previewHash,item.target.botId,staged.id);
        if (!staged.id || staged.source !== source) throw new ChiefEnhancementSetupError("Staging did not retain exact setup provenance",503);
        stages.push({...staged,botId: item.target.botId,name: skill.name,sha256: skill.sha256});
      }
      // Every missing file has been staged before any profile/skill promotion.
      this.assertOwned(owned);
      for (const item of owned.values()) {
        for (const skill of item.target.skills) {
          if (skill.action === "keep") continue;
          const before = this.current(item.target.botId), expected = clone(before);
          if (skill.action === "install") {
            const staged = stages.find(stage => stage.botId === item.target.botId && stage.name === skill.name)!;
            expected.skills.push({name: skill.name,content: skill.content,source,kind: before.skillMode === "assignment" ? "assigned" : "local",enabled: true,assigned: true,revision: ""});
            mutate(item,expected,() => this.adapter.commitStagedSkill(item.target.botId,staged.id,skill.sha256),() => item.added.add(skill.name));
          } else if (skill.action === "enable") {
            expected.skills.find(current => current.name === skill.name)!.enabled = true;
            mutate(item,expected,() => this.adapter.setSkillEnabled(item.target.botId,skill.name,true),() => item.enabled.add(skill.name));
          } else if (skill.action === "assign") {
            expected.skills.find(current => current.name === skill.name)!.assigned = true;
            mutate(item,expected,() => this.adapter.setSkillAssigned!(item.target.botId,skill.name,true),() => item.assigned.add(skill.name));
          }
        }
        if (item.target.nextSoul !== item.target.before.soul) {
          const expected = this.current(item.target.botId); expected.soul = item.target.nextSoul;
          mutate(item,expected,() => this.adapter.setSoul(item.target.botId,item.target.nextSoul),() => { item.soul = true; });
        }
      }
      this.assertOwned(owned);
      for (const [id,item] of owned) {
        const current = this.current(id);
        if (current.soul !== item.target.nextSoul || current.protectedStateHash !== item.target.before.protectedStateHash || item.target.skills.some(skill => !current.skills.some(existing => existing.name === skill.name && existing.content === skill.content && existing.enabled && existing.assigned))) throw new ChiefEnhancementSetupError("Setup did not verify the complete reviewed profile and skill readback");
        receipt.readbackHashes[id] = chiefSetupSnapshotHash(current);
      }
      receipt.state = "applied"; receipt.at = this.now(); this.save(receipt);
    } catch {
      for (const [id,item] of [...owned].reverse()) {
        if (!item.changed) {
          try {
            const current = this.snapshot(id);
            if (!current || chiefSetupSnapshotHash(current) !== item.lastHash) receipt.preservedNewerTargets.push(id);
          } catch { receipt.preservedNewerTargets.push(id); receipt.gaps.push("A selected agent's current state is unavailable; its uncertain writes were preserved for owner review"); }
          continue;
        }
        try {
          if (chiefSetupSnapshotHash(this.current(id)) !== item.lastHash) { receipt.preservedNewerTargets.push(id); continue; }
          const rollback = (action: () => void) => { this.adapter.assertCurrent?.(); if (chiefSetupSnapshotHash(this.current(id)) !== item.lastHash) throw new ChiefEnhancementSetupError("A newer revision appeared during conditional rollback"); action(); item.lastHash = chiefSetupSnapshotHash(this.current(id)); };
          if (item.soul) rollback(() => this.adapter.setSoul(id,item.target.before.soul));
          for (const name of [...item.assigned].reverse()) rollback(() => this.adapter.setSkillAssigned!(id,name,item.target.before.skills.find(skill => skill.name === name)!.assigned));
          for (const name of [...item.enabled].reverse()) rollback(() => this.adapter.setSkillEnabled(id,name,item.target.before.skills.find(skill => skill.name === name)!.enabled));
          for (const name of [...item.added].reverse()) rollback(() => { const skill = this.current(id).skills.find(skill => skill.name === name); if (!skill || skill.source !== source || !skill.content || chiefSetupContentHash(skill.content) !== item.target.skills.find(skill => skill.name === name)!.sha256) throw new ChiefEnhancementSetupError("An installed skill no longer belongs to this exact setup"); this.adapter.removeSkill(id,name,source); });
          if (semanticHash(this.current(id)) !== semanticHash(item.target.before)) throw new ChiefEnhancementSetupError("Conditional rollback left a state requiring review");
          receipt.restoredTargets.push(id);
        } catch { receipt.preservedNewerTargets.push(id); }
      }
      for (const id of receipt.targetIds) {
        try { const current = this.snapshot(id); if (!current) throw new Error("Unavailable target"); receipt.readbackHashes[id] = chiefSetupSnapshotHash(current); }
        catch {
          if (!receipt.preservedNewerTargets.includes(id)) receipt.preservedNewerTargets.push(id);
          delete receipt.readbackHashes[id];
          if (!receipt.gaps.some(gap => gap.includes("current state is unavailable"))) receipt.gaps.push("A selected agent's current state is unavailable; its uncertain writes were preserved for owner review");
        }
      }
      receipt.state = receipt.preservedNewerTargets.length ? "partial" : "failed";
      receipt.gaps.push(receipt.state === "partial" ? "Setup stopped. Newer or uncertain revisions were preserved; inspect these agents and review a fresh preview." : "Setup stopped and its unchanged writes were conditionally rolled back. Review a fresh preview before retrying.");
      receipt.at = this.now();
      this.save(receipt);
    } finally {
      this.cleanupStages(receipt);
      this.save(receipt);
    }
    if (receipt.state !== "applied") throw new ChiefEnhancementSetupError("The reviewed enhancement setup did not complete",409,receipt);
    return receipt;
  }
}
