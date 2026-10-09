import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { verifyChiefPackage } from "./chief-package-policy.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "chief-package-policy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries({ "server/index.js": "", "ui/index.html": "Chief", "ui/chief-help.html": "Chief help", "licenses/OpenMausBot-LICENSE.txt": "Apache License", "licenses/OpenMausBot-NOTICE.txt": "Copyright" })) {
    mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text);
  }
  mkdirSync(join(root, "ui/assets"));
  return root;
}
test("standalone package retains legal notices", t => assert.equal(verifyChiefPackage(fixture(t)).notices, true));
for (const forbidden of ["server/enterprise", ".chief-local", ".env", "app-update.yml"]) {
  test(`rejects ${forbidden} even if all expected files exist`, t => {
    const root = fixture(t); writeFileSync(join(root, forbidden), "unexpected");
    assert.throws(() => verifyChiefPackage(root), /forbidden resource/);
  });
}
test("rejects workspace build accidentally used for agent installer", t => {
  const root = fixture(t); writeFileSync(join(root, "ui/assets/SharedWorkspacePage-fixture.js"), "");
  assert.throws(() => verifyChiefPackage(root), /workspace entry point/);
});
