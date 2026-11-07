// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHIEF_ENHANCEMENT_SKILLS, type ChiefEnhancementPreview, type ChiefSetupReceipt, type ChiefSetupTargetPlan } from "../../shared/chief-enhancement-setup";
vi.mock("@/state/store", () => ({ api: vi.fn() }));
import { api } from "@/state/store";
import { ChiefEnhancementSetupPanel } from "./ChiefEnhancementSetupPanel";
import type { ChiefEnhancementCatalog } from "@/lib/chief-enhancement-setup";

let root: Root | undefined;
let host: HTMLDivElement;
const catalog = (): ChiefEnhancementCatalog => ({
  roster: [{ id: "one", name: "First agent", roles: [] }, { id: "two", name: "Second agent", title: "Correspondence", roles: [] }],
  catalogFingerprint: "b".repeat(64), guidance: ["Select existing agents; one may fill both roles."],
  bundle: { release: "1", chiefAddendum: "Exact Chief instructions.", mailAddendum: "Exact mail instructions.", skills: CHIEF_ENHANCEMENT_SKILLS.map(name => ({ name, content: `---\nname: ${name}\n---\nFull exact ${name} procedure.`, warnings: name === "scan-mail" ? ["Review source handling."] : [] })) },
});
function preview(chief = "one", reviewer = "two"): ChiefEnhancementPreview {
  const value = catalog();
  const targets: ChiefSetupTargetPlan[] = [...new Set([chief, reviewer])].map(id => {
    const roles: ChiefSetupTargetPlan["roles"] = [...(id === chief ? ["chief" as const] : []), ...(id === reviewer ? ["mail-reviewer" as const] : [])];
    const names = roles.length === 2 ? CHIEF_ENHANCEMENT_SKILLS : id === chief ? CHIEF_ENHANCEMENT_SKILLS.slice(0, 4) : CHIEF_ENHANCEMENT_SKILLS.slice(4);
    const addenda = roles.map(role => ({ role, content: role === "chief" ? value.bundle.chiefAddendum : value.bundle.mailAddendum, sha256: "addendum-hash" }));
    return { botId: id, name: value.roster.find(bot => bot.id === id)!.name, roles, expectedSnapshotHash: `before-${id}`, before: { id, name: "Existing", roles: [], soul: `Preserved identity for ${id}.`, profileRevision: "profile-r2", skillAssignmentRevision: "skills-r3", protectedStateHash: "model-and-grants-preserved", skills: [] }, nextSoul: `Preserved identity for ${id}.\n${addenda.map(value => value.content).join("\n")}`, addenda, skills: names.map(name => ({ name, content: value.bundle.skills.find(skill => skill.name === name)!.content, sha256: `hash-${name}`, action: "install" })) };
  });
  return { ...value, selection: { chiefBotId: chief, reviewerBotId: reviewer }, release: "1", previewHash: "a".repeat(64), targets, conflicts: [], missingRoles: [], changesNeeded: true };
}
function applied(value = preview()) {
  const saved = structuredClone(value); saved.changesNeeded = false;
  for (const target of saved.targets) { target.before.soul = target.nextSoul; target.expectedSnapshotHash = `saved-${target.botId}`; target.skills.forEach(skill => { skill.action = "keep"; }); }
  const receipt: ChiefSetupReceipt = { previewHash: value.previewHash, catalogFingerprint: value.catalogFingerprint, selection: { chiefBotId: value.selection.chiefBotId!, reviewerBotId: value.selection.reviewerBotId! }, state: "applied", at: 1000, targetIds: value.targets.map(target => target.botId), readbackHashes: Object.fromEntries(saved.targets.map(target => [target.botId, target.expectedSnapshotHash])), restoredTargets: [], preservedNewerTargets: [], gaps: [] };
  return { saved, receipt };
}
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(element => element.textContent?.trim() === label)!;
const checkbox = () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
const select = (label: string) => [...host.querySelectorAll("label")].find(element => element.textContent?.startsWith(label))!.querySelector("select")!;
async function choose(label: string, value: string) { await act(async () => { const element = select(label); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("change", { bubbles: true })); }); }
async function click(label: string) { await act(async () => button(label).click()); }
async function mount() { host = document.createElement("div"); document.body.append(host); root = createRoot(host); await act(async () => root!.render(createElement(ChiefEnhancementSetupPanel))); }
async function open(value = catalog()) { vi.mocked(api).mockResolvedValueOnce(value); await click("Review agent enhancement setup"); }
async function review(value = preview()) { await open(); await choose("Chief agent", value.selection.chiefBotId!); await choose("Mail-review agent", value.selection.reviewerBotId!); vi.mocked(api).mockResolvedValueOnce({ preview: value }); await click("Preview selected agent changes"); }
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); root = undefined; vi.resetAllMocks(); vi.unstubAllGlobals(); });

