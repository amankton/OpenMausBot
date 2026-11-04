import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";
import type { SendTurnInput } from "../contracts.ts";

// Explicit opt-in for Hermes, which has no native Auto mode for MCP tools.
// Unknown tools and arbitrary commands always retain the human gate.
const NATIVE_READS = new Set(["read_file", "search_files", "skill_view", "skills_list"]);
const AGENT_ROUTINES = new Set([
  "list_bots", "list_rooms", "list_threads", "check_delegation", "wait_delegation",
  "session_search", "session_read", "list_routines", "skills_list", "attach_file",
  "coordinate_bots", "delegate_bot",
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
  if (NATIVE_READS.has(name)) return true;
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
  if (!enabled || turn.approvalMode !== "auto" || !tool?.builtIn) return false;
  if (tool.server === "agents") return AGENT_ROUTINES.has(tool.name);
  return tool.server === "computer" && turn.integrations?.localComputer?.scope !== "local-computer" && COMPUTER_READS.has(tool.name);
}
