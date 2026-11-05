import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const skillNames = ["executive-check-in", "execute-and-verify", "coordinate-and-review", "decision-brief", "scan-mail", "classify-and-prioritize", "prepare-reply", "reconcile-follow-ups"];
const sourceRoot = fileURLToPath(new URL("..", import.meta.url));

export function verifyChiefPackage(resources) {
  for (const name of ["server/index.js", "ui/index.html", "ui/chief-help.html", "chief-install-handoff/HANDOFF.md", "chief-install-handoff/SETUP.md", "chief-install-handoff/CHIEF-ADDENDUM.md", "chief-install-handoff/MAIL-ADDENDUM.md", "licenses/OpenMausBot-LICENSE.txt", "licenses/OpenMausBot-NOTICE.txt", "licenses/parse5-LICENSE.txt", "licenses/entities-LICENSE.txt"]) {
    assert(existsSync(join(resources, name)), `Chief package is missing ${name}`);
  }
  for (const name of ["server/enterprise", ".chief-local", ".env", "app-update.yml"]) {
    assert(!existsSync(join(resources, name)), `Chief package contains forbidden resource ${name}`);
  }
  assert.match(readFileSync(join(resources, "ui/index.html"), "utf8"), /Chief/);
  assert.match(readFileSync(join(resources, "licenses/OpenMausBot-LICENSE.txt"), "utf8"), /Apache License/);
  // These modules are inlined into the self-contained server entry point.
  const server = readFileSync(join(resources, "server/index.js"), "utf8");
  for (const marker of ["chief-enhancement-setup.db", "connector-trust.db", "Mail body encoding is invalid or excessive"]) assert(server.includes(marker), `Chief package is missing bundled runtime ${marker}`);
  assert(!readdirSync(join(resources, "ui/assets")).some(name => name.startsWith("SharedWorkspacePage-")), "Agent release includes the workspace entry point");
  for (const name of skillNames) {
    const path = `skills/${name}/SKILL.md`;
    assert(existsSync(join(resources, path)), `Chief package is missing ${path}`);
    assert.equal(readFileSync(join(resources, path), "utf8"), readFileSync(join(sourceRoot, path), "utf8"), `Chief package changed the reviewed skill ${name}`);
  }
  return { product: "Chief Executive Suite", enterprise: false, sharedWorkspace: false, upstreamUpdateFeed: false, notices: true, reviewedSkills: skillNames.length, enhancementRuntime: true };
}
