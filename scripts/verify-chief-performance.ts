import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { launchVerificationServer, runControlOmb } from "./control-omb.ts";
import { fixtureApi, mountPreview } from "./testing/preview-fixture.ts";
import { removeTempDir } from "../server/testing/cleanup.ts";
import { serveChiefUi } from "./chief-ui-server.ts";
import { assertChiefUiBuild } from "./chief-ui-build.ts";

// Only synthetic data and the repository fake engine; no live provider or app.
const scratch = mkdtempSync(join(tmpdir(), "chief-performance-"));
const production = process.argv.includes("--production");
const root = fileURLToPath(new URL("../", import.meta.url));
const uiBuild = production ? assertChiefUiBuild(root) : undefined;
const gate = join(scratch, "finish");
const fixture = await launchVerificationServer({ ...process.env,
  FAKE_CLAUDE_MODE: "background-result", FAKE_CLAUDE_FINISH_GATE: gate,
  FAKE_CLAUDE_TOOL_CALLS: "[]",
});
let preview: { previewUrl: string; close(): Promise<void> } | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let releaseInstances = () => {};
try {
  const api = fixtureApi(fixture.info.url);
  await api("PATCH", "/api/config", { language: "en" });
  const created = await runControlOmb(["new-bot", "--name", "Pepper", "--url", fixture.info.url]) as { bot: { id: string } };
  if (production) {
    const ui = await serveChiefUi({ root, target: fixture.info.url, port: 0 });
    preview = { previewUrl: ui.url, close: ui.close };
  } else {
    preview = await mountPreview(fixture, {
      entry: "/scripts/testing/threads-preview.tsx", route: "/__performance.html", title: "Isolated Chief performance", logLevel: "error",
    });
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  await page.addInitScript(() => {
    localStorage.setItem("chief-analytics-opt-out", "1");
    localStorage.setItem("chief-email-gate", "skipped");
  });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  let instancesPending = false;
  const held = new Promise<void>(resolve => { releaseInstances = resolve; });
  await page.route("**/api/instances", async route => {
    instancesPending = true;
    await held;
    await route.continue().catch(() => {});
  });
  await page.goto(preview.previewUrl, { waitUntil: "domcontentloaded" });
  const composer = page.getByRole("textbox", { name: "Message Pepper", exact: true });
  await expect(composer).toBeVisible({ timeout: 45_000 });
  const navigationTimings = [await page.evaluate(() => ({
    composerReadyMs: Math.round(performance.now()),
    documentResponseMs: Math.round((performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming).responseEnd),
    resources: performance.getEntriesByType("resource").length,
    sourceModuleRequests: performance.getEntriesByType("resource").filter(entry => new URL(entry.name).pathname.startsWith("/src/")).length,
  }))];
  expect(instancesPending).toBe(true);
  releaseInstances();
  await expect(composer).toBeEnabled();
  await composer.fill("Performance fixture");
  await composer.press("Enter");
  const partial = page.locator("[data-partial-reply]");
  await expect(partial).toHaveText("parent still working", { timeout: 30_000 });
  const snapshot = await api("GET", "/api/bots?messages=200");
  const bot = snapshot.bots.find((candidate: { id: string }) => candidate.id === created.bot.id);
  expect(bot.busy).toBe(true);
  expect(JSON.stringify(bot.messages)).not.toContain("parent still working");
  const evidenceDir = fileURLToPath(new URL("../docs/verification/evidence/", import.meta.url));
  mkdirSync(evidenceDir, { recursive: true });
  const evidenceName = production ? "chief-performance-production" : "chief-performance";
  await page.screenshot({ path: join(evidenceDir, `${evidenceName}-streaming.png`) });
  writeFileSync(gate, "finish");
  await expect(partial).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(async () => {
    const next = await api("GET", "/api/bots?messages=200");
    return next.bots.find((candidate: { id: string }) => candidate.id === created.bot.id)?.busy;
  }, { timeout: 15_000 }).toBe(false);
  const transcript = page.getByRole("log", { name: "Conversation with Pepper" });
  await expect(transcript.getByText("hello from fake claude", { exact: true })).toHaveCount(1);
  if (production) {
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(composer).toBeVisible({ timeout: 15_000 });
      navigationTimings.push(await page.evaluate(() => ({
        composerReadyMs: Math.round(performance.now()),
        documentResponseMs: Math.round((performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming).responseEnd),
        resources: performance.getEntriesByType("resource").length,
        sourceModuleRequests: performance.getEntriesByType("resource").filter(entry => new URL(entry.name).pathname.startsWith("/src/")).length,
      })));
    }
    expect(navigationTimings.every(timing => timing.sourceModuleRequests === 0)).toBe(true);
  }
  expect(errors).toEqual([]);
  const evidence = {
    verifiedAt: new Date().toISOString(), fixtureUrl: fixture.info.url, logPath: fixture.info.logPath,
    uiMode: production ? "production" : "development", uiBuild, navigationTimings,
    chatVisibleWhileInstancesPending: true, partialVisibleWhileBusy: true,
    partialAbsentFromPersistence: true, partialClearedOnCompletion: true,
    finalReplyCount: 1, pageErrors: errors,
  };
  writeFileSync(join(evidenceDir, `${evidenceName}.json`), JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  releaseInstances();
  await browser?.close();
  await preview?.close();
  await fixture.close();
  // The directory was created by this process, contains only the synthetic gate.
  removeTempDir(scratch);
}
