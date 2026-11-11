import { createHash, randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { userInfo } from "node:os";
import { spawnCli, killCliTree } from "../procs.ts";
import { redactSecretsInText } from "../redact.ts";

export type CommandReviewInput = { command: string; cwd: string; scope: "workspace" | "vm" };
export type CommandReviewResult = { decision: "approve" | "checkpoint"; reason: string };
export interface CommandReviewer {
  review(input: CommandReviewInput, signal: AbortSignal): Promise<CommandReviewResult>;
  close(): Promise<void>;
}

const checkpoint = (reason: string): CommandReviewResult => ({ decision: "checkpoint", reason });

/** Mandatory checkpoints run before the model and cannot be waived by its answer.
 * This is a conservative floor, not a shell parser or a sandbox. The reviewer
 * must still evaluate the whole compound command and all visible inline code. */
export function commandCheckpoint(command: string): string | null {
  if (!command.trim() || Buffer.byteLength(command) > 16384 || /\p{Cc}/u.test(command.replace(/[\r\n\t]/g, ""))) return "invalid-command";
  if (redactSecretsInText(command) !== command || /(?:\.env\b|id_rsa|id_ed25519|credentials|keyring|private.?key|api.?key|access.?token|\b(?:password|passwd|secret|authorization|bearer)\b)/i.test(command)) return "credentials";
  if (/\b(?:rm|rmdir|erase|remove-item|unlink|rmtree|mkfs|format-volume|clear-disk)\b|\b(?:drop|truncate)\s+(?:table|database)|\bgit\s+(?:reset|clean)\b|\bdel\s+[^=]/i.test(command)) return "destructive";
  if (/\b(?:sudo|runas|chmod|chown|set-acl|icacls|netsh|set-executionpolicy|authorized_keys|sshd_config)\b|\b(?:grant|revoke)\s+|\b(?:reg|schtasks)\s+\/?(?:add|create|change|delete)\b|approval_policy|sandbox_mode|bypassPermissions|routineApprovals|commandReview|--dangerously/i.test(command)) return "security-or-system-change";
  if (/\bgit\s+push\b|\b(?:npm|pnpm|yarn)\s+publish\b|\bgh\s+(?:pr\s+merge|release\s+create)\b|\b(?:deploy|terraform\s+(?:apply|destroy)|kubectl\s+(?:apply|delete))\b/i.test(command)) return "publish-or-deploy";
  if (/\b(?:smtp|send_mail|send_email|send_message|sendmail|payment_intent|checkout|paypal)\b|\bstripe\b|\.(?:post|put|delete|send_message|sendmail)\s*\(|\bcurl\b[^\r\n]*(?:\s(?:-d|--data\S*|-F|--form|--upload-file)\b|\s-X\s*(?:POST|PUT|PATCH|DELETE))/i.test(command)) return "external-or-financial-action";
  if (/\b(?:base64|frombase64string|encodedcommand)\b|\b(?:eval|exec|compile)\s*\(/i.test(command)) return "hidden-code";
  return null;
}

export function commandReviewWorkingFolder(root: string | undefined, requested: unknown): string | null {
  if (!root || !isAbsolute(root) || typeof requested !== "string" || !isAbsolute(requested)) return null;
  try {
    const cwd = realpathSync(requested), local = relative(realpathSync(root), cwd);
    return !isAbsolute(local) && !local.split(/[\\/]/).includes("..") ? cwd : null;
  } catch { return null; }
}

export function commandReviewReceipt(input: CommandReviewInput): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

type WorkerSpec = { command: string; args: string[]; env?: NodeJS.ProcessEnv };
/** One tools-free native auxiliary reviewer per turn. Never an agent run.
 * The protocol carries decisions only; stdout/stderr and model errors are
 * never copied into logs or permission cards. No verdict is cached. */
export function createCommandReviewer(spec?: WorkerSpec, timeoutMs = 30000): CommandReviewer {
  let child: ReturnType<typeof spawnCli> | undefined;
  let buffer = "", closed = false;
  const pending = new Map<string, (result: CommandReviewResult) => void>();
  const outstanding = new Set<string>();
  const fail = () => { for (const done of pending.values()) done(checkpoint("reviewer-unavailable")); outstanding.clear(); };
  const start = () => {
    if (child || !spec || closed) return;
    child = spawnCli(spec.command, spec.args, { stdio: ["pipe", "pipe", "pipe"], env: spec.env });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      buffer += chunk;
      if (buffer.length > 65536) { fail(); if (child) void killCliTree(child).catch(() => {}); return; }
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        try {
          const row = JSON.parse(line);
          if (!row || typeof row !== "object" || Object.keys(row).sort().join(",") !== "decision,id" || typeof row.id !== "string") throw new Error("invalid reviewer response");
          outstanding.delete(row.id);
          const done = typeof row.id === "string" ? pending.get(row.id) : undefined;
          done?.(row.decision === "approve" ? { decision: "approve", reason: "routine-command" } : checkpoint(row.decision === "checkpoint" ? "review-needed" : "reviewer-unavailable"));
        } catch { fail(); }
      }
    });
    child.stderr.on("data", () => {});
    child.once("error", fail); child.once("exit", fail);
  };
  return {
    async review(input, signal) {
      const floor = commandCheckpoint(input.command);
      if (floor) return checkpoint(floor);
      if (closed || signal.aborted || outstanding.size >= 4 || !spec) return checkpoint("reviewer-unavailable");
      try { start(); } catch { return checkpoint("reviewer-unavailable"); }
      if (!child || child.exitCode !== null) return checkpoint("reviewer-unavailable");
      return await new Promise<CommandReviewResult>(resolve => {
        const id = randomUUID();
        const done = (result: CommandReviewResult) => {
          if (!pending.delete(id)) return;
          clearTimeout(timer); signal.removeEventListener("abort", abort); resolve(result);
        };
        const abort = () => done(checkpoint("review-cancelled"));
        const timer = setTimeout(() => done(checkpoint("review-timeout")), timeoutMs);
        pending.set(id, done); outstanding.add(id); signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) { abort(); return; }
        child!.stdin.write(JSON.stringify({ id, ...input }) + "\n", error => { if (error) done(checkpoint("reviewer-unavailable")); });
      });
    },
    async close() { closed = true; fail(); if (child && !await killCliTree(child)) throw new Error("Command reviewer shutdown could not be confirmed"); },
  };
}

