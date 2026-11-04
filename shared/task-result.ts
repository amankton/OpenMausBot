import type { WireMessage } from "./wire.ts";

export type ExecutionOutcome = "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
export type DeliveryOutcome = "delivered" | "partial" | "blocked" | "unverified";
export interface ResultSource { botId: string; threadId: string }
export interface ArtifactVersion {
  schemaVersion: 1;
  id: string;
  title: string;
  scope: "host" | "vm";
  /** Source observation, not a promise the source still exists. */
  locator: string;
  observedAt: number;
  sha256: string;
  bytes: number;
  /** Durable, immutable byte copy; use the normal message attachment guards. */
  attachment: NonNullable<WireMessage["attachments"]>[number];
}
export interface VerificationRecord {
  schemaVersion: 1;
  id: string;
  authority: "agent_claim" | "harness_observation";
  check: string;
  outcome: "passed" | "failed" | "not_run" | "unknown";
  artifactIds: string[];
  observedAt: number;
  botId: string;
}
export interface TaskResult {
  schemaVersion: 1;
  id: string;
  botId: string;
  threadId: string;
  executionId: string;
  requestMessageId?: string;
  requestId?: string;
  modelInstanceId?: string;
  providerTurnId?: string;
  retryOfExecutionId?: string;
  previousExecutionId?: string;
  source?: ResultSource;
  createdAt: number;
  sealedAt?: number;
  executionOutcome: ExecutionOutcome;
  deliveryOutcome: DeliveryOutcome;
  summary: string;
  dataKind: "synthetic" | "real" | "unspecified";
  dataKindAuthority: "agent_claim";
  artifacts: ArtifactVersion[];
  verifications: VerificationRecord[];
  artifactPublication?: { state: "reported" | "suppressed"; messageId?: string; reason?: string };
  notification: { state: "none" | "pending" | "reported" | "suppressed"; noWake: true; messageId?: string; reason?: string };
}
export interface TaskResultSummary {
  latestResultId: string;
  executionOutcome: ExecutionOutcome;
  deliveryOutcome: DeliveryOutcome;
  lastDeliveredResultId?: string;
}
