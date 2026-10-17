#!/usr/bin/env node
// Deterministic provider for the isolated connection repair acceptance journey.
// Approval, transcript, file download, and UI use production code. Only the
// model is replaced; this provider really writes the approved fixture file.
import { readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { createInterface } from "node:readline";
import { isAbsolute, join, relative } from "node:path";
import { randomUUID } from "node:crypto";

const arg = (name: string) => process.argv[process.argv.indexOf(name) + 1];
if (arg("--output-format") !== "stream-json") {
  await import("../../server/testing/fake-claude-cli.ts");
} else {
  const data = process.env.OMB_DATA_DIR ?? "";
  const within = relative(data, process.cwd());
  if (!data || process.env.OMB_TEST_SEALED_PATH !== "1" || data !== process.env.HOME || within.startsWith("..") || isAbsolute(within)) {
    throw new Error("Journey provider requires an explicitly isolated verification workspace");
  }
  const config = JSON.parse(readFileSync(arg("--mcp-config"), "utf8"));
  const broker = config.mcpServers.ogb.args.at(-1);
  const sessionId = randomUUID();
  const out = (frame: unknown) => process.stdout.write(JSON.stringify(frame) + "\n");
  let running = false;
  createInterface({ input: process.stdin }).on("line", async line => {
    const frame = JSON.parse(line);
    if (frame.type !== "user" || running) return;
    running = true;
    out({ type: "system", subtype: "init", session_id: sessionId, model: arg("--model"), permissionMode: "default", tools: ["Write"] });
    const id = randomUUID();
    const file = join(process.cwd(), "journey-result.md");
    const input = { file_path: file, content: "# CHIEF journey result\n\nThis file was written once after explicit fixture approval.\n" };
    out({ type: "assistant", message: { content: [{ type: "tool_use", id, name: "Write", input }] } });
    const socket = connect(broker);
    const response = await new Promise<any>((resolve, reject) => {
      socket.once("error", reject);
      socket.once("connect", () => socket.write(JSON.stringify({ t: "ask", id, kind: "permission", tool: "Write", input }) + "\n"));
      createInterface({ input: socket }).on("line", answer => {
        const result = JSON.parse(answer);
        if (result.t === "answer" && result.id === id) resolve(result);
      });
    });
    socket.end();
    const allowed = response.behavior === "allow";
    if (allowed) writeFileSync(file, input.content, { flag: "wx" });
    const text = allowed ? `Created the approved report. [Open report](<${file.replaceAll("\\", "/")}>)` : "The report was not written because approval was not granted.";
    out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: !allowed, content: allowed ? "Report written once." : response.message ?? "Approval not granted." }] } });
    out({ type: "assistant", message: { content: [{ type: "text", text }] } });
    out({ type: "result", is_error: false, stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });
    running = false;
  });
}
