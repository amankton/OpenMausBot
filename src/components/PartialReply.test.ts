// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PartialReply } from "./PartialReply";
import { publishLiveFrame, publishMissedFrames } from "@/lib/live-events";
import type { RuntimeEvent } from "../../shared/runtime-events";

let root: Root;
let host: HTMLDivElement;
let sequence = 0;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.useFakeTimers();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
});
const render = async (threadId = "thread", active = true, connected = true) => {
  await act(async () => root.render(createElement(PartialReply, { key: threadId, threadId, active, connected })));
};
const send = async (data: object) => {
  await act(async () => publishLiveFrame({ kind: "runtime", event: {
    type: "content.delta", streamKind: "assistant_text", delta: "Hello", provider: "fixture", threadId: "thread", turnId: "turn",
    eventId: `ui-${++sequence}`, createdAt: "2026-10-19T00:00:01Z", ...data,
  } as RuntimeEvent }));
};

it("renders partial plain text immediately without exposing reasoning or evaluating HTML", async () => {
  await render();
  await send({ streamKind: "reasoning_text", delta: "private" });
  expect(host.textContent).toBe("");
  await send({ delta: "<img src=x onerror=alert(1)>" });
  expect(host.querySelector("[data-partial-reply]")?.textContent).toBe("<img src=x onerror=alert(1)>");
  expect(host.querySelector("img")).toBeNull();
  await send({ type: "item.completed", itemType: "assistant_text", text: "finished" });
  expect(host.textContent).toBe("");
});

it("clears cancelled/disconnected and switched conversations, including queued paints", async () => {
  await render(); await send({}); await send({ delta: " pending" });
  await render("thread", false);
  await act(async () => vi.advanceTimersByTime(100));
  expect(host.textContent).toBe("");
  await render("other"); await send({ delta: "old conversation" });
  expect(host.textContent).toBe("");
  await send({ threadId: "other", turnId: "other-turn", delta: "Other" });
  expect(host.textContent).toBe("Other");
  await render("other", true, false);
  expect(host.textContent).toBe("");
});

it("drops a partial answer when the stream cannot replay its gap", async () => {
  await render(); await send({});
  await act(async () => publishMissedFrames());
  expect(host.textContent).toBe("");
  await send({ delta: "retired replay" });
  expect(host.textContent).toBe("");
});
