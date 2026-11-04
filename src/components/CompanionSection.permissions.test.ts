// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CompanionBridge, CompanionState } from "./PhoneSetupFlow";

vi.mock("@/state/store", () => ({ useStore: () => ({ state: { config: {} } }) }));
// Keep the real controller, including saved-state refresh, busy and error
// handling. Pairing UI is unrelated and must not open an iframe or pair a phone.
vi.mock("./PhoneSetupFlow", async original => ({
  ...await original<typeof import("./PhoneSetupFlow")>(), PhoneSetupFlowView: () => null,
}));
import { CompanionSection } from "./CompanionSection";

let root: Root | undefined;
let host: HTMLDivElement;
let saved: CompanionState;
let bridge: CompanionBridge;
let cloudDesktop: ReturnType<typeof vi.fn<CompanionBridge["cloudDesktop"]>>;
let browserControl: ReturnType<typeof vi.fn<CompanionBridge["browserControl"]>>;
const snapshot = () => structuredClone(saved);
const checkbox = (name: string) => {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="Allow computer view for ${name}"]`);
  expect(input).not.toBeNull(); expect(input!.type).toBe("checkbox"); return input!;
};
const browser = (name: string) => {
  const button = host.querySelector<HTMLButtonElement>(`button[aria-label="Browser control access for ${name}"]`);
  expect(button).not.toBeNull(); expect(button!.getAttribute("role")).toBe("switch"); return button!;
};
async function mount() {
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(createElement(CompanionSection)); });
}
async function unmount() {
  await act(async () => { root?.unmount(); }); root = undefined; host?.remove();
}
async function click(element: HTMLElement) { await act(async () => { element.click(); }); }
function update(deviceId: string, field: "cloudDesktopAccess" | "browserControlAccess", allowed: boolean) {
  saved = { ...saved, devices: saved.devices.map(device => device.id === deviceId ? { ...device, [field]: allowed } : device) };
  return snapshot();
}

beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("Network is forbidden in this fixture"))));
  saved = { enabled: true, keepAwake: false, port: 8810, pairing: null, devices: [
    { id: "phone-ada", name: "Ada", createdAt: 1, lastSeenAt: Date.now(), cloudDesktopAccess: true },
    { id: "fixture-tablet", name: "Fixture tablet", createdAt: 2, lastSeenAt: Date.now(), cloudDesktopAccess: false, browserControlAccess: true },
  ] };
  cloudDesktop = vi.fn(async (id, allowed) => update(id, "cloudDesktopAccess", allowed));
  browserControl = vi.fn(async (id, allowed) => update(id, "browserControlAccess", allowed));
  const unused = () => vi.fn(async () => { throw new Error("Pairing/lifecycle operations are forbidden in this fixture"); });
  bridge = { state: vi.fn(async () => snapshot()), cloudDesktop, browserControl,
    start: unused(), stop: unused(), keepAwake: unused(), refreshTailscale: unused(), pairing: unused(), revoke: unused() };
  vi.stubGlobal("ogb", { companion: bridge });
});
afterEach(async () => {
  await unmount();
  for (const method of [bridge.start, bridge.stop, bridge.keepAwake, bridge.refreshTailscale, bridge.pairing, bridge.revoke]) expect(method).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = "";
});

it.each([undefined, false, true])("keeps saved computer access outside advanced settings and browser access separate (%s)", async browserAccess => {
  saved.devices[0].browserControlAccess = browserAccess;
  await mount();
  const details = host.querySelector("details")!;
  const summary = details.querySelector("summary")!;
  expect(details.open).toBe(false);
  expect(checkbox("Ada").closest("details")).toBeNull();
  expect(checkbox("Ada").checked).toBe(true); expect(checkbox("Fixture tablet").checked).toBe(false);
  expect(browser("Ada").closest("details")).toBe(details);
  expect(browser("Ada").getAttribute("aria-checked")).toBe(String(browserAccess === true));
  await click(summary); expect(details.open).toBe(true);
  expect(checkbox("Ada").checked).toBe(true);
  expect(browser("Ada").getAttribute("aria-checked")).toBe(String(browserAccess === true));
  await click(summary); expect(details.open).toBe(false);
  expect(checkbox("Ada").checked).toBe(true);
  expect(cloudDesktop).not.toHaveBeenCalled(); expect(browserControl).not.toHaveBeenCalled();
});

it("changes only the selected device and permission through real callbacks and reloads saved state", async () => {
  await mount();
  await click(checkbox("Fixture tablet"));
  expect(cloudDesktop).toHaveBeenLastCalledWith("fixture-tablet", true);
  expect(checkbox("Fixture tablet").checked).toBe(true); expect(checkbox("Ada").checked).toBe(true);
  expect(browser("Ada").getAttribute("aria-checked")).toBe("false");
  expect(browser("Fixture tablet").getAttribute("aria-checked")).toBe("true");
  await click(checkbox("Ada"));
  expect(cloudDesktop.mock.calls).toEqual([["fixture-tablet", true], ["phone-ada", false]]);
  expect(checkbox("Ada").checked).toBe(false); expect(browserControl).not.toHaveBeenCalled();
  await click(host.querySelector("details summary")!);
  await click(browser("Ada")); await click(browser("Fixture tablet"));
  expect(browserControl.mock.calls).toEqual([["phone-ada", true], ["fixture-tablet", false]]);
  expect(cloudDesktop).toHaveBeenCalledTimes(2);
  expect(checkbox("Ada").checked).toBe(false); expect(checkbox("Fixture tablet").checked).toBe(true);
  await unmount(); await mount();
  expect(host.querySelector("details")!.open).toBe(false);
  expect(checkbox("Ada").checked).toBe(false); expect(checkbox("Fixture tablet").checked).toBe(true);
  await click(host.querySelector("details summary")!);
  expect(browser("Ada").getAttribute("aria-checked")).toBe("true");
  expect(browser("Fixture tablet").getAttribute("aria-checked")).toBe("false");
  expect(bridge.state).toHaveBeenCalledTimes(2);
});

it("disables permission changes while saving and preserves saved state after rejection until explicit retry", async () => {
  let rejectSave!: (error: Error) => void;
  cloudDesktop.mockImplementationOnce(() => new Promise<CompanionState>((_resolve, reject) => { rejectSave = reject; }));
  await mount(); await click(host.querySelector("details summary")!);
  await click(checkbox("Fixture tablet"));
  expect(checkbox("Ada").disabled).toBe(true); expect(checkbox("Fixture tablet").disabled).toBe(true);
  expect(browser("Ada").disabled).toBe(true); expect(browser("Fixture tablet").disabled).toBe(true);
  expect(checkbox("Fixture tablet").checked).toBe(false);
  await click(checkbox("Ada")); await click(browser("Ada"));
  expect(cloudDesktop.mock.calls).toEqual([["fixture-tablet", true]]); expect(browserControl).not.toHaveBeenCalled();
  await act(async () => { rejectSave(new Error("Synthetic permission save failed")); });
  expect(host.textContent).toContain("Remote access could not be updated. Open Advanced & troubleshooting and try again.");
  expect(checkbox("Fixture tablet").checked).toBe(false); expect(checkbox("Ada").checked).toBe(true);
  expect(checkbox("Ada").disabled).toBe(false); expect(browser("Ada").disabled).toBe(false);
  expect(saved.devices[1].cloudDesktopAccess).toBe(false);
  await click(checkbox("Fixture tablet"));
  expect(checkbox("Fixture tablet").checked).toBe(true);
  expect(cloudDesktop.mock.calls).toEqual([["fixture-tablet", true], ["fixture-tablet", true]]);
  expect(browserControl).not.toHaveBeenCalled();
});
