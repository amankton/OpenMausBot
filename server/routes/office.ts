import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestAuth } from "../request-auth.ts";
import { json, readBody } from "../harness/http.ts";
import { officeRequestSchema, activeMeeting } from "../../shared/office.ts";
import { createOfficeStore, OfficeError } from "../office.ts";
import { createOfficeMedia, type OfficeMedia } from "../office-media.ts";

/** Independent human identities. Office credentials never enter the agent API's
 * session registry and cannot access bots, chats, paired devices or enterprise features. */
export function createOfficeRoutes(dataDir: string, options: { enabled: boolean; media?: OfficeMedia }) {
  const store = createOfficeStore(dataDir);
  const media = options.media ?? createOfficeMedia();
  return async (req: IncomingMessage, res: ServerResponse, url: URL, ownerAuth: RequestAuth | null): Promise<boolean> => {
    if (url.pathname !== "/api/office" && !url.pathname.startsWith("/api/office/")) return false;
    res.setHeader("cache-control", "no-store");
    const reply = (status: number, body: unknown) => { json(res, status, body); return true; };
    if (!options.enabled) return reply(404, { error: "Chief office is not enabled on this server" });
    const method = req.method ?? "GET";
    const origin = req.headers.origin;
    const expectedOrigin = new URL(url.href).origin;
    if ((origin && origin !== expectedOrigin) || req.headers["sec-fetch-site"] === "cross-site") return reply(403, { error: "Use the Chief office's own browser origin" });
    if (method !== "GET" && !String(req.headers["content-type"] ?? "").startsWith("application/json")) return reply(415, { error: "Send office updates as JSON" });
    try {
      if (method === "POST" && url.pathname === "/api/office/claim") {
        const body = await readBody(req, 1024);
        return reply(200, store.claim(typeof body?.code === "string" ? body.code : ""));
      }
      const authorization = req.headers.authorization;
      const credential = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
      // Never silently fall back to local owner when a bad member credential was supplied.
      const actor = authorization ? store.authenticate(credential) :
        ownerAuth?.kind === "loopback" && ownerAuth.trust !== "service" && ownerAuth.scopes.includes("admin") ? "local-owner" : undefined;
      if (!actor) return reply(401, { error: "An office invitation or local owner session is required" });
      if (method === "GET" && url.pathname === "/api/office") return reply(200, store.snapshot(actor, media.configured ? "livekit" : "unconfigured"));
      if (method === "POST" && url.pathname === "/api/office/media") {
        const before = store.read();
        const connection = await media.token(before, actor);
        if (activeMeeting(store.read(), actor)?.id !== activeMeeting(before, actor)?.id ||
            (authorization && store.authenticate(credential) !== actor)) throw new OfficeError("Room or session changed; reconnect from your current room", 409);
        return reply(200, connection);
      }
      if (method === "POST" && url.pathname === "/api/office/logout") {
        const office = store.read();
        if (activeMeeting(office, actor)) {
          await media.disconnect(office, actor);
          // Do not remove a newer room membership while disconnecting an older call.
          store.update(office.revision, { type: "meeting.leave" }, actor);
        }
        store.logout(credential); return reply(200, { ok: true });
      }
      if (method === "POST" && url.pathname === "/api/office") {
        const parsed = officeRequestSchema.safeParse(await readBody(req, 200_000));
        if (!parsed.success) return reply(400, { error: "Invalid office update" });
        if (parsed.data.command.type === "meeting.leave") {
          const before = store.read();
          if (before.revision !== parsed.data.revision) throw new OfficeError("Office changed. Refresh and try again.", 409);
          await media.disconnect(before, actor);
        }
        const links = store.update(parsed.data.revision, parsed.data.command, actor);
        return reply(200, { ...store.snapshot(actor, media.configured ? "livekit" : "unconfigured"), links });
      }
      return reply(405, { error: "Unsupported office operation" });
    } catch (error) {
      if (error instanceof OfficeError) return reply(error.status, { error: error.message });
      if (error instanceof Error && "status" in error && [400, 413].includes(Number(error.status))) return reply(Number(error.status), { error: error.message });
      return reply(500, { error: "Office data could not be read or saved. Existing data has been preserved." });
    }
  };
}
