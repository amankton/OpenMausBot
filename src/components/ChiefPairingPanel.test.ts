// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/state/store", () => ({ api: vi.fn() }));
import { api } from "@/state/store";
import { ChiefPairingPanel } from "./ChiefPairingPanel";

let root: Root;
let host: HTMLDivElement;
const status = { enabled: true, bots: [{ id: "bacca", name: "Bacca" }, { id: "game", name: "Game Designer" }, { id: "qa", name: "Game QA" }], connections: [] };
async function mount() {
  vi.mocked(api).mockResolvedValue(status);
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  await act(async () => { root.render(createElement(ChiefPairingPanel)); });
}
async function fill(selector: string, value: string) {
  const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const boxes = () => [...host.querySelectorAll<HTMLInputElement>('fieldset input[type="checkbox"]')];
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); vi.resetAllMocks(); });
describe("pairing agent search", () => {
  it("filters names and retains selected agents across searches and in the request", async () => {
    await mount();
    await fill('input[type="search"]', "  bAC  ");
    expect(boxes().map(box => box.parentElement!.textContent)).toEqual(["Bacca"]);
    await act(async () => boxes()[0].click());
    await fill('input[type="search"]', "game");
    expect(boxes()).toHaveLength(2);
    expect(host.querySelector('[aria-label="Remove Bacca from selection"]')).not.toBeNull();
    await act(async () => boxes()[0].click());
    expect(host.textContent).toContain("2 selected");
    await fill('input[type="search"]', "missing");
    expect(boxes()).toHaveLength(0);
    expect(host.textContent).toContain("No matching agents.");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Clear agent search"]')!.click());
    expect(boxes().map(box => box.checked)).toEqual([true, true, false]);
    expect(document.activeElement).toBe(host.querySelector('input[type="search"]'));
    await fill('input[type="search"]', "qa");
    await fill("textarea", '{"fixture":"invitation"}');
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(api).toHaveBeenCalledWith("/api/chief-pairing", { method: "POST", body: JSON.stringify({ invitation: { fixture: "invitation" }, bots: ["bacca", "game"] }) });
  });
  it("requires an explicit Tracker write selection in the pairing request", async () => {
    await mount(); await act(async () => boxes()[0].click());
    const grant = host.querySelector<HTMLInputElement>('form > label input[type="checkbox"]')!;
    expect(grant.checked).toBe(false); await act(async () => grant.click());
    await fill("textarea", '{"fixture":"invitation"}');
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(api).toHaveBeenCalledWith("/api/chief-pairing", { method: "POST", body: JSON.stringify({ invitation: { fixture: "invitation" }, bots: ["bacca"], trackerWrite: true }) });
  });
  it("can remove a filtered-out selection; Enter in search does not submit", async () => {
    await mount();
    await act(async () => boxes()[0].click());
    await fill('input[type="search"]', "game");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Remove Bacca from selection"]')!.click());
    expect(host.textContent).toContain("0 selected");
    const key = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    host.querySelector('input[type="search"]')!.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(true);
    expect(api).toHaveBeenCalledTimes(1);
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  });
});
