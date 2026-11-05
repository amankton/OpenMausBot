import { expect, it } from "vitest";
import type { WorkItem, WorkStatus } from "../shared/executive-work.ts";
import { executiveNotificationPresentation } from "./executive-notifications.ts";

function item(status: WorkStatus, patch: Partial<WorkItem> = {}): WorkItem {
  return { id: "work", accountScope: "local:chief", source: { kind: "coordination", id: "request", version: "request" }, ownerBotId: "worker", coordinatorBotId: "chief", sourceThreadId: "source-thread", title: "Review the requested report", desiredOutcome: "An accepted report", nextAction: "Inspect the returned artifact and choose the next step", status, executionStatus: "working", priority: 3, dependencies: [], revision: 1, createdAt: 1000, updatedAt: 1000, ...patch };
}
it.each(["queued", "working", "waiting-on-other", "dismissed"] as const)("keeps %s progress quiet without claiming it finished", status => {
  expect(executiveNotificationPresentation(item(status))).toBeNull();
});
it.each([
  ["proposed", "New work needs review"],
  ["blocked", "Work is blocked"],
  ["waiting-on-human", "Work needs your decision"],
  ["ready-for-review", "Work is ready for review"],
] as const)("presents %s as an owner decision rather than completion", (status, title) => {
  const notice = executiveNotificationPresentation(item(status));
  expect(notice).toMatchObject({ kind: "question", title });
  expect(notice?.body).toContain("Inspect the returned artifact");
  expect(notice?.title).not.toMatch(/finished|completed/i);
});
it("reserves completion notices for work actually resolved with evidence or owner confirmation", () => {
  const completed = item("done", { executionStatus: "succeeded", completion: { kind: "evidence-verified", actor: "chief", reason: "Acceptance criteria verified against the artifact", sourceVersion: "request", evidence: ["result-one"] } });
  expect(executiveNotificationPresentation(completed)).toMatchObject({ kind: "done", title: "Work completed", body: expect.stringContaining("Acceptance criteria verified") });
  expect(executiveNotificationPresentation(item("done"))).toBeNull();
  expect(executiveNotificationPresentation({ ...completed, executionStatus: "outcome-unknown" })).toBeNull();
  expect(executiveNotificationPresentation({ ...completed, status: "ready-for-review" })?.kind).toBe("question");
});
it("keeps notification bodies bounded and removes embedded multiline code", () => {
  const notice = executiveNotificationPresentation(item("blocked", { title: "Report", nextAction: `Inspect evidence\n\n\`\`\`\nnot a notification command\n\`\`\`\n${"x".repeat(500)}` }));
  expect(notice?.body.length).toBeLessThanOrEqual(200);
  expect(notice?.body).not.toContain("\n"); expect(notice?.body).not.toContain("not a notification command");
});
