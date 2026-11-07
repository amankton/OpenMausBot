import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ExecutiveWorkStore, notificationAvailableAt } from "./executive-work.ts";
import { DEFAULT_EXECUTIVE_SETTINGS, type WorkItemCreate } from "../shared/executive-work.ts";

const dirs: string[] = [], stores: ExecutiveWorkStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const directory = () => { const dir = mkdtempSync(join(tmpdir(), "chief-work-test-")); dirs.push(dir); return dir; };
const open = (dir = directory(), now?: () => number) => { const store = new ExecutiveWorkStore(dir, now); stores.push(store); return store; };
const input = (patch: Partial<WorkItemCreate> = {}): WorkItemCreate => ({ accountScope: "account-one", source: { kind: "gmail", id: "thread-one/action-one", version: "message-one", threadId: "thread-one", botId: "chief" }, ownerBotId: "triage", coordinatorBotId: "chief", sourceThreadId: "chief-task-thread", title: "Review request", desiredOutcome: "Resolve the verified request", nextAction: "Review source evidence", ...patch });
const enableNotifications = (store: ExecutiveWorkStore) => store.saveSettings(store.settings().revision, { notifications: { enabled: true, priorityThreshold: 5, urgentBypassesQuiet: false, quietHours: null } });
let sequence = 0;
const event = () => ({ eventId: `event-${sequence++}` });

