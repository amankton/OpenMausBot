import { extractMailBody, mailHtmlToText } from "./body.ts";
import { readConnectorResponseBounded } from "../connector-response.ts";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { connectedServices, relayMcp, connectorBackendIdentity } from "../composio.ts";
import type { AppConfig } from "../config.ts";
import { MailCursorExpired, type MailReadProvider } from "../email-triage.ts";
import type { MailboxScope, MailCapabilities, MailMessage, MailThread } from "../../shared/email-triage.ts";

export interface MailToolSchema { name: string; inputSchema: { properties?: Record<string, unknown>; required?: string[] }; }
/** execute must bind the supplied connected account, never a session default. */
export interface MailToolTransport {
  discover(): Promise<MailToolSchema[]>;
  execute(accountId: string, name: string, args: Record<string, unknown>): Promise<unknown>;
}
export const AUDITED_MAIL_READ_TOOLS = ["GMAIL_GET_PROFILE", "GMAIL_FETCH_EMAILS", "GMAIL_FETCH_MESSAGE_BY_THREAD_ID"] as const;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown) => typeof value === "string" ? value : undefined;
const firstString = (value: Record<string, unknown>, keys: string[]) => keys.map(k => string(value[k])).find(Boolean);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const providerBackendIdentity = (cfg: AppConfig) => hash(`${connectorBackendIdentity(cfg)}:${cfg.composio?.userId ?? ""}`);

function unpack(value: unknown): Record<string, unknown> {
  let data = object(value);
  if (data.isError === true || data.successful === false || data.error) throw new Error("Connected mail read failed; check connection health");
  if (Array.isArray(data.content)) {
    const texts = data.content.filter(v => object(v).type === "text").map(v => object(v).text).filter(v => typeof v === "string");
    if (texts.length !== 1) throw new Error("Connected mail returned an unsupported response envelope");
    try { data = object(JSON.parse(texts[0] as string)); } catch { throw new Error("Connected mail returned invalid structured data"); }
  }
  if (data.successful === false || data.error) throw new Error("Connected mail read failed; check connection health");
  if (data.data && typeof data.data === "object") data = object(data.data);
  if (data.response_data && typeof data.response_data === "object") data = object(data.response_data);
  return data;
}

function schemaField(tool: MailToolSchema, candidates: string[], required = true) {
  const field = candidates.find(name => Object.hasOwn(tool.inputSchema.properties ?? {}, name));
  if (!field && required) throw new Error(`Connected mail schema lacks ${candidates[0]} for ${tool.name}`);
  return field;
}
function argsFor(tool: MailToolSchema, values: Record<string, unknown>) {
  const properties = tool.inputSchema.properties ?? {};
  const args = Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== undefined && Object.hasOwn(properties, key)));
  const missing = tool.inputSchema.required?.filter(key => args[key] === undefined && key !== "connected_account_id") ?? [];
  if (missing.length) throw new Error(`Connected mail schema has unsupported required fields for ${tool.name}`);
  return args;
}

function message(value: unknown, threadId: string): { value: MailMessage; complete: boolean } {
  const row = object(value);
  const id = firstString(row, ["id", "messageId", "message_id"]);
  const thread = firstString(row, ["threadId", "thread_id"]) ?? threadId;
  if (!id || thread !== threadId) throw new Error("Provider returned a message without the requested thread identity");
  const payload = object(row.payload);
  const headers = Array.isArray(payload.headers) ? payload.headers.map(object) : [];
  const header = (name: string) => string(headers.find(h => string(h.name)?.toLowerCase() === name)?.value) ?? "";
  const explicitBody = firstString(row, ["messageText", "message_text", "body", "text"]);
  const extractedBody = extractMailBody(payload);
  const htmlBody = firstString(row, ["htmlBody", "html_body"]);
  const text = explicitBody ?? (htmlBody !== undefined ? mailHtmlToText(htmlBody) : extractedBody.text);
  const subject = firstString(row, ["subject"]) ?? header("subject");
  const sender = firstString(row, ["sender", "from"]) ?? header("from");
  const recipientsRaw = row.to ?? row.recipients ?? header("to");
  const recipients = Array.isArray(recipientsRaw) ? recipientsRaw.filter(v => typeof v === "string") as string[] : typeof recipientsRaw === "string" ? recipientsRaw.split(",").map(s => s.trim()).filter(Boolean) : [];
  const labels = Array.isArray(row.labelIds ?? row.labels) ? (row.labelIds ?? row.labels) as string[] : [];
  const received = Number(row.internalDate ?? row.receivedAt);
  const version = firstString(row, ["historyId", "history_id", "version"]) ?? hash(`${id}:${text}:${recipients.join(",")}`);
  return { value: { id, threadId, version, sender, recipients, subject, text, labels, ...(Number.isFinite(received) ? { receivedAt: received } : {}) }, complete: explicitBody !== undefined || htmlBody !== undefined || extractedBody.available };
}

