import { z } from "zod";

const id = z.string().trim().min(1).max(240).refine(value => [...value].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127), "Identifiers must be printable");
const text = (max: number) => z.string().trim().min(1).max(max).refine(value => [...value].every(character => [9, 10, 13].includes(character.charCodeAt(0)) || character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127), "Text contains control characters");
const timezone = z.string().max(100).refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }, "Invalid timezone");
const timestamp = z.number().int().nonnegative();

export const workStatuses = ["proposed", "queued", "working", "waiting-on-human", "waiting-on-other", "blocked", "ready-for-review", "done", "dismissed"] as const;
export const executionStatuses = ["not-started", "working", "simulated", "partially-completed", "succeeded", "failed", "outcome-unknown", "cancelled"] as const;
export const workSourceSchema = z.object({ kind: id, id, version: id, threadId: id.optional(), botId: id.optional(), taskId: id.optional() }).strict();
export const workDeadlineSchema = z.object({
  value: text(120), timezone, precision: z.enum(["date", "minute", "second", "uncertain"]), provenance: text(500),
}).strict().superRefine((value, ctx) => {
  if (value.precision === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(value.value) || !Number.isFinite(Date.parse(value.value)) || new Date(value.value).toISOString().slice(0, 10) !== value.value)) ctx.addIssue({ code: "custom", message: "Date-only deadline requires a valid YYYY-MM-DD" });
  if (["minute", "second"].includes(value.precision) && (!/T\d{2}:\d{2}/.test(value.value) || !Number.isFinite(Date.parse(value.value)))) ctx.addIssue({ code: "custom", message: "Timed deadline must include a parseable time" });
});
export const workApprovalSchema = z.object({ reference: id, operation: text(120), target: text(500), revision: id, expiresAt: timestamp }).strict();
export const workCompletionSchema = z.object({
  kind: z.enum(["evidence-verified", "user-confirmed"]), actor: id, reason: text(500), sourceVersion: id,
  evidence: z.array(text(1000)).max(20).default([]),
}).strict().superRefine((value, ctx) => {
  if (value.kind === "evidence-verified" && !value.evidence.length) ctx.addIssue({ code: "custom", message: "Verified completion requires evidence references" });
});
export const workItemCreateSchema = z.object({
  accountScope: id, source: workSourceSchema, ownerBotId: id, coordinatorBotId: id, sourceThreadId: id,
  title: text(180).refine(value => !/[\r\n]/.test(value), "Title must fit on one line"),
  desiredOutcome: text(800), nextAction: text(800), status: z.enum(workStatuses).default("proposed"),
  executionStatus: z.enum(executionStatuses).default("not-started"), priority: z.number().int().min(1).max(5).default(3),
  dependencies: z.array(id).max(40).default([]), deadline: workDeadlineSchema.optional(), suggestedReviewAt: timestamp.optional(),
  approval: workApprovalSchema.optional(), completion: workCompletionSchema.optional(),
}).strict();
export const workItemPatchSchema = workItemCreateSchema.omit({ accountScope: true }).partial().extend({
  status: z.enum(workStatuses).optional(), executionStatus: z.enum(executionStatuses).optional(),
  priority: z.number().int().min(1).max(5).optional(), dependencies: z.array(id).max(40).optional(),
}).strict();
export type WorkStatus = typeof workStatuses[number];
export type WorkItemCreate = z.input<typeof workItemCreateSchema>;
export type WorkItemPatch = z.input<typeof workItemPatchSchema>;
export type WorkSource = z.infer<typeof workSourceSchema>;
export type WorkItem = z.infer<typeof workItemCreateSchema> & {
  id: string; revision: number; createdAt: number; updatedAt: number; resolvedAt?: number;
  resolutionActor?: string; resolutionReason?: string; lastSurfacedRevision?: number; lastSurfacedAt?: number;
};
export const workMutationSchema = z.object({ eventId: id, idempotencyKey: id.optional(), reopenReason: text(500).optional(), resolutionActor: id.optional(), resolutionReason: text(500).optional() }).strict();
export type WorkMutation = z.input<typeof workMutationSchema>;

export const executiveAccountSchema = z.object({
  accountScope: id, provider: z.enum(["gmail"]), identity: text(254), label: text(100), context: z.enum(["personal", "ministry", "work", "other"]).default("personal"),
  ownerBotId: id, coordinatorBotId: id, sourceThreadId: id, enabled: z.boolean().default(false),
}).strict();
export const executiveSettingsSchema = z.object({
  revision: z.number().int().nonnegative(), scansEnabled: z.boolean(), checkInEnabled: z.boolean(),
  analysisBudget: z.number().int().min(1).max(100), timezone,
  preferredMailReviewerBotId: id.nullable().optional(),
  accounts: z.array(executiveAccountSchema).max(20),
  notifications: z.object({ enabled: z.boolean(), priorityThreshold: z.number().int().min(1).max(5), urgentBypassesQuiet: z.boolean(),
    quietHours: z.object({ start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }).strict().nullable(),
  }).strict(),
  retention: z.object({ sourceIds: z.literal("indefinite"), runDays: z.number().int().min(7).max(3650) }).strict(),
  cadenceProposal: z.string().max(200).nullable(),
  routineBindings: z.array(z.object({ routineId: id, kind: z.enum(["check-in", "mail-scan"]) }).strict()).max(30).default([]),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.accounts.map(account => account.accountScope)).size !== value.accounts.length) ctx.addIssue({ code: "custom", message: "Duplicate account scope" });
  if (new Set(value.routineBindings.map(binding => binding.routineId)).size !== value.routineBindings.length) ctx.addIssue({ code: "custom", message: "Duplicate routine binding" });
});
export type ExecutiveSettings = z.infer<typeof executiveSettingsSchema>;
export type ExecutiveSettingsPatch = Partial<Omit<z.input<typeof executiveSettingsSchema>, "revision">>;
export const DEFAULT_EXECUTIVE_SETTINGS: ExecutiveSettings = {
  revision: 0, scansEnabled: false, checkInEnabled: false, analysisBudget: 15, timezone: "America/Los_Angeles", accounts: [],
  notifications: { enabled: false, priorityThreshold: 3, urgentBypassesQuiet: false, quietHours: null },
  retention: { sourceIds: "indefinite", runDays: 90 }, cadenceProposal: null, routineBindings: [],
};
export interface WorkEvent { id: string; accountScope: string; workItemId: string; revision: number; kind: "created" | "updated"; at: number; }
export interface WorkNotification {
  id: string; accountScope: string; workItemId: string; revision: number; botId: string; threadId: string;
  title: string; priority: number; state: "pending" | "claimed" | "delivered" | "suppressed" | "outcome-unknown";
  availableAt: number; createdAt: number; reason?: string; claimOwner?: string; claimedAt?: number;
}
export const executiveRunSchema = z.object({
  id, accountScope: id, botId: id, threadId: id, kind: z.enum(["check-in", "mail-scan", "coordination"]),
  startedAt: timestamp, finishedAt: timestamp.optional(), status: z.enum(["working", "completed", "partial", "failed", "outcome-unknown"]),
  gaps: z.array(text(500)).max(50).default([]), evidence: z.array(text(1000)).max(50).default([]),
  detailsPrunedAt: timestamp.optional(),
}).strict();
export type ExecutiveRun = z.infer<typeof executiveRunSchema>;