export function hermesCommandReviewer(env: NodeJS.ProcessEnv, workerScript?: string): CommandReviewer {
  const home = env.HERMES_HOME;
  if (!home) return createCommandReviewer();
  const script = workerScript ?? join(home, "plugins", "chief-http-tools", "command_review.py");
  const suffix = process.platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python"];
  const python = [env.HERMES_PYTHON || "", join(home, "hermes-agent", "venv", ...suffix), join(home, "hermes-agent", ".venv", ...suffix), join(home, "venv", ...suffix)].find(path => path && existsSync(path));
  if (!python || !existsSync(script)) return createCommandReviewer();
  const safeEnv: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "APPDATA", "COMSPEC", "PATHEXT", "LANG", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "PYTHONPATH", "CHIEF_BUDGET_RUN_ID", "CHIEF_MANAGED_REQUESTS_ONLY"]) {
    if (env[key]) safeEnv[key] = env[key];
  }
  // The backend may have a disposable HOME for provider isolation. Only this
  // explicitly enabled, tools-free native auxiliary uses its OS account's
  // existing login store; never copy credentials into the app/fixture home.
  const accountHome = userInfo().homedir;
  return createCommandReviewer({ command: python, args: [script], env: { ...safeEnv, HOME: accountHome, USERPROFILE: accountHome, HERMES_HOME: home, PYTHONIOENCODING: "utf-8" } });
}
