import { afterEach, describe, expect, it, vi } from "vitest";
import { createMcpMailProvider, createComposioDirectMailProvider, createComposioMailProvider, type MailToolSchema } from "./provider.ts";
import type { MailboxScope } from "../../shared/email-triage.ts";

const scope: MailboxScope = { accountId: "account-b", address: "owner@example.test", context: "personal", ownerBotId: "chief", coordinatorBotId: "chief", sourceThreadId: "task" };
const schemas: MailToolSchema[] = [
  { name: "GMAIL_GET_PROFILE", inputSchema: { properties: { user_id: {} } } },
  { name: "GMAIL_FETCH_EMAILS", inputSchema: { properties: { query: {}, page_token: {}, max_results: {}, user_id: {} } } },
  { name: "GMAIL_FETCH_MESSAGE_BY_THREAD_ID", inputSchema: { properties: { thread_id: {}, user_id: {}, format: {} } } },
];
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
const barrier=()=>{let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};};
describe("audited Gmail read adapter", () => {
  it("identifies an explicitly selected setup connection using only GET_PROFILE", async () => {
    const calls: Array<{account: string; name: string}> = [];
    const provider = await createMcpMailProvider({ async discover() { return schemas; }, async execute(account, name) {
      calls.push({account, name});
      if (name !== "GMAIL_GET_PROFILE") throw new Error("Mailbox content reads are disabled during setup");
      return {data: {emailAddress: "verified-owner@example.test"}};
    } });
    expect(await provider.identifyAccount!("new-active-connection")).toEqual({accountId: "new-active-connection", address: "verified-owner@example.test"});
    expect(calls).toEqual([{account: "new-active-connection", name: "GMAIL_GET_PROFILE"}]);
    expect(await provider.verifyIdentity({...scope,accountId: "new-active-connection"})).toEqual({accountId: "new-active-connection", address: "verified-owner@example.test"});
    expect(calls.every(call => call.name === "GMAIL_GET_PROFILE")).toBe(true);
  });
  it("uses actual schemas, explicit account IDs, bounded pages, and complete MIME context", async () => {
    const calls: Array<{account: string;name: string;args: Record<string, unknown>}> = [];
    const provider = await createMcpMailProvider({ async discover() { return schemas; }, async execute(account, name, args) {
      calls.push({ account, name, args });
      if (name === "GMAIL_GET_PROFILE") return { data: { emailAddress: scope.address } };
      if (name === "GMAIL_FETCH_EMAILS") return { data: { messages: [{ id: "m", threadId: "t" }], nextPageToken: "next" } };
      return { data: { messages: [{ id: "m", threadId: "t", internalDate: "1000", payload: { mimeType: "text/plain", headers: [{ name: "To", value: scope.address }], body: { data: Buffer.from("Complete body").toString("base64url") } } }] } };
    } });
    expect(await provider.verifyIdentity(scope)).toEqual({ accountId: scope.accountId, address: scope.address });
    expect((await provider.list(scope, { start: 0, end: 100000, limit: 25, cursor: "prior" })).nextCursor).toBe("next");
    const thread = await provider.readThread(scope, "t"); expect(thread.complete).toBe(true); expect(thread.messages[0].text).toBe("Complete body");
    expect(calls.every(c => c.account === "account-b")).toBe(true); expect(calls[1].args).toMatchObject({ query: "after:0 before:100", page_token: "prior", max_results: 25 });
    expect(provider.capabilities).toMatchObject({ mutations: false, providerDrafts: false, incrementalHistory: false });
  });
  it("fails closed when required operations or pagination schemas are not advertised", async () => {
    await expect(createMcpMailProvider({ async discover() { return []; }, async execute() { throw Error("must not execute"); } })).rejects.toThrow("unavailable");
    await expect(createMcpMailProvider({ async discover() { return schemas.map(s => s.name === "GMAIL_FETCH_EMAILS" ? { ...s, inputSchema: { properties: { query: {}, max_results: {} } } } : s); }, async execute() { throw Error("must not execute"); } })).rejects.toThrow("page_token");
  });
  it("does not call a snippet a complete thread and rejects cross-account responses", async () => {
    const provider = await createMcpMailProvider({ async discover() { return schemas; }, async execute(_a, name) { if (name === "GMAIL_GET_PROFILE") return { data: { accountId: "another", emailAddress: scope.address } }; return { data: { messages: [{ id: "m", threadId: "t", snippet: "A preview only" }] } }; } });
    await expect(provider.verifyIdentity(scope)).rejects.toThrow("account differs"); expect((await provider.readThread(scope, "t")).complete).toBe(false);
  });
  it("discovers and pins documented direct-execution schemas without exposing credentials", async () => {
    const calls: Array<{url: string;body?: Record<string, unknown>}> = [];
    const authorize: string[] = [];
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url); const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined; calls.push({url: value,body});
      if (!body) { const name = value.split("/tools/")[1].split("?")[0]; const schema = schemas.find(s => s.name === name)!; return new Response(JSON.stringify({ slug: name, toolkit: {slug: "gmail"}, version: "20261103_00", input_parameters: { type: "object", ...schema.inputSchema } })); }
      return new Response(JSON.stringify({ successful: true, data: { emailAddress: scope.address } }));
    }) as typeof fetch;
    const provider = await createComposioDirectMailProvider({ composio: { apiKey: "synthetic-key", userId: "synthetic-user" } }, async account => { authorize.push(account); }, fakeFetch,account=>{authorize.push(`final:${account}`);});
    await provider.verifyIdentity(scope);
    expect(calls).toHaveLength(4); expect(authorize).toEqual([scope.accountId,`final:${scope.accountId}`]);
    expect(calls[3].body).toMatchObject({ connected_account_id: "account-b", user_id: "synthetic-user", version: "20261103_00", arguments: {user_id: "me"} });
    expect(calls.some(c => /SEND|DELETE|DRAFT|MODIFY/.test(c.url))).toBe(false);
  });
  it.each(["grant","account","project-key","user-id","endpoint"] as const)("blocks direct final dispatch when %s changes during awaited authorization",async(change)=>{
    const gate=barrier(),entered=barrier(),cfg={composio:{apiKey:"synthetic-project-key",userId:"synthetic-user"}};let granted=true,selected=scope.accountId,executed=0;
    const fetcher=(async(input,init)=>{if(init?.method==="POST"){executed++;throw new Error("No revoked request may reach the provider");}const name=String(input).split("/tools/")[1]!.split("?")[0]!;return new Response(JSON.stringify({slug:name,toolkit:{slug:"gmail"},version:"20261103_00",input_parameters:{type:"object",...schemas.find(tool=>tool.name===name)!.inputSchema}}));}) as typeof fetch;
    const provider=await createComposioDirectMailProvider(cfg,async()=>{entered.release();await gate.promise;},fetcher,(account)=>{if(!granted||account!==selected)throw new Error("Synthetic current grant/account denied");});
    const pending=provider.verifyIdentity(scope);const rejected=expect(pending).rejects.toThrow();await entered.promise;
    if(change==="grant")granted=false;else if(change==="account")selected="different-account";else if(change==="project-key")cfg.composio.apiKey="different-synthetic-key";else if(change==="user-id")cfg.composio.userId="different-synthetic-user";else vi.stubEnv("OMB_COMPOSIO_API","http://127.0.0.1:32877/api/v3.1");
    gate.release();await rejected;expect(executed).toBe(0);
  });
  it("ignores ambient project credentials and requires an explicitly configured key",async()=>{
    vi.stubEnv("COMPOSIO_API_KEY","synthetic-ambient-key");let calls=0;
    await expect(createComposioDirectMailProvider({composio:{userId:"synthetic-user"}},()=>{},(async()=>{calls++;throw new Error("Must not fetch");}) as typeof fetch)).rejects.toThrow(/configured project credential/);expect(calls).toBe(0);
  });
  it.each(["grant","account","backend","user-id"] as const)("blocks managed MCP final dispatch when %s changes during its last authorization await",async(change)=>{
    vi.stubEnv("OMB_COMPOSIO_BROKER_URL","http://127.0.0.1:32878");vi.stubEnv("OMB_COMPOSIO_BROKER_TOKEN","a".repeat(64));
    const cfg={composio:{userId:"synthetic-managed-user"}},gate=barrier(),entered=barrier();let authorizationCalls=0,toolCalls=0,granted=true,selected=scope.accountId;
    vi.stubGlobal("fetch",(async(input,init)=>{
      const url=String(input);
      if(url.endsWith("/v1/connectors/connected"))return new Response(JSON.stringify({services:{gmail:{connected:true,status:"ACTIVE",accounts:[{id:scope.accountId,status:"ACTIVE"}]}}}));
      if(!url.endsWith("/v1/mcp"))throw new Error("Unexpected synthetic provider URL");
      const body=JSON.parse(String(init?.body)) as {id?:string;method:string};
      if(body.method==="tools/call"){toolCalls++;throw new Error("No revoked MCP request may reach the provider");}
      return new Response(JSON.stringify({jsonrpc:"2.0",id:body.id,result:body.method==="tools/list"?{tools:schemas.map(tool=>({...tool,inputSchema:{...tool.inputSchema,properties:{...tool.inputSchema.properties,connected_account_id:{type:"string"}}}}))}:{capabilities:{},serverInfo:{name:"synthetic",version:"1"}}}),{status:200,headers:{"content-type":"application/json"}});
    }) as typeof fetch);
    const provider=await createComposioMailProvider(cfg,async()=>{if(++authorizationCalls===2){entered.release();await gate.promise;}},account=>{if(!granted||account!==selected)throw new Error("Synthetic current grant/account denied");});
    const pending=provider.verifyIdentity(scope);const rejected=expect(pending).rejects.toThrow();await entered.promise;
    if(change==="grant")granted=false;else if(change==="account")selected="different-account";else if(change==="backend")vi.stubEnv("OMB_COMPOSIO_BROKER_TOKEN","b".repeat(64));else cfg.composio.userId="different-managed-user";
    gate.release();await rejected;expect(authorizationCalls).toBe(2);expect(toolCalls).toBe(0);
  });
  it("executes a correctly pinned managed profile read only after its final synchronous authority check",async()=>{
    vi.stubEnv("OMB_COMPOSIO_BROKER_URL","http://127.0.0.1:32879");vi.stubEnv("OMB_COMPOSIO_BROKER_TOKEN","c".repeat(64));
    let finalChecked=false,executed=0;
    vi.stubGlobal("fetch",(async(input,init)=>{
      if(String(input).endsWith("/v1/connectors/connected"))return new Response(JSON.stringify({services:{gmail:{connected:true,status:"ACTIVE",accounts:[{id:scope.accountId,status:"ACTIVE"}]}}}));
      const body=JSON.parse(String(init?.body)) as {id?:string;method:string;params?:{arguments:Record<string,unknown>}};
      if(body.method==="tools/call"){expect(finalChecked).toBe(true);expect(body.params?.arguments).toEqual({user_id:"me",connected_account_id:scope.accountId});executed++;}
      return new Response(JSON.stringify({jsonrpc:"2.0",id:body.id,result:body.method==="tools/list"?{tools:schemas.map(tool=>({...tool,inputSchema:{...tool.inputSchema,properties:{...tool.inputSchema.properties,connected_account_id:{type:"string"}}}}))}:body.method==="tools/call"?{data:{emailAddress:scope.address}}:{capabilities:{},serverInfo:{name:"synthetic",version:"1"}}}),{headers:{"content-type":"application/json"}});
    }) as typeof fetch);
    const provider=await createComposioMailProvider({composio:{userId:"synthetic-user"}},()=>{},account=>{expect(account).toBe(scope.accountId);finalChecked=true;});
    expect(await provider.verifyIdentity(scope)).toEqual({accountId:scope.accountId,address:scope.address});expect(executed).toBe(1);
  });
});
