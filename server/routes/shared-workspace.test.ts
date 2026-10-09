import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSharedWorkspaceRoutes, localPlatformUrl } from "./shared-workspace.ts";
import type { RequestAuth } from "../request-auth.ts";
import { removeTempDir } from "../testing/cleanup.ts";

const servers: Server[] = [], dirs: string[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
  for (const dir of dirs.splice(0)) await removeTempDir(dir);
});
async function serve(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function fixture(env: NodeJS.ProcessEnv = {}, auth: RequestAuth | null = { kind: "loopback", scopes: ["admin"] }) {
  const route = createSharedWorkspaceRoutes({ env });
  return serve((req, res) => { void route(req, res, new URL(req.url!, `http://${req.headers.host}`), auth); });
}

describe("retained workspace boundary", () => {
  it.each(["https://example.com:443", "http://localhost.example.com:8000", "file:///etc/passwd", "http://user:secret@localhost:8000", "http://localhost:8000/?token=private", "http://localhost:8000/#secret", "http://localhost:8000/admin", "http://localhost/"])("rejects an unsupported destination %s", (value) => {
    expect(localPlatformUrl(value)).toBeNull();
  });
  it("accepts an explicit local application route", () => {
    expect(localPlatformUrl("http://localhost:18087/workbench/chief/contact/persons")?.hostname).toBe("localhost");
  });
  it("checks a local front without forwarding any owner request credentials", async () => {
    const requests: IncomingMessage["headers"][] = [];
    const upstream = await serve((req, res) => { requests.push(req.headers); res.setHeader("content-type", "application/json"); res.end("{}"); });
    const url = upstream.replace("127.0.0.1", "localhost");
    const base = await fixture({ CHIEF_PLATFORM_URL: url });
    const response = await fetch(`${base}/api/shared-workspace`, { headers: { cookie: "private_session=sentinel", authorization: "Bearer sentinel" } });
    expect(await response.json()).toMatchObject({ enabled: true, available: true, url: `${url}/` });
    expect(requests).toHaveLength(1);
    expect(requests[0].cookie).toBeUndefined(); expect(requests[0].authorization).toBeUndefined();
  });
  it("refuses same-host different-port destinations because cookies ignore ports", async () => {
    const base = await fixture({ CHIEF_PLATFORM_URL: "http://127.0.0.1:18087" });
    const response = await fetch(`${base}/api/shared-workspace`);
    expect(await response.json()).toMatchObject({ enabled: false, available: false });
  });
  it("does not follow a frontend redirect", async () => {
    let destinationHits = 0;
    const destination = await serve((_req, res) => { destinationHits++; res.end("unexpected"); });
    const upstream = await serve((_req, res) => { res.writeHead(302, { location: destination }); res.end(); });
    const base = await fixture({ CHIEF_PLATFORM_URL: upstream.replace("127.0.0.1", "localhost") });
    expect(await (await fetch(`${base}/api/shared-workspace`)).json()).toMatchObject({ available: false });
    expect(destinationHits).toBe(0);
  });
  it("denies guests, service identities and hostile origins before probing", async () => {
    for (const auth of [null, { kind: "loopback", trust: "service", scopes: ["admin"] }] as Array<RequestAuth | null>) {
      const base = await fixture({ CHIEF_PLATFORM_URL: "http://localhost:18087" }, auth);
      expect((await fetch(`${base}/api/shared-workspace`)).status).toBe(403);
    }
    const base = await fixture();
    expect((await fetch(`${base}/api/shared-workspace`, { headers: { origin: "https://hostile.example" } })).status).toBe(403);
    expect((await fetch(`${base}/api/shared-workspace`, { method: "POST" })).status).toBe(405);
  });
  it("reads a prepared Chief-only manifest without contacting a service or exposing its path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "chief-shared-")); dirs.push(dir);
    const path = join(dir, "manifest.json");
    writeFileSync(path, JSON.stringify({ project: "chief-platform", url: "http://localhost:18087", status: "blocked-resources" }));
    const base = await fixture({ CHIEF_PLATFORM_MANIFEST: path });
    const data = await (await fetch(`${base}/api/shared-workspace`)).json();
    expect(data).toMatchObject({ enabled: true, available: false });
    expect(JSON.stringify(data)).not.toContain(dir);
    writeFileSync(path, JSON.stringify({ project: "platform-eval", url: "http://localhost:8087", status: "ready" }));
    expect(await (await fetch(`${base}/api/shared-workspace`)).json()).toMatchObject({ enabled: false });
  });
});
