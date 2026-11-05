// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONNECTOR_TRUST_CATALOG_FINGERPRINT, CONNECTOR_TRUST_OPERATIONS, type ConnectorTrustOverview, type ConnectorTrustPolicy } from "../../shared/connector-trust";
vi.mock("@/state/store", () => ({ api: vi.fn() }));
import { api } from "@/state/store";
import { BoundedEmailTrust, ConnectorTrustPanel } from "./ConnectorTrustPanel";

let root: Root | undefined;
let host: HTMLDivElement;
const overview = (): ConnectorTrustOverview => ({ policy: null, catalogFingerprint: CONNECTOR_TRUST_CATALOG_FINGERPRINT, operations: CONNECTOR_TRUST_OPERATIONS, accounts: [
  { accountId: "personal-connection", identity: "person@example.test", status: "active", verifiedAt: Date.now() },
  { accountId: "work-connection", identity: "work@example.test", status: "active", verifiedAt: Date.now() },
  { accountId: "unknown-connection", status: "active", verifiedAt: 0 },
] });
const policy = (overrides: Partial<ConnectorTrustPolicy> = {}): ConnectorTrustPolicy => ({
  botId: "solo", provider: "composio", catalogFingerprint: CONNECTOR_TRUST_CATALOG_FINGERPRINT, revision: 3, state: "active", reviewedAt: Date.now(), reviewedBy: "owner",
  grants: [{ accountId: "personal-connection", identity: "person@example.test", operations: ["search-mail"], tools: ["GMAIL_FETCH_EMAILS"] }], ...overrides,
});
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(element => element.textContent?.trim() === text)!;
const box = (name: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
async function mount(snapshot: ConnectorTrustOverview = overview()) {
  vi.mocked(api).mockResolvedValue(snapshot);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(createElement(ConnectorTrustPanel, { botId: "solo", botName: "Solo" })); });
}
async function selectRead() {
  await act(async () => box("Select mailbox person@example.test").click());
  await act(async () => box("Search mail for person@example.test").click());
}
function wire(snapshot: ConnectorTrustOverview) {
  let current = structuredClone(snapshot);
  vi.mocked(api).mockImplementation(async (_path, init) => {
    if (init?.method === "PUT") {
      const body = JSON.parse(init.body as string);
      current.policy = policy({ revision: body.expectedRevision + 1, grants: body.grants.map((grant: ConnectorTrustPolicy["grants"][number]) => ({ ...grant, tools: [...new Set(grant.operations.flatMap(id => CONNECTOR_TRUST_OPERATIONS.find(operation => operation.id === id)!.tools))] })) });
      return { policy: current.policy };
    }
    if (init?.method === "POST") {
      const body = JSON.parse(init.body as string);
      current.policy = policy({ revision: body.expectedRevision + 1, state: "revoked", grants: [] });
      return { policy: current.policy };
    }
    return current;
  });
}
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); root = undefined; vi.resetAllMocks(); vi.unstubAllGlobals(); });

