import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { sameAudience } from "./bot-visibility.ts";
import { DATA_DIR } from "./config.ts";
import type { RosterMember } from "./peer-roster.ts";

type Route = {
  mode: "external-delegation" | "direct-coordination";
  fromId: string;
  fromSection: string;
  toId: string;
  toSection: string;
};

export function directPeerRoute(mode: Route["mode"], from: RosterMember, to: RosterMember): boolean {
  if (from.id === to.id || from.hidden || to.hidden || !sameAudience(from.visibility, to.visibility)) return false;
  const file = join(DATA_DIR, "direct-peer-routes.json");
  try {
    const stat = statSync(file);
    if (!stat.isFile() || stat.size > 32768 || (process.platform !== "win32" && (stat.mode & 0o077))) return false;
    const routes: unknown = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    return Array.isArray(routes) && routes.some((route: Partial<Route> | null) =>
      route?.mode === mode && route.fromId === from.id && route.toId === to.id
      && route.fromSection === (from.section?.trim() || "") && route.toSection === (to.section?.trim() || ""));
  } catch {
    return false;
  }
}
