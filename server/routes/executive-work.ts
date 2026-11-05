import type { ServerResponse } from "node:http";
import type { ExecutiveService } from "../executive-service.ts";
import { PASS, type RouteHandler } from "./table.ts";
import type { json } from "../harness/http.ts";

export function createExecutiveWorkRoutes(service: ExecutiveService): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (!/^\/api\/executive-work(?:\/|$)/.test(path)) return PASS;
    if (auth.kind === "session" && !auth.scopes.includes("admin")) return json(res, 403, { error: "Chief work setup is owner-only" });
    const result = await service.request(path, method, ["POST", "PATCH"].includes(method) ? await readBody(req) : undefined);
    return result ? json(res, result.status, result.body) : PASS;
  };
}

export async function handleExecutiveInternal(
  context: { path: string; method: string; res: ServerResponse; json: typeof json; readBody: () => Promise<unknown> },
  deps: { service: ExecutiveService; actor: NonNullable<Parameters<ExecutiveService["request"]>[3]>; toolAllowed: (name: string) => boolean },
): Promise<boolean> {
  const { path, method, res, json, readBody } = context;
  if (!/^\/api\/internal\/executive-work(?:\/|$)/.test(path)) return false;
  if (!deps.actor.isLive()) { json(res, 401, { error: "This turn has ended" }); return true; }
  const tool = path.endsWith("/scan") ? "scan_mail" : path.endsWith("/review") ? "review_mail" : method === "GET" ? "work_items" : "record_work_item";
  if (!deps.toolAllowed(tool)) { json(res, 403, { error: "This tool is outside the bot's current tool selection" }); return true; }
  const result = await deps.service.request(path, method, ["POST", "PATCH"].includes(method) ? await readBody() : undefined, deps.actor);
  if (!result) return false;
  json(res, result.status, result.body);
  return true;
}
