import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createComposioTrustAccess, readConnectorResponseBounded, ConnectorTrustTransportError } from "./connector-trust-composio.ts";
import { ConnectorTrustError } from "./connector-trust.ts";
import { CONNECTOR_TRUST_OPERATIONS } from "../shared/connector-trust.ts";
import type { TrustBoundCall } from "./connector-trust-dispatch.ts";
import type { AppConfig } from "./config.ts";

const mocks = vi.hoisted(() => ({backend: "backend-one",connectedServices: vi.fn(),relayMcp: vi.fn(),provider: vi.fn()}));
vi.mock("./composio.ts",() => ({connectorBackendIdentity: () => mocks.backend,connectedServices: mocks.connectedServices,relayMcp: mocks.relayMcp}));
vi.mock("./email-triage/provider.ts",() => ({createComposioMailProvider: mocks.provider}));
beforeEach(() => {
  vi.clearAllMocks(); mocks.backend = "backend-one"; vi.stubEnv("COMPOSIO_API_KEY",""); vi.stubEnv("OMB_COMPOSIO_API","https://backend.composio.dev/api/v3.1");
  mocks.connectedServices.mockResolvedValue({gmail: {accounts: [{id: "account-one",status: "ACTIVE"}]}});
  mocks.provider.mockImplementation(async (_cfg: unknown,authorize: (account: string,tool: string) => void) => ({identifyAccount: async (accountId: string) => { authorize(accountId,"GMAIL_GET_PROFILE"); return {accountId,address: "owner@example.test"}; }}));
});
afterEach(() => { vi.unstubAllEnvs(); });
const config = (): AppConfig => ({composio: {apiKey: "synthetic-key",userId: "synthetic-user"}});
const readSchema = {type: "object",properties: {user_id: {type: "string"},query: {type: "string"}},required: ["query"]};
const sendSchema = {type: "object",properties: {user_id: {type: "string"},to: {type: "string"},subject: {type: "string"},body: {type: "string"}},required: ["to","subject","body"]};
function call(tool = "GMAIL_FETCH_EMAILS",args: Record<string,unknown> = {connected_account_id: "account-one",query: "after:1"}): TrustBoundCall {
  const operation = CONNECTOR_TRUST_OPERATIONS.find(operation => (operation.tools as readonly string[]).includes(tool))!;
  return {tool,accountId: String(args.connected_account_id ?? "account-one"),arguments: args,userTargets: [],operation: operation.id,effect: operation.effect};
}
const sendCall = () => call("GMAIL_SEND_EMAIL",{connected_account_id: "account-one",to: "recipient@example.test",subject: "Subject",body: "Exact text"});
function direct(options: {schema?: Record<string,unknown>; result?: unknown; schemaMutation?: (cfg: AppConfig) => void} = {}) {
  const cfg = config(); const dispatches: Array<Record<string,unknown>> = [];
  const fetcher = vi.fn(async (url: string | URL | Request,init?: RequestInit) => {
    if (init?.method === "POST") { dispatches.push(JSON.parse(String(init.body))); return new Response(JSON.stringify(options.result ?? {successful: true,data: {messages: []}})); }
    options.schemaMutation?.(cfg);
    const tool = String(url).split("/tools/")[1].split("?")[0];
    return new Response(JSON.stringify({slug: tool,toolkit: {slug: "gmail"},version: "20261103_00",input_parameters: options.schema ?? (tool === "GMAIL_SEND_EMAIL" ? sendSchema : readSchema)}));
  }) as unknown as typeof fetch;
  return {cfg,dispatches,fetcher,access: createComposioTrustAccess(cfg,() => true,fetcher)};
}
function managed(options: {schema?: Record<string,unknown>; result?: Record<string,unknown>; resultForChild?: (index: number) => Record<string,unknown>; beforeFinal?: () => void} = {}) {
  const sent: Array<Record<string,unknown>> = [];
  mocks.relayMcp.mockImplementation(async (_cfg: unknown,payload: unknown,_session?: unknown,before?: () => void | Promise<void>,final?: () => void) => {
    const frame = payload as {id?: string;method: string;params?: Record<string,unknown>};
    if (frame.method === "notifications/initialized") return {status: 202,bytes: new Uint8Array(),contentType: "application/json"};
    let result: unknown;
    if (frame.method === "initialize") result = {capabilities: {},serverInfo: {name: "synthetic",version: "1"}};
    else if (frame.method === "tools/list") result = {tools: [{name: "GMAIL_SEND_EMAIL",inputSchema: options.schema ?? {...sendSchema,properties: {...sendSchema.properties,connected_account_id: {type: "string"}},required: [...sendSchema.required,"connected_account_id"]}},{name: "GMAIL_FETCH_EMAILS",inputSchema: {...readSchema,properties: {...readSchema.properties,connected_account_id: {type: "string"}},required: [...readSchema.required,"connected_account_id"]}}]};
    else { await before?.(); options.beforeFinal?.(); final?.(); sent.push(frame.params ?? {}); result = options.resultForChild?.(sent.length - 1) ?? options.result ?? {content: [{type: "text",text: JSON.stringify({successful: true,data: {id: "synthetic"}})}]}; }
    return {status: 200,bytes: Buffer.from(JSON.stringify({jsonrpc: "2.0",id: frame.id,result})),contentType: "application/json",transportSessionId: "synthetic-session"};
  });
  const cfg: AppConfig = {};
  return {sent,cfg,access: createComposioTrustAccess(cfg,() => true)};
}

