import { z } from "zod";

export const CONNECTOR_TRUST_OPERATIONS = [
  { id: "read-profile", label: "Read mailbox identity", effect: "read", tools: ["GMAIL_GET_PROFILE", "GMAIL_WHO_AM_I"] },
  { id: "search-mail", label: "Search mail", effect: "read", tools: ["GMAIL_FETCH_EMAILS"] },
  { id: "read-thread", label: "Read complete threads", effect: "read", tools: ["GMAIL_FETCH_MESSAGE_BY_THREAD_ID"] },
  { id: "read-message", label: "Read individual messages", effect: "read", tools: ["GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID"] },
  { id: "read-history", label: "Read mailbox history", effect: "read", tools: ["GMAIL_LIST_HISTORY"] },
  { id: "read-labels", label: "Read labels", effect: "read", tools: ["GMAIL_LIST_LABELS", "GMAIL_GET_LABEL"] },
  { id: "create-draft", label: "Create provider drafts, with approval each time", effect: "write", tools: ["GMAIL_CREATE_EMAIL_DRAFT"] },
  { id: "update-draft", label: "Update provider drafts, with approval each time", effect: "write", tools: ["GMAIL_UPDATE_DRAFT"] },
  { id: "send-mail", label: "Send mail, with approval each time", effect: "send", tools: ["GMAIL_SEND_EMAIL", "GMAIL_REPLY_TO_THREAD", "GMAIL_FORWARD_MESSAGE"] },
  { id: "change-labels", label: "Change mailbox labels, with approval each time", effect: "write", tools: ["GMAIL_ADD_LABEL_TO_EMAIL", "GMAIL_MODIFY_THREAD_LABELS", "GMAIL_BATCH_MODIFY_MESSAGES", "GMAIL_REMOVE_LABEL"] },
  { id: "delete-mail", label: "Delete or trash mail, with approval each time", effect: "delete", tools: ["GMAIL_DELETE_MESSAGE", "GMAIL_BATCH_DELETE_MESSAGES", "GMAIL_DELETE_THREAD", "GMAIL_MOVE_TO_TRASH", "GMAIL_MOVE_THREAD_TO_TRASH"] },
] as const;
/** Must match the exact reviewed operation/tool catalog. The server checks
 * this hash against the registry at startup; stale pages cannot widen grants. */
export const CONNECTOR_TRUST_CATALOG_FINGERPRINT = "796c3034d1b689b12aa19d8d36643e77b4cc7e40c082638f8b4e43b537cb6d88";
export type ConnectorTrustOperation = typeof CONNECTOR_TRUST_OPERATIONS[number]["id"];
export type ConnectorTrustEffect = typeof CONNECTOR_TRUST_OPERATIONS[number]["effect"];
export const connectorTrustOperationIds = CONNECTOR_TRUST_OPERATIONS.map(operation => operation.id);
const printableId = z.string().min(1).max(240).refine(value => value === value.trim() && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127), "Identifier must be printable and exact");
export const connectorTrustGrantSchema = z.object({
  accountId: printableId,
  identity: z.string().email().max(320).transform(value => value.toLowerCase()),
  operations: z.array(z.enum(connectorTrustOperationIds as [ConnectorTrustOperation, ...ConnectorTrustOperation[]])).min(1).max(CONNECTOR_TRUST_OPERATIONS.length)
    .refine(operations => new Set(operations).size === operations.length, "Duplicate operations"),
}).strict();
export type ConnectorTrustGrant = z.infer<typeof connectorTrustGrantSchema>;
export const connectorTrustReviewSchema = z.object({
  catalogFingerprint: z.literal(CONNECTOR_TRUST_CATALOG_FINGERPRINT),
  expectedRevision: z.number().int().nonnegative(),
  reviewed: z.literal(true),
  grants: z.array(connectorTrustGrantSchema).max(20).refine(grants => new Set(grants.map(grant => grant.accountId)).size === grants.length, "Duplicate mailbox grants"),
}).strict().superRefine((review, ctx) => {
  if (new Set(review.grants.map(grant => grant.identity)).size !== review.grants.length) ctx.addIssue({ code: "custom", message: "Duplicate mailbox identities; select one connection for each mailbox" });
});
export type ConnectorTrustReview = z.infer<typeof connectorTrustReviewSchema>;
export const connectorTrustRevokeSchema = z.object({ expectedRevision: z.number().int().positive() }).strict();
export const connectorTrustPolicySchema = z.object({
  botId: printableId, provider: z.literal("composio"), revision: z.number().int().positive(),
  catalogFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(["active", "revoked"]), grants: z.array(connectorTrustGrantSchema.extend({tools: z.array(z.string().regex(/^GMAIL_[A-Z0-9_]+$/)).max(100)})).max(20),
  reviewedAt: z.number().int().nonnegative(), reviewedBy: printableId,
}).strict().superRefine((policy, ctx) => {
  if (new Set(policy.grants.map(grant => grant.accountId)).size !== policy.grants.length) ctx.addIssue({ code: "custom", message: "Duplicate mailbox grants" });
  if (new Set(policy.grants.map(grant => grant.identity)).size !== policy.grants.length) ctx.addIssue({ code: "custom", message: "Duplicate mailbox identities" });
  if (policy.state === "revoked" && policy.grants.length) ctx.addIssue({ code: "custom", message: "Revoked trust must carry no active grant" });
});
export type ConnectorTrustPolicy = z.infer<typeof connectorTrustPolicySchema>;
/** Facts are server-produced from the current active connection and account
 * profile. An owner-entered alias or cached ACTIVE flag is not an identity. */
export const connectorTrustAccountFactSchema = z.object({
  accountId: printableId, identity: z.string().email().max(320).optional(),
  status: z.enum(["active", "inactive", "unavailable"]), verifiedAt: z.number().int().nonnegative(),
}).strict();
export type ConnectorTrustAccountFact = z.infer<typeof connectorTrustAccountFactSchema>;
export interface ConnectorTrustOverview {
  policy: ConnectorTrustPolicy | null;
  operations: typeof CONNECTOR_TRUST_OPERATIONS;
  accounts: ConnectorTrustAccountFact[];
  catalogFingerprint: string;
  actions?: ConnectorTrustAction[];
  gap?: string;
}
export const connectorTrustApprovalSchema = z.object({
  id: printableId, botId: printableId, threadId: printableId, policyRevision: z.number().int().positive(),
  actionDigest: z.string().regex(/^[a-f0-9]{64}$/), approvedAt: z.number().int().nonnegative(), expiresAt: z.number().int().nonnegative(),
}).strict();
export type ConnectorTrustApproval = z.infer<typeof connectorTrustApprovalSchema>;
export const connectorTrustActionSchema = connectorTrustApprovalSchema.extend({
  state: z.enum(["pending", "outcome-unknown", "succeeded", "not-executed"]),
  startedAt: z.number().int().nonnegative(), resolvedAt: z.number().int().nonnegative().optional(),
  evidenceReference: z.string().min(1).max(1000).optional(),
}).strict();
export type ConnectorTrustAction = z.infer<typeof connectorTrustActionSchema>;
