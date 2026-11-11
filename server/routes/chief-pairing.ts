import { z } from "zod";
import { ChiefPairingRuntime, PairingError } from "../chief-pairing.ts";
import { PASS, type RouteHandler } from "./table.ts";
import { isProxied, isSameOrigin } from "../request-auth.ts";

export function createChiefPairingRoutes(options: { directory: string; origin?: string; localOnly: boolean; bots: () => Array<{ id: string; name: string }>; memberProfiles?: () => Array<{ workspace: string; account: string; botId: string; state: string }> }): RouteHandler {
  let runtime: ChiefPairingRuntime | undefined;
  return async ({ req, res, path, method, url, auth, json, readBody }) => {
    if (path !== "/api/chief-pairing" && !path.startsWith("/api/chief-pairing/")) return PASS;
    res.setHeader("Cache-Control", "no-store");
    if (!options.localOnly || auth.kind !== "loopback" || auth.trust === "service" || !auth.scopes.includes("admin") ||
        isProxied(req) || req.headers["sec-fetch-site"] === "cross-site" || !isSameOrigin(req) ||
        (method !== "GET" && !req.headers.origin)) {
      return json(res, 403, { error: "Use the personal Chief owner window to manage pairing." });
    }
    if (url.search) return json(res, 400, { error: "Pairing parameters must not appear in URLs." });
    if (!options.origin) return json(res, method === "GET" ? 200 : 503, { enabled: false, connections: [], bots: [], error: "Workspace pairing has not been enabled on this Chief." });
    try {
      runtime ??= new ChiefPairingRuntime({ directory: options.directory, origin: options.origin, hasBot: id => options.bots().some(bot => bot.id === id) });
      if (path === "/api/chief-pairing" && method === "GET") return json(res, 200, { enabled: true, connections: runtime.list(), bots: options.bots(), ...(options.memberProfiles ? { memberProfiles: options.memberProfiles().filter(m => m.state === "active") } : {}) });
      if (path === "/api/chief-pairing" && method === "POST") {
        const body = z.object({ invitation: z.unknown(), bots: z.array(z.string()), trackerWrite: z.boolean().optional() }).strict().parse(await readBody(req, 16384));
        if (options.memberProfiles) {
          const invite = z.object({ workspace: z.string().uuid(), account: z.string().uuid() }).passthrough().parse(body.invitation);
          const assigned = options.memberProfiles().find(m => m.state === "active" && m.workspace === invite.workspace && m.account === invite.account);
          if (!assigned || body.bots.length !== 1 || body.bots[0] !== assigned.botId) throw new PairingError(403, "Sign into the shared workspace, then connect its automatically assigned member profile.");
        }
        return json(res, 201, { connection: await runtime.pair(body.invitation, body.bots, body.trackerWrite, Boolean(options.memberProfiles)) });
      }
      const match = /^\/api\/chief-pairing\/([a-f0-9-]{36})(\/check)?$/.exec(path);
      if (match && method === "POST" && match[2]) return json(res, 200, { connection: await runtime.check(match[1]!) });
      if (match && method === "DELETE" && !match[2]) { runtime.forget(match[1]!); return json(res, 200, { forgotten: true }); }
      json(res, 405, { error: "Unsupported pairing operation" });
    } catch (error) {
      json(res, error instanceof PairingError ? error.status : error instanceof z.ZodError ? 400 : 503,
        { error: error instanceof PairingError ? error.message : "The connection operation could not be completed." });
    }
  };
}
