import { createHash, randomUUID } from "node:crypto";
import { ConnectorTrustError, evaluateConnectorTrust, type ConnectorTrustStore, type ConnectorTrustVerdict } from "./connector-trust.ts";
import type { ConnectorTrustAccountFact } from "../shared/connector-trust.ts";

export type TrustBoundCall = ConnectorTrustVerdict["calls"][number];
export interface PreparedTrustTransport {
  /** Complete session/schema preparation first. Invoke the returned synchronous
   * gate immediately before each network dispatch, with no intervening await. */
  execute(beforeEach: () => Promise<() => void>): Promise<{ status: number; bytes: Uint8Array; contentType: string }>;
}
export interface TrustDispatchDependencies {
  store: ConnectorTrustStore;
  facts(botId: string): Promise<ConnectorTrustAccountFact[]>;
  toolAllowed(botId: string, tool: string): boolean;
  transport(calls: readonly TrustBoundCall[], payload: unknown): Promise<PreparedTrustTransport>;
}

function immutableFrame(value: unknown): unknown {
  const copy: unknown = JSON.parse(JSON.stringify(value));
  const freeze = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    for (const child of Object.values(node)) freeze(child);
    Object.freeze(node);
  };
  freeze(copy);
  return copy;
}

/** Intersection with existing bot grants. The payload approved in the owner
 * card is the same immutable payload whose children reach the transport. */
export async function prepareTrustDispatch(
  botId: string, threadId: string, input: unknown, deps: TrustDispatchDependencies, assertLive: () => void, beforeDispatch: () => void = () => {},
) {
  assertLive();
  if (Buffer.byteLength(JSON.stringify(input) ?? "") > 64 * 1024) throw new ConnectorTrustError("Bounded mailbox actions must fit the 64 KiB owner review limit", 400);
  const payload = immutableFrame(input);
  const policy = deps.store.get(botId);
  const expectedRevision = policy?.revision ?? 0;
  if (policy?.state === "revoked") throw new ConnectorTrustError("Bounded mailbox access was revoked; review a new grant before continuing");
  const allowed = (tool: string) => deps.toolAllowed(botId, tool);
  const facts = policy ? await deps.facts(botId) : [];
  assertLive();
  if ((deps.store.get(botId)?.revision ?? 0) !== expectedRevision) throw new ConnectorTrustError("Trust changed while this call was prepared", 409);
  const verdict = evaluateConnectorTrust(policy, payload, facts, allowed);
  const transport = verdict.bounded && verdict.calls.length ? await deps.transport(verdict.calls, payload) : undefined;
  assertLive();
  let approvalId: string | undefined;
  const checkRevision = () => {
    assertLive();
    if ((deps.store.get(botId)?.revision ?? 0) !== expectedRevision) throw new ConnectorTrustError("Trust changed while this call waited; nothing further was dispatched", 409);
  };
  checkRevision();
  return {
    verdict, payload, facts,
    /** For legacy/discovery relay, including opt-in while a call waited. */
    checkCurrent: checkRevision,
    async approve() {
      checkRevision();
      const currentFacts = await deps.facts(botId);
      checkRevision();
      approvalId = deps.store.issueApproval(botId, threadId, payload, expectedRevision, currentFacts, allowed).id;
    },
    async dispatch() {
      if (!transport) throw new ConnectorTrustError("This request has no bounded mailbox operation to dispatch");
      let first = true;
      let started = false;
      try {
      const result = await transport.execute(async () => {
        checkRevision();
        const currentFacts = await deps.facts(botId);
        checkRevision();
        return () => {
          checkRevision();
          // This final check is synchronous, directly adjacent to fetch. A
          // policy, app or tool revocation during any await wins over a card.
          beforeDispatch();
          checkRevision();
          if (first) {
            deps.store.authorizeDispatch(botId, threadId, payload, currentFacts, allowed, expectedRevision, approvalId);
            first = false;
            started = true;
          } else {
            evaluateConnectorTrust(deps.store.get(botId), payload, currentFacts, allowed);
          }
        };
      });
      if (approvalId && started) deps.store.ackAction(botId, approvalId, "succeeded", "connector-response:" + createHash("sha256").update(result.bytes).digest("hex"));
      return result;
      } catch (error) {
        const evidence = error instanceof Error && "evidenceReference" in error && typeof error.evidenceReference === "string" && /^connector-(?:partial|unknown):\d+\/\d+:[a-f0-9]{64}$/.test(error.evidenceReference)
          ? error.evidenceReference : "connector-dispatch-error";
        if (approvalId && started) deps.store.ackAction(botId, approvalId, "outcome-unknown", evidence);
        throw error;
      }
    },
  };
}

/** Converts a tool transport result to the ordinary MCP result envelope. No
 * mail body, argument or credential is written to an audit log here. */
export function trustRpcResult(payload: unknown, results: unknown[]) {
  const rpc = payload as { id?: unknown };
  const result = results.length === 1 ? results[0] : { results };
  return { jsonrpc: "2.0", id: rpc.id ?? null, result: { content: [{ type: "text", text: JSON.stringify(result) }] } };
}

export function trustTransportId() { return randomUUID(); }
