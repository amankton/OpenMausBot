import type { ExecutiveRun, ExecutiveSettings, ExecutiveSettingsPatch, WorkItem, WorkItemPatch } from "../../shared/executive-work";
import { api } from "@/state/store";

export interface ExecutiveMailbox {
  accountScope: string;
  provider: "gmail";
  identity: string;
  label: string;
  verified: boolean;
  available: boolean;
  reason?: string;
}

export interface ExecutiveWorkSnapshot {
  settings: ExecutiveSettings;
  items: WorkItem[];
  runs: ExecutiveRun[];
  mailboxes: ExecutiveMailbox[];
  bots: Array<{ id: string; name: string; threadId: string }>;
  capabilities: {
    scan: boolean;
    gaps: string[];
    backlog?: number;
    routines?: Array<{ id: string; name: string; enabled: boolean; cadence?: string }>;
  };
}

export function readExecutiveWork(signal?: AbortSignal): Promise<ExecutiveWorkSnapshot> {
  return api("/api/executive-work", { signal });
}

export function saveExecutiveSettings(expectedRevision: number, patch: ExecutiveSettingsPatch): Promise<unknown> {
  return api("/api/executive-work/settings", { method: "PATCH", body: JSON.stringify({ expectedRevision, ...patch }) });
}

export function scanExecutiveMail(accountScopes: string[], eventId: string): Promise<unknown> {
  return api("/api/executive-work/scan", { method: "POST", body: JSON.stringify({ accountScopes, eventId }) });
}

export function updateExecutiveItem(item: WorkItem, patch: WorkItemPatch, decision: { eventId: string; resolutionReason?: string }): Promise<unknown> {
  return api(`/api/executive-work/items/${encodeURIComponent(item.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ accountScope: item.accountScope, expectedRevision: item.revision, patch, ...decision, resolutionActor: "owner",
      ...(["done", "dismissed"].includes(item.status) && patch.status && !["done", "dismissed"].includes(patch.status) ? { reopenReason: decision.resolutionReason } : {}),
    }),
  });
}
