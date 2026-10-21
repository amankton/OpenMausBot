import { Children, createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { configureLiveMedia, liveMedia, resetLiveMedia, startLiveCall } from "@/lib/live-call-media";
import { setLiveProvider } from "@/lib/live-provider";
vi.mock("@/state/store", async (original) => ({ ...await original<typeof import("@/state/store")>(), useStore: () => ({ state: { config: { live: { configured: true, voice: "marin", readTypedReplies: true, idleMinutes: 5 } } }, dispatch: vi.fn() }) }));
import { LiveCallSettings } from "./LiveCallSettings";
function find(tree: ReactNode): ((event: { target: { value: string } }) => Promise<void>) | undefined {
  for (const child of Children.toArray(tree)) {
    if (!isValidElement<{ children?: ReactNode; "aria-label"?: string; onChange?: (event: { target: { value: string } }) => Promise<void> }>(child)) continue;
    if (child.props["aria-label"] === "Voice provider") return child.props.onChange;
    const found = find(child.props.children); if (found) return found;
  }
}
afterEach(() => { resetLiveMedia(); setLiveProvider("openai"); vi.unstubAllGlobals(); });
it("ends the current call before changing provider and never starts the next automatically", async () => {
  vi.stubGlobal("window", { ogb: { speechStop: vi.fn(async () => {}) } });
  configureLiveMedia({ getUserMedia: () => new Promise(() => {}) });
  void startLiveCall({ botId: "fixture", threadId: "fixture", provider: "openai" });
  expect(liveMedia().phase).toBe("starting");
  let change: ReturnType<typeof find>;
  function Capture() { const tree = LiveCallSettings({ onClose: () => {} }); change = find(tree); return tree; }
  renderToStaticMarkup(createElement(Capture));
  await change!({ target: { value: "gemini" } });
  expect(liveMedia().phase).toBe("idle");
  expect(renderToStaticMarkup(createElement(Capture))).toContain('value="gemini" selected=""');
});
