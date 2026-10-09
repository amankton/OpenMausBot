// Full personal Chief UI, disposable home, synthetic files and repository fake engine only.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, type Browser } from "@playwright/test";
import { launchVerificationServer, type VerificationServer } from "./control-omb.ts";
import { fixtureApi, mountPreview, type MountedPreview } from "./testing/preview-fixture.ts";
import { removeTempDir } from "../server/testing/cleanup.ts";
import { parseMeetingReview, type MeetingReviewBundle } from "../shared/meeting-review.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const evidenceDir = join(root, "docs/verification/evidence");
const scratch = mkdtempSync(join(tmpdir(), "chief-meeting-import-"));
const promptsPath = join(scratch, "fake-prompts.jsonl");
const checkpoints: Array<{ stage: string; fakeEngineTurns: number }> = [];
const messageRequests: string[] = [];
const fakeTurns = (): unknown[] => existsSync(promptsPath) ? readFileSync(promptsPath, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as unknown) : [];
const existingDraft = "Existing synthetic draft — keep this first.";
const selectedText = "Reviewed synthetic follow-up: compare the two proposals ✅";
const reply = "Synthetic meeting import received after explicit Send.";
const now = new Date().toISOString();
const bundle: MeetingReviewBundle = {
  format: "chief.meeting-review", version: 1, exportedAt: now,
  source: { workspace: "synthetic-shared-workspace", meetingId: "synthetic-meeting", sessionId: "synthetic-session", revision: 1, title: "Synthetic meeting import acceptance", requestedAt: Date.now() - 5000 },
  review: { confirmed: true, reviewerPersonId: "synthetic-shared-member", reviewedAt: now },
  items: [
    { id: "selected", kind: "action", text: "Original selected draft", source: { segmentId: "s1", personId: "p1", speaker: "Synthetic member", startMs: 0, endMs: 1000, text: 'Compare proposals. <img src=x onerror="window.syntheticInjection=true"> 🌱' } },
    { id: "unselected", kind: "decision", text: "UNSELECTED ITEM MUST NOT TRANSFER", source: { segmentId: "s2", personId: "p2", speaker: "Synthetic colleague", startMs: 1200, endMs: 1800, text: "We decided to keep both options." } },
  ],
  transcript: [
    { id: "s1", personId: "p1", speaker: "Synthetic member", startMs: 0, endMs: 1000, text: 'Compare proposals. <img src=x onerror="window.syntheticInjection=true"> 🌱' },
    { id: "s2", personId: "p2", speaker: "Synthetic colleague", startMs: 1200, endMs: 1800, text: "We decided to keep both options." },
    { id: "s3", personId: "p2", speaker: "Synthetic colleague", startMs: 1900, endMs: 2400, text: "TRANSCRIPT ONLY MUST NOT TRANSFER" },
  ],
};
parseMeetingReview(JSON.stringify(bundle));
const bundleFile = { name: "synthetic-reviewed-meeting.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(bundle)) };
const checks: string[] = [];
let fixture: VerificationServer | undefined;
let ui: MountedPreview | undefined;
let browser: Browser | undefined;
let screenshotPath: string | undefined;
let fixtureUrl: string | undefined;
let serverLog: string | undefined;
let pendingError: unknown;
let captureExport: { status: "not-available" | "verified"; sha256?: string; sessionId?: string } = { status: "not-available" };
let actualBundle: MeetingReviewBundle | undefined;
let actualBundleBytes: Buffer | undefined;

function noTurn(stage: string) {
  const count = fakeTurns().length;
  checkpoints.push({ stage, fakeEngineTurns: count });
  expect(count, `No fake-engine conversation turn before Send: ${stage}`).toBe(0);
  expect(messageRequests, `No message API mutation before Send: ${stage}`).toEqual([]);
  expect(fixture && existsSync(fixture.fixtureDumpPath)).toBe(false);
}
try {
  const actualPath = join(root, ".chief-local/capture-reviewed-fixture.json");
  if (existsSync(actualPath)) {
    actualBundleBytes = readFileSync(actualPath);
    actualBundle = parseMeetingReview(actualBundleBytes.toString("utf8"));
    const receipt = JSON.parse(readFileSync(join(evidenceDir, "chief-platform-capture.json"), "utf8"));
    const sha256 = createHash("sha256").update(actualBundleBytes).digest("hex");
    expect(receipt.passed).toBe(true); expect(receipt.syntheticOnly).toBe(true);
    expect(receipt.exportedFixtureSha256).toBe(sha256);
    expect(actualBundle.source.workspace).toBe("b3ece3dc-e200-41c7-a9d8-2cb86c8c9fdb");
    expect(actualBundle.items.length).toBeGreaterThan(0);
    captureExport = { status: "verified", sha256, sessionId: actualBundle.source.sessionId };
  } else if (process.argv.includes("--require-capture-export")) {
    throw Error("The successful shared capture gate must produce its reviewed fixture before this acceptance run.");
  }
  // No inherited FAKE_* recipes or real provider configuration can change this run.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ["SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "TZ"].includes(key.toUpperCase())));
  fixture = await launchVerificationServer({ ...env, FAKE_CLAUDE_MODE: "happy", FAKE_CLAUDE_PROMPTS: promptsPath, FAKE_CLAUDE_REPLIES: JSON.stringify([reply]) });
  fixtureUrl = fixture.info.url; serverLog = fixture.info.logPath;
  const api = fixtureApi(fixture.info.url, { headers: { origin: fixture.info.url } });
  await api("PUT", "/api/config", { language: "en", onboarding: { completedAt: now, version: 1, reelSeen: true, hintsSeen: [] }, profile: { name: "Synthetic importer", email: "fixture@example.test" } });
  const { bots } = await api("GET", "/api/bots?messages=0") as { bots: Array<{ id: string; name: string; threadId: string }> };
  expect(bots).toHaveLength(1);
  const bot = bots[0];
  ui = await mountPreview(fixture, { entry: "/scripts/testing/threads-preview.tsx", route: "/__chief-meeting-import.html", title: "Synthetic Chief meeting import", logLevel: "error" });
  const origin = new URL(ui.previewUrl).origin;
  browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--disable-background-networking"] });
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort("blockedbyclient"));
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET" && /^\/api\/(?:bots|groups)\/[^/]+\/messages(?:\/|$)/.test(path)) messageRequests.push(path);
  });
  await page.goto(ui.previewUrl);
  const composer = page.getByRole("textbox", { name: `Message ${bot.name}`, exact: true });
  await expect(composer).toBeVisible({ timeout: 45000 });
  await composer.fill(existingDraft);
  const attach = page.locator('[data-tour="composer"] input[type="file"][multiple]');
  await attach.setInputFiles({ name: "synthetic-existing-note.txt", mimeType: "text/plain", buffer: Buffer.from("Existing synthetic attachment retained through review.") });
  const attachment = page.getByText("synthetic-existing-note.txt", { exact: true });
  await expect(attachment).toBeVisible();
  noTurn("initial draft and attachment");
  const importButton = page.getByRole("button", { name: "Import reviewed meeting notes", exact: true });
  async function selectBundle(file = bundleFile) {
    const chooser = page.waitForEvent("filechooser");
    await importButton.click(); await (await chooser).setFiles(file);
  }
  await selectBundle({ ...bundleFile, buffer: Buffer.from(JSON.stringify({ ...bundle, version: 2 })) });
  await expect(page.getByRole("alert")).toContainText("version 1");
  await expect(composer).toHaveValue(existingDraft); noTurn("invalid file rejected");

  await selectBundle();
  const dialog = page.getByRole("dialog", { name: `Review meeting notes for ${bot.name}`, exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("checkbox")).toHaveCount(4);
  for (const box of await dialog.getByRole("checkbox").all()) await expect(box).not.toBeChecked();
  await expect(dialog.locator("img")).toHaveCount(0);
  expect(await page.evaluate(() => "syntheticInjection" in window)).toBe(false);
  await expect(dialog.getByRole("button", { name: "Add reviewed notes to draft", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(composer).toHaveValue(existingDraft); await expect(attachment).toBeVisible();
  noTurn("cancelled second review"); checks.push("Malformed version rejected; cancel preserves existing draft and attachment; source markup renders as text");

  await selectBundle();
  await dialog.getByRole("checkbox", { name: "Include this item", exact: true }).first().check();
  const confirm = dialog.getByRole("checkbox", { name: "I reviewed the selected material and want to add it to this agent’s draft.", exact: true });
  await confirm.check();
  await dialog.getByRole("textbox", { name: "Text for your draft", exact: true }).first().fill(selectedText);
  await expect(confirm).not.toBeChecked();
  await expect(dialog.getByRole("button", { name: "Add reviewed notes to draft", exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(dialog).toBeVisible();
  mkdirSync(evidenceDir, { recursive: true });
  await page.screenshot({ path: join(evidenceDir, "chief-meeting-import-review-mobile.png") });
  await page.setViewportSize({ width: 1360, height: 1000 });
  await confirm.check(); noTurn("reviewed and edited, before adding to draft");
  await dialog.getByRole("button", { name: "Add reviewed notes to draft", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const draft = await composer.inputValue();
  expect(draft.startsWith(existingDraft + "\n\n")).toBe(true);
  expect(draft).toContain(selectedText); expect(draft).toContain("synthetic-session");
  expect(draft).not.toContain("UNSELECTED ITEM MUST NOT TRANSFER");
  expect(draft).not.toContain("TRANSCRIPT ONLY MUST NOT TRANSFER"); expect(draft).not.toContain('"transcript"');
  await expect(attachment).toBeVisible(); noTurn("appended unsent draft");
  screenshotPath = join(evidenceDir, "chief-meeting-import-unsent.png");
  await page.screenshot({ path: screenshotPath });
  // Reload proves normal draft persistence rather than component-local preview state.
  await page.reload(); await expect(composer).toHaveValue(draft, { timeout: 30000 }); await expect(attachment).toBeVisible();
  noTurn("reload retains unsent draft and attachment");
  checks.push("Second review starts unchecked; edits revoke confirmation; mobile layout; only selected material appends and survives reload without a fake-engine turn");

  if (actualBundle !== undefined && actualBundleBytes !== undefined) {
    await selectBundle({ name: "capture-reviewed-fixture.json", mimeType: "application/json", buffer: actualBundleBytes });
    await expect(dialog).toBeVisible();
    for (const box of await dialog.getByRole("checkbox").all()) await expect(box).not.toBeChecked();
    await dialog.getByRole("checkbox", { name: "Include this item", exact: true }).first().check();
    await confirm.check(); noTurn("actual shared capture export independently reviewed");
    await dialog.getByRole("button", { name: "Add reviewed notes to draft", exact: true }).click();
    const combined = await composer.inputValue();
    expect(combined.startsWith(draft + "\n\n")).toBe(true);
    const appended = combined.slice(draft.length + 2);
    const material = JSON.parse(appended.slice(appended.indexOf("{\n")));
    expect(material.source).toEqual(actualBundle.source);
    expect(material.items).toEqual([actualBundle.items[0]]);
    expect(material.transcript).toBeUndefined();
    await expect(attachment).toBeVisible(); noTurn("actual shared export appended unsent");
    await page.reload(); await expect(composer).toHaveValue(combined, { timeout: 30000 });
    await expect(attachment).toBeVisible(); noTurn("actual shared export persists without sending");
    await page.screenshot({ path: join(evidenceDir, "chief-meeting-import-actual-export-unsent.png") });
    checks.push("Actual reviewed JSON from successful synthetic shared capture gate matches its receipt hash, passes independent personal review, and appends only selected source-attributed material without sending");
  }

  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => fakeTurns().length, { timeout: 30000 }).toBe(1);
  const capturedPrompt = fakeTurns()[0];
  const prompt = typeof capturedPrompt === "string" ? capturedPrompt : JSON.stringify(capturedPrompt);
  expect(prompt).toContain(existingDraft); expect(prompt).toContain(selectedText); expect(prompt).toContain("synthetic-existing-note.txt");
  expect(prompt).not.toContain("UNSELECTED ITEM MUST NOT TRANSFER"); expect(prompt).not.toContain("TRANSCRIPT ONLY MUST NOT TRANSFER");
  if (actualBundle !== undefined) expect(prompt).toContain(actualBundle.source.sessionId);
  await expect(page.getByRole("log", { name: `Conversation with ${bot.name}`, exact: true })).toContainText(reply, { timeout: 30000 });
  expect(fakeTurns()).toHaveLength(1); checkpoints.push({ stage: "after explicit Send", fakeEngineTurns: 1 });
  expect(messageRequests).toEqual([`/api/bots/${bot.id}/messages`]);
  await expect(composer).toHaveValue("");
  expect(pageErrors).toEqual([]);
  checks.push("Explicit Send alone reaches repository fake engine once, with preserved draft and attachment, and real chat displays its synthetic reply");
} catch (error) { pendingError = error; }
finally {
  for (const cleanup of [() => browser?.close(), () => ui?.close(), () => fixture?.close(), () => removeTempDir(scratch)]) {
    try { await cleanup(); } catch (error) { pendingError ??= error; }
  }
}
mkdirSync(evidenceDir, { recursive: true });
const evidence = { verifiedAt: new Date().toISOString(), status: pendingError ? "failed" : "passed", scope: "Real personal Chief App/Composer import with isolated fake-engine server; synthetic edge-case bundle plus actual synthetic capture export when verified below", captureExport, fixtureUrl, serverLog, checks, checkpoints, screenshotPath,
  ownerProfileUsed: false, externalProviderUsed: false, messageRequests, ...(pendingError ? { error: pendingError instanceof Error ? pendingError.message : String(pendingError) } : {}) };
writeFileSync(join(evidenceDir, "chief-meeting-import.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
if (pendingError) throw pendingError;
