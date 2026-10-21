import { memo, useEffect, useRef, useState } from "react";
import { listenLiveFrames } from "@/lib/live-events";
import { createPartialReply } from "@/lib/partial-reply";

/** Tokens update this small plain-text surface, never the app store or Markdown. */
export const PartialReply = memo(function PartialReply({ threadId, active, connected, hidden = false }: {
  threadId: string;
  active: boolean;
  connected: boolean;
  hidden?: boolean;
}) {
  const [text, setText] = useState("");
  const tracker = useRef<ReturnType<typeof createPartialReply> | null>(null);
  useEffect(() => {
    setText("");
    const current = createPartialReply(threadId, setText);
    tracker.current = current;
    const stop = listenLiveFrames({ onFrame: current.onFrame, onMissedFrames: current.reset });
    return () => { stop(); current.dispose(); tracker.current = null; };
  }, [threadId]);
  useEffect(() => {
    if (!active || !connected) tracker.current?.reset();
  }, [active, connected]);
  if (!active || !connected || hidden || !text) return null;
  return <div data-partial-reply="" aria-live="off" className="max-w-full whitespace-pre-wrap break-words rounded-2xl bg-panel px-4 py-3 text-[14px] leading-relaxed text-ink">{text}</div>;
});
