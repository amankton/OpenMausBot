// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EXECUTIVE_SETTINGS, type WorkItem } from "../../shared/executive-work";
vi.mock("@/state/store", () => ({ api: vi.fn() }));
vi.mock("./ConnectorTrustPanel", () => ({ BoundedEmailTrust: () => null }));
import { api } from "@/state/store";
import { ExecutiveWorkPanel } from "./ExecutiveWorkPanel";
import type { ExecutiveWorkSnapshot } from "@/lib/executive-work";

let root: Root | undefined;
let host: HTMLDivElement;
const snapshot = (): ExecutiveWorkSnapshot => ({
  settings: structuredClone(DEFAULT_EXECUTIVE_SETTINGS), items: [], runs: [],
  mailboxes: [], bots: [{ id: "triage", name: "Email Triage", threadId: "triage-thread" }, { id: "chief", name: "Bacca", threadId: "chief-thread" }],
  capabilities: { scan: false, gaps: ["No supported mail adapter is available."] },
});
const configured = (): ExecutiveWorkSnapshot => {
  const value = snapshot();
  value.settings.scansEnabled = true;
  value.settings.accounts = [{ accountScope: "connection-one", provider: "gmail", identity: "owner@example.com", label: "Personal", context: "personal", ownerBotId: "triage", coordinatorBotId: "chief", sourceThreadId: "triage-thread", enabled: true }];
  value.mailboxes = [{ accountScope: "connection-one", provider: "gmail", identity: "owner@example.com", label: "Personal", available: true, verified: false }];
  value.capabilities = { scan: true, gaps: [], backlog: 4 };
  return value;
};
const workItem = (): WorkItem => ({
  id: "item-one", revision: 4, accountScope: "connection-one", source: { kind: "mail", id: "message-one", version: "v2", botId: "triage" },
  ownerBotId: "triage", coordinatorBotId: "chief", sourceThreadId: "triage-thread", title: "Review a meeting request", desiredOutcome: "Confirm the meeting plan", nextAction: "Review available times",
  status: "ready-for-review", executionStatus: "succeeded", priority: 2, dependencies: [], createdAt: 1000, updatedAt: 2000,
  deadline: { value: "2026-11-06", timezone: "America/Los_Angeles", precision: "date", provenance: "Message asks for a reply by Friday" }, suggestedReviewAt: 4000,
});
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(element => element.textContent?.trim() === text)!;
async function mount(value: ExecutiveWorkSnapshot = snapshot(), props: Parameters<typeof ExecutiveWorkPanel>[0] = {}) {
  vi.mocked(api).mockResolvedValue(value);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(createElement(ExecutiveWorkPanel, props)); });
}
async function fill(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
const inputByLabel = (text: string) => [...host.querySelectorAll<HTMLLabelElement>("label")].find(element => element.textContent?.startsWith(text))!.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input,textarea,select")!;
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); root = undefined; vi.resetAllMocks(); });