/** Supports only audited Gmail reads found in the live schema. A successful
 * connection inventory alone never advertises usable scan capabilities. */
export async function createMcpMailProvider(transport: MailToolTransport): Promise<MailReadProvider> {
  const tools = await transport.discover();
  const requireTool = (name: string) => { const tool = tools.find(t => t.name === name); if (!tool) throw new Error(`Connected mail tool unavailable: ${name}`); return tool; };
  const profile = requireTool("GMAIL_GET_PROFILE");
  const list = requireTool("GMAIL_FETCH_EMAILS");
  const thread = requireTool("GMAIL_FETCH_MESSAGE_BY_THREAD_ID");
  const queryKey = schemaField(list, ["query", "q"] )!;
  const pageKey = schemaField(list, ["page_token", "pageToken"] )!;
  const limitKey = schemaField(list, ["max_results", "maxResults"] )!;
  const threadKey = schemaField(thread, ["thread_id", "threadId"] )!;
  const capabilities: MailCapabilities = { search: true, pagination: true, fullThreads: true, incrementalHistory: false, counts: false, providerDrafts: false, mutations: false };
  const callAccount = async (accountId: string, tool: MailToolSchema, supplied: Record<string, unknown>) => {
    z.string().trim().min(1).max(200).parse(accountId);
    if (!AUDITED_MAIL_READ_TOOLS.includes(tool.name as typeof AUDITED_MAIL_READ_TOOLS[number])) throw new Error("Read-only mail adapter refused an unaudited tool");
    const args = argsFor(tool, { user_id: "me", userId: "me", ...supplied });
    const result = unpack(await transport.execute(accountId, tool.name, args));
    const responseAccount = firstString(result, ["connected_account_id", "accountId"]);
    if (responseAccount && responseAccount !== accountId) throw new Error("Mailbox response account differs from configured connection");
    return result;
  };
  const call = (scope: MailboxScope, tool: MailToolSchema, supplied: Record<string, unknown>) => callAccount(scope.accountId, tool, supplied);
  const identifyAccount = async (accountId: string) => {
    const result = await callAccount(accountId, profile, {});
    const address = firstString(result, ["emailAddress", "email_address", "email"]);
    if (!address || !z.string().email().safeParse(address).success) throw new Error("Mailbox identity was not returned by the provider");
    return { accountId, address };
  };
  return {
    capabilities,
    identifyAccount,
    async verifyIdentity(scope) {
      return identifyAccount(scope.accountId);
    },
    async list(scope, window) {
      // Date operators use epoch seconds; no unread filter excludes read mail.
      const query = `after:${Math.floor(window.start / 1000)} before:${Math.ceil(window.end / 1000)}`;
      let result: Record<string, unknown>;
      try { result = await call(scope, list, { [queryKey]: query, [pageKey]: window.cursor, [limitKey]: Math.min(25, window.limit), include_spam_trash: false }); }
      catch (error) { if (error instanceof MailCursorExpired) throw error; throw error; }
      const input = result.messages ?? result.emails;
      if (!Array.isArray(input)) throw new Error("Provider returned no structured message list; coverage is unknown");
      const nextCursor = firstString(result, ["nextPageToken", "next_page_token", "nextPage", "next_page"]);
      const messages = input.map(value => {
        const row = object(value);
        const id = firstString(row, ["id", "messageId", "message_id"]);
        const threadId = firstString(row, ["threadId", "thread_id"]);
        if (!id || !threadId) throw new Error("Provider returned a message without source IDs");
        return { id, threadId, version: firstString(row, ["historyId", "history_id", "version"]) ?? id };
      });
      if (messages.length > 200) throw new Error("Provider returned an excessive page");
      return { messages, nextCursor, truncated: result.truncated === true || result.has_more === true && !nextCursor };
    },
    async readThread(scope, threadId): Promise<MailThread> {
      const result = await call(scope, thread, { [threadKey]: threadId, format: "full" });
      const data = result.messages ?? result.emails;
      if (!Array.isArray(data) || !data.length) throw new Error("Provider returned no complete thread message array");
      const rows = data.map(value => message(value, threadId));
      const messages = rows.map(row => row.value).sort((a, b) => (a.receivedAt ?? 0) - (b.receivedAt ?? 0) || a.id.localeCompare(b.id));
      const version = hash(messages.map(m => `${m.id}:${m.version}`).join("|"));
      return { accountId: scope.accountId, id: threadId, version, complete: rows.every(r => r.complete) && result.truncated !== true && !result.nextPageToken && !result.next_page_token, messages };
    },
  };
}

