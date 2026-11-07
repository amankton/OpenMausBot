import { z } from "zod";
import { ChiefEnhancementSetupError, type ChiefEnhancementSetupService } from "../chief-enhancement-setup.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createChiefEnhancementSetupRoutes(options: {
  /** Require private desktop owner proof on reads as well as writes; never
   * accept connector/internal capability tokens for full profile previews. */
  assertAccess(auth: RequestAuth): void;
  /** Bind assertOwner and the supported runtime adapter's assertCurrent to
   * this request's live owner session, rather than a global cached authority. */
  service(auth: RequestAuth): ChiefEnhancementSetupService;
}): RouteHandler {
  return async ({req,res,path,method,url,auth,json,readBody}) => {
    const match = /^\/api\/chief-enhancement-setup(?:\/(preview|apply))?$/.exec(path);
    if (!match) return PASS;
    res.setHeader("cache-control","no-store");
    try {
      options.assertAccess(auth);
      if (url.search) return json(res,400,{error: "Setup review parameters belong in the request body"});
      const action = match[1];
      if (method === "GET" && !action) return json(res,200,options.service(auth).catalog());
      if (method !== "POST" || !action) return json(res,405,{error: "Unsupported enhancement setup operation"});
      const body = await readBody(req,8192);
      options.assertAccess(auth);
      const service = options.service(auth);
      const result = action === "preview" ? service.preview(body) : service.apply(body);
      options.assertAccess(auth);
      return json(res,200,action === "preview" ? {preview: result} : {receipt: result});
    } catch (error) {
      if (error instanceof z.ZodError) return json(res,400,{error: "Invalid reviewed enhancement setup request"});
      if (error instanceof ChiefEnhancementSetupError) return json(res,error.status,{error: error.message,...(error.receipt ? {receipt: error.receipt} : {})});
      const status = error && typeof error === "object" && "status" in error && [400,401,403,413].includes(Number(error.status)) ? Number(error.status) : 503;
      return json(res,status,{error: "Enhancement setup could not verify the current owner or supported profile and skill state"});
    }
  };
}
