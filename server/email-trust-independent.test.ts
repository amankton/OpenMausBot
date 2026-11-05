import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ConnectorTrustStore, evaluateConnectorTrust } from "./connector-trust.ts";
import type { ConnectorTrustAccountFact, ConnectorTrustOperation } from "../shared/connector-trust.ts";
import { CONNECTOR_TRUST_CATALOG_FINGERPRINT } from "../shared/connector-trust.ts";

const fixtures: Array<{ store: ConnectorTrustStore; dir: string }> = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) { fixture.store.close(); rmSync(fixture.dir, { recursive: true, force: true }); } });
function fixture(operations: ConnectorTrustOperation[] = ["search-mail", "read-thread", "create-draft", "send-mail"]) {
  let now = 1_000_000;
  const dir = mkdtempSync(join(tmpdir(), "chief-independent-trust-")), store = new ConnectorTrustStore(dir, () => now);
  fixtures.push({ store, dir });
  const facts: ConnectorTrustAccountFact[] = [{ accountId: "account-one", identity: "one@example.test", status: "active", verifiedAt: now }];
  const policy = store.review("reviewer", { catalogFingerprint: CONNECTOR_TRUST_CATALOG_FINGERPRINT, expectedRevision: 0, reviewed: true, grants: [{ accountId: "account-one", identity: "one@example.test", operations }] }, facts, "owner", () => true);
  return { store, facts, policy, advance: (milliseconds: number) => { now += milliseconds; }, now: () => now };
}
const call = (tool = "GMAIL_FETCH_EMAILS", args: Record<string, unknown> = { connected_account_id: "account-one", query: "after:1" }) => ({ jsonrpc: "2.0", id: "request", method: "tools/call", params: { name: tool, arguments: args } });

