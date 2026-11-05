import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ConnectorTrustStore, evaluateConnectorTrust, connectorTrustActionDigest, ConnectorTrustError } from "./connector-trust.ts";
import { handleConnectorTrustRoute } from "./routes/connector-trust.ts";
import { CONNECTOR_TRUST_CATALOG_FINGERPRINT, type ConnectorTrustAccountFact } from "../shared/connector-trust.ts";

const dirs: string[] = [], stores: ConnectorTrustStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const dir of dirs.splice(0)) rmSync(dir, {recursive: true,force: true}); });
const facts = (at = 100_000): ConnectorTrustAccountFact[] => [{accountId: "mailbox-one",identity: "owner@example.test",status: "active",verifiedAt: at}];
const read = (accountId = "mailbox-one") => ({jsonrpc: "2.0",id: 1,method: "tools/call",params: {name: "GMAIL_FETCH_EMAILS",arguments: {connected_account_id: accountId,user_id: "me",query: "newer_than:1d"}}});
const send = (to = "recipient@example.test") => ({jsonrpc: "2.0",id: 2,method: "tools/call",params: {name: "GMAIL_SEND_EMAIL",arguments: {connected_account_id: "mailbox-one",user_id: "me",to,subject: "Review this exact message",body: "Exact approved content"}}});
function open(now: () => number = () => 100_000, directory?: string) { const dir = directory ?? mkdtempSync(join(tmpdir(), "chief-trust-test-")); if (!directory) dirs.push(dir); const store = new ConnectorTrustStore(dir,now); stores.push(store); return {store,dir}; }
const grant = (store: ConnectorTrustStore) => store.review("chief",{catalogFingerprint: CONNECTOR_TRUST_CATALOG_FINGERPRINT,expectedRevision: 0,reviewed: true,grants: [{accountId: "mailbox-one",identity: "owner@example.test",operations: ["search-mail","send-mail","create-draft","delete-mail","change-labels"]}]},facts(),"owner",() => true);

