import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { verifyChiefPackage } from "./chief-package-policy.mjs";
import { fileURLToPath } from "node:url";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "chief-package-policy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries({ "server/index.js": "chief-enhancement-setup.db connector-trust.db Mail body encoding is invalid or excessive", "ui/index.html": "Chief", "ui/chief-help.html": "Chief help", "licenses/OpenMausBot-LICENSE.txt": "Apache License", "licenses/OpenMausBot-NOTICE.txt": "Copyright", "licenses/parse5-LICENSE.txt": "MIT", "licenses/entities-LICENSE.txt": "BSD" })) {
    mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text);
  }
  mkdirSync(join(root, "ui/assets"));
  for (const name of ["HANDOFF.md", "SETUP.md", "CHIEF-ADDENDUM.md", "MAIL-ADDENDUM.md"]) {
    const path = join(root, "chief-install-handoff", name);
    mkdirSync(dirname(path), {recursive: true});
    writeFileSync(path, "Neutral install instructions");
  }
  for (const name of ["executive-check-in", "execute-and-verify", "coordinate-and-review", "decision-brief", "scan-mail", "classify-and-prioritize", "prepare-reply", "reconcile-follow-ups"]) {
    const file = `skills/${name}/SKILL.md`;
    mkdirSync(dirname(join(root, file)), {recursive: true});
    copyFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), join(root, file));
  }
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

test("rejects a missing or changed reviewed skill", t => {
  const root = fixture(t);
  const file = join(root, "skills/scan-mail/SKILL.md");
  writeFileSync(file, "different instructions");
  assert.throws(() => verifyChiefPackage(root), /changed the reviewed skill/);
  rmSync(file);
  assert.throws(() => verifyChiefPackage(root), /missing skills/);
});

test("rejects an older bundled server without the enhancement runtime", t => {
  const root = fixture(t);
  writeFileSync(join(root, "server/index.js"), "older server");
  assert.throws(() => verifyChiefPackage(root), /missing bundled runtime/);
});