it("retains a revoked policy as a durable denial rather than restoring legacy access", () => {
  const f = fixture();
  const revoked = f.store.revoke("reviewer", 1, "owner"); expect(revoked).toMatchObject({ state: "revoked", revision: 2 });
  expect(() => f.store.authorizeDispatch("reviewer", "task", call(), f.facts, () => true)).toThrow(/revoked/);
  expect(f.store.get("unconfigured-reviewer")).toBeNull();
  expect(evaluateConnectorTrust(null, call(), [], () => true, f.now()).bounded).toBe(false);
});
it("checks exact agent, mailbox and provider operation scope", () => {
  const f = fixture(["search-mail"]);
  expect(f.store.authorizeDispatch("reviewer", "task", call(), f.facts, () => true).requiresApproval).toBe(false);
  expect(() => f.store.authorizeDispatch("reviewer", "task", call("GMAIL_FETCH_EMAILS", { connected_account_id: "account-two" }), f.facts, () => true)).toThrow();
  expect(() => f.store.authorizeDispatch("reviewer", "task", call("GMAIL_FETCH_MESSAGE_BY_THREAD_ID", { connected_account_id: "account-one", thread_id: "thread" }), f.facts, () => true)).toThrow(/outside/);
  expect(() => f.store.authorizeDispatch("reviewer", "task", call(), f.facts, () => false)).toThrow(/tool/);
});
it.each([
  call("GMAIL_FETCH_EMAILS", { query: "missing-account" }),
  call("GMAIL_FETCH_EMAILS", { connected_account_id: "account-one", connectedAccountId: "account-two" }),
  call("GMAIL_FETCH_EMAILS", { connected_account_id: " account-one " }),
  call("GMAIL_FETCH_EMAILS", { connected_account_id: "account-one", user_id: "two@example.test" }),
  call("GMAIL_FETCH_EMAILS", { connected_account_id: ["account-one"] }),
  call("GMAIL_FETCH_UNKNOWN", { connected_account_id: "account-one" }),
  call("COMPOSIO_REMOTE_WORKBENCH", { code: "synthetic opaque code" }),
  call("COMPOSIO_PROXY_EXECUTE", { connected_account_id: "account-one", path: "/unreviewed" }),
  call("COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [] }),
  call("COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [{ tool_slug: "GMAIL_FETCH_EMAILS", arguments: { connected_account_id: "account-one" } }, { tool_slug: "GMAIL_FETCH_EMAILS", arguments: {} }] }),
])("refuses missing, ambiguous, opaque or unreviewed calls %#", payload => {
  const f = fixture(); expect(() => f.store.authorizeDispatch("reviewer", "task", payload, f.facts, () => true)).toThrow();
});
it("intersects trust with fresh authoritative identity and live tool grants at dispatch", () => {
  const f = fixture();
  expect(() => f.store.authorizeDispatch("reviewer", "task", call(), [{ ...f.facts[0]!, identity: "changed@example.test" }], () => true)).toThrow(/outside/);
  expect(() => f.store.authorizeDispatch("reviewer", "task", call(), [{ ...f.facts[0]!, status: "inactive" }], () => true)).toThrow(/fresh/);
  expect(() => f.store.authorizeDispatch("reviewer", "task", call(), [...f.facts, ...f.facts], () => true)).toThrow(/ambiguous/);
  f.advance(60_001); expect(() => f.store.authorizeDispatch("reviewer", "task", call(), f.facts, () => true)).toThrow(/fresh/);
});
it("requires a fresh one-use approval for drafts as well as sends", () => {
  const f = fixture(), draft = call("GMAIL_CREATE_EMAIL_DRAFT", { connected_account_id: "account-one", to: "recipient@example.test", body: "Synthetic draft" });
  expect(() => f.store.authorizeDispatch("reviewer", "task", draft, f.facts, () => true)).toThrow(/fresh.*approval/);
  const approval = f.store.issueApproval("reviewer", "task", draft, 1, f.facts, () => true);
  expect(f.store.authorizeDispatch("reviewer", "task", draft, f.facts, () => true, 1, approval.id).requiresApproval).toBe(true);
  expect(() => f.store.authorizeDispatch("reviewer", "task", draft, f.facts, () => true, 1, approval.id)).toThrow(/already used|pending or outcome-unknown/);
});
it("binds risky approval to exact payload, task, policy revision and expiry", () => {
  const f = fixture(), send = call("GMAIL_SEND_EMAIL", { connected_account_id: "account-one", to: "recipient@example.test", body: "Synthetic message" });
  const approval = f.store.issueApproval("reviewer", "task", send, 1, f.facts, () => true, 1000);
  expect(() => f.store.authorizeDispatch("reviewer", "other-task", send, f.facts, () => true, 1, approval.id)).toThrow(/does not match/);
  expect(() => f.store.authorizeDispatch("reviewer", "task", call("GMAIL_SEND_EMAIL", { ...send.params.arguments, to: "changed@example.test" }), f.facts, () => true, 1, approval.id)).toThrow(/does not match/);
  f.advance(1001); expect(() => f.store.authorizeDispatch("reviewer", "task", send, f.facts, () => true, 1, approval.id)).toThrow(/does not match/);
});
it("invalidates staged risky actions when grant revisions or revocation change", () => {
  const f = fixture(), send = call("GMAIL_SEND_EMAIL", { connected_account_id: "account-one", to: "recipient@example.test", body: "Synthetic message" });
  const approval = f.store.issueApproval("reviewer", "task", send, 1, f.facts, () => true);
  f.store.revoke("reviewer", 1, "owner");
  expect(() => f.store.authorizeDispatch("reviewer", "task", send, f.facts, () => true, 1, approval.id)).toThrow(/revoked/);
  expect(() => f.store.review("reviewer", { catalogFingerprint: CONNECTOR_TRUST_CATALOG_FINGERPRINT, expectedRevision: 1, reviewed: true, grants: [] }, f.facts, "owner", () => true)).toThrow(/changed/);
});
it("checks every explicit batch child and requires one approval for mixed read/write", () => {
  const f = fixture(), batch = call("COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [{ tool_slug: "GMAIL_FETCH_EMAILS", arguments: { connected_account_id: "account-one" } }, { tool_slug: "GMAIL_CREATE_EMAIL_DRAFT", arguments: { connected_account_id: "account-one", body: "Synthetic draft" } }] });
  expect(() => f.store.authorizeDispatch("reviewer", "task", batch, f.facts, () => true)).toThrow(/fresh/);
  const approval = f.store.issueApproval("reviewer", "task", batch, 1, f.facts, () => true);
  expect(f.store.authorizeDispatch("reviewer", "task", batch, f.facts, () => true, 1, approval.id).calls).toHaveLength(2);
});
it("rejects batch-level mailbox-user overrides that conflict with the verified account", () => {
  const f = fixture(), payload = call("COMPOSIO_MULTI_EXECUTE_TOOL", { connected_account_id: "account-one", user_id: "other@example.test", tools: [{ tool_slug: "GMAIL_FETCH_EMAILS", arguments: {} }] });
  expect(() => f.store.authorizeDispatch("reviewer", "task", payload, f.facts, () => true)).toThrow();
});
it("requires the canonical provider account selector rather than an unverified alias", () => {
  const f = fixture();
  expect(() => f.store.authorizeDispatch("reviewer", "task", call("GMAIL_FETCH_EMAILS", { connectedAccountId: "account-one" }), f.facts, () => true)).toThrow();
});
it("requires each batch child to carry the selector consumed by its actual mail tool", () => {
  const f = fixture(), payload = call("COMPOSIO_MULTI_EXECUTE_TOOL", { connected_account_id: "account-one", tools: [{ tool_slug: "GMAIL_FETCH_EMAILS", arguments: {} }] });
  expect(() => f.store.authorizeDispatch("reviewer", "task", payload, f.facts, () => true)).toThrow();
});
it("rejects two connection IDs for the same normalized mailbox identity", () => {
  const f = fixture();
  expect(() => f.store.review("reviewer", { catalogFingerprint: CONNECTOR_TRUST_CATALOG_FINGERPRINT, expectedRevision: 1, reviewed: true, grants: [{ accountId: "account-one", identity: "one@example.test", operations: ["search-mail"] }, { accountId: "alias-connection", identity: "ONE@example.test", operations: ["search-mail"] }] }, [...f.facts, { accountId: "alias-connection", identity: "one@example.test", status: "active", verifiedAt: f.now() }], "owner", () => true)).toThrow();
});
it.each(["GMAIL_DELETE_MESSAGE", "GMAIL_ADD_LABEL_TO_EMAIL"])("requires a new exact owner approval for %s despite a reviewed grant", tool => {
  const f = fixture(["delete-mail", "change-labels"]);
  const payload = call(tool, { connected_account_id: "account-one", message_id: "synthetic-message" });
  expect(() => f.store.authorizeDispatch("reviewer", "task", payload, f.facts, () => true)).toThrow(/fresh.*approval/);
  const approval = f.store.issueApproval("reviewer", "task", payload, 1, f.facts, () => true);
  expect(f.store.authorizeDispatch("reviewer", "task", payload, f.facts, () => true, 1, approval.id).requiresApproval).toBe(true);
});
it("rejects a raw JSON-RPC batch that cannot carry one reviewed execution boundary", () => {
  const f = fixture(); expect(() => f.store.authorizeDispatch("reviewer", "task", [call(), call()], f.facts, () => true)).toThrow();
});
it("never replays a consumed approval after opening a new store process connection", () => {
  const dir = mkdtempSync(join(tmpdir(), "chief-independent-trust-restart-"));
  let store = new ConnectorTrustStore(dir, () => 1_000_000);
  try {
    const facts: ConnectorTrustAccountFact[] = [{ accountId: "account-one", identity: "one@example.test", status: "active", verifiedAt: 1_000_000 }];
    store.review("reviewer", { catalogFingerprint: CONNECTOR_TRUST_CATALOG_FINGERPRINT, expectedRevision: 0, reviewed: true, grants: [{ accountId: "account-one", identity: "one@example.test", operations: ["create-draft"] }] }, facts, "owner", () => true);
    const payload = call("GMAIL_CREATE_EMAIL_DRAFT", { connected_account_id: "account-one", body: "Synthetic draft" });
    const approval = store.issueApproval("reviewer", "task", payload, 1, facts, () => true);
    store.authorizeDispatch("reviewer", "task", payload, facts, () => true, 1, approval.id);
    store.close(); store = new ConnectorTrustStore(dir, () => 1_000_000);
    expect(() => store.authorizeDispatch("reviewer", "task", payload, facts, () => true, 1, approval.id)).toThrow(/already used|pending or outcome-unknown/);
    expect(() => store.issueApproval("reviewer", "task", payload, 1, facts, () => true)).toThrow(/pending or outcome-unknown/);
    expect(store.actions("reviewer")[0]?.state).toBe("outcome-unknown");
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
it("requires a new grant review for stale or unacknowledged operation catalogs", () => {
  const f = fixture();
  expect(() => f.store.review("reviewer", { expectedRevision: 1, reviewed: true, grants: [] }, f.facts, "owner", () => true)).toThrow();
  expect(() => f.store.review("reviewer", { catalogFingerprint: "0".repeat(64), expectedRevision: 1, reviewed: true, grants: [] }, f.facts, "owner", () => true)).toThrow();
  expect(() => evaluateConnectorTrust({ ...f.policy, catalogFingerprint: "0".repeat(64) }, call(), f.facts, () => true, f.now())).toThrow(/catalog|review/);
});
it("allows a new approved attempt only after authoritative evidence proves the previous action did not execute", () => {
  const f = fixture(), payload = call("GMAIL_CREATE_EMAIL_DRAFT", { connected_account_id: "account-one", body: "Synthetic draft" });
  const approval = f.store.issueApproval("reviewer", "task", payload, 1, f.facts, () => true);
  f.store.authorizeDispatch("reviewer", "task", payload, f.facts, () => true, 1, approval.id);
  expect(() => f.store.issueApproval("reviewer", "task", payload, 1, f.facts, () => true)).toThrow(/pending or outcome-unknown/);
  f.store.ackAction("reviewer", approval.id, "not-executed", "synthetic-transport-rejection-receipt");
  const next = f.store.issueApproval("reviewer", "task", payload, 1, f.facts, () => true);
  expect(next.id).not.toBe(approval.id);
  f.store.authorizeDispatch("reviewer", "task", payload, f.facts, () => true, 1, next.id);
  f.store.ackAction("reviewer", next.id, "succeeded", "synthetic-provider-result-receipt");
  expect(() => f.store.issueApproval("reviewer", "task", payload, 1, f.facts, () => true)).toThrow(/already confirmed/);
});
