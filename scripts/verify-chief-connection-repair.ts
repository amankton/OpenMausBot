import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "@playwright/test";
import { launchVerificationServer, runControlOmb } from "./control-omb.ts";
import { fixtureApi, mountPreview, type MountedPreview } from "./testing/preview-fixture.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const evidenceDir = join(root, "work/chief-connection-repair-20261017");
mkdirSync(evidenceDir, { recursive: true });
const fixture = await launchVerificationServer();
let ui: MountedPreview | undefined;
let browser: Browser | undefined;
const evidence: Record<string, any> = { fixture: fixture.info, startedAt: new Date().toISOString(), model: "deterministic fixture provider; real approved file write" };
evidence.sourceHashes = Object.fromEntries(["server/index.ts", "server/control-client.ts", "shared/computer-control-timing.ts", "scripts/testing/connection-journey-cli.ts"].map(file => [file, createHash("sha256").update(readFileSync(join(root, file))).digest("hex")]));
try {
  const api = fixtureApi(fixture.info.url);
  await api("PATCH", "/api/instances/claude", { cli: join(root, "scripts/testing/connection-journey-cli.ts") });
  await api("PATCH", "/api/config", { features: { showToolCalls: true }, language: "en" });
  const { bot } = await api("POST", "/api/bots", { name: "Connection Journey", computer: "off" });
  await api("PATCH", `/api/bots/${bot.id}/tasks/${bot.threadId}`, { approvalMode: "ask" });
  ui = await mountPreview(fixture, { entry: "/scripts/testing/threads-preview.tsx", route: "/__connection-journey.html", title: "Isolated CHIEF connection repair acceptance" });
  evidence.previewUrl = ui.previewUrl;
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const capture = async (name: string) => {
    try { await page.screenshot({ path: join(evidenceDir, name), fullPage: true, animations: "disabled", timeout: 10_000 }); }
    catch (error) { (evidence.visualCaptureErrors ??= []).push({ name, error: String(error) }); }
  };
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const pendingRequests = new Set<string>();
  page.on("request", request => pendingRequests.add(new URL(request.url()).pathname));
  page.on("requestfinished", request => pendingRequests.delete(new URL(request.url()).pathname));
  page.on("requestfailed", request => pendingRequests.delete(new URL(request.url()).pathname));
  page.setDefaultTimeout(60_000);
  await page.goto(ui.previewUrl, { waitUntil: "commit" });
  const loading = setTimeout(() => console.log(JSON.stringify({ uiPendingRequests: [...pendingRequests] })), 20_000);
  try { await page.getByRole("button", { name: /Connection Journey/ }).first().waitFor({ timeout: 120_000 }); }
  finally { clearTimeout(loading); }
  await page.getByRole("button", { name: /Connection Journey/ }).first().click();
  const composer = page.getByRole("textbox", { name: /Connection Journey/ });
  await composer.fill("Create a short local report after I approve the write, then give me its download link.");
  await composer.press("Enter");
  await page.getByRole("button", { name: "Allow once", exact: true }).waitFor();
  await capture("journey-approval-desktop.png");
  const openMessages = (await api("GET", `/api/threads/${bot.threadId}/messages?limit=100`)).messages;
  const pending = openMessages.find((message: any) => message.card?.requestId && !message.card.answered);
  assert(pending, "real approval card must exist before the write");
  const file = join(fixture.info.dataDir, "task-workspaces", bot.id, bot.threadId, "journey-result.md");
  assert.equal(existsSync(file), false, "approval must precede file creation");
  await page.getByRole("button", { name: "Allow once", exact: true }).click();
  evidence.wait = await runControlOmb(["wait", "--bot", bot.id, "--timeout", "30", "--url", fixture.info.url]);
  assert.equal(evidence.wait.status, "settled");
  await page.getByRole("button", { name: "Open report", exact: true }).waitFor();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Open report", exact: true }).click();
  const download = await downloadEvent;
  const downloaded = join(evidenceDir, "journey-result.md");
  await download.saveAs(downloaded);
  assert.equal(readFileSync(downloaded, "utf8"), readFileSync(file, "utf8"));
  evidence.artifact = { name: download.suggestedFilename(), bytes: readFileSync(downloaded).length, sha256: createHash("sha256").update(readFileSync(downloaded)).digest("hex"), retainedAt: downloaded };
  evidence.transcript = await runControlOmb(["messages", "--bot", bot.id, "--limit", "20", "--url", fixture.info.url]);
  await capture("journey-completed-desktop.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open report", exact: true }).waitFor();
  const mobileDownloadEvent = page.waitForEvent("download", { timeout: 10_000 });
  await page.getByRole("button", { name: "Open report", exact: true }).click();
  const mobileDownload = await mobileDownloadEvent;
  const mobilePath = await mobileDownload.path();
  assert(mobilePath);
  assert.equal(readFileSync(mobilePath, "utf8"), readFileSync(downloaded, "utf8"));
  await capture("journey-completed-mobile-web.png");
  evidence.mobileWeb = { width: 390, artifactControlClickable: true, downloadVerified: true, nativeMobile: "unverified" };
  await page.setViewportSize({ width: 1440, height: 1000 });
  const denial = (await api("POST", "/api/bots", { name: "Denial Journey", computer: "off" })).bot;
  await api("PATCH", `/api/bots/${denial.id}/tasks/${denial.threadId}`, { approvalMode: "ask" });
  await page.locator(`[data-sidebar-bot-row="${denial.id}"]`).click();
  const denyComposer = page.getByRole("textbox", { name: /Denial Journey/ });
  await denyComposer.fill("Request permission to write the report; respect my answer.");
  await denyComposer.press("Enter");
  await page.getByRole("button", { name: "Deny", exact: true }).click();
  const deniedWait: any = await runControlOmb(["wait", "--bot", denial.id, "--timeout", "30", "--url", fixture.info.url]);
  assert.equal(deniedWait.status, "settled");
  assert.equal(existsSync(join(fixture.info.dataDir, "task-workspaces", denial.id, denial.threadId, "journey-result.md")), false);
  const deniedMessages = (await api("GET", `/api/threads/${denial.threadId}/messages?limit=100`)).messages;
  assert(deniedMessages.some((message: any) => message.card?.answered === "deny"));
  evidence.explicitRejection = { settled: true, fileWritten: false, cardAnswer: "deny" };
  evidence.pageErrors = errors;
  assert.equal(errors.length, 0);
  evidence.passed = true;
} catch (error) {
  evidence.passed = false;
  evidence.error = error instanceof Error ? error.message : String(error);
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) {
    writeFileSync(join(evidenceDir, "journey-failure-dom.txt"), await page.locator("body").innerText());
    await page.screenshot({ path: join(evidenceDir, "journey-failure.png"), fullPage: true, animations: "disabled", timeout: 10_000 }).catch(() => {});
  }
  throw error;
} finally {
  evidence.finishedAt = new Date().toISOString();
  writeFileSync(join(evidenceDir, "journey.json"), JSON.stringify(evidence, null, 2));
  await browser?.close();
  await ui?.close();
  await fixture.close();
  console.log(JSON.stringify({ passed: evidence.passed, evidence: join(evidenceDir, "journey.json") }));
}
