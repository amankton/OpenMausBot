// Launch the actual packaged executable with no owner configuration or credentials.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  OMB_COMPANION_DIR: join(evidence, "companion"),
  HERMES_HOME: join(evidence, ".hermes"), OMB_TEST_SEALED_PATH: "1",
});
for (const key of ["APPDATA", "LOCALAPPDATA", "TEMP", "CHIEF_PROFILE_DIR", "OMB_DATA_DIR"]) mkdirSync(env[key], { recursive: true });
console.log(`Evidence: ${evidence}`);
let app;
const checks = [];
const enhancementSkills = ["executive-check-in", "execute-and-verify", "coordinate-and-review", "decision-brief", "scan-mail", "classify-and-prioritize", "prepare-reply", "reconcile-follow-ups"];
const setupEvidence = { providerCredentialsProvided: false, modelGenerationRequestedByVerifier: false, ownerCredentialsProvided: false };
try {
  app = await electron.launch({ executablePath, env, cwd: evidence, timeout: 90_000 });
  assert.equal(await app.evaluate(({ app }) => app.getPath("userData")), env.CHIEF_PROFILE_DIR);
  assert.equal(await app.evaluate(() => process.cwd()), evidence);
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
  // Exercise the real native companion bridge only inside this disposable profile.
  const pairing = await page.evaluate(async () => {
    await window.ogb.companion.start();
    return window.ogb.companion.pairing(true);
  });
  assert(pairing.pairing?.token, "Fixture companion did not offer pairing");
  const pairResponse = await fetch(`http://127.0.0.1:${pairing.port}/api/pair`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ credential: pairing.pairing.token, deviceName: "Chief Release Fixture Phone" }),
  });
  assert.equal(pairResponse.status, 201);
  const paired = await pairResponse.json();
  await page.getByRole("button", { name: "Computers", exact: true }).click();
  const phoneControl = page.getByRole("checkbox", { name: "Allow computer view for Chief Release Fixture Phone", exact: true });
  await phoneControl.waitFor({ timeout: 20_000 });
  assert.equal(await phoneControl.isChecked(), false);
  assert.equal(await phoneControl.evaluate(element => element.closest("details") === null), true);
  async function waitForGrant(allowed) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const granted = await page.evaluate(async id => (await window.ogb.companion.state()).devices.find(device => device.id === id)?.cloudDesktopAccess, paired.device.id);
      if (granted === allowed) return;
      await delay(100);
    }
    throw new Error("Packaged phone permission did not persist");
  }
  await phoneControl.click();
  await waitForGrant(true);
  await phoneControl.click();
  await waitForGrant(false);
  await page.screenshot({ path: join(evidence, "phone-control.png") });
  checks.push("visible native phone control grants and revokes through the real isolated companion");
  await page.evaluate(() => window.ogb.companion.stop());
  await app.close(); app = undefined;
  app = await electron.launch({ executablePath, env, cwd: evidence, timeout: 90_000 });
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
  // Layout acceptance uses only this disposable packaged workspace.
  await page.evaluate(async () => {
    for (const name of ["Spacing A", "Spacing B"]) {
      const response = await fetch("/api/sidebar-sections", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, botIds: [] }) });
      if (!response.ok) throw Error(`Fixture section failed: ${response.status}`);
    }
    localStorage.setItem("openmausbot.sidebarCollapsedSections.v1", JSON.stringify(["section:Spacing A", "section:Spacing B"]));
  });
  await page.reload();
  await page.locator('[data-sidebar-section-id="section:Spacing B"]').waitFor();
  const spacing = await page.evaluate(() => {
    const rect = selector => document.querySelector(selector).getBoundingClientRect();
    const a = rect('[data-sidebar-section-id="section:Spacing A"] [data-section]');
    const b = rect('[data-sidebar-section-id="section:Spacing B"] [data-section]');
    const nav = rect('[data-sidebar-nav="routines"] > span:last-child');
    const profile = rect('[data-glass-bar="bottom"] button[aria-haspopup="menu"] > span > span:last-of-type');
    const logo = rect('[aria-label="Chief Executive Suite"] .chief-wordmark');
    const search = document.querySelector('[aria-label="Search bots and messages"]').parentElement.getBoundingClientRect();
    return { topRow: rect('[data-sidebar-top-row]').height, collapsedPitch: b.top - a.top,
      gutter: parseFloat(getComputedStyle(document.querySelector('[data-sidebar] .glass-scroller')).paddingLeft),
      labelOffset: nav.x - profile.x, logoSearchGap: search.top - logo.bottom, navHeight: rect('[data-sidebar-nav="routines"]').height };
  });
  assert.deepEqual(spacing, { topRow: 32, collapsedPitch: 34, gutter: 12, labelOffset: 0, logoSearchGap: 16, navHeight: 36 });
  assert.equal(await page.locator('[data-sidebar]').getByRole('button', { name: /Switch server:/ }).count(), 0);
  await page.screenshot({ path: join(evidence, "sidebar-spacing.png") });
  assert.equal(await page.evaluate(() => localStorage.getItem('omb-advanced-mode')), '0');
  await page.getByRole('button', { name: 'Collapse sidebar to avatars', exact: true }).click();
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).waitFor();
  await page.waitForFunction(() => Math.round(document.querySelector('[data-sidebar]').getBoundingClientRect().width) === 80);
  assert.equal(await page.locator('[data-sidebar]').evaluate(element => element.getBoundingClientRect().width), 80);
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse sidebar to avatars', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: 'Collapse sidebar to avatars', exact: true }).waitFor();
  checks.push('Simple-mode sidebar collapse and expand work and remain available after reload');
  checks.push("Windows sidebar: 32px top row, 34px collapsed groups, 12px gutters, aligned footer labels and no duplicate server selector");
  await page.getByRole("button", {name:"Chief work",exact:true}).click();
  const beforeWorkState=await page.evaluate(async()=>fetch("/api/executive-work").then(r=>r.json()));
  assert(beforeWorkState.bots.length>0);
  await page.getByLabel("Preferred mail reviewer").selectOption(beforeWorkState.bots[0].id);
  await page.getByRole("button", {name:"Save settings",exact:true}).click();
  await page.getByText("Settings saved. No new routine or mailbox action was started.", {exact:true}).waitFor({timeout:20_000});
  const workState=await page.evaluate(async()=>fetch('/api/executive-work').then(r=>r.json()));
  assert.equal(workState.settings.scansEnabled,false);
  assert.equal(workState.settings.accounts.length,0);
  assert(workState.settings.preferredMailReviewerBotId);
  checks.push("packaged Chief work routes, saved reviewer and disabled unconfigured mail scans");
  await page.screenshot({path:join(evidence,"chief-work.png")});

  // These are the real packaged routes and renderer, with an empty HOME and
  // cwd outside the source checkout. No HTTP route or provider is stubbed.
  const resources = await app.evaluate(() => process.resourcesPath);
  const beforeSetup = await page.evaluate(async () => {
    const get = async path => { const response = await fetch(path); if (!response.ok) throw Error(`Fixture read failed: ${response.status}`); return response.json(); };
    const [bots, routines, work] = await Promise.all([get("/api/bots?messages=0"), get("/api/routines"), get("/api/executive-work")]);
    return { models: bots.bots.map(bot => ({ id: bot.id, modelSelection: bot.modelSelection })), routines: routines.routines, settings: work.settings };
  });
  assert.equal(beforeSetup.routines.length, 0);
  assert.equal(beforeSetup.settings.scansEnabled, false);
  assert.equal(beforeSetup.settings.checkInEnabled, false);
  assert.equal(beforeSetup.settings.notifications.enabled, false);
  assert.equal(beforeSetup.settings.routineBindings.length, 0);
  assert.equal(beforeSetup.settings.accounts.length, 0);
  const nativeSetup = page.getByRole("region", { name: "Agent enhancement setup", exact: true });
  // Wrapped select labels include their option text in Chromium's accessible
  // name. Anchor the meaningful role prefix and require a unique combobox.
  const chiefAgentSelect = nativeSetup.getByRole("combobox", { name: /^Chief agent/ });
  const reviewerAgentSelect = nativeSetup.getByRole("combobox", { name: /^Mail-review agent/ });
  await nativeSetup.getByRole("button", { name: "Review agent enhancement setup", exact: true }).click();
  await chiefAgentSelect.waitFor();
  assert.equal(await chiefAgentSelect.count(), 1);
  assert.equal(await reviewerAgentSelect.count(), 1);
  const setupCatalog = await page.evaluate(async () => { const response = await fetch("/api/chief-enhancement-setup"); return { status: response.status, body: await response.json() }; });
  assert.equal(setupCatalog.status, 200);
  assert.deepEqual(setupCatalog.body.bundle.skills.map(skill => skill.name), enhancementSkills);
  for (const skill of setupCatalog.body.bundle.skills) assert.equal(skill.content, readFileSync(join(resources, "skills", skill.name, "SKILL.md"), "utf8"), `Packaged catalog differs from its bundled ${skill.name}`);
  assert(setupCatalog.body.roster.length > 0);
  const setupBotId = setupCatalog.body.roster[0].id;
  assert.equal(await chiefAgentSelect.inputValue(), "");
  assert.equal(await reviewerAgentSelect.inputValue(), "");
  await chiefAgentSelect.selectOption(setupBotId);
  await reviewerAgentSelect.selectOption(setupBotId);
  const previewResponse = page.waitForResponse(response => response.url().endsWith("/api/chief-enhancement-setup/preview") && response.request().method() === "POST");
  await nativeSetup.getByRole("button", { name: "Preview selected agent changes", exact: true }).click();
  const firstPreview = (await (await previewResponse).json()).preview;
  assert.equal(firstPreview.targets.length, 1);
  assert.deepEqual(firstPreview.targets[0].roles, ["chief", "mail-reviewer"]);
  assert.equal(firstPreview.targets[0].skills.length, 8);
  assert.equal(firstPreview.conflicts.length, 0);
  assert.equal(firstPreview.missingRoles.length, 0);
  assert.equal(firstPreview.changesNeeded, true);
  const skillDocuments = nativeSetup.getByRole("region", { name: "All eight exact skill documents", exact: true });
  assert.equal(await skillDocuments.locator("details").count(), 8);
  for (let index = 0; index < enhancementSkills.length; index++) {
    const detail = skillDocuments.locator("details").nth(index);
    await detail.locator("summary").click();
    assert.equal(await detail.locator("pre").textContent(), setupCatalog.body.bundle.skills[index].content);
  }
  await nativeSetup.getByRole("heading", { name: "Review exact enhancement changes", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(evidence, "enhancement-review-desktop.png") });
  const originalViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  await page.setViewportSize({ width: 390, height: 844 });
  await nativeSetup.getByRole("heading", { name: "Review exact enhancement changes", exact: true }).scrollIntoViewIfNeeded();
  const setupLayout = await nativeSetup.evaluate(element => ({ width: element.getBoundingClientRect().width, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
  assert(setupLayout.width <= 390 && setupLayout.scrollWidth <= setupLayout.clientWidth + 1, "Enhancement review overflows at390px");
  await page.screenshot({ path: join(evidence, "enhancement-review-390px.png") });
  await page.setViewportSize(originalViewport);
  await nativeSetup.getByRole("button", { name: "Cancel enhancement review", exact: true }).click();
  const afterCancel = await page.evaluate(async id => { const response = await fetch("/api/chief-enhancement-setup/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chiefBotId: id, reviewerBotId: id }) }); return (await response.json()).preview; }, setupBotId);
  assert.equal(afterCancel.previewHash, firstPreview.previewHash);
  checks.push("packaged enhancement catalog loads all8 exact bundled skills outside checkout; same-agent selection, complete review,390px layout and cancellation preserve state");
  await nativeSetup.getByRole("button", { name: "Preview selected agent changes", exact: true }).click();
  await nativeSetup.getByRole("checkbox", { name: "I reviewed these exact agents, instructions, all eight skill documents and assignment changes.", exact: true }).check();
  const applyResponse = page.waitForResponse(response => response.url().endsWith("/api/chief-enhancement-setup/apply") && response.request().method() === "POST");
  await nativeSetup.getByRole("button", { name: "Apply reviewed enhancements", exact: true }).click();
  const appliedResponse = await applyResponse;
  assert.equal(appliedResponse.status(), 200);
  const appliedReceipt = (await appliedResponse.json()).receipt;
  assert.equal(appliedReceipt.state, "applied");
  await nativeSetup.getByText("Enhancements applied and independently read back for the selected existing agents. Mailbox setup, trust, schedules and notifications still require their separate choices.", { exact: true }).waitFor({ timeout: 30_000 });
  checks.push("packaged owner UI applies exact reviewed profiles/skills and separately verifies readback");

  // Plain Node fetch has no Electron owner capability. Neither reads nor
  // revocations may inherit trust merely from reaching the loopback port.
  const origin = new URL(page.url()).origin;
  assert.equal((await fetch(`${origin}/api/chief-enhancement-setup`)).status, 403);
  const trustPath = `/api/bots/${encodeURIComponent(setupBotId)}/connector-trust`;
  assert.equal((await fetch(`${origin}${trustPath}`)).status, 403);
  assert.equal((await fetch(`${origin}${trustPath}/revoke`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: 1 }) })).status, 403);
  const ownerTrust = await page.evaluate(async path => { const response = await fetch(path); return { status: response.status, body: await response.json() }; }, trustPath);
  assert.equal(ownerTrust.status, 200);
  assert.equal(ownerTrust.body.policy, null);
  assert.equal(ownerTrust.body.accounts.length, 0);
  assert(ownerTrust.body.operations.length > 0);
  const ownerRevoke = await page.evaluate(async path => { const response = await fetch(`${path}/revoke`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: 1 }) }); return { status: response.status }; }, trustPath);
  assert.equal(ownerRevoke.status, 409, "Owner revoke must reach missing-policy revision validation without provider credentials");
  checks.push("packaged setup/trust reads and revoke require desktop owner proof; owner trust reads work and revoke safely refuses an absent policy without provider access");

  await app.close(); app = undefined;
  app = await electron.launch({ executablePath, env, cwd: evidence, timeout: 90_000 });
  page = undefined;
  const setupRestartDeadline = Date.now() + 60_000;
  while (Date.now() < setupRestartDeadline) {
    page = app.windows().find(win => win.url().startsWith("http://127.0.0.1:"));
    if (page) break;
    await delay(250);
  }
  assert(page, "Packaged setup restart never opened its local UI");
  await page.getByRole("button", { name: "Chief Release Fixture", exact: true }).waitFor({ timeout: 45_000 });
  const reviewedRequest = { chiefBotId: setupBotId, reviewerBotId: setupBotId, previewHash: firstPreview.previewHash, catalogFingerprint: firstPreview.catalogFingerprint, reviewed: true };
  const persisted = await page.evaluate(async request => {
    const get = async path => { const response = await fetch(path); if (!response.ok) throw Error(`Fixture read failed: ${response.status}`); return response.json(); };
    const retry = await fetch("/api/chief-enhancement-setup/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
    const replay = { status: retry.status, body: await retry.json() };
    const previewResponse = await fetch("/api/chief-enhancement-setup/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chiefBotId: request.chiefBotId, reviewerBotId: request.reviewerBotId }) });
    const current = await previewResponse.json();
    const [bots, routines, work] = await Promise.all([get("/api/bots?messages=0"), get("/api/routines"), get("/api/executive-work")]);
    return { replay, previewStatus: previewResponse.status, preview: current.preview, models: bots.bots.map(bot => ({ id: bot.id, modelSelection: bot.modelSelection })), routines: routines.routines, settings: work.settings };
  }, reviewedRequest);
  assert.equal(persisted.replay.status, 200);
  assert.deepEqual(persisted.replay.body.receipt, appliedReceipt);
  assert.equal(persisted.previewStatus, 200);
  assert.equal(persisted.preview.changesNeeded, false);
  assert.equal(persisted.preview.conflicts.length, 0);
  assert.equal(persisted.preview.missingRoles.length, 0);
  assert.equal(persisted.preview.targets[0].before.soul, firstPreview.targets[0].nextSoul);
  assert.equal(persisted.preview.targets[0].skills.length, 8);
  assert(persisted.preview.targets[0].skills.every(skill => skill.action === "keep"));
  assert.deepEqual(persisted.models, beforeSetup.models);
  assert.deepEqual(persisted.routines, beforeSetup.routines);
  assert.deepEqual(persisted.settings, beforeSetup.settings);
  for (const role of ["chief", "mail-reviewer"]) assert(persisted.preview.targets[0].before.soul.split(`<!-- chief-enhancement:1:${role}:`).length <= 2, "Retry duplicated an addendum");
  checks.push("full restart preserves exact setup and receipt; identical reviewed retry is idempotent; all existing models, manual settings, account scope, notifications and routine count remain unchanged");
  await page.getByRole("button", { name: "Chief work", exact: true }).click();
  await page.screenshot({ path: join(evidence, "enhancement-restarted.png") });
  Object.assign(setupEvidence, { bundledSkills: enhancementSkills.length, outsideCheckout: true, sameAgentBothRoles: true, layout390: setupLayout, applyReadbackVerified: true, restartAndIdempotentRetryVerified: true, modelSelectionsPreserved: true, manualDefaultsPreserved: true, ownerProofVerified: true, positiveMailboxGrantTested: false, positiveRevokeTested: false, noProviderReason: "The sealed fresh profile has no provider credentials or verified mailbox. Positive grants/revocation remain covered by separate route/store and synthetic UI fixtures." });
  writeFileSync(join(evidence, "receipt.json"), JSON.stringify({ passed: true, executablePath, checks, setupEvidence }, null, 2));
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