describe("reviewed connector trust", () => {
  it("preserves never-configured legacy calls and persists revoked deny tombstones", () => {
    const {store,dir} = open(); expect(evaluateConnectorTrust(store.get("chief"), null, [],() => false).bounded).toBe(false);
    const policy = grant(store); store.revoke("chief", policy.revision,"owner");
    const restarted = open(() => 100_000,dir).store;
    expect(restarted.get("chief")?.state).toBe("revoked"); expect(() => evaluateConnectorTrust(restarted.get("chief"),read(),facts(),() => true,100_000)).toThrow("revoked");
  });
  it("rejects stale policy writes across store instances and invalid blanket operations", () => {
    const {store,dir} = open(); grant(store); const second = open(() => 100_000,dir).store;
    expect(() => second.review("chief",{catalogFingerprint: CONNECTOR_TRUST_CATALOG_FINGERPRINT,expectedRevision: 0,reviewed: true,grants: []},facts(),"owner",() => true)).toThrow("changed");
    expect(() => store.review("chief",{catalogFingerprint: CONNECTOR_TRUST_CATALOG_FINGERPRINT,expectedRevision: 1,reviewed: false,grants: []},facts(),"owner",() => true)).toThrow();
    expect(() => store.review("chief",{catalogFingerprint: CONNECTOR_TRUST_CATALOG_FINGERPRINT,expectedRevision: 1,reviewed: true,grants: [{accountId: "mailbox-one",identity: "owner@example.test",operations: ["*"]}]},facts(),"owner",() => true)).toThrow();
  });
  it("requires exact account identity, fresh facts and current intersecting tool grants", () => {
    const {store} = open(); const policy = grant(store);
    expect(() => evaluateConnectorTrust(policy,read(),[{...facts()[0],identity: "other@example.test"}],() => true,100_000)).toThrow("outside");
    expect(() => evaluateConnectorTrust(policy,read(),facts(1),() => true,100_000)).toThrow("fresh");
    expect(() => evaluateConnectorTrust(policy,read(),facts(),() => false,100_000)).toThrow("current");
    expect(() => evaluateConnectorTrust(policy,read("wrong"),facts(),() => true,100_000)).toThrow("missing");
  });
  it("never converts reviewed write eligibility into fresh action approval", () => {
    const {store} = open(); const policy = grant(store);
    for (const name of ["GMAIL_CREATE_EMAIL_DRAFT","GMAIL_DELETE_MESSAGE","GMAIL_ADD_LABEL_TO_EMAIL"]) {
      const frame = {method: "tools/call",params: {name,arguments: {connected_account_id: "mailbox-one",message_id: "message"}}};
      expect(evaluateConnectorTrust(policy,frame,facts(),() => true,100_000).requiresApproval).toBe(true);
      expect(() => store.authorizeDispatch("chief","thread",frame,facts(),() => true,policy.revision)).toThrow("fresh");
    }
  });
  it("binds one-use approval to the complete payload, account, agent, thread and policy revision", () => {
    const {store,dir} = open(); const policy = grant(store); const action = send();
    const approved = store.issueApproval("chief","thread",action,policy.revision,facts(),() => true);
    expect(() => store.authorizeDispatch("chief","thread",send("changed@example.test"),facts(),() => true,policy.revision,approved.id)).toThrow("does not match");
    expect(() => store.authorizeDispatch("chief","other-thread",action,facts(),() => true,policy.revision,approved.id)).toThrow("does not match");
    expect(store.authorizeDispatch("chief","thread",action,facts(),() => true,policy.revision,approved.id).requiresApproval).toBe(true);
    const second = open(() => 100_000,dir).store;
    expect(() => second.authorizeDispatch("chief","thread",action,facts(),() => true,policy.revision,approved.id)).toThrow(/pending|unknown|already used/);
    expect(connectorTrustActionDigest(action)).not.toBe(connectorTrustActionDigest({...action,params: {...action.params,arguments: {...action.params.arguments,body: "Changed"}}}));
  });
  it("rejects expiry, changed trust revision and revoked write grants after owner approval", () => {
    let now = 100_000; const {store} = open(() => now); const policy = grant(store); const action = send();
    const approval = store.issueApproval("chief","thread",action,policy.revision,facts(now),() => true,1000);
    now += 1001; expect(() => store.authorizeDispatch("chief","thread",action,facts(now),() => true,1,approval.id)).toThrow("does not match");
    const next = store.issueApproval("chief","thread",action,policy.revision,facts(now),() => true);
    store.revoke("chief",1,"owner"); expect(() => store.authorizeDispatch("chief","thread",action,facts(now),() => true,1,next.id)).toThrow("revoked");
  });
  it("refuses opaque wrappers, implicit recipients and conflicting account binding", () => {
    const {store} = open(); const policy = grant(store);
    for (const name of ["COMPOSIO_REMOTE_WORKBENCH","COMPOSIO_REMOTE_BASH_TOOL","COMPOSIO_MANAGE_CONNECTIONS","GMAIL_SEND_DRAFT"]) {
      expect(() => evaluateConnectorTrust(policy,{method: "tools/call",params: {name,arguments: {connected_account_id: "mailbox-one"}}},facts(),() => true,100_000)).toThrow();
    }
    const action = read(); action.params.arguments = {...action.params.arguments,connectedAccountId: "other"} as typeof action.params.arguments;
    expect(() => evaluateConnectorTrust(policy,action,facts(),() => true,100_000)).toThrow("conflicting");
    expect(() => evaluateConnectorTrust(policy,{method: "tools/call",params: {name: "GMAIL_REPLY_TO_THREAD",arguments: {connected_account_id: "mailbox-one",thread_id: "t"}}},facts(),() => true,100_000)).toThrow("recipients");
  });
  it("requires canonical child account selectors instead of camelCase or batch wrapper metadata", () => {
    const {store} = open(); const policy = grant(store);
    const directAlias = {method: "tools/call",params: {name: "GMAIL_FETCH_EMAILS",arguments: {connectedAccountId: "mailbox-one"}}};
    const wrapperOnly = {method: "tools/call",params: {name: "COMPOSIO_MULTI_EXECUTE_TOOL",arguments: {connected_account_id: "mailbox-one",tools: [{tool_slug: "GMAIL_FETCH_EMAILS",arguments: {query: "x"}}]}}};
    expect(() => evaluateConnectorTrust(policy,directAlias,facts(),() => true,100_000)).toThrow("canonical");
    expect(() => evaluateConnectorTrust(policy,wrapperOnly,facts(),() => true,100_000)).toThrow("canonical");
    const correct = {...wrapperOnly,params: {...wrapperOnly.params,arguments: {...wrapperOnly.params.arguments,tools: [{tool_slug: "GMAIL_FETCH_EMAILS",arguments: {connected_account_id: "mailbox-one",query: "x"}}]}}};
    expect(evaluateConnectorTrust(policy,correct,facts(),() => true,100_000).calls).toHaveLength(1);
  });
  it("rejects a stale catalog review and persists only exact currently granted tool snapshots", () => {
    const {store} = open();
    expect(() => store.review("chief",{catalogFingerprint: "old-catalog",expectedRevision: 0,reviewed: true,grants: []},facts(),"owner",() => true)).toThrow();
    const policy = store.review("chief",{catalogFingerprint: CONNECTOR_TRUST_CATALOG_FINGERPRINT,expectedRevision: 0,reviewed: true,grants: [{accountId: "mailbox-one",identity: "owner@example.test",operations: ["read-profile"]}]},facts(),"owner",tool => tool === "GMAIL_GET_PROFILE");
    expect(policy.grants[0].tools).toEqual(["GMAIL_GET_PROFILE"]);
    expect(() => evaluateConnectorTrust({...policy,catalogFingerprint: "0".repeat(64)},read(),facts(),() => true,100_000)).toThrow("catalog changed");
    const newlyReachableTool = {method: "tools/call",params: {name: "GMAIL_WHO_AM_I",arguments: {connected_account_id: "mailbox-one"}}};
    expect(() => evaluateConnectorTrust(policy,newlyReachableTool,facts(),() => true,100_000)).toThrow("outside");
  });
  it("journals uncertain delivery across restart and blocks new approvals for the same exact action", () => {
    const {store,dir} = open(); grant(store); const action = send();
    const approval = store.issueApproval("chief","thread",action,1,facts(),() => true);
    store.authorizeDispatch("chief","thread",action,facts(),() => true,1,approval.id);
    expect(store.actions("chief")[0].state).toBe("pending");
    const reopened = open(() => 100_000,dir).store; expect(reopened.actions("chief")[0].state).toBe("outcome-unknown");
    expect(() => reopened.issueApproval("chief","thread",action,1,facts(),() => true)).toThrow("outcome-unknown");
    expect(() => reopened.authorizeDispatch("chief","thread",action,facts(),() => true,1,approval.id)).toThrow("outcome-unknown");
    reopened.ackAction("chief",approval.id,"outcome-unknown","transport-timeout-receipt");
    expect(() => reopened.issueApproval("chief","thread",action,1,facts(),() => true)).toThrow("outcome-unknown");
  });
  it("requires confirmed non-execution before a fresh retry and prevents stale acknowledgements", () => {
    const {store} = open(); grant(store); const action = send();
    const first = store.issueApproval("chief","thread",action,1,facts(),() => true);
    store.authorizeDispatch("chief","thread",action,facts(),() => true,1,first.id);
    store.ackAction("chief",first.id,"not-executed","provider-explicit-rejection-receipt");
    const retry = store.issueApproval("chief","thread",action,1,facts(),() => true);
    store.authorizeDispatch("chief","thread",action,facts(),() => true,1,retry.id);
    expect(() => store.ackAction("chief",first.id,"succeeded","stale-first-request")).toThrow("superseded");
    store.ackAction("chief",retry.id,"succeeded","verified-provider-success-receipt");
    expect(() => store.issueApproval("chief","thread",action,1,facts(),() => true)).toThrow("already confirmed");
  });
});

