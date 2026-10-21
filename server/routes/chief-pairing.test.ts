import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChiefPairingRoutes } from "./chief-pairing.ts";
import { json, readBody } from "../harness/http.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import type { RequestAuth } from "../request-auth.ts";

const cleanup: Array<{ server: Server; directory: string }> = [];
afterEach(async () => { for (const { server, directory } of cleanup.splice(0)) {
  await new Promise<void>(resolve => server.close(() => resolve())); await removeTempDir(directory);
} });
async function fixture({ auth = { kind: "loopback", scopes: ["admin"] } as RequestAuth, localOnly = true, enabled = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "chief-pairing-route-"));
  const route = createChiefPairingRoutes({ directory, localOnly, origin: enabled ? "http://127.0.0.1:12345" : undefined,
    bots: () => [{ id: "synthetic-agent", name: "Synthetic agent" }] });
  const server = createServer(async (req, res) => {
    // The main server uses an internal localhost URL even when Vite forwards
    // the browser's original Host and Origin on another port.
    const url = new URL(req.url!, origin.replace("127.0.0.1", "localhost"));
    await route({ req, res, url, path: url.pathname, method: req.method!, auth, json, readBody });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  cleanup.push({ server, directory });
  return { directory, origin, request: (path = "", init: RequestInit = {}) => fetch(origin + "/api/chief-pairing" + path, init) };
}
describe("personal pairing HTTP boundary", () => {
  it.each([
    { localOnly: false },
    { auth: { kind: "loopback", scopes: ["client"], trust: "service" } as RequestAuth },
    { auth: { kind: "loopback", scopes: ["client"] } as RequestAuth },
  ])("rejects shared or non-owner access before creating credentials: %j", async options => {
    const f = await fixture(options); expect((await f.request()).status).toBe(403); expect(readdirSync(f.directory)).toEqual([]);
  });
  it("does not create credentials until explicitly configured", async () => {
    const f = await fixture({ enabled: false });
    expect(await (await f.request()).json()).toMatchObject({ enabled: false, connections: [] });
    expect(readdirSync(f.directory)).toEqual([]);
  });
  it("rejects foreign origins, cross-site requests, missing mutation origin and URL parameters", async () => {
    const f = await fixture();
    expect((await f.request("", { headers: { Origin: "https://untrusted.test" } })).status).toBe(403);
    expect((await f.request("", { headers: { "Sec-Fetch-Site": "cross-site" } })).status).toBe(403);
    expect((await f.request("", { method: "POST" })).status).toBe(403);
    expect((await f.request("?secret=synthetic")).status).toBe(400);
    expect(readdirSync(f.directory)).toEqual([]);
  });
  it("returns only public runtime state with cache disabled", async () => {
    const f = await fixture(); const response = await f.request(); const value = await response.json();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(value).toEqual({ enabled: true, connections: [], bots: [{ id: "synthetic-agent", name: "Synthetic agent" }] });
    expect(JSON.stringify(value)).not.toMatch(/privateKey|runtimeSecret/);
  });
  it("accepts the browser-facing origin instead of the internal routing URL", async () => {
    const f = await fixture({ enabled: false });
    const response = await f.request("", { method: "POST", headers: { Origin: f.origin } });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ enabled: false });
  });
  it("rejects different loopback origins and forwarded origin spoofing", async () => {
    const f = await fixture({ enabled: false });
    for (const headers of [
      { Origin: f.origin.replace("127.0.0.1", "localhost") },
      { Origin: "http://127.0.0.1:1" },
      { Origin: f.origin, "X-Forwarded-Host": "127.0.0.1" },
      { Origin: f.origin.replace("http:", "https:"), "X-Forwarded-Proto": "https" },
      { Origin: f.origin, "X-Forwarded-For": "127.0.0.1" },
      { Origin: f.origin, Forwarded: "for=127.0.0.1" },
    ]) expect((await f.request("", { method: "POST", headers })).status).toBe(403);
    expect(readdirSync(f.directory)).toEqual([]);
  });
});
