// The line the harness prints when a turn starts (stderr, which the desktop
// app keeps in server.log). Prompt contents stay private. Words spoken on a Live call are never
// logged — the call's summary line (liveCallSummaryLine) has counters only —
// so a turn carrying any of them shows `text=(spoken)` instead.

export interface TurnStartLog {
  botId: string;
  text: string;
  images: number;
  depth: number;
  card: boolean;
  /** some of the turn's words were spoken on a Live call */
  spoken: boolean;
}

export function turnStartLogLine(turn: TurnStartLog): string {
  const text = turn.spoken ? "(spoken)" : `(private:${turn.text.length} chars)`;
  return `[omb-turn] bot=${turn.botId} text=${text} images=${turn.images} depth=${turn.depth} card=${turn.card}`;
}
