import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";
import { CONNECTOR_TRUST_CATALOG_FINGERPRINT } from "../shared/connector-trust.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import { openSse } from "./testing/sse.ts";

it("enforces exact mailbox approvals through the real HTTP relay and owner routes", async () => {
  const gates = mkdtempSync(join(tmpdir(), "chief-trust-runtime-"));
  const executed: Array<{tool: string; body: any}> = [];
  let origin = "", userId = "synthetic-user", failWrite = false;
  const schema = (tool: string) => ({ type: "object", properties: {
    user_id: {type: "string"}, ...(tool === "GMAIL_CREATE_EMAIL_DRAFT" || tool === "GMAIL_SEND_EMAIL" ? {to: {type: "string"}, subject: {type: "string"}, body: {type: "string"}} : {}),
    ...(tool === "GMAIL_DELETE_MESSAGE" ? {message_id: {type: "string"}} : {}),
    ...(tool === "GMAIL_FETCH_EMAILS" ? {query: {type: "string"}, page_token: {type: "string"}, max_results: {type: "integer"}, include_spam_trash: {type: "boolean"}} : {}),
    ...(tool === "GMAIL_FETCH_MESSAGE_BY_THREAD_ID" ? {thread_id: {type: "string"}, format: {type: "string"}} : {}),
  }, additionalProperties: false });
  const upstream = createServer(async (req,res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {}, path = new URL(req.url ?? "/", "http://fixture").pathname;
    const reply = (value: unknown, status = 200) => { res.writeHead(status,{"content-type":"application/json"}); res.end(JSON.stringify(value)); };
    const session = () => ({session_id:"trs_fixture", mcp:{type:"http",url:origin+"/mcp"},config:{user_id:userId,multi_account:{enable:true,max_accounts_per_toolkit:5,require_explicit_selection:true},auth_configs:{}}});
    if (path.endsWith("/auth_configs")) return reply({items:[]});
    if (path.endsWith("/tool_router/session") && req.method === "POST") { userId = body.user_id; return reply(session(),201); }
    if (path.endsWith("/tool_router/session/trs_fixture")) return reply(session());
    if (path.endsWith("/connected_accounts")) return reply({items:[{id:"synthetic-account",toolkit:{slug:"gmail"},status:"ACTIVE"}]});
    if (path.endsWith("/toolkits")) return reply({items:[{slug:"gmail",name:"Gmail",connected_account:{id:"synthetic-account",status:"ACTIVE"}}]});
    if (path.includes("/tools/execute/")) {
      const tool = path.split("/").at(-1)!;
      if (tool === "GMAIL_GET_PROFILE") return reply({successful:true,data:{emailAddress:"reader@example.test"}});
      executed.push({tool,body}); return failWrite ? reply({error:"synthetic response lost"},503) : reply({successful:true,data:{id:"synthetic-result"}});
    }
    if (path.includes("/tools/")) { const tool = path.split("/").at(-1)!; return reply({slug:tool,toolkit:{slug:"gmail"},version:"20261103_00",input_parameters:schema(tool)}); }
    if (path === "/mcp") return reply({jsonrpc:"2.0",id:body.id,result: body.method === "tools/list" ? {tools:[]} : {capabilities:{},serverInfo:{name:"synthetic",version:"1"}}});
    return reply({error:"unknown fixture route"},404);
  });
  await new Promise<void>(resolve => upstream.listen(0,"127.0.0.1",resolve));
  origin = `http://127.0.0.1:${(upstream.address() as {port:number}).port}`;
  const desktopOwner = "a".repeat(43);
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input,init = {}) => realFetch(input,{...init,headers:{...Object.fromEntries(new Headers(init.headers)),"x-openmausbot-desktop-owner":desktopOwner}});
  let fixture: Awaited<ReturnType<typeof launchVerificationServer>>;
  try { fixture = await launchVerificationServer({FAKE_CLAUDE_MODE:"slow",FAKE_CLAUDE_SLOW_FINISH_GATE:join(gates,"finish"),OMB_TEST_DESKTOP_OWNER_TOKEN:desktopOwner},undefined,undefined,undefined,undefined,undefined,[],undefined,undefined,undefined,false,origin+"/api/v3.1"); }
  finally { globalThis.fetch = realFetch; }
  const api = async (method: string,path: string,body?: unknown,token?: string,expected = 200) => {
    const response = await fetch(fixture.info.url+path,{method,headers:{"content-type":"application/json",origin:fixture.info.url,...(token ? {authorization:`Bearer ${token}`} : {"x-openmausbot-desktop-owner":desktopOwner})},...(body === undefined ? {} : {body:JSON.stringify(body)})});
    const value = await response.json() as any; expect(response.status,JSON.stringify(value)).toBe(expected); return value;
  };
  const events = await openSse(fixture.info.url+"/api/events",{"x-openmausbot-desktop-owner":desktopOwner});
  try {
    await api("PATCH","/api/config",{composio:{apiKey:"ak_synthetic_fixture"}});
    const bot = (await api("GET","/api/bots")).bots[0];
    await api("PATCH",`/api/bots/${bot.id}`,{composio:true,outbound:{policy:"allow",dailyCap:20}});
    const trustPath = `/api/bots/${bot.id}/connector-trust`;
    const initial = await api("GET",trustPath); expect(initial.policy).toBeNull(); expect(initial.accounts[0]).toMatchObject({accountId:"synthetic-account",identity:"reader@example.test",status:"active"});
    const review = (path: string,revision: number) => api("PUT",path,{catalogFingerprint:CONNECTOR_TRUST_CATALOG_FINGERPRINT,expectedRevision:revision,reviewed:true,grants:[{accountId:"synthetic-account",identity:"reader@example.test",operations:["read-profile","create-draft","delete-mail","send-mail"]}]});
    await review(trustPath,0); expect((await api("GET",trustPath)).policy.revision).toBe(1);
    let lastPid: number | undefined;
    const start = async (target: any) => {
      await api("POST",`/api/bots/${target.id}/messages`,{text:"Run only the isolated synthetic connector verification",threadId:target.threadId},undefined,202);
      await expect.poll(() => existsSync(fixture.fixtureDumpPath) && JSON.parse(readFileSync(fixture.fixtureDumpPath,"utf8")).pid !== lastPid,{timeout:15_000}).toBe(true);
      const dump = JSON.parse(readFileSync(fixture.fixtureDumpPath,"utf8")); lastPid = dump.pid;
      const connector = Object.values(dump.mcpConfig.mcpServers).find((entry:any) => entry.env?.OMB_CONNECTOR_TOKEN) as any;
      expect(connector?.env.OMB_CONNECTOR_TOKEN).toBeTruthy(); return connector.env.OMB_CONNECTOR_TOKEN as string;
    };
    const token = await start(bot), seen = new Set<string>();
    const untrustedRead = await fetch(fixture.info.url+trustPath,{headers:{origin:fixture.info.url,authorization:`Bearer ${token}`}});
    await untrustedRead.arrayBuffer();
    await api("PUT",trustPath,{catalogFingerprint:CONNECTOR_TRUST_CATALOG_FINGERPRINT,expectedRevision:1,reviewed:true,grants:[]},token,403);
    const card = async (target = bot) => {
      let found: any;
      await expect.poll(async () => { found = (await api("GET",`/api/threads/${target.threadId}/messages`)).messages.find((m:any) => m.card?.requestId && !seen.has(m.card.requestId)); return Boolean(found); },{timeout:15_000}).toBe(true);
      seen.add(found.card.requestId); return found.card;
    };
    const request = (tool: string,args: Record<string,unknown>,cap = token,expected = 200) => {
      const pending = api("POST","/api/internal/connectors/mcp",{jsonrpc:"2.0",id:"synthetic-request",method:"tools/call",params:{name:tool,arguments:{connected_account_id:"synthetic-account",...args}}},cap,expected);
      void pending.catch(() => undefined); return pending;
    };
    const answer = (c:any,behavior:string,target=bot) => api("POST",`/api/threads/${target.threadId}/respond`,{requestId:c.requestId,behavior});
    const privateMarker = "SYNTHETIC_PRIVATE_BODY_NOT_FOR_AUDIT";
    const draft = {to:"recipient@example.test",subject:"Synthetic draft",body:privateMarker};
    expect((await request("GMAIL_CREATE_EMAIL_DRAFT",{...draft,connected_account_id:"unreviewed-account"})).result.isError).toBe(true);
    const opaque = await api("POST","/api/internal/connectors/mcp",{jsonrpc:"2.0",id:"opaque",method:"tools/call",params:{name:"COMPOSIO_REMOTE_WORKBENCH",arguments:{code:"synthetic opaque executor"}}},token);
    expect(opaque.result.isError).toBe(true); expect(executed).toHaveLength(0);
    let held = request("GMAIL_CREATE_EMAIL_DRAFT",draft); let c = await card();
    expect(c.title).toBe("Approve this exact mailbox action?"); expect(c.subtitle).toContain(privateMarker); expect(executed).toHaveLength(0);
    await answer(c,"deny"); expect((await held).result.isError).toBe(true); expect(executed).toHaveLength(0);
    held = request("GMAIL_CREATE_EMAIL_DRAFT",draft); c = await card(); await answer(c,"allow"); expect((await held).result.isError).not.toBe(true);
    expect(executed).toHaveLength(1); expect(executed[0]).toMatchObject({tool:"GMAIL_CREATE_EMAIL_DRAFT",body:{connected_account_id:"synthetic-account",version:"20261103_00",arguments:draft}});
    expect(executed[0].body.arguments.connected_account_id).toBeUndefined();
    held = request("GMAIL_DELETE_MESSAGE",{message_id:"synthetic-delete"}); c = await card(); await answer(c,"deny"); await held; expect(executed).toHaveLength(1);
    held = request("GMAIL_CREATE_EMAIL_DRAFT",{...draft,subject:"Revoke while held"}); c = await card();
    await api("POST",trustPath+"/revoke",{expectedRevision:1}); await answer(c,"allow"); expect((await held).result.isError).toBe(true); expect(executed).toHaveLength(1);
    await review(trustPath,2); failWrite = true;
    held = request("GMAIL_CREATE_EMAIL_DRAFT",{...draft,subject:"Unknown outcome"}); c = await card(); await answer(c,"allow"); expect((await held).result.isError).toBe(true); expect(executed).toHaveLength(2);
    const uncertain = await api("GET",trustPath); expect(uncertain.actions.some((a:any) => a.state === "outcome-unknown")).toBe(true);
    held = request("GMAIL_CREATE_EMAIL_DRAFT",{...draft,subject:"Unknown outcome"}); c = await card(); await answer(c,"allow"); expect((await held).result.isError).toBe(true); expect(executed).toHaveLength(2);
    failWrite = false;
    const other = (await api("POST","/api/bots",{name:"Synthetic legacy reviewer"},undefined,201)).bot;
    await api("PATCH",`/api/bots/${other.id}`,{composio:true,outbound:{policy:"ask",dailyCap:20}});
    const otherToken = await start(other);
    held = request("GMAIL_SEND_EMAIL",{...draft,subject:"Opt in while held"},otherToken,409); c = await card(other);
    await review(`/api/bots/${other.id}/connector-trust`,0); await answer(c,"allow",other); expect((await held).error).toMatch(/Trust changed/); expect(executed).toHaveLength(2);
    const decisions = await api("GET","/api/decisions"); expect(JSON.stringify(decisions.decisions.filter((d:any) => d.botId === bot.id))).not.toContain(privateMarker);
    await events.until(f => f.kind === "notify" && f.notification.botId === bot.id); expect(JSON.stringify(events.frames.filter(f => f.kind === "notify" && f.notification.botId === bot.id))).not.toContain(privateMarker);
    expect(untrustedRead.status,"A connector capability and forged Origin must not grant owner-only trust read authority").toBe(403);
    expect(readFileSync(fixture.info.logPath,"utf8")).not.toMatch(/ReferenceError|uncaughtException/);
  } finally {
    events.close(); await fixture.close(); await new Promise<void>(resolve => upstream.close(() => resolve())); await removeTempDir(gates);
  }
},120_000);
