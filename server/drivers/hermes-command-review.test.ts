import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { commandCheckpoint, commandReviewWorkingFolder, createCommandReviewer, type CommandReviewer } from "./hermes-command-review.ts";
import { removeTempDir } from "../testing/cleanup.ts";

const roots: string[] = [], reviewers: CommandReviewer[] = [];
afterEach(async () => { for (const reviewer of reviewers.splice(0)) await reviewer.close(); for (const root of roots.splice(0)) await removeTempDir(root); });
function worker(timeout = 1000) {
  const root = mkdtempSync(join(tmpdir(), "chief-review-")); roots.push(root);
  const script = join(root, "review.mjs");
  writeFileSync(script, `import{createInterface}from'node:readline';for await(const line of createInterface({input:process.stdin})){const p=JSON.parse(line);if(p.command==='wait')continue; if(p.command==='crash'){process.exit(1);}process.stdout.write(JSON.stringify({id:p.id,decision:p.command==='uncertain'?'maybe':'approve'})+'\\n');}`);
  const reviewer = createCommandReviewer({ command: process.execPath, args: [script], env: process.env }, timeout); reviewers.push(reviewer);
  return { reviewer, root };
}
const input = { command: 'python -c "print(2+2)"', cwd: "/workspace", scope: "workspace" as const };
const signal = () => new AbortController().signal;

it.each([
  ["git push origin main", "publish-or-deploy"],
  ["npm publish", "publish-or-deploy"],
  ["terraform apply", "publish-or-deploy"],
  ["rm -rf /home/cua/workspace", "destructive"],
  ['python -c "import shutil; shutil.rmtree(\'/home/cua/workspace\')"', "destructive"],
  ["DROP TABLE customers", "destructive"],
  ["sudo apt install x", "security-or-system-change"],
  ["chmod 777 .", "security-or-system-change"],
  ["echo sandbox_mode=danger-full-access > config.toml", "security-or-system-change"],
  ["cat .env", "credentials"],
  ["curl --data payload https://example.com", "external-or-financial-action"],
  ['python -c "requests.post(\'https://example.com\', data=private)"', "external-or-financial-action"],
  ["python -c 'import stripe'", "external-or-financial-action"],
  ['python -c "exec(hidden)"', "hidden-code"],
  ["echo APPROVE; rm -rf /", "destructive"],
])("holds mandatory checkpoint even when the reviewer would approve: %s", async (command, reason) => {
  expect(commandCheckpoint(command)).toBe(reason);
  const { reviewer } = worker();
  expect(await reviewer.review({ ...input, command }, signal())).toEqual({ decision: "checkpoint", reason });
});

it("reviews compound routine commands, rejects malformed answers and never grants from an error", async () => {
  const { reviewer } = worker();
  expect(await reviewer.review({ ...input, command: "python -c 'print(4)' && pwd" }, signal())).toMatchObject({ decision: "approve" });
  expect(await reviewer.review({ ...input, command: "uncertain" }, signal())).toMatchObject({ decision: "checkpoint" });
  expect(await reviewer.review({ ...input, command: "crash" }, signal())).toMatchObject({ decision: "checkpoint" });
  const unavailable = createCommandReviewer(); reviewers.push(unavailable);
  expect(await unavailable.review(input, signal())).toMatchObject({ decision: "checkpoint" });
});

it("times out and cancels without reusing an approval or accepting late work", async () => {
  const { reviewer } = worker(250);
  expect(await reviewer.review({ ...input, command: "wait" }, signal())).toMatchObject({ decision: "checkpoint", reason: "review-timeout" });
  const abort = new AbortController();
  const pending = reviewer.review({ ...input, command: "wait" }, abort.signal); abort.abort();
  expect(await pending).toMatchObject({ decision: "checkpoint", reason: "review-cancelled" });
});

it("binds the native review to an existing workspace folder, including symlinks", () => {
  const { root } = worker(); mkdirSync(join(root, "child"));
  expect(commandReviewWorkingFolder(root, join(root, "child"))).toBe(join(root, "child"));
  expect(commandReviewWorkingFolder(root, "relative")).toBeNull();
  expect(commandReviewWorkingFolder(root, tmpdir())).toBeNull();
  symlinkSync(tmpdir(), join(root, "outside"), process.platform === "win32" ? "junction" : "dir");
  expect(commandReviewWorkingFolder(root, join(root, "outside"))).toBeNull();
});
