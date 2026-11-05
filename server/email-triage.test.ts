import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EmailTriageService, EmailTriageStore, MailCursorExpired, type MailReadProvider } from "./email-triage.ts";
import { ExecutiveWorkStore } from "./executive-work.ts";
import type { MailboxScope, MailClassification, MailThread } from "../shared/email-triage.ts";

const roots: string[] = [];
const stores: Array<{close(): void}> = [];
afterEach(() => { for (const store of stores.splice(0)) { try { store.close(); } catch { /* already closed for restart check */ } } for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const scope = (accountId = "a"): MailboxScope => ({ accountId, address: `${accountId}@example.test`, context: "personal", ownerBotId: "chief", coordinatorBotId: "chief", sourceThreadId: "chief-task" });
const classification = (summary = "Respond to an existing request"): MailClassification => ({ category: "personal", senderIntent: "Request a reply", summary, reason: "An explicit question is unanswered", priority: 3, recommendedAction: "Review and prepare reply text", actionable: true, proposedLabels: [], replyText: "Thank you. I will review the request." });
function thread(accountId: string, id: string, version = "v1"): MailThread { return { accountId, id, version, complete: true, messages: [{ id: `${id}-${version}`, threadId: id, version, sender: "sender@example.test", recipients: [`${accountId}@example.test`], subject: "Request", text: "Please review this request", labels: [] }] }; }
function fixture(providerOverrides: Partial<MailReadProvider> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "chief-mail-test-")); roots.push(dir);
  const work = new ExecutiveWorkStore(dir); stores.push(work);
  const state = new EmailTriageStore(dir); stores.push(state);
  const provider: MailReadProvider = { capabilities: { search: true, pagination: true, fullThreads: true, incrementalHistory: false, counts: false, providerDrafts: false, mutations: false }, async verifyIdentity(s) { return { accountId: s.accountId, address: s.address }; }, async list() { return { messages: [{ id: "message", threadId: "thread", version: "v1" }] }; }, async readThread(s, id) { return thread(s.accountId, id); }, ...providerOverrides };
  return { dir, work, state, provider, service: new EmailTriageService(state, work, provider) };
}