describe("Chief work setup and queue", () => {
  it("shows missing coverage and does not offer an active scan or schedule by default", async () => {
    const open = vi.fn(); await mount(snapshot(), { onOpenRoutines: open });
    expect(host.textContent).toContain("No successful run recorded");
    expect(host.textContent).toContain("No supported mailbox connection is available");
    expect(host.textContent).toContain("No linked routines reported");
    expect(host.textContent).toContain("No supported mail adapter is available");
    expect(button("Scan mail now").disabled).toBe(true);
    expect((inputByLabel("Notify on meaningful changes") as HTMLInputElement).checked).toBe(false);
    await act(async () => button("Open routines").click()); expect(open).toHaveBeenCalledOnce();
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("reports a load failure and lets the owner retry without issuing a scan", async () => {
    let reject: (value: unknown) => void = () => {};
    vi.mocked(api).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => { root!.render(createElement(ExecutiveWorkPanel)); });
    expect(host.textContent).toContain("Loading work and settings");
    await act(async () => reject(new Error("Mailbox connection unavailable")));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Mailbox connection unavailable");
    vi.mocked(api).mockResolvedValue(snapshot());
    await act(async () => button("Refresh").click());
    expect(host.textContent).toContain("Sources and settings");
    expect(api).toHaveBeenCalledTimes(2);
  });

  it("retains unsaved setup after a conflict and sends the expected settings revision", async () => {
    const value = configured(); value.settings.revision = 7; await mount(value);
    await fill(inputByLabel("Suggested cadence"), "Weekday mornings");
    vi.mocked(api).mockRejectedValueOnce(new Error("Settings revision conflict; refresh before retrying"));
    await act(async () => button("Save settings").closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    const body = JSON.parse(vi.mocked(api).mock.calls[1][1]!.body as string);
    expect(body.expectedRevision).toBe(7); expect(body.cadenceProposal).toBe("Weekday mornings");
    expect(body.notifications.enabled).toBe(false); expect(body.accounts[0].accountScope).toBe("connection-one");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("revision conflict");
    expect(inputByLabel("Suggested cadence").value).toBe("Weekday mornings");
    expect(button("Verify and scan mail").disabled).toBe(true);
  });

  it("holds a scan pending and never submits the same click twice", async () => {
    const value = configured(); await mount(value);
    let finish: (value: unknown) => void = () => {};
    vi.mocked(api).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => button("Verify and scan mail").click());
    expect(button("Scanning…").disabled).toBe(true);
    await act(async () => button("Scanning…").click());
    const calls = vi.mocked(api).mock.calls.filter(([path]) => path === "/api/executive-work/scan");
    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0][1]!.body as string); expect(body.accountScopes).toEqual(["connection-one"]); expect(body.eventId).toEqual(expect.any(String));
    vi.mocked(api).mockResolvedValue(value);
    await act(async () => finish({}));
    expect(host.textContent).toContain("Review the run receipts for coverage and gaps");
  });

  it("blocks a saved source whose current connection identity has changed", async () => {
    const value = configured(); value.mailboxes[0].identity = "another@example.com"; await mount(value);
    expect(button("Scan mail now").disabled).toBe(true);
  });

  it("does not let an unidentified connection become a new account scope", async () => {
    const value = configured(); value.settings.accounts = []; value.mailboxes[0].identity = ""; await mount(value);
    expect((inputByLabel("Personal") as HTMLInputElement).disabled).toBe(true);
    expect(host.textContent).toContain("Mailbox identity unavailable");
    expect(button("Save settings").disabled).toBe(true);
  });

  it("saves only a discovered mailbox identity with explicitly selected agent assignments", async () => {
    const value = configured(); value.settings.accounts = []; value.settings.scansEnabled = false; await mount(value);
    await act(async () => (inputByLabel("Personal") as HTMLInputElement).click());
    await fill(host.querySelector<HTMLSelectElement>('[aria-label="Mail reviewer for owner@example.com"]')!, "triage");
    await fill(host.querySelector<HTMLSelectElement>('[aria-label="Coordinating Chief for owner@example.com"]')!, "chief");
    await fill(host.querySelector<HTMLSelectElement>('[aria-label="Context for owner@example.com"]')!, "ministry");
    await act(async () => button("Save settings").closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    const call = vi.mocked(api).mock.calls.find(([path]) => path === "/api/executive-work/settings")!;
    const body = JSON.parse(call[1]!.body as string);
    expect(body.accounts).toEqual([{ accountScope: "connection-one", provider: "gmail", identity: "owner@example.com", label: "Personal", context: "ministry", ownerBotId: "triage", coordinatorBotId: "chief", sourceThreadId: "triage-thread", enabled: true }]);
    expect(body.scansEnabled).toBe(false);
    expect(vi.mocked(api).mock.calls.some(([path]) => path === "/api/executive-work/scan")).toBe(false);
  });

  it("binds an existing routine only after saving an explicit discovery selection", async () => {
    const value = configured(); value.capabilities.routines = [{ id: "routine-one", name: "Morning review", enabled: false, cadence: "Weekdays at 08:00" }];
    await mount(value);
    expect(host.textContent).toContain("No linked routines reported");
    await fill(host.querySelector<HTMLSelectElement>('[aria-label="Discovery mode for Morning review"]')!, "check-in");
    expect(api).toHaveBeenCalledTimes(1);
    await act(async () => button("Save settings").closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    const call = vi.mocked(api).mock.calls.find(([path]) => path === "/api/executive-work/settings")!;
    const body = JSON.parse(call[1]!.body as string);
    expect(body.routineBindings).toEqual([{ routineId: "routine-one", kind: "check-in" }]);
    expect(vi.mocked(api).mock.calls.some(([path]) => path.startsWith("/api/routines"))).toBe(false);
  });

  it("saves the preferred existing reviewer while mail is disconnected", async () => {
    const value = snapshot(); value.bots.push({ id: "solo", name: "Solo", threadId: "solo-thread" }); await mount(value);
    await fill(inputByLabel("Preferred mail reviewer"), "solo");
    await act(async () => button("Save settings").closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    const call = vi.mocked(api).mock.calls.find(([path]) => path === "/api/executive-work/settings")!;
    const body = JSON.parse(call[1]!.body as string);
    expect(body.preferredMailReviewerBotId).toBe("solo"); expect(body.accounts).toEqual([]); expect(body.scansEnabled).toBe(false);
    expect(vi.mocked(api).mock.calls.some(([path]) => path === "/api/bots" || path === "/api/executive-work/scan")).toBe(false);
  });

  it("uses the saved reviewer for a new source without changing existing assignments", async () => {
    const value = configured(); value.settings.accounts = []; value.settings.preferredMailReviewerBotId = "chief"; await mount(value);
    await act(async () => (inputByLabel("Personal") as HTMLInputElement).click());
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Mail reviewer for owner@example.com"]')!.value).toBe("chief");
    await fill(inputByLabel("Preferred mail reviewer"), "triage");
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Mail reviewer for owner@example.com"]')!.value).toBe("chief");
  });

  it("can disable a disappeared source and unbind a missing routine without deleting either service record", async () => {
    const value = configured(); value.mailboxes = []; value.settings.routineBindings = [{ routineId: "missing-routine", kind: "mail-scan" }]; await mount(value);
    await act(async () => button("Disable unavailable source").click());
    await act(async () => button("Remove unavailable binding").click());
    await act(async () => button("Save settings").closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    const call = vi.mocked(api).mock.calls.find(([path]) => path === "/api/executive-work/settings")!;
    const body = JSON.parse(call[1]!.body as string);
    expect(body.accounts[0].enabled).toBe(false); expect(body.routineBindings).toEqual([]);
    expect(vi.mocked(api).mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });

  it("records evidence and source revisions for a completion without inventing a timed deadline", async () => {
    const value = configured(); value.items = [workItem()]; const open = vi.fn(); await mount(value, { onOpenTask: open });
    expect(host.textContent).toContain("2026-11-06 · America/Los_Angeles · date precision");
    expect(host.textContent).toContain("not a source deadline");
    await act(async () => button("Open source task").click()); expect(open).toHaveBeenCalledWith({ botId: "triage", threadId: "triage-thread" });
    await fill(inputByLabel("Work status"), "done");
    expect(button("Record decision").disabled).toBe(true);
    await fill(inputByLabel("Decision reason"), "Verified the final meeting brief");
    await fill(inputByLabel("Completion basis"), "evidence-verified");
    expect(button("Record decision").disabled).toBe(true);
    await fill(inputByLabel("Evidence references"), "artifact:brief-revision-2");
    await act(async () => button("Record decision").closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    const call = vi.mocked(api).mock.calls.find(([path]) => path === "/api/executive-work/items/item-one")!;
    const body = JSON.parse(call[1]!.body as string);
    expect(body.expectedRevision).toBe(4); expect(body.accountScope).toBe("connection-one");
    expect(body.patch.completion).toEqual({ kind: "evidence-verified", actor: "owner", reason: "Verified the final meeting brief", sourceVersion: "v2", evidence: ["artifact:brief-revision-2"] });
  });

  it("keeps closed items hidden until requested and requires a reason to reopen", async () => {
    const value = configured(); value.items = [{ ...workItem(), status: "dismissed" }]; await mount(value);
    expect(host.textContent).not.toContain("Review a meeting request");
    await fill(inputByLabel("Show"), "all"); await fill(inputByLabel("Work status"), "queued");
    expect(button("Record decision").disabled).toBe(true);
    await fill(inputByLabel("Reason for reopening"), "New reply changes the requested meeting");
    await act(async () => button("Record decision").closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    const call = vi.mocked(api).mock.calls.find(([path]) => path === "/api/executive-work/items/item-one")!;
    expect(JSON.parse(call[1]!.body as string).reopenReason).toBe("New reply changes the requested meeting");
  });
});
