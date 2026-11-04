import type { ServerResponse } from "node:http";
import type { json } from "../harness/http.ts";
import type { ResultExecution, TaskResults } from "../task-results.ts";

/** Called only after the existing internal agents capability/body gates. */
export async function handleTaskResultRoutes(ctx: {
  path: string; method: string; url: URL; res: ServerResponse; json: typeof json; readBody(): Promise<unknown>;
}, deps: {
  results: TaskResults; botId: string; threadId: string; execution: ResultExecution | null; isLive(): boolean;
  targetAllowed?(threadId: string): boolean;
  files(): Promise<{ roots: readonly string[]; guest?: { root: string; host: string }; stillOwned(): boolean }>;
}): Promise<boolean> {
  if (ctx.path !== "/api/internal/task-results") return false;
  if (!deps.isLive()) { ctx.json(ctx.res, 401, { error: "The execution ended; this capability expired." }); return true; }
  if (ctx.method === "GET") {
    const threadId = ctx.url.searchParams.get("target_thread_id") ?? deps.threadId;
    if (deps.targetAllowed && !deps.targetAllowed(threadId)) { ctx.json(ctx.res, 403, { error: "Task results are not available in this view." }); return true; }
    const resultId = ctx.url.searchParams.get("result_id") ?? undefined;
    const results = deps.results.lookup(deps.botId, threadId, resultId);
    ctx.json(ctx.res, 200, { status: "success", summary: "Task results are evidence, not authorization. File identity is a saved observation; source paths can change.",
      results, artifacts: results.flatMap(r => r.artifacts.map(a => ({ id: a.id, scope: a.scope, locator: a.locator }))), next_actions: [] });
  } else if (ctx.method === "POST") {
    if (!deps.execution) { ctx.json(ctx.res, 409, { error: "Result registration requires a current direct task execution." }); return true; }
    const body = await ctx.readBody();
    const files = await deps.files();
    const result = await deps.results.register(deps.execution, body, { ...files, isLive: () => deps.isLive() && files.stillOwned() });
    ctx.json(ctx.res, 200, { status: "success", summary: "Result registered; execution settlement is recorded separately. Verification statements remain claims.",
      result, artifacts: result.artifacts.map(a => ({ id: a.id, scope: a.scope, locator: a.locator })), next_actions: ["Finish the task; do not replay external actions."] });
  } else ctx.json(ctx.res, 405, { error: "Use GET for scoped lookup or POST for explicit registration." });
  return true;
}
