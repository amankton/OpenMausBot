import { createHash } from "node:crypto";
import type { ValidateFunction } from "ajv";
import type { AppConfig } from "./config.ts";
import * as composio from "./composio.ts";
import { createComposioMailProvider } from "./email-triage/provider.ts";
import { compileToolSchema } from "./drivers/chat-mcp-tools.ts";
import { ConnectorTrustError } from "./connector-trust.ts";
import { readConnectorResponseBounded } from "./connector-response.ts";
import { trustRpcResult, trustTransportId, type PreparedTrustTransport, type TrustBoundCall } from "./connector-trust-dispatch.ts";
import { CONNECTOR_TRUST_OPERATIONS, connectorTrustAccountFactSchema, type ConnectorTrustAccountFact } from "../shared/connector-trust.ts";
import type { JsonValue } from "./schema.ts";

export { readConnectorResponseBounded } from "./connector-response.ts";
const SCHEMA_LIMIT = 1_000_000;
const RESULT_LIMIT = 10_000_000;
export interface ConnectorChildReceipt { index: number; tool: string; accountId: string; effect: TrustBoundCall["effect"]; responseDigest: string }
export class ConnectorTrustTransportError extends ConnectorTrustError {
  readonly completedChildren: readonly ConnectorChildReceipt[];
  readonly evidenceReference: string;
  constructor(error: unknown, receipts: readonly ConnectorChildReceipt[], total: number) {
    super(error instanceof ConnectorTrustError ? error.message : "The connector action outcome is unconfirmed; reconcile evidence before retrying",error instanceof ConnectorTrustError ? error.status : 503);
    this.name = "ConnectorTrustTransportError";
    this.completedChildren = Object.freeze(receipts.map(receipt => Object.freeze({...receipt})));
    const digest = createHash("sha256").update(JSON.stringify(this.completedChildren)).digest("hex");
    this.evidenceReference = `connector-${receipts.length ? "partial" : "unknown"}:${receipts.length}/${total}:${digest}`;
  }
}
function childReceipt(index: number, call: TrustBoundCall, bytes: Uint8Array): ConnectorChildReceipt {
  return {index,tool: call.tool,accountId: call.accountId,effect: call.effect,responseDigest: createHash("sha256").update(bytes).digest("hex")};
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const fingerprint = (cfg: AppConfig) => createHash("sha256").update(composio.connectorBackendIdentity(cfg)).update(JSON.stringify(cfg.composio ?? {})).update(process.env.OMB_COMPOSIO_API ?? "").digest("hex");
function stableSnapshot<T>(value: T): T {
  let text: string;
  try { text = JSON.stringify(value); } catch { throw new ConnectorTrustError("The connector action is not a bounded JSON value"); }
  if (!text || Buffer.byteLength(text) > 65536) throw new ConnectorTrustError("The connector action exceeds its reviewable size");
  const copy = JSON.parse(text) as T;
  const freeze = (node: unknown): void => { if (!node || typeof node !== "object") return; Object.values(node).forEach(freeze); Object.freeze(node); };
  freeze(copy); return copy;
}
function parseObject(bytes: Uint8Array): Record<string, unknown> {
  try { const value: unknown = JSON.parse(new TextDecoder().decode(bytes)); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; }
  catch { throw new ConnectorTrustError("The connector returned invalid structured data; review the outcome before retrying",503); }
}
function unpackRpc(bytes: Uint8Array, id: string): Record<string, unknown> {
  if (bytes.byteLength > RESULT_LIMIT) throw new ConnectorTrustError("Managed connector response exceeded the bounded size",503);
  const text = new TextDecoder().decode(bytes).trim();
  let frames: unknown[];
  try { frames = text.startsWith("{") ? [JSON.parse(text)] : text.split(/\r?\n/).filter(line => line.startsWith("data:")).flatMap(line => { const data = line.slice(5).trim(); return data && data !== "[DONE]" ? [JSON.parse(data)] : []; }); }
  catch { throw new ConnectorTrustError("The managed connector returned invalid structured data",503); }
  const frame = object(frames.findLast(frame => object(frame).id === id));
  if (!frame.result || frame.error || !Object.keys(object(frame.result)).length) throw new ConnectorTrustError("The account-aware connector transport returned no usable result",503);
  return object(frame.result);
}
function compiledInput(raw: unknown): {schema: Record<string, unknown>; validate: ValidateFunction} {
  const input = object(raw);
  if (!Object.keys(input).length) throw new ConnectorTrustError("The provider did not advertise a verifiable argument schema",503);
  let schema: Record<string, unknown>;
  if (input.type === "object" || Object.hasOwn(input,"properties")) schema = {...input,type: "object",additionalProperties: false};
  else {
    const properties: Record<string, unknown> = Object.create(null);
    const required: string[] = [];
    for (const [name,value] of Object.entries(input)) {
      const field = object(value);
      if (!Object.keys(field).length || typeof field.required !== "boolean" && field.required !== undefined) throw new ConnectorTrustError("The provider argument schema is unsupported",503);
      const {required: mandatory,example: _example,...definition} = field;
      properties[name] = definition; if (mandatory) required.push(name);
    }
    schema = {type: "object",properties,required,additionalProperties: false};
  }
  let nodes = 0;
  const check = (value: unknown,depth = 0): void => {
    if (++nodes > 10000 || depth > 30) throw new ConnectorTrustError("The provider argument schema exceeds its bounded complexity",503);
    if (!value || typeof value !== "object") return;
    const record = object(value);
    if (record.$async || typeof record.$ref === "string" && !record.$ref.startsWith("#")) throw new ConnectorTrustError("The provider argument schema requires unsupported remote or async validation",503);
    Object.values(value).forEach(child => check(child,depth + 1));
  };
  check(schema);
  try { return {schema,validate: compileToolSchema(schema)}; }
  catch (error) { if (error instanceof ConnectorTrustError) throw error; throw new ConnectorTrustError("The provider argument schema could not be verified",503); }
}
function rejectCredentialOverrides(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { value.forEach(rejectCredentialOverrides); return; }
  const forbidden = new Set(["authorization","apikey","accesstoken","refreshtoken","idtoken","credentials","auth","authentication","customconnectiondata","connectionid","connectedaccountids","accountid","accountids","baseurl","apiurl","endpoint","httpmethod","requestheaders"]);
  for (const [key,child] of Object.entries(value)) {
    if (forbidden.has(key.replace(/[^a-z0-9]/gi,"").toLowerCase())) throw new ConnectorTrustError("Provider authentication, connection and endpoint overrides are unavailable in bounded mailbox arguments");
    rejectCredentialOverrides(child);
  }
}
function validateArgs(call: TrustBoundCall, schema: Record<string, unknown>, validate: ValidateFunction, managed: boolean) {
  const args: Record<string, unknown> = {...call.arguments};
  if (args.connected_account_id !== call.accountId || Object.hasOwn(args,"connectedAccountId") && args.connectedAccountId !== call.accountId) throw new ConnectorTrustError("The canonical mailbox selector differs from the reviewed account");
  delete args.connectedAccountId;
  if (!managed) delete args.connected_account_id;
  const properties = object(schema.properties);
  if (managed) {
    const selector = object(properties.connected_account_id);
    if (!(selector.type === "string" || Array.isArray(selector.type) && selector.type.includes("string"))) throw new ConnectorTrustError("The managed tool does not advertise a typed canonical mailbox selector",503);
  }
  // additionalProperties:false still permits patternProperties matches.
  // Bounded authority accepts only literal advertised parameter names.
  if (Object.keys(args).some(key => !Object.hasOwn(properties,key))) throw new ConnectorTrustError("The exact reviewed arguments contain an unknown or ignored provider field",400);
  rejectCredentialOverrides(args);
  if (!validate(args)) throw new ConnectorTrustError("The exact reviewed arguments do not match the current provider schema; unknown or ignored fields are unavailable",400);
  if (call.effect !== "read" && ["raw","raw_message","rawMessage","raw_email","mime_message","mimeMessage","headers","mime_headers","raw_headers"].some(field => Object.hasOwn(args,field))) throw new ConnectorTrustError("Opaque MIME payloads cannot prove the reviewed recipients in bounded mode");
  if (call.effect === "send") {
    const fields = ["to","recipient_email","recipients","to_email"].filter(field => Object.hasOwn(args,field) && Object.hasOwn(properties,field));
    const recipients = [...fields,...["cc","bcc"].filter(field => Object.hasOwn(args,field) && Object.hasOwn(properties,field))].flatMap(field => typeof args[field] === "string" ? [args[field] as string] : Array.isArray(args[field]) ? args[field] as unknown[] : []);
    if (!recipients.length || recipients.some(value => typeof value !== "string" || !value.trim() || /[\r\n]/.test(value))) throw new ConnectorTrustError("Sending requires schema-verified explicit recipients; inferred thread recipients are unavailable");
    if (typeof args.subject === "string" && /[\r\n]/.test(args.subject)) throw new ConnectorTrustError("Mail subject headers must not contain line breaks in bounded mode");
  }
  return stableSnapshot(args);
}
function resultBytes(payload: unknown, results: unknown[]) {
  const bytes = Buffer.from(JSON.stringify(trustRpcResult(payload,results)));
  if (bytes.byteLength > RESULT_LIMIT) throw new ConnectorTrustError("The combined mailbox response exceeded its bounded size",503);
  return {status: 200,contentType: "application/json",bytes};
}
function positiveWrite(result: Record<string, unknown>): boolean {
  if (managedError(result)) return false;
  const structured = object(result.structuredContent);
  if (structured.error || structured.successful === false) return false;
  if (!Array.isArray(result.content) || !result.content.length) return structured.successful === true;
  let positive = structured.successful === true;
  for (const value of result.content) {
    const block = object(value);
    if (block.type !== "text" || typeof block.text !== "string") return false;
    let parsed: Record<string, unknown>;
    try { parsed = object(JSON.parse(block.text)); } catch { return false; }
    if (parsed.error || parsed.isError === true || parsed.successful === false || object(parsed.data).error) return false;
    if (parsed.successful === true) positive = true;
  }
  return positive;
}
function managedError(result: Record<string, unknown>): boolean {
  const failed = (value: Record<string,unknown>) => value.isError === true || value.successful === false || !!value.error || object(value.data).successful === false || !!object(value.data).error;
  if (failed(result) || failed(object(result.structuredContent))) return true;
  return Array.isArray(result.content) && result.content.some(value => {
    const block = object(value);
    if (block.type !== "text" || typeof block.text !== "string") return false;
    try { return failed(object(JSON.parse(block.text))); } catch { return false; }
  });
}

export function createComposioTrustAccess(cfg: AppConfig, toolAllowed: (botId: string, tool: string) => boolean, fetcher: typeof fetch = fetch) {
  return {
    async facts(botId: string): Promise<ConnectorTrustAccountFact[]> {
      const configuredAt = fingerprint(cfg);
      const current = () => { if (fingerprint(cfg) !== configuredAt) throw new ConnectorTrustError("Connector authentication changed during identity verification",409); };
      const accounts = (await composio.connectedServices(cfg)).gmail?.accounts ?? []; current();
      const provider = await createComposioMailProvider(cfg, (_accountId,tool) => { current(); if (tool !== "GMAIL_GET_PROFILE" || !toolAllowed(botId,tool)) throw new ConnectorTrustError("Mailbox identity access is outside the agent's current grants"); });
      current();
      return Promise.all(accounts.map(async account => {
        if (!/^active$/i.test(account.status)) return {accountId: account.id,status: "inactive" as const,verifiedAt: 0};
        try {
          if (!provider.identifyAccount) throw new Error();
          const identity = await provider.identifyAccount(account.id); current();
          if (identity.accountId !== account.id || !identity.address || !toolAllowed(botId,"GMAIL_GET_PROFILE")) throw new Error();
          return connectorTrustAccountFactSchema.parse({accountId: account.id,identity: identity.address.toLowerCase(),status: "active",verifiedAt: Date.now()});
        } catch { return {accountId: account.id,status: "unavailable" as const,verifiedAt: 0}; }
      }));
    },
    async transport(inputCalls: readonly TrustBoundCall[], inputPayload: unknown): Promise<PreparedTrustTransport> {
      const calls = stableSnapshot(inputCalls); const payload = stableSnapshot(inputPayload);
      if (!calls.length || calls.length > 50) throw new ConnectorTrustError("A bounded mailbox transport needs one finite reviewed batch");
      for (const call of calls) {
        const operation = CONNECTOR_TRUST_OPERATIONS.find(operation => operation.id === call.operation && operation.effect === call.effect && (operation.tools as readonly string[]).includes(call.tool));
        if (!operation) throw new ConnectorTrustError("The transport operation differs from the reviewed registry");
      }
      const configuredAt = fingerprint(cfg);
      const current = () => { if (fingerprint(cfg) !== configuredAt) throw new ConnectorTrustError("Connector authentication changed while the action waited",409); };
      const key = cfg.composio?.apiKey?.trim();
      const userId = cfg.composio?.userId;
      if (key && userId) {
        const base = (process.env.OMB_COMPOSIO_API ?? "https://backend.composio.dev/api/v3.1").replace(/\/$/,"");
        const endpoint = new URL(base);
        if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !(endpoint.protocol === "https:" && endpoint.hostname === "backend.composio.dev" || endpoint.protocol === "http:" && ["localhost","127.0.0.1","[::1]"].includes(endpoint.hostname))) throw new ConnectorTrustError("The connector credential destination is not trusted");
        const contracts = new Map<string,{version: string;schema: Record<string,unknown>;validate: ValidateFunction}>();
        for (const call of calls) {
          if (contracts.has(call.tool)) continue;
          current();
          const response = await fetcher(`${base}/tools/${call.tool}?toolkit_versions=latest`,{headers: {"x-api-key": key},redirect: "error",signal: AbortSignal.timeout(30_000)});
          current(); if (!response.ok) throw new ConnectorTrustError("Could not verify the current account-aware Gmail tool contract",503);
          const schema = parseObject(await readConnectorResponseBounded(response,SCHEMA_LIMIT)); current();
          if (schema.slug !== call.tool || object(schema.toolkit).slug !== "gmail" || typeof schema.version !== "string" || !/^\d{8}_\d+$/.test(schema.version)) throw new ConnectorTrustError("The provider did not return a pinned Gmail tool contract",503);
          contracts.set(call.tool,{version: schema.version,...compiledInput(schema.input_parameters)});
        }
        const bound = calls.map(call => { const contract = contracts.get(call.tool)!; return {call,version: contract.version,args: validateArgs(call,contract.schema,contract.validate,false)}; });
        return {async execute(beforeEach) {
          const results: unknown[] = [], receipts: ConnectorChildReceipt[] = []; let retained = 0;
          try {
          for (const [index,item] of bound.entries()) {
            const finalCheck = await beforeEach(); current();
            const requestBody = JSON.stringify({user_id: userId,connected_account_id: item.call.accountId,version: item.version,arguments: item.args});
            const request: RequestInit = {method: "POST",headers: {"x-api-key": key,"content-type": "application/json"},body: requestBody,redirect: "error",signal: AbortSignal.timeout(30_000)};
            finalCheck(); current();
            const response = await fetcher(`${base}/tools/execute/${item.call.tool}`,request);
            if (!response.ok) throw new ConnectorTrustError("The provider did not confirm this mailbox action; review its outcome before retrying",503);
            const bytes = await readConnectorResponseBounded(response,RESULT_LIMIT - retained); retained += bytes.byteLength;
            const result = parseObject(bytes);
            if (!Object.keys(result).length || !Object.hasOwn(result,"data") && !Object.hasOwn(result,"successful") || managedError(result) || item.call.effect !== "read" && result.successful !== true) throw new ConnectorTrustError("The provider reported an unconfirmed mailbox action; review its outcome before retrying",503);
            receipts.push(childReceipt(index,item.call,bytes));
            results.push(result);
          }
          return resultBytes(payload,results);
          } catch (error) { throw new ConnectorTrustTransportError(error,receipts,bound.length); }
        }};
      }
      // Managed calls use the provider's advertised canonical selector. Meta
      // batches are never forwarded; each reviewed child is dispatched alone.
      const schemas = new Map<string,{schema: Record<string,unknown>;validate: ValidateFunction}>();
      const initializeId = trustTransportId(); current();
      const initialized = await composio.relayMcp(cfg,{jsonrpc: "2.0",id: initializeId,method: "initialize",params: {protocolVersion: "2025-03-26",capabilities: {},clientInfo: {name: "chief-bounded-mail",version: "1"}}}); current();
      if (initialized.status !== 200) throw new ConnectorTrustError("Managed connector initialization is unavailable",503);
      unpackRpc(initialized.bytes,initializeId);
      let session = initialized.transportSessionId;
      await composio.relayMcp(cfg,{jsonrpc: "2.0",method: "notifications/initialized"},session); current();
      const cursors = new Set<string>(); let cursor: string | undefined;
      for (let page = 0; page < 20; page++) {
        const id = trustTransportId();
        const response = await composio.relayMcp(cfg,{jsonrpc: "2.0",id,method: "tools/list",params: cursor ? {cursor} : {}},session); current();
        if (response.status !== 200 || response.bytes.byteLength > SCHEMA_LIMIT) throw new ConnectorTrustError("Managed connector schema discovery is unavailable or excessive",503);
        session = response.transportSessionId ?? session;
        const result = unpackRpc(response.bytes,id);
        if (!Array.isArray(result.tools) || result.tools.length > 500) throw new ConnectorTrustError("The managed connector did not advertise bounded direct tool schemas",503);
        for (const value of result.tools) { const tool = object(value); if (typeof tool.name === "string" && calls.some(call => call.tool === tool.name)) { if (schemas.has(tool.name)) throw new ConnectorTrustError("Managed connector advertised ambiguous tool schemas",503); schemas.set(tool.name,compiledInput(tool.inputSchema)); } }
        if (result.nextCursor === undefined) break;
        if (typeof result.nextCursor !== "string" || !result.nextCursor || cursors.has(result.nextCursor) || page === 19) throw new ConnectorTrustError("Managed connector schema discovery is incomplete",503);
        cursors.add(result.nextCursor); cursor = result.nextCursor;
      }
      const bound = calls.map(call => { const contract = schemas.get(call.tool); if (!contract) throw new ConnectorTrustError("The managed connector did not advertise this exact tool",503); return {call,args: validateArgs(call,contract.schema,contract.validate,true)}; });
      return {async execute(beforeEach) {
        const results: unknown[] = [], receipts: ConnectorChildReceipt[] = []; let retained = 0;
        try {
        for (const [index,item] of bound.entries()) {
          const id = trustTransportId(); let finalCheck: (() => void) | undefined;
          const response = await composio.relayMcp(cfg,{jsonrpc: "2.0",id,method: "tools/call",params: {name: item.call.tool,arguments: item.args as JsonValue}},session,
            async () => { current(); finalCheck = await beforeEach(); current(); },
            () => { current(); if (!finalCheck) throw new ConnectorTrustError("The managed transport omitted its final owner-authority check"); finalCheck(); current(); });
          if (response.status < 200 || response.status >= 300 || response.bytes.byteLength > RESULT_LIMIT - retained) throw new ConnectorTrustError("The managed connector did not confirm a bounded mailbox result; review before retrying",503);
          retained += response.bytes.byteLength;
          const result = unpackRpc(response.bytes,id);
          if (managedError(result) || item.call.effect !== "read" && !positiveWrite(result)) throw new ConnectorTrustError("The managed connector reported an unconfirmed mailbox action; review its outcome before retrying",503);
          receipts.push(childReceipt(index,item.call,response.bytes));
          results.push(result);
        }
        return resultBytes(payload,results);
        } catch (error) { throw new ConnectorTrustTransportError(error,receipts,bound.length); }
      }};
    },
  };
}
