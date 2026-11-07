import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { ExecutiveService } from "./executive-service.ts";
import type { MailReadProvider } from "./email-triage.ts";
import type { WorkItemCreate } from "../shared/executive-work.ts";

const fixtures: Array<{ service: ExecutiveService; dir: string }> = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) { fixture.service.close(); rmSync(fixture.dir, { recursive: true, force: true }); } });
const actor = (botId = "triage-one", live = true) => ({ botId, threadId: `${botId}-thread`, isLive: () => live });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "chief-executive-api-test-"));
  const provider: MailReadProvider = {
    capabilities: { search: true, pagination: true, fullThreads: true, incrementalHistory: false, counts: false, providerDrafts: false, mutations: false },
    verifyIdentity: vi.fn(async scope => ({ accountId: scope.accountId, address: scope.address })),
    list: vi.fn(async () => ({ messages: [] })),
    readThread: vi.fn(async (scope, threadId) => ({ accountId: scope.accountId, id: threadId, version: "source-one", complete: true, messages: [] })),
  };
  const bots = ["triage-one", "triage-two", "chief-one", "chief-two"].map(id => ({ id, name: id, threadId: `${id}-thread` }));
  const service = new ExecutiveService(dir, { bots: () => bots, provider: async () => provider, connections: async () => [{ id: "account-one", status: "ACTIVE" }, { id: "account-two", status: "ACTIVE" }], routines: () => [{ id: "routine-one", name: "First routine", enabled: false, target: "bot", botId: "triage-one" }, { id: "routine-two", name: "Second routine", enabled: false, target: "bot", botId: "triage-two" }], threadOwned: (botId, threadId) => threadId === `${botId}-thread` });
  fixtures.push({ service, dir });
  service.work.saveSettings(0, { scansEnabled: true, checkInEnabled: true, accounts: [{ accountScope: "account-one", provider: "gmail", identity: "one@example.test", label: "Personal", ownerBotId: "triage-one", coordinatorBotId: "chief-one", sourceThreadId: "triage-one-thread", enabled: true }, { accountScope: "account-two", provider: "gmail", identity: "two@example.test", label: "Ministry", ownerBotId: "triage-two", coordinatorBotId: "chief-two", sourceThreadId: "triage-two-thread", enabled: true }] });
  return { service, provider };
}
const itemInput = (patch: Partial<WorkItemCreate> = {}): WorkItemCreate => ({ accountScope: "local:triage-one", source: { kind: "manual", id: "task", version: "source-one", botId: "triage-one" }, ownerBotId: "triage-one", coordinatorBotId: "triage-one", sourceThreadId: "triage-one-thread", title: "Review an obligation", desiredOutcome: "Verified resolution", nextAction: "Inspect evidence", ...patch });

