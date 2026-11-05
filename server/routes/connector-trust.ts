import { z } from "zod";
import { CONNECTOR_TRUST_OPERATIONS, CONNECTOR_TRUST_CATALOG_FINGERPRINT, connectorTrustRevokeSchema, type ConnectorTrustAccountFact } from "../../shared/connector-trust.ts";
import { ConnectorTrustError, type ConnectorTrustStore } from "../connector-trust.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface ConnectorTrustRouteDependencies {
  /** Must reject non-owner, missing bot, cross-bot, revoked session and
   * unavailable acting-owner authority. Called again after every await. */
  assertAccess(botId: string, write: boolean): void;
  /** Fresh authoritative account profile facts; never owner-entered labels. */
  accountFacts(botId: string): Promise<ConnectorTrustAccountFact[]>;
  /** Intersection of currently reachable exact connector and native tool
   * selections. The callback must read current bot state, not a snapshot. */
  toolAllowed(botId: string, tool: string): boolean;
  reviewerId(): string;
}
export interface ConnectorTrustRouteResponse { status: number; body: Record<string, unknown> }

/** Parent routes /api/bots/:id/connector-trust[/(revoke)] here after ordinary
 * request authentication/body limits. No agent/internal tool mounts this API. */
export async function handleConnectorTrustRoute(
  store: ConnectorTrustStore,
  request: { botId: string; method: string; action?: "revoke"; body?: unknown },
  deps: ConnectorTrustRouteDependencies,
): Promise<ConnectorTrustRouteResponse> {
  const { botId, method, action } = request;
  const write = method !== "GET";
  try {
    deps.assertAccess(botId, write);
    if (method === "GET" && !action) {
      let accounts: ConnectorTrustAccountFact[] = [];
      let gap: string | undefined;
      try { accounts = await deps.accountFacts(botId); }
      catch { gap = "Current mailbox identities are unavailable. Existing trust can still be revoked; new grants require a fresh profile check."; }
      deps.assertAccess(botId, false);
      return { status: 200, body: { policy: store.get(botId), operations: CONNECTOR_TRUST_OPERATIONS, catalogFingerprint: CONNECTOR_TRUST_CATALOG_FINGERPRINT, accounts, actions: store.actions(botId), ...(gap ? { gap } : {}) } };
    }
    if (method === "PUT" && !action) {
      const facts = await deps.accountFacts(botId);
      deps.assertAccess(botId, true);
      const policy = store.review(botId, request.body, facts, deps.reviewerId(), tool => deps.toolAllowed(botId, tool));
      return { status: 200, body: { policy } };
    }
    if (method === "POST" && action === "revoke") {
      const parsed = connectorTrustRevokeSchema.parse(request.body);
      // Revoke is independent of provider availability and identity lookup.
      deps.assertAccess(botId, true);
      return { status: 200, body: { policy: store.revoke(botId, parsed.expectedRevision, deps.reviewerId()) } };
    }
    return { status: 405, body: { error: "Unsupported connected-app trust operation" } };
  } catch (error) {
    if (error instanceof z.ZodError) return { status: 400, body: { error: "Invalid reviewed connected-app trust request" } };
    if (error instanceof ConnectorTrustError) return { status: error.status, body: { error: error.message } };
    // Do not echo provider exception text or credentials into a settings page.
    return { status: 503, body: { error: "Connected-app trust could not verify the current owner, agent grants or mailbox identities" } };
  }
}

export function createConnectorTrustRoutes(options: {
  store: ConnectorTrustStore;
  assertAccess(auth: RequestAuth, botId: string, write: boolean): void;
  accountFacts(botId: string): Promise<ConnectorTrustAccountFact[]>;
  toolAllowed(botId: string, tool: string): boolean;
  reviewerId(auth: RequestAuth): string;
}): RouteHandler {
  return async ({ req, res, path, method, url, auth, json, readBody }) => {
    const match = /^\/api\/bots\/([^/]+)\/connector-trust(?:\/(revoke))?$/.exec(path);
    if (!match) return PASS;
    res.setHeader("cache-control", "no-store");
    try {
      if (url.search) return json(res, 400, { error: "Trust review parameters must be sent in the request body" });
      const botId = decodeURIComponent(match[1]!);
      const assertAccess = (target: string, write: boolean) => options.assertAccess(auth, target, write);
      assertAccess(botId, method !== "GET");
      const body = method === "PUT" || method === "POST" ? await readBody(req, 32768) : undefined;
      const result = await handleConnectorTrustRoute(options.store, { botId, method, ...(match[2] ? {action: "revoke" as const} : {}), body }, {
        assertAccess, accountFacts: options.accountFacts, toolAllowed: options.toolAllowed,
        reviewerId: () => options.reviewerId(auth),
      });
      return json(res, result.status, result.body);
    } catch (error) {
      const bodyStatus = error && typeof error === "object" && "status" in error && [400, 413].includes(Number(error.status)) ? Number(error.status) : undefined;
      return json(res, error instanceof ConnectorTrustError ? error.status : error instanceof URIError || error instanceof z.ZodError ? 400 : bodyStatus ?? 503,
        { error: error instanceof ConnectorTrustError ? error.message : "Connected-app trust request could not be processed" });
    }
  };
}