describe("bounded connector trust owner review", () => {
  it("distinguishes never configured and does not preselect or mutate permissions", async () => {
    await mount();
    expect(host.textContent).toContain("Not configured. Existing connector permissions are unchanged");
    expect([...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every(input => !input.checked)).toBe(true);
    expect(box("Select mailbox unknown-connection").disabled).toBe(true);
    expect(button("Review bounded access").disabled).toBe(true);
    expect(api).toHaveBeenCalledExactlyOnceWith("/api/bots/solo/connector-trust", { signal: expect.any(AbortSignal) });
  });

  it("shows exact agent, provider, account and tools before saving a reviewed grant", async () => {
    await mount(); await selectRead();
    await act(async () => button("Review bounded access").click());
    expect(api).toHaveBeenCalledTimes(1);
    const review = host.querySelector('section[aria-labelledby$="review-title"]')!;
    expect(review.textContent).toContain("Solo"); expect(review.textContent).toContain("Composio Gmail");
    expect(review.textContent).toContain("person@example.test"); expect(review.textContent).toContain("personal-connection");
    expect(review.textContent).toContain("GMAIL_FETCH_EMAILS"); expect(review.textContent).not.toContain("GMAIL_SEND_EMAIL");
    expect(document.activeElement).toBe(button("Cancel trust review"));
    wire(overview());
    await act(async () => button("Save reviewed bounded access").click());
    const write = vi.mocked(api).mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(write[0]).toBe("/api/bots/solo/connector-trust");
    expect(JSON.parse(write[1]!.body as string)).toEqual({ expectedRevision: 0, catalogFingerprint: CONNECTOR_TRUST_CATALOG_FINGERPRINT, reviewed: true, grants: [{ accountId: "personal-connection", identity: "person@example.test", operations: ["search-mail"] }] });
    expect(host.textContent).toContain("Bounded access saved and verified at revision 1");
    expect(vi.mocked(api).mock.calls.at(-1)![1]?.method).toBeUndefined();
  });

  it("keeps write and send operations marked Ask each time and includes exact tools in review", async () => {
    await mount(); await selectRead();
    await act(async () => box("Send mail, with approval each time for person@example.test").click());
    expect(host.textContent).toContain("Ask each time · effect: send");
    await act(async () => button("Review bounded access").click());
    const review = host.querySelector('section[aria-labelledby$="review-title"]')!;
    expect(review.textContent).toContain("GMAIL_SEND_EMAIL"); expect(review.textContent).toContain("GMAIL_REPLY_TO_THREAD");
    expect(review.textContent).toContain("every write, draft, send, label change or deletion still asks");
    await act(async () => button("Cancel trust review").click());
    expect(box("Send mail, with approval each time for person@example.test").checked).toBe(true);
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("blocks a grant for an identity that changed beneath an existing policy", async () => {
    const value = overview(); value.policy = policy(); value.accounts[0].identity = "changed@example.test"; await mount(value);
    expect(host.textContent).toContain("The selected policy references person@example.test");
    expect(box("Search mail for person@example.test").disabled).toBe(true);
    expect(button("Review bounded access").disabled).toBe(true);
    await act(async () => box("Select mailbox changed@example.test").click());
    await act(async () => box("Select mailbox changed@example.test").click());
    expect(box("Search mail for changed@example.test").checked).toBe(false);
  });

  it("shows the exact removed pairs when narrowing an existing policy", async () => {
    const value = overview(); value.policy = policy({ grants: [{ accountId: "personal-connection", identity: "person@example.test", operations: ["search-mail", "read-thread"], tools: ["GMAIL_FETCH_EMAILS", "GMAIL_FETCH_MESSAGE_BY_THREAD_ID"] }] }); await mount(value);
    await act(async () => box("Read complete threads for person@example.test").click());
    await act(async () => button("Review bounded access").click());
    const removed = [...host.querySelectorAll("section")].find(section => section.querySelector(":scope > h5")?.textContent === "Previously allowed pairs being removed")!;
    expect(removed.textContent).toContain("GMAIL_FETCH_MESSAGE_BY_THREAD_ID");
    expect(removed.textContent).not.toContain("GMAIL_FETCH_EMAILS");
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("requires refresh and a new review after a stale-write rejection", async () => {
    await mount(); await selectRead(); await act(async () => button("Review bounded access").click());
    vi.mocked(api).mockRejectedValueOnce(new Error("Trust policy changed; refresh its revision"));
    await act(async () => button("Save reviewed bounded access").click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Trust policy changed");
    expect(button("Review bounded access").disabled).toBe(true);
    expect(button("Save reviewed bounded access")).toBeUndefined();
    expect(vi.mocked(api).mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
    vi.mocked(api).mockResolvedValue(overview()); await act(async () => button("Refresh trust and identities").click());
    expect(box("Select mailbox person@example.test").checked).toBe(false);
  });

  it("does not report success when mutation readback disagrees with the reviewed policy", async () => {
    await mount(); await selectRead(); await act(async () => button("Review bounded access").click());
    vi.mocked(api).mockResolvedValueOnce({ policy: policy({ revision: 1 }) }).mockResolvedValueOnce({ ...overview(), policy: policy({ revision: 2 }) });
    await act(async () => button("Save reviewed bounded access").click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("saved policy changed before readback");
    expect(host.textContent).not.toContain("Bounded access saved and verified");
    expect(button("Review bounded access").disabled).toBe(true);
  });

  it("revokes while the provider is unavailable and retains the revoked state after readback", async () => {
    const value = overview(); value.accounts = []; value.policy = policy(); await mount(value);
    await act(async () => button("Review revocation").click());
    expect(host.textContent).toContain("Revoke every pair listed above for this agent");
    expect(api).toHaveBeenCalledTimes(1); wire(value);
    await act(async () => button("Revoke reviewed bounded access").click());
    const write = vi.mocked(api).mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(write[0]).toBe("/api/bots/solo/connector-trust/revoke"); expect(JSON.parse(write[1]!.body as string)).toEqual({ expectedRevision: 3 });
    expect(host.textContent).toContain("Bounded access revoked and verified at revision 4");
    expect(host.textContent).toContain("does not restore legacy access");
    expect(button("Review revocation")).toBeUndefined();
  });

  it("does not duplicate a pending owner-confirmed mutation", async () => {
    await mount(); await selectRead(); await act(async () => button("Review bounded access").click());
    let finish: (value: unknown) => void = () => {};
    vi.mocked(api).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => button("Save reviewed bounded access").click());
    expect(button("Saving and checking…").disabled).toBe(true);
    await act(async () => button("Saving and checking…").click());
    expect(vi.mocked(api).mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
    vi.mocked(api).mockResolvedValue({ ...overview(), policy: policy({ revision: 1 }) });
    await act(async () => finish({ policy: policy({ revision: 1 }) }));
    expect(host.textContent).toContain("Bounded access saved and verified");
  });

  it("reports a load failure without offering a grant", async () => {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    vi.mocked(api).mockRejectedValue(new Error("Current owner authority unavailable"));
    await act(async () => root!.render(createElement(ConnectorTrustPanel, { botId: "solo", botName: "Solo" })));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Current owner authority unavailable");
    expect(button("Review bounded access")).toBeUndefined();
    expect(button("Refresh trust and identities").disabled).toBe(false);
  });

  it("requires selecting an existing agent when no preference is saved", async () => {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root!.render(createElement(BoundedEmailTrust, { bots: [{ id: "solo", name: "Solo" }] })));
    expect(api).not.toHaveBeenCalled(); expect(host.textContent).toContain("Selecting an agent grants nothing");
  });

  it("blocks an incompatible catalog but still permits revocation", async () => {
    const value = overview(); value.policy = policy(); value.catalogFingerprint = "f".repeat(64); await mount(value);
    expect(host.textContent).toContain("This client cannot review the current tool catalog");
    expect(button("Review bounded access").disabled).toBe(true);
    expect(button("Review revocation").disabled).toBe(false);
  });

  it("requires a fresh exact review when a previous policy uses an older tool catalog", async () => {
    const value = overview(); value.policy = policy({ catalogFingerprint: "0".repeat(64) }); await mount(value);
    expect(host.textContent).toContain("new tools are not added automatically");
    expect(button("Review bounded access").disabled).toBe(false);
    await act(async () => button("Review bounded access").click());
    expect(host.querySelector('section[aria-labelledby$="review-title"]')?.textContent).toContain(CONNECTOR_TRUST_CATALOG_FINGERPRINT);
    wire(value); await act(async () => button("Save reviewed bounded access").click());
    const body = JSON.parse(vi.mocked(api).mock.calls.find(([, init]) => init?.method === "PUT")![1]!.body as string);
    expect(body.catalogFingerprint).toBe(CONNECTOR_TRUST_CATALOG_FINGERPRINT);
    expect(body.grants[0]).not.toHaveProperty("tools");
  });

  it("surfaces unknown mailbox outcomes without offering a replay", async () => {
    const value = overview(); value.actions = [{ id: "action-one", botId: "solo", threadId: "source-thread", policyRevision: 1, actionDigest: "b".repeat(64), approvedAt: Date.now(), expiresAt: Date.now() + 1000, state: "outcome-unknown", startedAt: Date.now() }]; await mount(value);
    expect(host.textContent).toContain("Mailbox actions await an outcome check");
    expect(host.textContent).toContain("outcome-unknown"); expect(host.textContent).toContain("source-thread");
    expect([...host.querySelectorAll("button")].some(element => /retry|replay/i.test(element.textContent ?? ""))).toBe(false);
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("does not show a late response from the previously selected agent", async () => {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    let oldResponse: (value: unknown) => void = () => {};
    vi.mocked(api).mockImplementation(path => path === "/api/bots/solo/connector-trust" ? new Promise(resolve => { oldResponse = resolve; }) : Promise.resolve({ ...overview(), accounts: [] }));
    await act(async () => root!.render(createElement(ConnectorTrustPanel, { botId: "solo", botName: "Solo" })));
    await act(async () => root!.render(createElement(ConnectorTrustPanel, { botId: "other", botName: "Other reviewer" })));
    await act(async () => oldResponse({ ...overview(), policy: policy() }));
    expect(host.textContent).toContain("Other reviewer");
    expect(host.textContent).not.toContain("person@example.test");
    expect(host.textContent).toContain("Not configured");
  });
});
