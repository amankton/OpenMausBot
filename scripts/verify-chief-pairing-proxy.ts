import assert from "node:assert/strict";
import { createHash, createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { createServer as createViteServer } from "vite";
import { launchVerificationServer } from "./control-omb.ts";

// Synthetic authority only: exercises the actual personal server and Vite
// proxy without using owner accounts, invitations, agents, or credentials.
const invitation = { challenge: randomBytes(32).toString("base64url"), workspace: randomUUID(), account: randomUUID(), expiresAt: new Date(Date.now() + 120000).toISOString() };
let claims = 0;
const authority = createServer(async (req, res) => {
  try {
    assert.equal(req.url, "/chief/v1/connections/complete");
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const claim = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(claim.challenge, invitation.challenge);
    const publicKey = createPublicKey({ key: Buffer.from(claim.publicKey, "base64url"), type: "spki", format: "der" });
    assert.ok(verify(null, Buffer.from(JSON.stringify(["chief-pair-v1", claim.challenge, claim.runtimeId, claim.publicKey, claim.bots, claim.scopes])), publicKey, Buffer.from(claim.signature, "base64url")));
    claims++;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ connection: { id: randomUUID(), workspace: invitation.workspace, account: invitation.account,
      runtimeId: claim.runtimeId, keyFingerprint: createHash("sha256").update(claim.publicKey).digest("hex"),
      bots: claim.bots, scopes: claim.scopes, state: "pending", generation: 1, expiresAt: invitation.expiresAt }, runtimeSecret: randomBytes(32).toString("base64url") }));
  } catch { res.statusCode = 400; res.end("Invalid synthetic claim"); }
});
await new Promise<void>(resolve => authority.listen(0, "127.0.0.1", resolve));
const address = authority.address(); assert.ok(address && typeof address !== "string");
let fixture: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
let ui: Awaited<ReturnType<typeof createViteServer>> | undefined;
try {
  fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, undefined, [], undefined,
    { lifecycleOrigin: `http://127.0.0.1:${address.port}` });
  ui = await createViteServer({ root: process.cwd(), logLevel: "error", server: { host: "127.0.0.1", port: 0,
    proxy: { "/api": { target: fixture.info.url, ws: true } } } });
  await ui.listen();
  const origin = new URL(ui.resolvedUrls!.local[0]!).origin;
  const request = (path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) => fetch(origin + path, {
    method, headers: { Origin: origin, "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const botResponse = await request("/api/bots", "POST", {}); assert.equal(botResponse.status, 201);
  const { bot } = await botResponse.json();
  const status = await request("/api/chief-pairing"); assert.equal(status.status, 200);
  assert.ok((await status.json()).bots.some((row: { id: string }) => row.id === bot.id));
  for (const headers of [{ Origin: "https://untrusted.test" }, { Origin: fixture.info.url },
    { "Sec-Fetch-Site": "cross-site" }, { "X-Forwarded-Host": "localhost" }, { "X-Forwarded-Proto": "http" }]) {
    assert.equal((await request("/api/chief-pairing", "POST", { invitation, bots: [bot.id] }, headers)).status, 403);
  }
  assert.equal(claims, 0);
  const response = await request("/api/chief-pairing", "POST", { invitation, bots: [bot.id] });
  assert.equal(response.status, 201);
  const { connection } = await response.json(); assert.equal(connection.state, "pending");
  assert.equal(claims, 1);
  const stored = await (await request("/api/chief-pairing")).json();
  assert.equal(stored.connections[0].id, connection.id);
  assert.equal((await request(`/api/chief-pairing/${connection.id}`, "DELETE")).status, 200);
  assert.equal((await (await request("/api/chief-pairing")).json()).connections.length, 0);
  const receipt = { passed: true, verifiedAt: new Date().toISOString(), syntheticOnly: true, authorityStub: true,
    actualPersonalServer: true, actualViteProxy: true, checks: ["selected agent request creates signed pending connection", "roster and saved connection reload", "foreign origin and forwarding spoof rejected before claim", "local forget works through proxy"], logPath: fixture.info.logPath };
  writeFileSync("docs/verification/evidence/chief-pairing-proxy.json", JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify(receipt));
} finally {
  await ui?.close(); await fixture?.close();
  authority.closeAllConnections(); await new Promise<void>(resolve => authority.close(() => resolve()));
}
