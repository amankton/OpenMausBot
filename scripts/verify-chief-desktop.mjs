// Launch the actual packaged executable with no owner configuration or credentials.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { _electron as electron } from "@playwright/test";

const executablePath = resolve(process.argv[2] || "release/win-unpacked/Chief Executive Suite.exe");
const evidence = mkdtempSync(join(tmpdir(), "chief-desktop-acceptance-"));
const env = {};
for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "SystemDrive"]) {
  if (process.env[key]) env[key] = process.env[key];
}
Object.assign(env, {
  HOME: evidence, USERPROFILE: evidence, APPDATA: join(evidence, "roaming"), LOCALAPPDATA: join(evidence, "local"),
  TEMP: join(evidence, "tmp"), TMP: join(evidence, "tmp"), PATH: join(process.env.SystemRoot || "C:\\Windows", "System32"),
  CHIEF_PROFILE_DIR: join(evidence, "profile"), OMB_DATA_DIR: join(evidence, "workspace"),
  HERMES_HOME: join(evidence, ".hermes"), OMB_TEST_SEALED_PATH: "1",
});
for (const key of ["APPDATA", "LOCALAPPDATA", "TEMP", "CHIEF_PROFILE_DIR", "OMB_DATA_DIR"]) mkdirSync(env[key], { recursive: true });
console.log(`Evidence: ${evidence}`);
let app;
const checks = [];
try {
  app = await electron.launch({ executablePath, env, timeout: 90_000 });
  assert.equal(await app.evaluate(({ app }) => app.getPath("userData")), env.CHIEF_PROFILE_DIR);
  checks.push("isolated packaged Electron profile");
  let page;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    page = app.windows().find(win => win.url().startsWith("http://127.0.0.1:"));
    if (page) break;
    await delay(250);
  }
  assert(page, "Packaged desktop never opened its local UI");
  page.on("response", async response => {
    if (response.url().endsWith("/api/config") && response.request().method() === "PUT") {
      console.log(`Profile/config write: HTTP ${response.status()}`);
      if (!response.ok()) console.log(await response.text());
    }
  });
  await page.getByLabel("Your name", { exact: true }).waitFor({ timeout: 60_000 });
  assert.match(await page.title(), /Chief/);
  const welcome = await page.locator("body").innerText();
  assert.doesNotMatch(welcome, /OpenMaus|MausBot|MAUS/);
  await page.screenshot({ path: join(evidence, "welcome.png") });
  checks.push("fresh onboarding loads with Chief branding");
  await page.getByLabel("Your name", { exact: true }).fill("Chief Release Fixture");
  await page.getByLabel("Email", { exact: true }).fill("chief-release@example.test");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByText("What your bots can do", { exact: true }).waitFor({ timeout: 20_000 });
  await page.getByRole("button", { name: "Skip tour", exact: true }).click();
  await page.getByRole("button", { name: "Chief Release Fixture", exact: true }).waitFor({ timeout: 30_000 });
  const state = await page.evaluate(async () => {
    const config = await fetch("/api/config").then(r => r.json());
    const edition = await fetch("/api/edition").then(r => r.json());
    return { profile: config.profile, edition };
  });
  assert.equal(state.profile.name, "Chief Release Fixture");
  assert.equal(state.edition.edition, "oss");
  assert.equal(await page.locator('[data-sidebar-nav="shared-workspace"]').count(), 0);
  checks.push("profile saved, OSS edition, standalone navigation");
  await page.getByRole("button", { name: "Chief Release Fixture", exact: true }).click();
  assert.doesNotMatch(await page.locator("body").innerText(), /OpenMaus|MausBot|Get the phone app/);
  await page.getByText("Settings", { exact: true }).click();
  await page.getByText("Replay welcome tour", { exact: true }).waitFor();
  assert.doesNotMatch(await page.locator("body").innerText(), /OpenMaus|MausBot/);
  await page.screenshot({ path: join(evidence, "settings.png") });
  checks.push("settings and profile menu have no upstream product offers");
  await app.close(); app = undefined;
  app = await electron.launch({ executablePath, env, timeout: 90_000 });
  const restartDeadline = Date.now() + 60_000;
  while (Date.now() < restartDeadline) {
    page = app.windows().find(win => win.url().startsWith("http://127.0.0.1:"));
    if (page) break;
    await delay(250);
  }
  assert(page);
  await page.getByRole("button", { name: "Chief Release Fixture", exact: true }).waitFor({ timeout: 45_000 });
  checks.push("profile and onboarding persist after full application restart");
  await page.screenshot({ path: join(evidence, "restarted.png") });
  writeFileSync(join(evidence, "receipt.json"), JSON.stringify({ passed: true, executablePath, checks }, null, 2));
  console.log(JSON.stringify({ passed: true, evidence, checks }));
} catch (error) {
  const snapshots = [];
  for (const page of app?.windows() || []) {
    snapshots.push({ url: page.url(), body: await page.locator("body").innerText().catch(() => "unavailable") });
  }
  writeFileSync(join(evidence, "failure.json"), JSON.stringify({ error: String(error), checks, snapshots }, null, 2));
  throw error;
} finally {
  await app?.close();
}
