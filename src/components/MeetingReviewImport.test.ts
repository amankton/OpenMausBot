// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MeetingReviewImport } from "./MeetingReviewImport";

const fixture = () => ({ format: "chief.meeting-review", version: 1, exportedAt: "2026-10-07T10:00:00.000Z",
  source: { workspace: "synthetic-workspace", meetingId: "synthetic-meeting", sessionId: "synthetic-session", revision: 1, title: "Planning", requestedAt: 1000 },
  review: { confirmed: true, reviewerPersonId: "synthetic-member", reviewedAt: "2026-10-07T10:00:00.000Z" },
  items: [{ id: "i1", kind: "action", text: "Review proposal", source: { segmentId: "s1", personId: "p1", speaker: "Synthetic member", startMs: 0, endMs: 1000, text: '<img src=x onerror="bad()"> Unicode 🌱' } }],
  transcript: [{ id: "s1", personId: "p1", speaker: "Synthetic member", startMs: 0, endMs: 1000, text: '<img src=x onerror="bad()"> Unicode 🌱' }],
});
let root: Root;
let container: HTMLDivElement;
let append: ReturnType<typeof vi.fn<(text: string) => void>>;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("Import must not send network requests"); }));
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container); append = vi.fn();
  await act(async () => root.render(createElement(MeetingReviewImport, { targetName: "My agent", disabled: false, onAppendDraft: append })));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });
async function upload(contents = JSON.stringify(fixture())) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [{ size: new TextEncoder().encode(contents).byteLength, text: async () => contents }] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}
async function click(element: HTMLElement) { await act(async () => element.click()); }
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent === label)!;
const checks = () => [...document.querySelectorAll<HTMLInputElement>('dialog input[type="checkbox"]')];

it("requires independent personal review, defaults everything off and never sends", async () => {
  await upload();
  expect(checks().map(input => input.checked)).toEqual([false, false, false]);
  expect(document.querySelector("dialog img")).toBeNull();
  expect(document.querySelector("dialog")?.textContent).toContain('Unicode 🌱');
  expect(button("Add reviewed notes to draft").disabled).toBe(true);
  await click(checks()[0]); await click(checks()[2]);
  await click(button("Add reviewed notes to draft"));
  expect(append).toHaveBeenCalledTimes(1);
  expect(append.mock.calls[0][0]).toContain("Review proposal");
  expect(append.mock.calls[0][0]).not.toContain('"transcript"');
  expect(fetch).not.toHaveBeenCalled();
  expect(document.querySelector("dialog")).toBeNull();
});
it("changing a selection clears confirmation; cancellation leaves the draft untouched", async () => {
  await upload(); await click(checks()[0]); await click(checks()[2]);
  await click(checks()[1]);
  expect(checks()[2].checked).toBe(false);
  await click(button("Cancel"));
  expect(append).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
it("rejects oversized and unknown-version files before opening a review", async () => {
  await upload(JSON.stringify({ ...fixture(), version: 2 }));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("version 1");
  await upload("x".repeat(512 * 1024 + 1));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("512 KiB");
  expect(document.querySelector("dialog")).toBeNull(); expect(append).not.toHaveBeenCalled();
});
it("unmount/target change invalidates a pending file read", async () => {
  let finish!: (value: string) => void;
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [{ size: 500, text: () => new Promise<string>(resolve => { finish = resolve; }) }] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  await act(async () => root.render(createElement(MeetingReviewImport, { key: "another-target", targetName: "Other agent", disabled: false, onAppendDraft: append })));
  await act(async () => finish(JSON.stringify(fixture())));
  expect(document.querySelector("dialog")).toBeNull(); expect(append).not.toHaveBeenCalled();
});