it("keeps actor overview within configured account assignments", async () => {
  const { service } = fixture();
  const overview = await service.request("/api/internal/executive-work", "GET", undefined, actor());
  expect(overview?.status).toBe(200);
  const serialized = JSON.stringify(overview?.body);
  expect(serialized).toContain("one@example.test");
  expect(serialized).not.toContain("two@example.test");
  expect(serialized).not.toContain("account-two");
  expect(serialized).not.toContain("routine-two");
});
it("does not allow a bot to change owner setup or select an unrelated account", async () => {
  const { service, provider } = fixture();
  const settings = await service.request("/api/internal/executive-work/settings", "PATCH", { expectedRevision: 1, scansEnabled: true }, actor());
  expect(settings?.status).toBe(403);
  const scan = await service.request("/api/internal/executive-work/scan", "POST", { accountScopes: ["account-two"], eventId: "forbidden-scan" }, actor());
  expect(scan?.status).toBe(403); expect(provider.list).not.toHaveBeenCalled();
});
it("prevents owner-confirmation laundering through create then update", async () => {
  const { service } = fixture();
  const create = await service.request("/api/internal/executive-work/items", "POST", { item: itemInput({ status: "ready-for-review", completion: { kind: "user-confirmed", actor: "owner", reason: "The bot claims owner confirmation", sourceVersion: "source-one" } }), mutation: { eventId: "forged-create" } }, actor());
  expect(create?.status).toBe(403);
  expect(service.work.list()).toHaveLength(0);
});
it("prevents an actor closing historical user-confirmed evidence without owner input", async () => {
  const { service } = fixture();
  const item = service.work.create(itemInput({ status: "ready-for-review", completion: { kind: "user-confirmed", actor: "owner", reason: "Previous review", sourceVersion: "source-one" } }), { eventId: "owner-staged" });
  const response = await service.request(`/api/internal/executive-work/items/${item.id}`, "PATCH", { accountScope: item.accountScope, expectedRevision: item.revision, patch: { status: "done" }, eventId: "forged-finish" }, actor());
  expect(response?.status).toBe(403); expect(service.work.get(item.accountScope, item.id)?.status).toBe("ready-for-review");
});
it("forces generic work authority and source notification pointer to the active task", async () => {
  const { service } = fixture();
  const response = await service.request("/api/internal/executive-work/items", "POST", { item: itemInput({ source: { kind: "manual", id: "task", version: "source-one", botId: "triage-two", taskId: "foreign-task" }, ownerBotId: "triage-two", coordinatorBotId: "chief-two", sourceThreadId: "triage-two-thread" }), mutation: { eventId: "bound-create" } }, actor());
  expect(response?.status).toBe(201);
  const saved = service.work.list()[0]!;
  expect(saved.ownerBotId).toBe("triage-one"); expect(saved.coordinatorBotId).toBe("triage-one"); expect(saved.sourceThreadId).toBe("triage-one-thread"); expect(saved.source.botId).toBe("triage-one");
  expect(saved.source.taskId).not.toBe("foreign-task");
});
it("rejects actor authority reassignment and cross-account item edits", async () => {
  const { service } = fixture();
  const item = service.work.create(itemInput(), { eventId: "item-create" });
  const reassign = await service.request(`/api/internal/executive-work/items/${item.id}`, "PATCH", { accountScope: item.accountScope, expectedRevision: 1, patch: { coordinatorBotId: "chief-two" }, eventId: "reassign" }, actor());
  expect(reassign?.status).toBe(403);
  const unrelated = await service.request(`/api/internal/executive-work/items/${item.id}`, "PATCH", { accountScope: item.accountScope, expectedRevision: 1, patch: { title: "Unrelated change" }, eventId: "cross-account" }, actor("triage-two"));
  expect(unrelated?.status).toBe(404);
});
it("rejects owner settings pointing at a task owned by another bot", async () => {
  const { service } = fixture(); const accounts = service.work.settings().accounts.map(a => ({ ...a }));
  accounts[0]!.sourceThreadId = "triage-two-thread";
  const result = await service.request("/api/executive-work/settings", "PATCH", { expectedRevision: 1, accounts });
  expect(result?.status).toBe(400); expect(service.work.settings().revision).toBe(1);
});
it("keeps an old duplicate scan idempotent beyond the recent-run display limit", async () => {
  const { service, provider } = fixture();
  service.work.recordRun({ id: "old-event:account-one", accountScope: "account-one", botId: "triage-one", threadId: "triage-one-thread", kind: "mail-scan", startedAt: 1000, finishedAt: 1100, status: "completed", gaps: [], evidence: ["old-receipt"] });
  for (let index = 0; index < 60; index++) service.work.recordRun({ id: `new-${index}`, accountScope: "account-one", botId: "triage-one", threadId: "triage-one-thread", kind: "mail-scan", startedAt: 2000 + index, finishedAt: 3000 + index, status: "completed", gaps: [], evidence: [] });
  const result = await service.request("/api/internal/executive-work/scan", "POST", { accountScopes: ["account-one"], eventId: "old-event" }, actor());
  expect(result?.status).toBe(200); expect(result?.body).toMatchObject({ duplicate: true }); expect(provider.list).not.toHaveBeenCalled();
});
it("rejects stale source revisions on owner item transitions", async () => {
  const { service } = fixture(), item = service.work.create(itemInput(), { eventId: "create" });
  service.work.update(item.accountScope, item.id, 1, { status: "queued" }, { eventId: "newer" });
  const response = await service.request(`/api/executive-work/items/${item.id}`, "PATCH", { accountScope: item.accountScope, expectedRevision: 1, patch: { title: "Stale result" }, eventId: "stale" });
  expect(response?.status).toBe(409); expect(service.work.get(item.accountScope, item.id)?.title).toBe(item.title);
});
it("does not let an actor impersonate the owner through resolution metadata", async () => {
  const { service } = fixture(), item = service.work.create(itemInput(), { eventId: "create" });
  const response = await service.request(`/api/internal/executive-work/items/${item.id}`, "PATCH", { accountScope: item.accountScope, expectedRevision: 1, patch: { status: "dismissed" }, eventId: "dismiss", resolutionActor: "owner", resolutionReason: "Out of scope" }, actor());
  expect(response?.status).toBe(200); expect(service.work.get(item.accountScope, item.id)?.resolutionActor).toBe("triage-one");
});
it("does not expose mailbox source bodies to the coordinator's discovery result", async () => {
  const { service, provider } = fixture();
  const response = await service.request("/api/internal/executive-work/scan", "POST", { accountScopes: ["account-one"], eventId: "coordinator-scan" }, actor("chief-one"));
  expect(response?.status).toBe(200); expect((response!.body as { review: unknown[] }).review).toEqual([]); expect(provider.readThread).not.toHaveBeenCalled();
});

it("does not accept unrelated historical evidence to close a newer obligation", async () => {
  const {service}=fixture();
  const item=service.work.create(itemInput({status:"ready-for-review"}),{eventId:"create-new-obligation"});
  const result=await service.request(`/api/internal/executive-work/items/${item.id}`,"PATCH",{accountScope:item.accountScope,expectedRevision:item.revision,eventId:"old-evidence",patch:{status:"done",completion:{kind:"evidence-verified",actor:"triage-one",reason:"Old result in this thread",sourceVersion:item.source.version,evidence:["unrelated-old-result"]}}},actor());
  expect(result?.status).toBe(403);
  expect(service.work.get(item.accountScope,item.id)?.status).toBe("ready-for-review");
});
it("discovers setup identities without scanning messages",async()=>{
 const {service,provider}=fixture();
 provider.identifyAccount=vi.fn(async accountId=>({accountId,address:accountId==="account-one"?"one@example.test":"two@example.test"}));
 const response=await service.request("/api/executive-work","GET",undefined);
 expect(response?.body).toMatchObject({mailboxes:[expect.objectContaining({identity:"one@example.test",verified:true}),expect.objectContaining({identity:"two@example.test",verified:true})]});
 expect(provider.list).not.toHaveBeenCalled();expect(provider.readThread).not.toHaveBeenCalled();
});