describe("owner trust route service", () => {
  it("returns bounded review metadata and applies only explicitly reviewed current revisions", async () => {
    const {store} = open();
    const deps = { assertAccess() {}, async accountFacts() { return facts(); },toolAllowed() { return true; },reviewerId() { return "owner"; } };
    const overview = await handleConnectorTrustRoute(store,{botId: "chief",method: "GET"},deps); expect(overview.body.policy).toBeNull();
    const result = await handleConnectorTrustRoute(store,{botId: "chief",method: "PUT",body: {catalogFingerprint: CONNECTOR_TRUST_CATALOG_FINGERPRINT,expectedRevision: 0,reviewed: true,grants: [{accountId: "mailbox-one",identity: "owner@example.test",operations: ["search-mail"]}]}},deps);
    expect(result.status).toBe(200); expect(store.get("chief")?.revision).toBe(1);
    const stale = await handleConnectorTrustRoute(store,{botId: "chief",method: "PUT",body: {catalogFingerprint: CONNECTOR_TRUST_CATALOG_FINGERPRINT,expectedRevision: 0,reviewed: true,grants: []}},deps); expect(stale.status).toBe(409);
  });
  it("rechecks owner authority after pending identity reads before saving a grant", async () => {
    const {store} = open(); let live = true;
    const result = await handleConnectorTrustRoute(store,{botId: "chief",method: "PUT",body: {catalogFingerprint: CONNECTOR_TRUST_CATALOG_FINGERPRINT,expectedRevision: 0,reviewed: true,grants: []}}, {
      assertAccess() { if (!live) throw new ConnectorTrustError("Owner session was revoked"); },
      async accountFacts() { live = false; return facts(); },toolAllowed() { return true; },reviewerId() { return "owner"; },
    });
    expect(result.status).toBe(403); expect(store.get("chief")).toBeNull();
  });
  it("can revoke while identity provider is unavailable and never echoes provider secrets", async () => {
    const {store} = open(); grant(store);
    const deps = { assertAccess() {}, async accountFacts(): Promise<ConnectorTrustAccountFact[]> { throw new Error("api_key=synthetic-secret"); },toolAllowed() { return true; },reviewerId() { return "owner"; } };
    const overview = await handleConnectorTrustRoute(store,{botId: "chief",method: "GET"},deps); expect(overview.status).toBe(200); expect(JSON.stringify(overview.body)).not.toContain("synthetic-secret");
    const revoked = await handleConnectorTrustRoute(store,{botId: "chief",method: "POST",action: "revoke",body: {expectedRevision: 1}},deps);
    expect(revoked.status).toBe(200); expect(store.get("chief")?.state).toBe("revoked");
  });
});