describe("actual schema and account-pinned connector transport",() => {
  it("pins each child account outside provider arguments, freezes payloads, and uses the discovered version",async () => {
    const f = direct(); const calls = [call(),call("GMAIL_FETCH_EMAILS",{connected_account_id: "account-two",query: "after:2"})];
    const prepared = await f.access.transport(calls,{id: "owner-action"});
    calls[0].arguments.query = "changed after review"; calls[0].accountId = "changed-account";
    let checks = 0; await prepared.execute(async () => () => { checks++; });
    expect(checks).toBe(2); expect(f.dispatches.map(body => body.connected_account_id)).toEqual(["account-one","account-two"]);
    expect(f.dispatches[0]).toMatchObject({version: "20261103_00",user_id: "synthetic-user",arguments: {query: "after:1"}});
    expect((f.dispatches[0].arguments as Record<string,unknown>).connected_account_id).toBeUndefined();
  });
  it.each([
    {query: "x"},
    {connected_account_id: "account-one",query: 123},
    {connected_account_id: "account-one",query: "x",unknown_ignored_flag: true},
    {connected_account_id: "account-one"},
  ])("rejects missing selectors and schema-incompatible or ignored arguments %#",async args => {
    const f = direct(); await expect(f.access.transport([call("GMAIL_FETCH_EMAILS",args)],{})).rejects.toThrow(); expect(f.dispatches).toHaveLength(0);
  });
  it("refuses a fabricated recipient field that the actual reply schema would ignore",async () => {
    const f = direct({schema: {type: "object",properties: {thread_id: {type: "string"},recipient_email: {type: "string"}},additionalProperties: true}});
    const action = call("GMAIL_REPLY_TO_THREAD",{connected_account_id: "account-one",thread_id: "t",to: "not-consumed@example.test"});
    await expect(f.access.transport([action],{})).rejects.toThrow("unknown or ignored"); expect(f.dispatches).toHaveLength(0);
  });
  it("rejects unknown literal argument names even if patternProperties would accept them",async () => {
    const f = direct({schema: {...readSchema,patternProperties: {"^.*$": {}}}});
    const action = call("GMAIL_FETCH_EMAILS",{connected_account_id: "account-one",query: "x",ignored_extension: "must not run"});
    await expect(f.access.transport([action],{})).rejects.toThrow("unknown or ignored"); expect(f.dispatches).toHaveLength(0);
  });
  it.each(["access_token","apiKey","authorization","custom_connection_data","base_url","request_headers"])("refuses a schema-advertised credential or endpoint override %s",async field => {
    const f = direct({schema: {...readSchema,properties: {...readSchema.properties,[field]: {type: "string"}}}});
    const action = call("GMAIL_FETCH_EMAILS",{connected_account_id: "account-one",query: "x",[field]: "synthetic-unapproved-override"});
    await expect(f.access.transport([action],{})).rejects.toThrow("overrides"); expect(f.dispatches).toHaveLength(0);
  });
  it("refuses nested authentication overrides and schema-advertised raw message headers",async () => {
    const auth = direct({schema: {...readSchema,properties: {...readSchema.properties,options: {type: "object",properties: {Authorization: {type: "string"}}}}}});
    await expect(auth.access.transport([call("GMAIL_FETCH_EMAILS",{connected_account_id: "account-one",query: "x",options: {Authorization: "synthetic"}})],{})).rejects.toThrow("overrides");
    const headers = direct({schema: {...sendSchema,properties: {...sendSchema.properties,headers: {type: "object"}}}});
    const action = sendCall(); action.arguments.headers = {To: "hidden-recipient@example.test"};
    await expect(headers.access.transport([action],{})).rejects.toThrow("Opaque MIME"); expect(headers.dispatches).toHaveLength(0);
  });
  it("rejects raw MIME overrides even when advertised beside a valid recipient",async () => {
    const f = direct({schema: {...sendSchema,properties: {...sendSchema.properties,raw: {type: "string"}}}});
    const action = sendCall(); action.arguments.raw = "opaque different recipient";
    await expect(f.access.transport([action],{})).rejects.toThrow("Opaque MIME"); expect(f.dispatches).toHaveLength(0);
  });
  it("does not permit opaque MIME in provider draft writes either",async () => {
    const f = direct({schema: {...sendSchema,properties: {...sendSchema.properties,raw: {type: "string"}}}});
    const action = call("GMAIL_CREATE_EMAIL_DRAFT",{connected_account_id: "account-one",to: "recipient@example.test",subject: "Draft",body: "Visible text",raw: "hidden MIME recipients"});
    await expect(f.access.transport([action],{})).rejects.toThrow("Opaque MIME"); expect(f.dispatches).toHaveLength(0);
  });
  it("fails closed for invalid or remotely referenced argument schemas",async () => {
    for (const schema of [{type: "object",properties: {query: {type: "unknown-type"}}},{type: "object",properties: {query: {$ref: "https://untrusted.invalid/schema"}}}]) {
      const f = direct({schema}); await expect(f.access.transport([call()],{})).rejects.toThrow("schema"); expect(f.dispatches).toHaveLength(0);
    }
  });
  it("runs the final synchronous revocation gate immediately before the fetch sentinel",async () => {
    const f = direct(); const prepared = await f.access.transport([sendCall()],{});
    let finalRan = false;
    await expect(prepared.execute(async () => { await Promise.resolve(); return () => { finalRan = true; throw new ConnectorTrustError("Owner revoked at dispatch"); }; })).rejects.toThrow("revoked");
    expect(finalRan).toBe(true); expect(f.dispatches).toHaveLength(0);
  });
  it("rechecks cfg and backend changes made inside the final owner gate before network dispatch",async () => {
    for (const mutate of [(f: ReturnType<typeof direct>) => { f.cfg.composio!.userId = "other-user"; },() => { mocks.backend = "new-backend"; }]) {
      mocks.backend = "backend-one"; const f = direct(); const prepared = await f.access.transport([sendCall()],{});
      await expect(prepared.execute(async () => () => { mutate(f); })).rejects.toThrow("authentication changed"); expect(f.dispatches).toHaveLength(0);
    }
  });
  it.each([{}, {successful: false}, {successful: true,error: "synthetic error"},{successful: true,data: {successful: false}},{data: {id: "unconfirmed-write"}}])("does not report false/error/unknown write responses as completed %#",async result => {
    const f = direct({result}); const prepared = await f.access.transport([sendCall()],{});
    await expect(prepared.execute(async () => () => {})).rejects.toThrow(); expect(f.dispatches).toHaveLength(1);
  });
  it("rejects empty or explicitly unsuccessful read envelopes",async () => {
    for (const result of [{},{successful: true,data: {successful: false}}]) {
      const f = direct({result}); const prepared = await f.access.transport([call()],{}); await expect(prepared.execute(async () => () => {})).rejects.toThrow("unconfirmed");
    }
  });
  it("decomposes a managed batch into typed canonical-selector direct calls",async () => {
    const f = managed(); const prepared = await f.access.transport([sendCall(),call()],{method: "tools/call",params: {name: "COMPOSIO_MULTI_EXECUTE_TOOL"}});
    await prepared.execute(async () => () => {});
    expect(f.sent.map(frame => frame.name)).toEqual(["GMAIL_SEND_EMAIL","GMAIL_FETCH_EMAILS"]);
    expect(f.sent.every(frame => (frame.arguments as Record<string,unknown>).connected_account_id === "account-one")).toBe(true);
  });
  it("does not substitute a process environment credential for the selected managed backend",async () => {
    vi.stubEnv("COMPOSIO_API_KEY","synthetic-unselected-project-key");
    const f = managed(); const unusedProjectFetch = vi.fn(async () => { throw new Error("Wrong credential path"); }) as unknown as typeof fetch;
    const prepared = await createComposioTrustAccess(f.cfg,() => true,unusedProjectFetch).transport([call()],{});
    await prepared.execute(async () => () => {}); expect(unusedProjectFetch).not.toHaveBeenCalled(); expect(f.sent).toHaveLength(1);
  });
  it.each([
    {...sendSchema},
    {...sendSchema,properties: {...sendSchema.properties,connected_account_id: {}}},
    {...sendSchema,properties: {...sendSchema.properties,connected_account_id: {type: "number"}}},
  ])("rejects managed schemas with absent, ignored or incorrectly typed selectors %#",async schema => {
    const f = managed({schema}); await expect(f.access.transport([sendCall()],{})).rejects.toThrow(); expect(f.sent).toHaveLength(0);
  });
  it("rejects contradictory managed success plus nested errors and unknown write acknowledgements",async () => {
    for (const result of [{structuredContent: {successful: true},content: [{type: "text",text: JSON.stringify({successful: false,error: "failure"})}]},{content: [{type: "text",text: "Probably sent"}]},{isError: true,content: [{type: "text",text: JSON.stringify({successful: true})}]}]) {
      const f = managed({result}); const prepared = await f.access.transport([sendCall()],{}); await expect(prepared.execute(async () => () => {})).rejects.toThrow("unconfirmed");
    }
  });
  it("catches managed backend revocation after awaited preparation but before its fetch sentinel",async () => {
    const f = managed({beforeFinal: () => { mocks.backend = "revoked-backend"; }}); const prepared = await f.access.transport([sendCall()],{});
    await expect(prepared.execute(async () => () => {})).rejects.toThrow("authentication changed"); expect(f.sent).toHaveLength(0);
  });
  it("retains sanitized per-child receipts when a later project action times out",async () => {
    let posts = 0;
    const fetcher = (async (url: string | URL | Request,init?: RequestInit) => {
      if (init?.method === "POST") { posts++; if (posts === 2) throw new Error("synthetic-secret-token and private mail text"); return new Response(JSON.stringify({successful: true,data: {privateBody: "CONFIDENTIAL SOURCE BODY"}})); }
      const tool = String(url).split("/tools/")[1].split("?")[0]; return new Response(JSON.stringify({slug: tool,toolkit: {slug: "gmail"},version: "20261103_00",input_parameters: sendSchema}));
    }) as typeof fetch;
    const one = sendCall(), two = sendCall(); two.accountId = "account-two"; two.arguments.connected_account_id = "account-two";
    const prepared = await createComposioTrustAccess(config(),() => true,fetcher).transport([one,two],{});
    const error = await prepared.execute(async () => () => {}).catch(error => error);
    expect(error).toBeInstanceOf(ConnectorTrustTransportError); expect(error.completedChildren).toHaveLength(1);
    expect(error.completedChildren[0]).toMatchObject({index: 0,tool: "GMAIL_SEND_EMAIL",accountId: "account-one",effect: "send"});
    expect(error.completedChildren[0].responseDigest).toMatch(/^[a-f0-9]{64}$/); expect(error.evidenceReference).toMatch(/^connector-partial:1\/2:[a-f0-9]{64}$/);
    expect(JSON.stringify(error)).not.toMatch(/CONFIDENTIAL|synthetic-secret|private mail/);
  });
  it("retains confirmed managed-child evidence while refusing an unconfirmed later acknowledgement",async () => {
    const f = managed({resultForChild: index => ({content: [{type: "text",text: JSON.stringify(index ? {successful: false,error: "synthetic private result"} : {successful: true,data: {id: "first-confirmed"}})}]})});
    const prepared = await f.access.transport([sendCall(),sendCall()],{});
    const error = await prepared.execute(async () => () => {}).catch(error => error);
    expect(error).toBeInstanceOf(ConnectorTrustTransportError); expect(error.completedChildren).toHaveLength(1); expect(error.evidenceReference).toContain("partial:1/2");
  });
  it("does not call an oversized or unparsed write response completed",async () => {
    const metadata = {slug: "GMAIL_SEND_EMAIL",toolkit: {slug: "gmail"},version: "20261103_00",input_parameters: sendSchema};
    const fetcher = (async (_url: string | URL | Request,init?: RequestInit) => init?.method !== "POST" ? new Response(JSON.stringify(metadata)) : new Response(new ReadableStream<Uint8Array>({start(controller) { controller.enqueue(new Uint8Array(10_000_001)); }}))) as typeof fetch;
    const prepared = await createComposioTrustAccess(config(),() => true,fetcher).transport([sendCall()],{});
    const error = await prepared.execute(async () => () => {}).catch(error => error);
    expect(error).toBeInstanceOf(ConnectorTrustTransportError); expect(error.completedChildren).toHaveLength(0); expect(error.evidenceReference).toContain("unknown:0/1");
  });
  it("enforces the combined response budget before accepting a later write acknowledgement",async () => {
    const f = direct({result: {successful: true,data: {text: "x".repeat(5_100_000)}}});
    const prepared = await f.access.transport([sendCall(),sendCall()],{});
    const error = await prepared.execute(async () => () => {}).catch(error => error);
    expect(error).toBeInstanceOf(ConnectorTrustTransportError); expect(error.completedChildren).toHaveLength(1); expect(error.evidenceReference).toContain("partial:1/2");
  });
});