function parseFrame(bytes: Uint8Array, id: string) {
  const text = new TextDecoder().decode(bytes).trim();
  const frames = text.startsWith("{") ? [JSON.parse(text)] : text.split(/\r?\n/).filter(line => line.startsWith("data:")).flatMap(line => { try { return [JSON.parse(line.slice(5).trim())]; } catch { return []; } });
  const frame = frames.map(object).findLast(f => f.id === id);
  if (!frame || frame.error) throw new Error("Connected mail discovery or read failed; verify the configured connector credential");
  return object(frame.result);
}

/** Uses the existing Composio session and transport. Explicit account binding
 * must be advertised by every read schema; a session's default is insufficient.
 * Server callers must enforce their bot's current connector scope in authorize. */
export async function createComposioMailProvider(cfg: AppConfig, authorize: (accountId: string, tool: string) => void | Promise<void>, finalAuthorize?: (accountId: string, tool: string) => void): Promise<MailReadProvider> {
  if (cfg.composio?.apiKey?.trim() && cfg.composio?.userId) {
    return createComposioDirectMailProvider(cfg, authorize, fetch, finalAuthorize);
  }
  const backend = providerBackendIdentity(cfg);
  let session: string | undefined;
  let inventory: MailToolSchema[] = [];
  const rpc = async (method: string, params: Record<string, unknown>, beforeDispatch?: () => void) => {
    const id = randomUUID();
    const response = await relayMcp(cfg, { jsonrpc: "2.0", id, method, params: params as never }, session, undefined, () => {
      if (providerBackendIdentity(cfg) !== backend) throw new Error("Connected mail authentication changed during this operation");
      beforeDispatch?.();
    });
    if (response.status !== 200) throw new Error("Connected mail transport is unavailable; verify the configured connector credential");
    session = response.transportSessionId ?? session;
    return parseFrame(response.bytes, id);
  };
  await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "chief-read-only-mail", version: "1" } });
  await relayMcp(cfg, { jsonrpc: "2.0", method: "notifications/initialized" }, session).catch(() => undefined);
  let cursor: string | undefined;
  const seen = new Set<string>();
  for (let page = 0; page < 20; page++) {
    const result = await rpc("tools/list", cursor ? { cursor } : {});
    if (!Array.isArray(result.tools)) throw new Error("Connected mail discovery returned no tool schemas");
    inventory.push(...result.tools.map(object).filter(t => AUDITED_MAIL_READ_TOOLS.includes(t.name as typeof AUDITED_MAIL_READ_TOOLS[number])).map(t => ({ name: String(t.name), inputSchema: object(t.inputSchema) })));
    cursor = string(result.nextCursor);
    if (!cursor) break;
    if (seen.has(cursor) || page === 19) throw new Error("Connected mail tool discovery is incomplete");
    seen.add(cursor);
  }
  const provider = await createMcpMailProvider({
    async discover() { return inventory; },
    async execute(accountId, name, args) {
      const tool = inventory.find(t => t.name === name);
      if (!tool || !Object.hasOwn(tool.inputSchema.properties ?? {}, "connected_account_id")) throw new Error("Connected mail tool cannot explicitly bind the requested account; use a verified account-aware adapter");
      await authorize(accountId, name);
      const service = (await connectedServices(cfg)).gmail;
      if (!service?.accounts.some(a => a.id === accountId && /^active$/i.test(a.status))) throw new Error("Mailbox connection is not currently active");
      await authorize(accountId, name);
      return rpc("tools/call", { name, arguments: { ...args, connected_account_id: accountId } }, () => finalAuthorize?.(accountId, name));
    },
  });
  // Verify account pinning before claiming scan capability availability.
  if (inventory.some(t => !Object.hasOwn(t.inputSchema.properties ?? {}, "connected_account_id"))) throw new Error("Connected mail schemas do not support explicit account binding");
  return provider;
}

