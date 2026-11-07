import type { WorkItem } from "../shared/executive-work.ts";
import { summarize } from "./notify.ts";

export interface ExecutiveNotificationPresentation {
  kind: "question" | "done";
  title: string;
  body: string;
}

/** Execution progress is a receipt, not an owner interruption or completion. */
export function executiveNotificationPresentation(item: WorkItem): ExecutiveNotificationPresentation | null {
  const body = summarize(`${item.title}: ${item.nextAction}`, 200);
  switch (item.status) {
    case "proposed": return { kind: "question", title: "New work needs review", body };
    case "waiting-on-human": return { kind: "question", title: "Work needs your decision", body };
    case "blocked": return { kind: "question", title: "Work is blocked", body };
    case "ready-for-review": return { kind: "question", title: "Work is ready for review", body };
    case "done":
      if (!item.completion || item.executionStatus === "outcome-unknown") return null;
      return { kind: "done", title: "Work completed", body: summarize(`${item.title}: ${item.completion.reason}`, 200) };
    default: return null;
  }
}