describe("bounded bodies and authoritative mailbox facts",() => {
  it("stops an oversized chunked body without trusting a missing or false Content-Length",async () => {
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({start(controller) { controller.enqueue(new Uint8Array([1,2]));controller.enqueue(new Uint8Array([3,4,5])); },cancel() { canceled = true; }});
    await expect(readConnectorResponseBounded(new Response(body,{headers: {"content-length": "1"}}),4)).rejects.toThrow("bounded size"); expect(canceled).toBe(true);
  });
  it("rejects an oversized declared body before retaining chunks",async () => {
    await expect(readConnectorResponseBounded(new Response("small",{headers: {"content-length": "1000"}}),4)).rejects.toThrow("bounded size");
  });
  it("returns unavailable rather than an alias when identity access is revoked or profile is wrong",async () => {
    const access = createComposioTrustAccess(config(),() => false); const denied = await access.facts("chief"); expect(denied[0]).toMatchObject({accountId: "account-one",status: "unavailable",verifiedAt: 0});
    mocks.provider.mockResolvedValue({identifyAccount: async () => ({accountId: "other-account",address: "owner@example.test"})});
    expect((await createComposioTrustAccess(config(),() => true).facts("chief"))[0].status).toBe("unavailable");
  });
  it("marks inactive connections without reading their mailbox profile",async () => {
    mocks.connectedServices.mockResolvedValue({gmail: {accounts: [{id: "inactive",status: "REVOKED"}]}});
    const identify = vi.fn(); mocks.provider.mockResolvedValue({identifyAccount: identify});
    expect((await createComposioTrustAccess(config(),() => true).facts("chief"))[0].status).toBe("inactive"); expect(identify).not.toHaveBeenCalled();
  });
});