it("defaults to no scans, check-ins or notifications and validates settings revisions", () => {
  const store = open(); expect(store.settings()).toEqual(DEFAULT_EXECUTIVE_SETTINGS);
  const next = store.saveSettings(0, { analysisBudget: 17 }); expect(next.revision).toBe(1);
  expect(() => store.saveSettings(0, { scansEnabled: true })).toThrow(/changed/);
  expect(() => store.saveSettings(1, { analysisBudget: 0 })).toThrow();
  expect(() => store.saveSettings(1, { timezone: "moon" })).toThrow();
  expect(() => store.saveSettings(1, { accounts: [{ accountScope: "x", provider: "gmail", identity: "owner@example.test", label: "Personal", ownerBotId: "mail", coordinatorBotId: "chief", sourceThreadId: "thread", enabled: false }, { accountScope: "x", provider: "gmail", identity: "other@example.test", label: "Ministry", ownerBotId: "mail", coordinatorBotId: "chief", sourceThreadId: "thread", enabled: false }] })).toThrow(/Duplicate/);
});
it("persists exact time precision, state, settings and evidence after reopening", () => {
  const dir = directory(), first = open(dir);
  const work = first.create(input({ deadline: { value: "2026-11-08", precision: "date", timezone: "America/Los_Angeles", provenance: "source message" }, suggestedReviewAt: 1_793_000_000_000 }), event());
  first.saveSettings(0, { cadenceProposal: "Weekday mornings, pending owner configuration" });
  const second = open(dir); expect(second.get("account-one", work.id)).toEqual(work);
  expect(second.settings().cadenceProposal).toMatch(/pending/);
  expect(second.get("account-one", work.id)?.deadline?.value).toBe("2026-11-08");
});
it("deduplicates account-plus-source identity, not provider message ID alone", () => {
  const store = open(), a = store.create(input(), event());
  const repeat = store.create(input({ title: "Changed incoming summary" }), event());
  const b = store.create(input({ accountScope: "account-two" }), event());
  expect(repeat.id).toBe(a.id); expect(repeat.title).toBe(a.title); expect(b.id).not.toBe(a.id);
  expect(store.get("account-two", a.id)).toBeUndefined();
  expect(() => store.update("account-two", a.id, 1, { title: "leak" }, event())).toThrow(/No work/);
});
it("returns the cached result for exact event retries and rejects event/key collisions", () => {
  const store = open(), mutation = { eventId: "create-event", idempotencyKey: "source-create" };
  const work = store.create(input(), mutation);
  const next = store.update(work.accountScope, work.id, 1, { status: "queued" }, event());
  expect(next.revision).toBe(2); expect(store.create(input(), mutation)).toEqual(work);
  expect(store.create(input(), { eventId: "other-create", idempotencyKey: "source-create" })).toEqual(work);
  expect(() => store.create(input({ title: "conflicting write" }), mutation)).toThrow(/different operation/);
  expect(store.events("account-one")).toHaveLength(2);
});
it("rejects concurrent stale updates from independent database connections", () => {
  const dir = directory(), first = open(dir), second = open(dir), item = first.create(input(), event());
  first.update(item.accountScope, item.id, 1, { status: "queued" }, event());
  expect(() => second.update(item.accountScope, item.id, 1, { title: "stale" }, event())).toThrow(/changed/);
  expect(second.get(item.accountScope, item.id)?.status).toBe("queued");
});
it("does not treat tool success as reviewed completion or permit invalid transitions", () => {
  const store = open(), item = store.create(input(), event());
  expect(() => store.update(item.accountScope, item.id, 1, { status: "done", executionStatus: "succeeded" }, event())).toThrow(/transition/);
  let work = store.update(item.accountScope, item.id, 1, { status: "queued" }, event());
  work = store.update(item.accountScope, item.id, work.revision, { status: "working", executionStatus: "succeeded" }, event());
  work = store.update(item.accountScope, item.id, work.revision, { status: "ready-for-review" }, event());
  expect(() => store.update(item.accountScope, item.id, work.revision, { status: "done" }, event())).toThrow(/Completion/);
  expect(() => store.update(item.accountScope, item.id, work.revision, { status: "done", completion: { kind: "evidence-verified", actor: "chief", reason: "Verified", sourceVersion: "message-one", evidence: [] } }, event())).toThrow(/evidence/);
  expect(() => store.update(item.accountScope, item.id, work.revision, { status: "done", completion: { kind: "evidence-verified", actor: "chief", reason: "Verified", sourceVersion: "old", evidence: ["artifact#receipt"] } }, event())).toThrow(/current source/);
  work = store.update(item.accountScope, item.id, work.revision, { status: "done", completion: { kind: "evidence-verified", actor: "chief", reason: "Acceptance criteria verified", sourceVersion: "message-one", evidence: ["artifact#receipt"] } }, event());
  expect(work.status).toBe("done"); expect(work.resolutionActor).toBe("chief");
});
it("retains partial success and refuses completion while execution is unknown", () => {
  const store = open(), item = store.create(input({ status: "working", executionStatus: "partially-completed" }), event());
  const ready = store.update(item.accountScope, item.id, 1, { status: "ready-for-review", executionStatus: "outcome-unknown" }, event());
  expect(() => store.update(item.accountScope, item.id, ready.revision, { status: "done", completion: { kind: "user-confirmed", actor: "owner", reason: "Reviewed", sourceVersion: "message-one" } }, event())).toThrow(/unknown/);
  expect(store.get(item.accountScope, item.id)?.executionStatus).toBe("outcome-unknown");
});
it("keeps dismissed items closed on new evidence and requires justified reopening", () => {
  const store = open(), item = store.create(input(), event());
  let work = store.update(item.accountScope, item.id, 1, { status: "dismissed" }, { ...event(), resolutionActor: "owner", resolutionReason: "No action wanted" });
  work = store.update(item.accountScope, item.id, work.revision, { source: { ...work.source, version: "message-two" } }, event());
  expect(work.status).toBe("dismissed");
  expect(() => store.update(item.accountScope, item.id, work.revision, { status: "queued" }, { ...event(), reopenReason: "I want to retry" })).toThrow(/new source/);
  work = store.update(item.accountScope, item.id, work.revision, { status: "queued", source: { ...work.source, version: "message-three" } }, { ...event(), reopenReason: "A new reply contains a new obligation" });
  expect(work.status).toBe("queued"); expect(work.resolutionReason).toBeUndefined();
});
it("retains the original completion evidence when observing a later reply on done work", () => {
  const store = open(), item = store.create(input({ status: "ready-for-review" }), event());
  let work = store.update(item.accountScope, item.id, 1, { status: "done", completion: { kind: "user-confirmed", actor: "owner", reason: "Resolved", sourceVersion: "message-one" } }, event());
  work = store.update(item.accountScope, item.id, work.revision, { source: { ...work.source, version: "message-two" } }, event());
  expect(work.status).toBe("done"); expect(work.completion?.sourceVersion).toBe("message-one");
});
it("serializes single-run leases, expires them and rejects stale release tokens", () => {
  const dir = directory(); let now = 1000; const first = open(dir, () => now), second = open(dir, () => now);
  const lease = first.acquireLease("mail:account-one", "run-one", 1000);
  expect(() => second.acquireLease("mail:account-one", "run-two", 1000)).toThrow(/owns/);
  expect(second.releaseLease("mail:account-one", "wrong-token")).toBe(false);
  now += 1001; const next = second.acquireLease("mail:account-one", "run-two", 1000);
  expect(first.releaseLease("mail:account-one", lease.token)).toBe(false);
  expect(second.releaseLease("mail:account-one", next.token)).toBe(true);
});
it("records disabled-notification receipts and never creates an all-clear from no change", () => {
  const store = open(), item = store.create(input(), event());
  expect(store.pendingNotifications()).toEqual([]); expect(store.notifications()[0]?.reason).toBe("notifications-disabled");
  enableNotifications(store);
  store.update(item.accountScope, item.id, 1, { source: { ...item.source, version: "message-two" } }, event());
  expect(store.notifications()).toHaveLength(1); expect(store.pendingNotifications()).toEqual([]);
});
it("retains nonactionable progress receipts without enqueuing owner alerts", () => {
  const store = open(); enableNotifications(store);
  for (const status of ["queued", "working", "waiting-on-other"] as const) {
    store.create(input({ status, source: { kind: "coordination", id: status, version: "request" } }), event());
  }
  expect(store.pendingNotifications()).toEqual([]);
  expect(store.notifications()).toHaveLength(3);
  expect(store.notifications().every(notice => notice.state === "suppressed" && notice.reason === "no-owner-action")).toBe(true);
  const work = store.list().find(row => row.status === "working")!;
  const reviewed = store.update(work.accountScope, work.id, work.revision, { status: "ready-for-review" }, event());
  expect(store.pendingNotifications()).toHaveLength(1); expect(store.pendingNotifications()[0]?.revision).toBe(reviewed.revision);
});
it("deduplicates notifications, routes to originating thread and does not replay uncertain delivery", () => {
  const store = open(); enableNotifications(store);
  const mutation = event(), item = store.create(input(), mutation); store.create(input(), mutation);
  expect(store.pendingNotifications()).toHaveLength(1);
  const notification = store.pendingNotifications()[0]!;
  expect(notification.botId).toBe("chief"); expect(notification.threadId).toBe("chief-task-thread");
  expect(store.claimNotification(notification.id, "dispatcher")).toBeDefined();
  expect(store.claimNotification(notification.id, "other")).toBeUndefined();
  expect(() => store.ackNotification(notification.id, "other", "delivered")).toThrow(/claim/);
  store.ackNotification(notification.id, "dispatcher", "outcome-unknown");
  expect(store.pendingNotifications()).toEqual([]); expect(store.get(item.accountScope, item.id)?.lastSurfacedAt).toBeUndefined();
});
it("suppresses superseded pending alerts and marks delivered revision exactly", () => {
  const store = open(); enableNotifications(store);
  const item = store.create(input(), event()), old = store.pendingNotifications()[0]!;
  const next = store.update(item.accountScope, item.id, 1, { status: "waiting-on-human" }, event());
  expect(store.claimNotification(old.id, "dispatcher")).toBeUndefined();
  const notice = store.pendingNotifications().find(row => row.revision === next.revision)!;
  store.claimNotification(notice.id, "dispatcher"); store.ackNotification(notice.id, "dispatcher", "delivered");
  expect(store.get(item.accountScope, item.id)?.lastSurfacedRevision).toBe(next.revision);
});
it("defaults source routing to the owner when the source has no explicit bot", () => {
  const store = open(); enableNotifications(store);
  const item = store.create(input({ source: { kind: "gmail", id: "source", version: "v1" }, sourceThreadId: "triage-thread" }), event());
  const notice = store.pendingNotifications()[0]!;
  expect(notice.botId).toBe("triage"); expect(notice.threadId).toBe("triage-thread");
  store.enqueueCallback(item.accountScope, "callback", item.id, 1, "receipt");
  expect(store.pendingCallbacks()[0]).toMatchObject({ botId: "triage", threadId: "triage-thread" });
});
it("defers quiet-hour notifications with timezone and explicit urgency rules", () => {
  const at = Date.parse("2026-11-05T07:30:00Z"), settings = structuredClone(DEFAULT_EXECUTIVE_SETTINGS);
  settings.notifications.quietHours = { start: "22:00", end: "07:00" };
  expect(notificationAvailableAt(at, settings, 1)).toBe(Date.parse("2026-11-05T15:00:00Z"));
  settings.notifications.urgentBypassesQuiet = true; expect(notificationAvailableAt(at, settings, 1)).toBe(at);
  expect(notificationAvailableAt(at, settings, 3)).toBe(Date.parse("2026-11-05T15:00:00Z"));
  settings.notifications.quietHours = { start: "00:00", end: "00:00" }; expect(notificationAvailableAt(at, settings, 3)).toBe(Number.MAX_SAFE_INTEGER);
});
it("records durable failure runs without overwriting historical timestamps", () => {
  const dir = directory(), first = open(dir);
  first.recordRun({ id: "run", accountScope: "account-one", botId: "triage", threadId: "source", kind: "mail-scan", status: "working", startedAt: 1000, gaps: [], evidence: [] });
  first.recordRun({ id: "run", accountScope: "account-one", botId: "triage", threadId: "source", kind: "mail-scan", status: "partial", startedAt: 1000, finishedAt: 1200, gaps: ["Pagination quota"], evidence: ["coverage#receipt"] });
  const second = open(dir); expect(second.getRuns("account-one")[0]?.status).toBe("partial");
  expect(() => second.recordRun({ ...second.getRuns("account-one")[0]!, startedAt: 1400 })).toThrow(/identity/);
});
it("prunes expired run detail while retaining event identity tombstones", () => {
  let now = 1_000_000; const store = open(directory(), () => now);
  store.recordRun({ id: "retained-event", accountScope: "account-one", botId: "triage", threadId: "source", kind: "mail-scan", startedAt: now, finishedAt: now + 100, status: "completed", gaps: [], evidence: ["expired-detail"] });
  now += 91 * 86_400_000;
  expect(store.pruneRunDetails()).toBe(1); expect(store.pruneRunDetails()).toBe(0);
  expect(store.getRun("account-one", "retained-event")).toMatchObject({ id: "retained-event", status: "completed", evidence: [], detailsPrunedAt: now });
});
it("queues one revision-specific review callback, rejects stale callbacks and never closes work", () => {
  const store = open(), item = store.create(input({ status: "working" }), event());
  expect(store.enqueueCallback(item.accountScope, "completion-one", item.id, 1, "delegation#receipt")).toBe(true);
  expect(store.enqueueCallback(item.accountScope, "completion-one", item.id, 1, "delegation#receipt")).toBe(false);
  expect(store.pendingCallbacks()).toHaveLength(1);
  expect(store.claimCallback(item.accountScope, "completion-one")).toBe(true);
  expect(store.claimCallback(item.accountScope, "completion-one")).toBe(false);
  store.ackCallback(item.accountScope, "completion-one", "delivered"); expect(store.get(item.accountScope, item.id)?.status).toBe("working");
  store.update(item.accountScope, item.id, 1, { nextAction: "Changed assignment" }, event());
  expect(store.enqueueCallback(item.accountScope, "completion-stale", item.id, 1, "old#receipt")).toBe(false);
});
it("recovers unacknowledged dispatches as unknown without automatic replay", () => {
  const dir = directory(), first = open(dir); enableNotifications(first);
  const item = first.create(input(), event());
  first.claimNotification(first.pendingNotifications()[0]!.id, "old-runtime");
  first.enqueueCallback(item.accountScope, "pending-result", item.id, 1, "receipt"); first.claimCallback(item.accountScope, "pending-result");
  const second = open(dir); expect(second.recoverUnacknowledgedDispatches()).toEqual({ notifications: 1, callbacks: 1 });
  expect(second.pendingCallbacks()).toEqual([]); expect(second.pendingNotifications()).toEqual([]);
  expect(second.notifications()[0]?.state).toBe("outcome-unknown");
  expect(second.recoverUnacknowledgedDispatches()).toEqual({ notifications: 0, callbacks: 0 });
});
it("validates input metadata and rejects mail body fields from the generic queue", () => {
  const store = open(); expect(() => store.create({ ...input(), body: "confidential mailbox body" } as WorkItemCreate, event())).toThrow();
  expect(() => store.create(input({ title: "multiline\nsubject" }), event())).toThrow();
  expect(() => store.create(input({ deadline: { value: "some time tomorrow", timezone: "UTC", precision: "date", provenance: "ambiguous mail" } }), event())).toThrow();
  const item = store.create(input({ deadline: { value: "tomorrow, time unknown", timezone: "UTC", precision: "uncertain", provenance: "ambiguous mail" } }), event());
  expect(item.deadline?.precision).toBe("uncertain");
});
