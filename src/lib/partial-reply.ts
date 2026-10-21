import type { ServerFrame } from "../../shared/wire";

export const PARTIAL_REPLY_INTERVAL_MS = 80;
export const PARTIAL_REPLY_MAX_CHARS = 32_768;

/** Ephemeral display only. Durable messages remain the transcript authority. */
export function createPartialReply(threadId: string, onText: (text: string) => void) {
  let turnId: string | undefined;
  let itemId: string | undefined;
  let text = "";
  let displayed = "";
  let boundaryAt = 0;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const retired = new Set<string>();
  const seen = new Set<string>();
  const closedItems = new Set<string>();
  const remember = (set: Set<string>, key: string, max: number) => {
    set.add(key);
    if (set.size > max) set.delete(set.values().next().value!);
  };
  const flush = () => {
    timer = undefined;
    if (!disposed && text !== displayed) { displayed = text; onText(text); }
  };
  const clearText = () => {
    clearTimeout(timer); timer = undefined;
    text = ""; itemId = undefined;
    flush();
  };
  const retire = () => {
    if (turnId) remember(retired, turnId, 64);
    turnId = undefined;
    seen.clear(); closedItems.clear();
    clearText();
  };
  return {
    reset: retire,
    dispose() { disposed = true; clearTimeout(timer); },
    onFrame(frame: ServerFrame) {
      if (disposed) return;
      if (frame.kind === "message" && frame.threadId === threadId &&
          frame.message.role === "bot" && frame.message.kind === "text" && frame.message.turnId === turnId) {
        clearText();
        return;
      }
      if (frame.kind !== "runtime") return;
      const event = frame.event;
      if (event.threadId !== threadId || !event.turnId || retired.has(event.turnId)) return;
      const at = Date.parse(event.createdAt) || 0;
      if (at < boundaryAt) return;
      if (event.type === "turn.started") {
        if (event.turnId === turnId) return;
        retire();
        turnId = event.turnId; boundaryAt = at;
        return;
      }
      if (turnId && event.turnId !== turnId) return;
      if (seen.has(event.eventId)) return;
      remember(seen, event.eventId, 2048);
      if (event.type === "turn.completed" || event.type === "session.exited") {
        turnId = event.turnId; boundaryAt = at; retire();
        return;
      }
      if (event.type === "turn.retrying") { boundaryAt = at; clearText(); return; }
      if (event.type === "item.completed" && event.itemType === "assistant_text") {
        if (event.itemId) remember(closedItems, event.itemId, 128);
        if (!event.itemId || !itemId || event.itemId === itemId) clearText();
        boundaryAt = at;
        return;
      }
      // Never display reasoning, tool arguments, raw events, or synthetic errors.
      if (event.type !== "content.delta" || event.streamKind !== "assistant_text" || event.synthetic ||
          (event.itemId && closedItems.has(event.itemId))) return;
      turnId = event.turnId;
      if (itemId && event.itemId && itemId !== event.itemId) clearText();
      itemId = event.itemId;
      text += event.delta.slice(0, Math.max(0, PARTIAL_REPLY_MAX_CHARS - text.length));
      if (!displayed) flush();
      else if (!timer && text !== displayed) timer = setTimeout(flush, PARTIAL_REPLY_INTERVAL_MS);
    },
  };
}