describe("reviewed reusable Chief enhancement setup", () => {
  it("opens lazily, selects no agents by default and makes no mutation", async () => {
    await mount(); expect(api).not.toHaveBeenCalled();
    await open(); expect(api).toHaveBeenCalledExactlyOnceWith("/api/chief-enhancement-setup", { signal: undefined });
    expect(select("Chief agent").value).toBe(""); expect(select("Mail-review agent").value).toBe("");
    expect(button("Preview selected agent changes").disabled).toBe(true);
    expect(host.textContent).toContain("creates no agent, changes no model or grants");
  });

  it("previews exact agents, full before/after text, all eight procedures and assignment actions", async () => {
    await mount(); await review();
    expect(JSON.parse(vi.mocked(api).mock.calls[1][1]!.body as string)).toEqual({ chiefBotId: "one", reviewerBotId: "two" });
    expect(host.textContent).toContain("Preserved identity for one.");
    expect(host.textContent).toContain("Exact Chief instructions."); expect(host.textContent).toContain("Exact mail instructions.");
    for (const name of CHIEF_ENHANCEMENT_SKILLS) expect(host.textContent).toContain(`Full exact ${name} procedure.`);
    expect(host.textContent).toContain("Review source handling.");
    expect(host.textContent).toContain("profile-r2"); expect(host.textContent).toContain("skills-r3"); expect(host.textContent).toContain("install");
    expect(button("Apply reviewed enhancements").disabled).toBe(true);
    expect(document.activeElement).toBe(button("Cancel enhancement review"));
    expect(api).toHaveBeenCalledTimes(2);
  });

  it("cancels a review without applying and returns focus to preview", async () => {
    await mount(); await review(); await click("Cancel enhancement review");
    expect(host.textContent).not.toContain("Review exact enhancement changes");
    expect(select("Chief agent").value).toBe("one");
    expect(document.activeElement).toBe(button("Preview selected agent changes"));
    expect(api).toHaveBeenCalledTimes(2);
  });

  it("applies a same-agent review once with exact hashes, then separately verifies readback", async () => {
    const value = preview("one", "one"); const { saved, receipt } = applied(value);
    await mount(); await review(value); await act(async () => checkbox().click());
    vi.mocked(api).mockResolvedValueOnce({ receipt }).mockResolvedValueOnce({ preview: saved });
    await click("Apply reviewed enhancements");
    const request = vi.mocked(api).mock.calls[2];
    expect(request[0]).toBe("/api/chief-enhancement-setup/apply");
    expect(JSON.parse(request[1]!.body as string)).toEqual({ chiefBotId: "one", reviewerBotId: "one", previewHash: value.previewHash, catalogFingerprint: value.catalogFingerprint, reviewed: true });
    expect(vi.mocked(api).mock.calls[3][0]).toBe("/api/chief-enhancement-setup/preview");
    expect(host.textContent).toContain("applied and independently read back");
    expect(host.textContent).toContain("Setup receipt: applied");
    expect(api).toHaveBeenCalledTimes(4);
  });

  it("invalidates a captured review when a selected agent changes", async () => {
    await mount(); await review(); await act(async () => checkbox().click());
    await choose("Mail-review agent", "one");
    expect(host.textContent).not.toContain("Review exact enhancement changes"); expect(api).toHaveBeenCalledTimes(2);
  });

  it("shows conflict contents and blocks apply for mismatched existing skills or missing roles", async () => {
    const value = preview(); value.conflicts = ["Existing scan-mail has different content; resolve through skills."]; value.missingRoles = ["mail-reviewer"];
    value.targets[0].before.skills = [{ name: "scan-mail", content: "Current conflicting instructions.", enabled: true, assigned: true, kind: "local", source: "current-local", revision: "old-skill" }];
    value.targets[0].skills.push({ name: "scan-mail", content: "New content", action: "conflict", sha256: "proposed" });
    await mount(); await review(value);
    expect(host.textContent).toContain("Current conflicting instructions."); expect(host.textContent).toContain("Setup is blocked");
    expect(checkbox().disabled).toBe(true); expect(button("Apply reviewed enhancements").disabled).toBe(true);
    expect(api).toHaveBeenCalledTimes(2);
  });

  it("requires fresh review after a stale apply and does not replay it", async () => {
    await mount(); await review(); await act(async () => checkbox().click());
    vi.mocked(api).mockRejectedValueOnce(Object.assign(new Error("Profile revision changed; review a fresh preview"), { status: 409 }));
    await click("Apply reviewed enhancements");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("revision changed");
    expect(button("Apply reviewed enhancements").disabled).toBe(true); expect(button("Preview selected agent changes").disabled).toBe(true);
    await click("Apply reviewed enhancements"); expect(api).toHaveBeenCalledTimes(3);
    vi.mocked(api).mockResolvedValueOnce(catalog()); await click("Refresh enhancement setup");
    expect(button("Preview selected agent changes").disabled).toBe(false); expect(api).toHaveBeenCalledTimes(4);
  });

  it("holds pending apply, prevents duplicate submits and does not claim success before readback", async () => {
    await mount(); await review(); await act(async () => checkbox().click());
    let complete: (value: unknown) => void = () => {};
    vi.mocked(api).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    await click("Apply reviewed enhancements"); await click("Apply reviewed enhancements");
    expect(api).toHaveBeenCalledTimes(3); expect(button("Apply reviewed enhancements").disabled).toBe(true); expect(button("Close enhancement setup").disabled).toBe(true);
    const { receipt } = applied(); vi.mocked(api).mockRejectedValueOnce(new Error("Readback unavailable"));
    await act(async () => complete({ receipt }));
    expect(host.textContent).toContain("Readback unavailable"); expect(host.textContent).not.toContain("applied and independently read back"); expect(button("Apply reviewed enhancements").disabled).toBe(true);
  });

  it.each(["hash", "model-protection", "instructions", "still-needed"])("rejects an unconfirmed readback: %s", async change => {
    const { receipt, saved } = applied();
    if (change === "hash") saved.targets[0].expectedSnapshotHash = "unexpected";
    if (change === "model-protection") saved.targets[0].before.protectedStateHash = "changed-model";
    if (change === "instructions") { saved.targets[0].before.soul += "extra"; saved.targets[0].nextSoul = saved.targets[0].before.soul; }
    if (change === "still-needed") saved.changesNeeded = true;
    await mount(); await review(); await act(async () => checkbox().click());
    vi.mocked(api).mockResolvedValueOnce({ receipt }).mockResolvedValueOnce({ preview: saved }); await click("Apply reviewed enhancements");
    expect(host.textContent).toContain("could not be confirmed"); expect(host.textContent).not.toContain("applied and independently read back"); expect(button("Apply reviewed enhancements").disabled).toBe(true);
  });

  it("displays partial failure receipts and prevents an automatic retry", async () => {
    await mount(); await review(); await act(async () => checkbox().click());
    const { receipt } = applied(); receipt.state = "partial"; receipt.gaps = ["One skill assignment needs inspection."];
    vi.mocked(api).mockRejectedValueOnce(Object.assign(new Error("Setup failed after a partial write"), { status: 409, body: { receipt } }));
    await click("Apply reviewed enhancements"); expect(host.textContent).toContain("Setup receipt: partial"); expect(host.textContent).toContain("One skill assignment needs inspection."); expect(button("Apply reviewed enhancements").disabled).toBe(true);
  });

  it("shows an unavailable older server honestly and creates no fallback mutation", async () => {
    await mount(); vi.mocked(api).mockRejectedValueOnce(Object.assign(new Error("Not found"), { status: 404 })); await click("Review agent enhancement setup");
    expect(host.textContent).toContain("This server does not provide reviewed enhancement setup"); expect(host.querySelector("select")).toBeNull(); expect(api).toHaveBeenCalledTimes(1);
  });

  it("reports owner-session refusal and allows catalog refresh", async () => {
    await mount(); vi.mocked(api).mockRejectedValueOnce(Object.assign(new Error("Forbidden"), { status: 403 })); await click("Review agent enhancement setup");
    expect(host.textContent).toContain("authenticated desktop owner's session");
    vi.mocked(api).mockResolvedValueOnce(catalog()); await click("Refresh enhancement setup"); expect(select("Chief agent").value).toBe("");
  });

  it("recognizes already applied exact content without offering another write", async () => {
    const { saved } = applied(); await mount(); await review(saved);
    expect(host.textContent).toContain("No apply is needed"); expect(checkbox().disabled).toBe(true); expect(button("Apply reviewed enhancements").disabled).toBe(true); expect(api).toHaveBeenCalledTimes(2);
  });
});
