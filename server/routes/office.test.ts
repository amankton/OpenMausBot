import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOfficeRoutes } from "./office.ts";
import { createOfficeStore } from "../office.ts";
import { resolveRequestAuth, type LoopbackTrust } from "../request-auth.ts";
import { SessionRegistry } from "../sessions.ts";
import { json } from "../harness/http.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import type { OfficeMedia } from "../office-media.ts";
import { createOfficeMedia } from "../office-media.ts";
import { OfficeError } from "../office.ts";
import type { OfficeCommand, OfficeSnapshot } from "../../shared/office.ts";

const resources: Array<{ server: Server; sessions: SessionRegistry; dir: string }> = [];
afterEach(async () => {
  for (const { server, sessions, dir } of resources.splice(0)) {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    sessions.close(); await removeTempDir(dir);
  }
});
type Update = OfficeSnapshot & { links: Array<{ personId: string; code: string }> };
async function fixture(options: { enabled?: boolean; trust?: LoopbackTrust; media?: OfficeMedia } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "chief-office-http-"));
  const sessions = new SessionRegistry({ file: join(dir, "agent-sessions.json") });
  const media = options.media ?? { configured: false, token: vi.fn(async () => { throw new Error("Not configured"); }), disconnect: vi.fn(async () => {}) };
  const route = createOfficeRoutes(dir, { enabled: options.enabled ?? true, media });
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      const gate = resolveRequestAuth(req, { url, sessions, cookieName: "test_session", streamPath: "/api/events", loopbackTrust: options.trust });
      if (await route(req, res, url, gate.auth)) return;
      // Same gate order as index.ts; the sentinel represents private agent data.
      if (!gate.auth) return json(res, gate.status, { error: gate.error });
      json(res, 200, { privateBotTranscript: "PRIVATE_AGENT_SENTINEL" });
    } catch { json(res, 500, { error: "unexpected fixture failure" }); }
  });
  resources.push({ server, sessions, dir });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (path = "/api/office", token?: string, body?: unknown, headers: Record<string, string> = {}) => fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const snapshot = async (token?: string) => (await request("/api/office", token)).json() as Promise<OfficeSnapshot>;
  const command = async (command: OfficeCommand, token?: string) => {
    const revision = (await snapshot(token)).office.revision;
    return request("/api/office", token, { revision, command });
  };
  const member = async (name: string) => {
    const added = await (await command({ type: "person.add", name, title: "Member" })).json() as Update;
    const personId = added.office.people.at(-1)!.id;
    const invited = await (await command({ type: "invite.create", roomId: "huddle", personIds: [personId] })).json() as Update;
    const code = invited.links[0]!.code;
    const response = await request("/api/office/claim", undefined, { code });
    expect(response.status).toBe(200);
    const claimed = await response.json() as { token: string; personId: string };
    return { ...claimed, code, invitationId: invited.office.invitations.find(i => i.personId === personId)!.id };
  };
  return { dir, base, request, snapshot, command, member, media };
}

