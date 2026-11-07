import { api } from "@/state/store";
import type { ChiefEnhancementPreview, ChiefEnhancementSelection, ChiefSetupReceipt } from "../../shared/chief-enhancement-setup";

export type ChiefEnhancementCatalog = Pick<ChiefEnhancementPreview, "roster" | "bundle" | "catalogFingerprint" | "guidance">;
export type ChiefEnhancementReview = { chiefBotId: string; reviewerBotId: string; previewHash: string; catalogFingerprint: string; reviewed: true };
const endpoint = "/api/chief-enhancement-setup";
export const readChiefEnhancementCatalog = (signal?: AbortSignal): Promise<ChiefEnhancementCatalog> => api(endpoint, { signal });
export const previewChiefEnhancements = (selection: ChiefEnhancementSelection, signal?: AbortSignal): Promise<{ preview: ChiefEnhancementPreview }> => api(`${endpoint}/preview`, { method: "POST", body: JSON.stringify(selection), signal });
export const applyChiefEnhancements = (review: ChiefEnhancementReview): Promise<{ receipt: ChiefSetupReceipt }> => api(`${endpoint}/apply`, { method: "POST", body: JSON.stringify(review) });

/** The mutation receipt is followed by a fresh non-mutating profile/skill preview. */
export function verifyChiefEnhancementReadback(review: ChiefEnhancementPreview, receipt: ChiefSetupReceipt, current: ChiefEnhancementPreview) {
  const ids = review.targets.map(target => target.botId).sort();
  const sameIds = (actual: string[]) => JSON.stringify([...actual].sort()) === JSON.stringify(ids);
  const selected = review.selection;
  if (receipt.state !== "applied" || receipt.previewHash !== review.previewHash || receipt.catalogFingerprint !== review.catalogFingerprint || receipt.selection.chiefBotId !== selected.chiefBotId || receipt.selection.reviewerBotId !== selected.reviewerBotId || !sameIds(receipt.targetIds) || receipt.gaps.length || receipt.restoredTargets.length || receipt.preservedNewerTargets.length || current.catalogFingerprint !== review.catalogFingerprint || current.selection.chiefBotId !== selected.chiefBotId || current.selection.reviewerBotId !== selected.reviewerBotId || current.changesNeeded || current.conflicts.length || current.missingRoles.length || !sameIds(current.targets.map(target => target.botId)) || current.targets.some(target => {
    const original = review.targets.find(candidate => candidate.botId === target.botId);
    return !original || target.expectedSnapshotHash !== receipt.readbackHashes[target.botId] || target.before.soul !== target.nextSoul || target.before.soul !== original.nextSoul || target.before.protectedStateHash !== original.before.protectedStateHash;
  })) {
    throw new Error("Setup could not be confirmed against the current profiles and skills. Refresh and review the saved state; do not repeat the apply request automatically.");
  }
}
