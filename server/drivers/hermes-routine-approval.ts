import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";
import type { SendTurnInput } from "../contracts.ts";
import { SPAWNED_PROXIES } from "../proxy-paths.ts";

// Explicit opt-in for Hermes, which has no native Auto mode for MCP tools.
// Unknown tools and arbitrary commands always retain the human gate.
const NATIVE_READS = new Set(["read_file", "search_files", "skill_view", "skills_list"]);
const AGENT_ROUTINES = new Set([
  "list_bots", "list_rooms", "list_threads", "check_delegation", "wait_delegation",
  "session_search", "session_read", "list_routines", "skills_list", "attach_file",
  "coordinate_bots", "delegate_bot",
  "register_task_result", "task_results",
]);
const COMPUTER_READS = new Set(["list_windows", "list_apps", "get_window_state", "get_desktop_state"]);
const DOCUMENT_EXTENSIONS = new Set([".md", ".txt", ".html", ".css", ".csv", ".svg"]);

function documentInWorkspace(path: unknown, cwd: string | undefined): boolean {
  if (typeof path !== "string" || !isAbsolute(path) || !cwd || !isAbsolute(cwd) || /\p{Cc}/u.test(path)) return false;
  // Do not auto-edit instructions, skills, credentials, executables or config.
  if (!DOCUMENT_EXTENSIONS.has(extname(path).toLowerCase()) || /^(agents|skill|soul|user|memory)\.md$/i.test(basename(path))) return false;
  try {
    const root = realpathSync(cwd);
    let ancestor = resolve(path);
    while (!existsSync(ancestor)) {
      const parent = dirname(ancestor);
      if (parent === ancestor) return false;
      ancestor = parent;
    }
    const target = resolve(realpathSync(ancestor), relative(ancestor, resolve(path)));
    const local = relative(root, target);
    return !!local && !isAbsolute(local) && local.split(/[\\/]/).every(part => part !== ".." && !part.startsWith(".")) &&
      !local.split(/[\\/]/).some(part => ["node_modules", "plugins", "skills", "credentials"].includes(part.toLowerCase()));
  } catch { return false; }
}

export function hermesRoutineNative(turn: SendTurnInput, enabled: boolean, name: string, args: Record<string, unknown>): boolean {
  if (!enabled || turn.approvalMode !== "auto") return false;
  if (NATIVE_READS.has(name)) {
    if (process.env.CHIEF_CUSTOMER_INSTALLATION !== "1" || name === "skills_list") return true;
    // Customer installs do not inherit the operator's unbounded native-read
    // opt-in. Unknown skill/file routes retain the existing approval card.
    if (name === "skill_view") return false;
    const requested = args.path ?? args.file_path ?? (name === "search_files" ? turn.cwd : undefined);
    if (typeof requested !== "string" || !isAbsolute(requested) || !turn.cwd || !isAbsolute(turn.cwd)) return false;
    try {
      const local = relative(realpathSync(turn.cwd), realpathSync(requested));
      return !isAbsolute(local) && !local.split(/[\\/]/).some(part => part === ".." || part.startsWith(".") ||
        /^(?:credentials|secrets|plugins|node_modules)$/i.test(part) || /^(?:config|auth|runtime-secrets)\.(?:json|yaml|yml)$/i.test(part) || /\.(?:pem|key|p12|pfx|keystore)$/i.test(part));
    } catch { return false; }
  }
  if (name === "write_file" || name === "patch" && (args.mode === undefined || args.mode === "replace")) {
    return documentInWorkspace(args.path, turn.cwd);
  }
  // Complete, read-only commands only; no shell syntax, flags, aliases or scripts.
  if (name === "terminal" && typeof args.command === "string") {
    return ["pwd", "git status --short", "git status --porcelain", "git rev-parse --show-toplevel"].includes(args.command.trim());
  }
  return false;
}

export function hermesRoutineMcp(turn: SendTurnInput, enabled: boolean,
  tool: { server: string; name: string; builtIn: boolean } | undefined): boolean {
  if (!enabled || turn.approvalMode !== "auto" || !tool) return false;
  if (tool.server === "huly" && ["connections", "projects", "issues", "issue"].includes(tool.name)) {
    const descriptor = turn.integrations?.custom?.huly;
    if (descriptor && "command" in descriptor && descriptor.command === process.execPath && JSON.stringify(descriptor.args) === JSON.stringify([SPAWNED_PROXIES.huly]) &&
        descriptor.env?.CHIEF_HULY_DIRECTORY === process.env.OMB_DATA_DIR && descriptor.env?.CHIEF_HULY_BOT === turn.botId &&
        descriptor.env?.CHIEF_HULY_ORIGIN === process.env.CHIEF_LIFECYCLE_ORIGIN && !!process.env.CHIEF_LIFECYCLE_ORIGIN) return true;
  }
  if (!tool.builtIn) return false;
  if (tool.server === "agents") return AGENT_ROUTINES.has(tool.name);
  return tool.server === "computer" && turn.integrations?.localComputer?.scope !== "local-computer" && COMPUTER_READS.has(tool.name);
}