describe("office HTTP trust boundaries", () => {
  it("uses single-use claims, explicit acceptance, persisted joins/leaves and private meeting records", async () => {
    const f = await fixture(), a = await f.member("Avery"), b = await f.member("Blake");
    expect((await f.request("/api/office/claim", undefined, { code: a.code })).status).toBe(401);
    expect((await f.command({ type: "meeting.join", roomId: "huddle" }, a.token)).status).toBe(403);
    expect((await f.command({ type: "invite.respond", invitationId: a.invitationId, accept: true }, b.token)).status).toBe(404);
    expect((await f.command({ type: "invite.respond", invitationId: a.invitationId, accept: true }, a.token)).status).toBe(200);
    expect((await f.command({ type: "meeting.join", roomId: "huddle" }, a.token)).status).toBe(200);
    const meetingId = (await f.snapshot(a.token)).office.meetings[0]!.id;
    expect((await f.command({ type: "note.add", meetingId, kind: "decision", text: "Only the participants should read this decision.", speakerId: a.personId, assigneeId: null }, a.token)).status).toBe(200);
    for (const credential of [undefined, b.token]) {
      const snapshot = await f.snapshot(credential);
      expect(snapshot.office.meetings).toEqual([]);
      expect(JSON.stringify(snapshot)).not.toContain("participants should read");
    }
    expect(createOfficeStore(f.dir).read().meetings[0]!.presentIds).toEqual([a.personId]);
    expect((await f.command({ type: "meeting.leave" }, a.token)).status).toBe(200);
    const saved = createOfficeStore(f.dir).read().meetings[0]!;
    expect(saved.presentIds).toEqual([]); expect(saved.endedAt).not.toBeNull();
    const disk = readFileSync(join(f.dir, "chief-office.v1.json"), "utf8");
    for (const secret of [a.token, a.code, b.token, b.code]) expect(disk).not.toContain(secret);
  });

  it("never promotes member or malformed bearer credentials to a private-agent owner on loopback", async () => {
    const f = await fixture(), a = await f.member("Avery");
    for (const token of [a.token, "chief_office_invalid-token"]) {
      for (const path of ["/api/bots", "/api/config", "/api/threads/private/messages"]) {
        const response = await f.request(path, token);
        expect(response.status, `${path} with ${token === a.token ? "member" : "invalid"} token`).toBe(401);
        expect(await response.text()).not.toContain("PRIVATE_AGENT_SENTINEL");
      }
    }
  });

  it("refuses bad office bearer and basic auth even with an otherwise valid loopback owner", async () => {
    const f = await fixture();
    expect((await f.request("/api/office", "bad")).status).toBe(401);
    expect((await f.request("/api/office", undefined, undefined, { authorization: "Basic YTpi" })).status).toBe(401);
    const response = await f.request(); expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("does not accept a member credential in a different office workspace", async () => {
    const first = await fixture(), second = await fixture();
    const member = await first.member("Avery");
    expect((await first.request("/api/office", member.token)).status).toBe(200);
    expect((await second.request("/api/office", member.token)).status).toBe(401);
    expect((await second.request("/api/bots", member.token)).status).toBe(401);
    expect((await second.request("/api/office/claim", undefined, { code: member.code })).status).toBe(401);
    expect((await second.snapshot()).office.people).toHaveLength(1);
  });

  it("rejects cross-origin and cross-site readers, claimers and writers", async () => {
    const f = await fixture(), a = await f.member("Avery");
    const headerCases: Record<string, string>[] = [{ origin: "https://attacker.invalid" }, { "sec-fetch-site": "cross-site" }];
    for (const headers of headerCases) {
      expect((await f.request("/api/office", a.token, undefined, headers)).status).toBe(403);
      expect((await f.request("/api/office/claim", undefined, { code: a.code }, headers)).status).toBe(403);
      expect((await f.request("/api/office", a.token, {}, headers)).status).toBe(403);
    }
    expect((await f.request("/api/office", a.token, undefined, { origin: f.base })).status).toBe(200);
  });

  it("requires opt-in and never grants owner privileges to service-trust callers", async () => {
    const disabled = await fixture({ enabled: false }); expect((await disabled.request()).status).toBe(404);
    const service = await fixture({ trust: "service" }); expect((await service.request()).status).toBe(401);
    expect((await service.request("/api/office", undefined, { revision: 0, command: { type: "person.add", name: "Forbidden", title: "" } })).status).toBe(401);
  });

  it("validates body shape, JSON content type, size and revision before writes", async () => {
    const f = await fixture();
    expect((await fetch(f.base + "/api/office", { method: "POST", body: "{}" })).status).toBe(415);
    expect((await fetch(f.base + "/api/office", { method: "POST", headers: { "content-type": "application/json" }, body: "{" })).status).toBe(400);
    expect((await f.request("/api/office", undefined, { revision: 0, command: { type: "person.add", name: "Avery", title: "", injected: true } })).status).toBe(400);
    expect((await f.request("/api/office/claim", undefined, { code: "a".repeat(2000) })).status).toBe(413);
    const revision = (await f.snapshot()).office.revision;
    await f.command({ type: "person.add", name: "Avery", title: "" });
    expect((await f.request("/api/office", undefined, { revision, command: { type: "room.add", name: "Stale", kind: "audio" } })).status).toBe(409);
    expect((await f.snapshot()).office.rooms.some(r => r.name === "Stale")).toBe(false);
  });

  it("returns explicit media authorization and setup failures without pretending to connect", async () => {
    const f = await fixture({ media: createOfficeMedia({}) });
    expect((await f.request("/api/office/media", undefined, {})).status).toBe(403);
    await f.command({ type: "meeting.join", roomId: "huddle" });
    const response = await f.request("/api/office/media", undefined, {});
    expect(response.status).toBe(503);
    expect((await response.json() as { error: string }).error).toContain("CHIEF_LIVEKIT_URL");
    expect((await f.snapshot()).media).toBe("unconfigured");
  });

  it("retains membership and the credential when the provider cannot disconnect media", async () => {
    const media = { configured: true, token: vi.fn(), disconnect: vi.fn(async () => { throw new OfficeError("Retry leaving", 503); }) };
    const f = await fixture({ media }), a = await f.member("Avery");
    await f.command({ type: "invite.respond", invitationId: a.invitationId, accept: true }, a.token);
    await f.command({ type: "meeting.join", roomId: "huddle" }, a.token);
    const revision = (await f.snapshot(a.token)).office.revision;
    expect((await f.command({ type: "meeting.leave" }, a.token)).status).toBe(503);
    expect((await f.request("/api/office/logout", a.token, {})).status).toBe(503);
    const current = await f.snapshot(a.token);
    expect(current.office.revision).toBe(revision);
    expect(current.occupants.huddle).toEqual([a.personId]);
  });

  it("withholds a media token generated after the member has left and logged out", async () => {
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    const token = vi.fn(async () => { entered(); await wait; return { url: "wss://media.example.invalid", token: "STALE_MEDIA_CREDENTIAL" }; });
    const f = await fixture({ media: { configured: true, token, disconnect: vi.fn(async () => {}) } });
    const a = await f.member("Avery");
    await f.command({ type: "invite.respond", invitationId: a.invitationId, accept: true }, a.token);
    await f.command({ type: "meeting.join", roomId: "huddle" }, a.token);
    const pendingToken = f.request("/api/office/media", a.token, {});
    await started;
    try { expect((await f.request("/api/office/logout", a.token, {})).status).toBe(200); }
    finally { release(); }
    const response = await pendingToken;
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("STALE_MEDIA_CREDENTIAL");
  });

  it("logs out only the member, leaving their meeting and revoking the persisted credential", async () => {
    const f = await fixture(), a = await f.member("Avery"), b = await f.member("Blake");
    await f.command({ type: "invite.respond", invitationId: a.invitationId, accept: true }, a.token);
    await f.command({ type: "meeting.join", roomId: "huddle" }, a.token);
    expect((await f.request("/api/office/logout", a.token, {})).status).toBe(200);
    expect(f.media.disconnect).toHaveBeenCalledOnce();
    expect((await f.request("/api/office", a.token)).status).toBe(401);
    expect((await f.request("/api/office", b.token)).status).toBe(200);
    expect(createOfficeStore(f.dir).read().meetings[0]!.presentIds).toEqual([]);
  });

  it("does not clear a newly joined room when an earlier logout media disconnect is still pending", async () => {
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    const disconnect = vi.fn(async () => {}).mockImplementationOnce(async () => { entered(); await wait; });
    const f = await fixture({ media: { configured: true, token: vi.fn(), disconnect } });
    const a = await f.member("Avery");
    await f.command({ type: "invite.respond", invitationId: a.invitationId, accept: true }, a.token);
    await f.command({ type: "invite.create", roomId: "boardroom", personIds: [a.personId] });
    const invitationId = (await f.snapshot(a.token)).office.invitations.find(i => i.roomId === "boardroom")!.id;
    await f.command({ type: "invite.respond", invitationId, accept: true }, a.token);
    await f.command({ type: "meeting.join", roomId: "huddle" }, a.token);
    const loggingOut = f.request("/api/office/logout", a.token, {});
    await started;
    try {
      expect((await f.command({ type: "meeting.leave" }, a.token)).status).toBe(200);
      expect((await f.command({ type: "meeting.join", roomId: "boardroom" }, a.token)).status).toBe(200);
    } finally { release(); }
    expect((await loggingOut).status).toBe(409);
    const current = await f.snapshot(a.token);
    expect(current.occupants.boardroom).toEqual([a.personId]);
    expect((await f.request("/api/office/logout", a.token, {})).status).toBe(200);
    expect((await f.request("/api/office", a.token)).status).toBe(401);
  });
});
