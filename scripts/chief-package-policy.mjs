import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function verifyChiefPackage(resources) {
  for (const name of ["server/index.js", "ui/index.html", "ui/chief-help.html", "licenses/OpenMausBot-LICENSE.txt", "licenses/OpenMausBot-NOTICE.txt"]) {
    assert(existsSync(join(resources, name)), `Chief package is missing ${name}`);
  }
  for (const name of ["server/enterprise", ".chief-local", ".env", "app-update.yml"]) {
    assert(!existsSync(join(resources, name)), `Chief package contains forbidden resource ${name}`);
  }
  assert.match(readFileSync(join(resources, "ui/index.html"), "utf8"), /Chief/);
  assert.match(readFileSync(join(resources, "licenses/OpenMausBot-LICENSE.txt"), "utf8"), /Apache License/);
  assert(!readdirSync(join(resources, "ui/assets")).some(name => name.startsWith("SharedWorkspacePage-")), "Agent release includes the workspace entry point");
  return { product: "Chief Executive Suite", enterprise: false, sharedWorkspace: false, upstreamUpdateFeed: false, notices: true };
}