describe("private read-only mail scanning", () => {
  it("resumes saved pages after restart and retains a separate review backlog", async () => {
    const cursors: Array<string | undefined> = [];
    const f = fixture({ async list(_s, window) { cursors.push(window.cursor); return window.cursor ? { messages: [{ id: "m2", threadId: "t2", version: "v1" }] } : { messages: [{ id: "m1", threadId: "t1", version: "v1" }], nextCursor: "page2" }; } });
    const first = await f.service.scan([scope()], { pageBudget: 1 });
    expect(first.status).toBe("partial"); expect(first.accounts[0].backlog).toBe(1);
    const fixedEnd = f.state.session("a")!.end;
    f.state.close();
    const resumed = new EmailTriageStore(f.dir); stores.push(resumed);
    const second = await new EmailTriageService(resumed, f.work, f.provider).scan([scope()]);
    expect(cursors).toEqual([undefined, "page2"]); expect(resumed.session("a")!.end).toBe(fixedEnd);
    expect(second.accounts[0].discoveryComplete).toBe(true); expect(second.accounts[0].backlog).toBe(2); expect(second.status).toBe("partial");
  });
  it("isolates identical IDs in different accounts and fairly allocates the shared review budget", async () => {
    const calls: string[] = [];
    const f = fixture({ async list() { return { messages: Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, threadId: `t${i}`, version: "v1" })) }; } });
    const receipt = await f.service.scan([scope("a"), scope("b")], { reviewBudget: 15, classifier: async (_thread, s) => { calls.push(s.accountId); return classification(); } });
    expect(calls.length).toBe(15); expect(calls.slice(0, 4)).toEqual(["a", "b", "a", "b"]);
    expect(f.work.list({ accountScope: "a" }).length).toBe(8); expect(f.work.list({ accountScope: "b" }).length).toBe(7);
    expect(receipt.accounts.map(a => a.backlog)).toEqual([4, 5]);
  });
  it("deduplicates repeated scans and source-linked queue publication", async () => {
    const f = fixture();
    await f.service.scan([scope()], { classifier: async () => classification() });
    const receipt = await f.service.scan([scope()], { classifier: async () => classification() });
    expect(f.work.list({ accountScope: "a" })).toHaveLength(1); expect(receipt.accounts[0].discovered).toBe(0); expect(receipt.status).toBe("complete");
  });
  it("records an expired cursor reconciliation without silently skipping the window", async () => {
    let calls = 0;
    const f = fixture({ async list() { calls++; if (calls === 1) throw new MailCursorExpired(); return { messages: [] }; } });
    const receipt = await f.service.scan([scope()]);
    expect(calls).toBe(2); expect(receipt.accounts[0].discoveryComplete).toBe(true); expect(receipt.accounts[0].gaps.join(" ")).toContain("Expired provider cursor");
  });
  it("reports quota/partial failure without leaking provider response content", async () => {
    const f = fixture({ async list(s) { if (s.accountId === "a") throw new Error("secret-mail-body-and-api-token"); return { messages: [] }; } });
    const receipt = await f.service.scan([scope("a"), scope("b")]);
    expect(receipt.status).toBe("partial"); expect(JSON.stringify(receipt)).not.toContain("secret-mail"); expect(receipt.accounts[1].discoveryComplete).toBe(true);
  });
  it("refuses identity mismatch before retrieving mail", async () => {
    let reads = 0;
    const f = fixture({ async verifyIdentity() { return { accountId: "a", address: "wrong@example.test" }; }, async list() { reads++; return { messages: [] }; } });
    const receipt = await f.service.scan([scope()]);
    expect(reads).toBe(0); expect(receipt.status).toBe("failed"); expect(receipt.accounts[0].identityVerified).toBe(false);
  });
  it("reconciles old unresolved threads and updates the existing canonical item", async () => {
    let latest = "v1";
    const f = fixture({ async list() { return { messages: latest === "v1" ? [{ id: "m1", threadId: "old-thread", version: "v1" }] : [] }; }, async readThread(s, id) { return thread(s.accountId, id, latest); } });
    await f.service.scan([scope()], { classifier: async () => classification() }); latest = "v2";
    const receipt = await f.service.scan([scope()], { classifier: async () => classification("New reply changes next step") });
    const items = f.work.list({ accountScope: "a" }); expect(items).toHaveLength(1); expect(items[0].source.version).toBe("v2"); expect(receipt.accounts[0].reconciledThreads).toBe(1);
  });
  it("keeps dismissed work closed when a new reply is discovered", async () => {
    let version = "v1";
    const f = fixture({ async list() { return { messages: [{ id: `m-${version}`, threadId: "t", version }] }; }, async readThread(s, id) { return thread(s.accountId, id, version); } });
    await f.service.scan([scope()], { classifier: async () => classification() });
    const item = f.work.list({ accountScope: "a" })[0];
    f.work.update("a", item.id, item.revision, { status: "dismissed" }, { eventId: "dismiss", resolutionActor: "owner", resolutionReason: "Not needed" });
    version = "v2"; await f.service.scan([scope()], { classifier: async () => classification() });
    expect(f.work.get("a", item.id)?.status).toBe("dismissed"); expect(f.work.list({ accountScope: "a" })).toHaveLength(1);
  });
  it("local reply text is never called sent and rejects stale thread or recipient revisions", async () => {
    let version = "v1";
    const f = fixture({ async readThread(s, id) { return thread(s.accountId, id, version); } });
    await f.service.scan([scope()], { classifier: async () => classification() });
    expect(await f.service.draft(scope(), "thread", "v1")).toMatchObject({ sent: false, providerDraft: false, accountId: "a" });
    version = "v2"; await expect(f.service.draft(scope(), "thread", "v1")).rejects.toThrow("stale");
    await expect(f.service.submitReview(scope(), "thread", "v1", classification())).rejects.toThrow("stale");
  });
  it("leaves incomplete context pending and fails on repeated pagination cursors", async () => {
    const f = fixture({ async list() { return { messages: [{ id: "m", threadId: "t", version: "v1" }], nextCursor: "same" }; }, async readThread(s, id) { return { ...thread(s.accountId, id), complete: false }; } });
    const receipt = await f.service.scan([scope()], { classifier: async () => classification() });
    expect(receipt.status).toBe("partial"); expect(receipt.accounts[0].backlog).toBe(1); expect(f.work.list({ accountScope: "a" })).toHaveLength(0);
    expect(receipt.accounts[0].gaps.join(" ")).toContain("repeated");
  });
  it("uses a single mailbox lease across independent store instances", () => {
    const f = fixture(); const second = new EmailTriageStore(f.dir); stores.push(second);
    f.state.lease("a", "one"); expect(() => second.lease("a", "two")).toThrow("already running");
    f.state.release("a", "one"); expect(() => second.lease("a", "two")).not.toThrow();
  });
  it("recovers pending canonical publication after a failure and process restart", async () => {
    const f = fixture(); const create = f.work.create.bind(f.work);
    f.work.create = () => { throw new Error("Synthetic unavailable queue"); };
    const partial = await f.service.scan([scope()], { classifier: async () => classification() });
    expect(partial.status).toBe("partial"); expect(f.state.reviews("a")[0].publishPending).toBe(true);
    f.state.close(); f.work.create = create;
    const resumed = new EmailTriageStore(f.dir); stores.push(resumed);
    await new EmailTriageService(resumed, f.work, f.provider).scan([scope()]);
    expect(f.work.list({accountScope: "a"})).toHaveLength(1); expect(resumed.reviews("a")[0].publishPending).toBe(false);
  });
  it("applies corrected classifications without creating another action for the same source revision", async () => {
    const f = fixture(); await f.service.scan([scope()], { classifier: async () => classification() });
    await f.service.submitReview(scope(), "thread", "v1", classification("Owner-corrected next step"));
    const items = f.work.list({accountScope: "a"}); expect(items).toHaveLength(1); expect(items[0].title).toBe("Owner-corrected next step");
  });
  it("does not advance a discovery checkpoint when account scope is revoked during a pending page", async () => {
    let finish!: (value: { messages: Array<{id: string;threadId: string;version: string}>; nextCursor: string }) => void;
    let started!: () => void;
    const pending = new Promise<void>(resolve => { started = resolve; });
    const f = fixture({ async list() { started(); return new Promise(resolve => { finish = resolve; }); } });
    let enabled = true;
    const service = new EmailTriageService(f.state, f.work, f.provider, Date.now, () => { if (!enabled) throw new Error("Mailbox scope was revoked"); });
    const scan = service.scan([scope()]); await pending;
    const before = structuredClone(f.state.session("a")); enabled = false;
    finish({ messages: [{id: "returned-after-revocation",threadId: "t",version: "v1"}], nextCursor: "new-page" });
    const receipt = await scan;
    expect(receipt.status).toBe("partial"); expect(f.state.session("a")).toEqual(before); expect(f.state.backlog("a")).toHaveLength(0); expect(f.work.list()).toHaveLength(0);
  });
  it("does not persist review or publication when scope is revoked during a pending thread read", async () => {
    const f = fixture(); await f.service.scan([scope()]);
    let finish!: (value: MailThread) => void;
    let started!: () => void;
    const pending = new Promise<void>(resolve => { started = resolve; });
    f.provider.readThread = async () => { started(); return new Promise(resolve => { finish = resolve; }); };
    let enabled = true;
    const service = new EmailTriageService(f.state, f.work, f.provider, Date.now, () => { if (!enabled) throw new Error("Mailbox scope was revoked"); });
    const review = service.submitReview(scope(), "thread", "v1", classification()); await pending;
    enabled = false; finish(thread("a", "thread"));
    await expect(review).rejects.toThrow("revoked"); expect(f.state.backlog("a")).toHaveLength(1); expect(f.state.reviews("a")[0].classification).toBeUndefined(); expect(f.work.list()).toHaveLength(0);
  });
  it("rechecks scope after model classification before committing a review", async () => {
    const f = fixture(); let enabled = true;
    const service = new EmailTriageService(f.state, f.work, f.provider, Date.now, () => { if (!enabled) throw new Error("Mailbox scope was revoked"); });
    const receipt = await service.scan([scope()], { classifier: async () => { enabled = false; return classification(); } });
    expect(receipt.status).toBe("partial"); expect(f.state.backlog("a")).toHaveLength(1); expect(f.work.list()).toHaveLength(0);
  });
  it("fences a blocked page after another service acquires and releases the expired lease", async () => {
    const f = fixture(); let now = 1000;
    const oldState = new EmailTriageStore(f.dir, () => now), newState = new EmailTriageStore(f.dir, () => now); stores.push(oldState, newState);
    let finish!: (value: {messages: Array<{id: string;threadId: string;version: string}>;nextCursor: string}) => void;
    let started!: () => void; const pending = new Promise<void>(resolve => { started = resolve; });
    const oldProvider = {...f.provider, async list() { started(); return new Promise<{messages: Array<{id: string;threadId: string;version: string}>;nextCursor: string}>(resolve => { finish = resolve; }); }};
    const oldRun = new EmailTriageService(oldState, f.work, oldProvider, () => now).scan([scope()]); await pending;
    now += 120_001;
    const newProvider = {...f.provider, async list() { return {messages: [{id: "new",threadId: "new-thread",version: "v2"}]}; }};
    await new EmailTriageService(newState, f.work, newProvider, () => now).scan([scope()]);
    const checkpoint = structuredClone(newState.session("a"));
    finish({messages: [{id: "stale",threadId: "stale-thread",version: "v1"}],nextCursor: "stale-page"});
    const receipt = await oldRun;
    expect(receipt.status).toBe("partial"); expect(newState.session("a")).toEqual(checkpoint); expect(newState.backlog("a").map(r => r.threadId)).toEqual(["new-thread"]);
  });
  it("fences a blocked thread read so an old run cannot overwrite a newer service review", async () => {
    const f = fixture(); let now = 1000;
    const oldState = new EmailTriageStore(f.dir, () => now), newState = new EmailTriageStore(f.dir, () => now); stores.push(oldState, newState);
    let finish!: (value: MailThread) => void;
    let started!: () => void; const pending = new Promise<void>(resolve => { started = resolve; });
    const oldProvider = {...f.provider, async readThread() { started(); return new Promise<MailThread>(resolve => { finish = resolve; }); }};
    const oldRun = new EmailTriageService(oldState, f.work, oldProvider, () => now).scan([scope()], {classifier: async () => classification("Stale review")}); await pending;
    now += 120_001;
    const newProvider = {...f.provider, async list() { return {messages: [{id: "message-v2",threadId: "thread",version: "v2"}]}; }, async readThread(s: MailboxScope, id: string) { return thread(s.accountId, id, "v2"); }};
    await new EmailTriageService(newState, f.work, newProvider, () => now).scan([scope()], {classifier: async () => classification("Current review")});
    finish(thread("a", "thread", "v1"));
    const receipt = await oldRun;
    const items = f.work.list({accountScope: "a"}); expect(receipt.status).toBe("partial"); expect(items).toHaveLength(1); expect(items[0].source.version).toBe("v2"); expect(items[0].title).toBe("Current review"); expect(newState.reviews("a")[0].version).toBe("v2");
  });
});
