import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestAuth } from "../request-auth.ts";
import { json } from "../harness/http.ts";

type PlatformSetting = { url?: string; status?: string };

/** A local retained application, not a credential or arbitrary proxy endpoint. */
export function localPlatformUrl(raw: unknown): URL | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname) ||
        url.username || url.password || url.search || url.hash || !url.port) return null;
    if (url.pathname !== "/" && !/^\/workbench\/[\w-]+(?:\/[\w/-]+)?$/.test(url.pathname)) return null;
    return url;
  } catch { return null; }
}

function configuredPlatform(env: NodeJS.ProcessEnv): PlatformSetting | null {
  if (env.CHIEF_PLATFORM_URL) return { url: env.CHIEF_PLATFORM_URL };
  if (!env.CHIEF_PLATFORM_MANIFEST) return null;
  try {
    const text = readFileSync(env.CHIEF_PLATFORM_MANIFEST, "utf8");
    if (text.length > 16_384) return null;
    const manifest = JSON.parse(text);
    return manifest.project === "chief-platform" ? { url: manifest.url, status: manifest.status } : null;
  } catch { return null; }
}

export function createSharedWorkspaceRoutes(options: { env?: NodeJS.ProcessEnv; localOnly?: boolean } = {}) {
  const env = options.env ?? process.env;
  return async (req: IncomingMessage, res: ServerResponse, url: URL, auth: RequestAuth | null): Promise<boolean> => {
    if (url.pathname !== "/api/shared-workspace") return false;
    res.setHeader("cache-control", "no-store");
    const reply = (status: number, body: unknown) => { json(res, status, body); return true; };
    // Initial local host only. Platform authenticates people independently;
    // this endpoint never exchanges or forwards Chief/agent credentials.
    if (options.localOnly === false || auth?.kind !== "loopback" || auth.trust === "service" || !auth.scopes.includes("admin")) {
      return reply(403, { error: "Open the shared workspace from the local Chief owner window" });
    }
    if ((req.headers.origin && req.headers.origin !== url.origin) || req.headers["sec-fetch-site"] === "cross-site") {
      return reply(403, { error: "Use Chief's own browser origin" });
    }
    if (req.method !== "GET") return reply(405, { error: "Unsupported shared workspace operation" });
    const base = { name: "Chief shared workspace" };
    const setting = configuredPlatform(env);
    if (!setting) return reply(200, { ...base, enabled: false, available: false, message: "The shared workspace has not been connected yet." });
    const target = localPlatformUrl(setting.url);
    if (!target) return reply(200, { ...base, enabled: false, available: false, message: "The local shared workspace address needs to be configured." });
    // Cookies do not distinguish ports. Separate hostnames prevent Chief's
    // browser cookies from being sent to the retained application.
    if (target.hostname === url.hostname) return reply(200, { ...base, enabled: false, available: false,
      message: "Open your personal Chief workspace at 127.0.0.1 and the shared workspace at localhost to keep their sign-ins separate.",
    });
    if (setting.status && setting.status !== "ready") return reply(200, {
      ...base, enabled: true, available: false,
      message: "The shared workspace is prepared but is not running yet. Your personal agent workspace is still available.",
    });
    let available = false;
    try {
      const response = await fetch(new URL("/config.json", target), {
        method: "GET", redirect: "error", signal: AbortSignal.timeout(2000),
        headers: { accept: "application/json" },
      });
      available = response.ok && (response.headers.get("content-type") ?? "").includes("application/json");
      await response.body?.cancel();
    } catch { /* bounded unavailable state, with no upstream response/credentials exposed */ }
    return reply(200, { ...base, enabled: true, available,
      ...(available ? { url: target.href } : { message: "The shared workspace is unavailable. Retry when it is running; your personal agent workspace remains available." }),
    });
  };
}
