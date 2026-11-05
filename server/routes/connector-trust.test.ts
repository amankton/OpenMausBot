import { CONNECTOR_TRUST_CATALOG_FINGERPRINT, type ConnectorTrustPolicy } from "../../shared/connector-trust.ts";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ConnectorTrustError, ConnectorTrustStore } from "../connector-trust.ts";
import { createConnectorTrustRoutes } from "./connector-trust.ts";
import { dispatchRoutes } from "./table.ts";
import { json, readBody } from "../harness/http.ts";

const fixtures: Array<{server: Server;store: ConnectorTrustStore;dir: string}> = [];
afterEach(async () => { for (const f of fixtures.splice(0)) { await new Promise<void>(resolve => { f.server.close(() => resolve()); f.server.closeAllConnections(); }); f.store.close(); rmSync(f.dir,{recursive: true,force: true}); } });
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(),"chief-trust-route-")); const store = new ConnectorTrustStore(dir);
  let live = true; let provider = true;
  const route = createConnectorTrustRoutes({store,
    assertAccess(auth,botId) { if ((auth.kind === "loopback" && auth.trust === "service") || !live) throw new ConnectorTrustError("An active owner session is required"); if (botId !== "chief") throw new ConnectorTrustError("No such agent",404); },
    async accountFacts() { if (!provider) throw new Error("synthetic private credential rejected"); return [{accountId: "connection-one",identity: "owner@example.test",status: "active",verifiedAt: Date.now()}]; },
    toolAllowed() { return true; },reviewerId() { return "owner"; },
  });
  const server = createServer((req,res) => { void (async () => {
    const url = new URL(req.url ?? "/","http://127.0.0.1");
    const handled = await dispatchRoutes([route],{req,res,url,path: url.pathname,method: req.method ?? "GET",auth: req.headers["x-synthetic-service"] ? {kind: "loopback",trust: "service",scopes: ["client"]} : {kind: "loopback",scopes: ["admin","client"]},json,readBody});
    if (!handled) json(res,404,{error: "No fixture route"});
  })().catch(() => { if (!res.headersSent) json(res,500,{error: "Fixture failed"}); }); });
  await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve)); const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing fixture address");
  fixtures.push({server,store,dir});
  return {url: `http://127.0.0.1:${address.port}`,store,revokeSession() { live = false; },providerDown() { provider = false; }};
}
const responseBody = async (response: Response) => await response.json() as {policy: ConnectorTrustPolicy | null;gap?: string};
const proposal = {catalogFingerprint: CONNECTOR_TRUST_CATALOG_FINGERPRINT,expectedRevision: 0,reviewed: true,grants: [{accountId: "connection-one",identity: "owner@example.test",operations: ["read-profile","search-mail"]}]};
it("routes an actual isolated owner review, rejects stale writes, and keeps revoke available offline", async () => {
  const f = await fixture(); const path = `${f.url}/api/bots/chief/connector-trust`;
  const overview = await fetch(path); expect(overview.status).toBe(200); expect(overview.headers.get("cache-control")).toBe("no-store"); expect((await responseBody(overview)).policy).toBeNull();
  const applied = await fetch(path,{method: "PUT",headers: {"content-type": "application/json"},body: JSON.stringify(proposal)}); expect(applied.status).toBe(200); expect((await responseBody(applied)).policy?.revision).toBe(1);
  const stale = await fetch(path,{method: "PUT",headers: {"content-type": "application/json"},body: JSON.stringify(proposal)}); expect(stale.status).toBe(409);
  f.providerDown(); const unavailable = await fetch(path).then(responseBody); expect(unavailable.gap).toBeTruthy(); expect(JSON.stringify(unavailable)).not.toContain("private credential");
  const revoked = await fetch(`${path}/revoke`,{method: "POST",headers: {"content-type": "application/json"},body: JSON.stringify({expectedRevision: 1})}); expect(revoked.status).toBe(200); expect((await responseBody(revoked)).policy?.state).toBe("revoked");
});
it("refuses service/cross-agent review and rejects URL/body misuse without a provider write", async () => {
  const f = await fixture(); const path = `${f.url}/api/bots/chief/connector-trust`;
  expect((await fetch(path,{method: "PUT",headers: {"x-synthetic-service": "1","content-type": "application/json"},body: JSON.stringify(proposal)})).status).toBe(403);
  expect((await fetch(`${f.url}/api/bots/wrong/connector-trust`)).status).toBe(404);
  expect((await fetch(`${path}?reviewed=true`)).status).toBe(400);
  expect((await fetch(path,{method: "PUT",headers: {"content-type": "application/json"},body: "{"})).status).toBe(400);
  expect((await fetch(path,{method: "PUT",headers: {"content-type": "application/json"},body: JSON.stringify({data: "x".repeat(40000)})})).status).toBe(413);
  expect(f.store.get("chief")).toBeNull();
});