/** Documented Composio direct execution pins the account independently of
 * session defaults. Tool versions and parameter schemas are discovered first.
 * References: docs.composio.dev/reference/api-reference/tools/getToolsByToolSlug
 * and docs.composio.dev/docs/auth-configuration/connected-accounts. */
export async function createComposioDirectMailProvider(
  cfg: AppConfig,
  authorize: (accountId: string, tool: string) => void | Promise<void>,
  fetcher: typeof fetch = fetch,
  finalAuthorize?: (accountId: string, tool: string) => void,
): Promise<MailReadProvider> {
  const backend = providerBackendIdentity(cfg);
  const key = cfg.composio?.apiKey?.trim();
  const userId = cfg.composio?.userId;
  if (!key || !userId) throw new Error("Connected mail needs the configured project credential and user identity");
  const base = (process.env.OMB_COMPOSIO_API ?? "https://backend.composio.dev/api/v3.1").replace(/\/$/, "");
  const endpoint = new URL(base);
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !(endpoint.protocol === "https:" && endpoint.hostname === "backend.composio.dev" || endpoint.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname))) throw new Error("Connected mail rejected an untrusted credential destination");
  const versions = new Map<string, string>();
  const request = async (path: string, body?: Record<string, unknown>, beforeDispatch?: () => void) => {
    if (providerBackendIdentity(cfg) !== backend) throw new Error("Connected mail authentication changed during this operation");
    beforeDispatch?.();
    const response = await fetcher(`${base}${path}`, { method: body ? "POST" : "GET", headers: { "x-api-key": key, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000), redirect: "error" });
    if (!response.ok) {
      if (response.status === 400 || response.status === 410) {
        const errorBody = await response.text();
        if (/page.?token|history.?id|cursor/i.test(errorBody)) throw new MailCursorExpired("Expired provider cursor");
      }
      throw new Error(response.status === 401 || response.status === 403 ? "Connected mail credential or access was rejected; verify connector setup" : `Connected mail operation failed with HTTP ${response.status}`);
    }
    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > 10_000_000) throw new Error("Connected mail response exceeded the bounded page size");
    const text = new TextDecoder().decode(await readConnectorResponseBounded(response, 10_000_000));
    try { return object(JSON.parse(text)); } catch { throw new Error("Connected mail returned invalid JSON"); }
  };
  return createMcpMailProvider({
    async discover() {
      const schemas: MailToolSchema[] = [];
      for (const name of AUDITED_MAIL_READ_TOOLS) {
        const result = await request(`/tools/${name}?toolkit_versions=latest`);
        if (result.slug !== name || object(result.toolkit).slug !== "gmail" || typeof result.version !== "string" || !/^\d{8}_\d+$/.test(result.version)) throw new Error("Connected mail tool discovery did not return a pinned Gmail schema");
        versions.set(name, result.version);
        const input = object(result.input_parameters);
        const isJsonSchema = input.type === "object" || Object.hasOwn(input, "properties");
        const properties = isJsonSchema ? object(input.properties) : input;
        const required = isJsonSchema ? (Array.isArray(input.required) ? input.required.filter(v => typeof v === "string") as string[] : []) : Object.entries(input).filter(([, field]) => object(field).required === true).map(([field]) => field);
        schemas.push({ name, inputSchema: { properties, required } });
      }
      return schemas;
    },
    async execute(accountId, name, args) {
      if (!AUDITED_MAIL_READ_TOOLS.includes(name as typeof AUDITED_MAIL_READ_TOOLS[number]) || !versions.has(name)) throw new Error("Read-only mail adapter refused an undiscovered tool");
      await authorize(accountId, name);
      // Authorization checks the live configured mailbox and per-bot grant;
      // the explicit account is never inferred from discovery ordering.
      return request(`/tools/execute/${name}`, { user_id: userId, connected_account_id: accountId, version: versions.get(name), arguments: args }, () => finalAuthorize?.(accountId, name));
    },
  });
}
