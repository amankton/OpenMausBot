// Real App, shared control surface and temporary fake-engine data only.
import { Writable } from "node:stream";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { runControlOmb } from "./control-omb.ts";
import { launchUi } from "./testing/control-omb-ui.ts";
import { fixtureApi } from "./testing/preview-fixture.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const evidenceDir = resolve(root, "docs/verification/evidence/executive-work");
const attemptId = new Date().toISOString();
mkdirSync(evidenceDir, { recursive: true });
const env = { ...process.env };
// Reuse installed binaries when available, with the launcher's disposable HOME.
// No installed app, saved login, provider key or user browser profile is opened.
const installedBrowser = process.platform === "win32" && env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Programs/chief-executive-suite/resources/browser-engine") : null;
if (installedBrowser) {
  const binary = join(installedBrowser, "agent-browser.exe");
  const chrome = join(installedBrowser, "chrome/chrome-headless-shell-win64/chrome-headless-shell.exe");
  if (!env.OMB_AGENT_BROWSER_PATH && existsSync(binary)) env.OMB_AGENT_BROWSER_PATH = binary;
  if (!env.AGENT_BROWSER_EXECUTABLE_PATH && existsSync(chrome)) env.AGENT_BROWSER_EXECUTABLE_PATH = chrome;
}

let output = "";
let diagnostics = "";
let launchError: unknown;
let cleanupIncomplete: string | undefined;
let info: { ui: string; url: string; previewUrl: string; botId: string; dataDir: string; logPath: string } | undefined;
const commands: Array<{ command: string; operation?: string; name?: string; width?: string; height?: string }> = [];
const launch = launchUi([], env, {
  stdout: new Writable({ write(chunk, _encoding, done) { output += String(chunk); done(); } }),
  stderr: new Writable({ write(chunk, _encoding, done) { diagnostics += String(chunk); done(); } }),
}).catch(error => { launchError = error; });

try {
  await expect.poll(() => {
    if (launchError) throw launchError;
    try { info = JSON.parse(output); return Boolean(info?.ui); } catch { return false; }
  }, { timeout: 180_000, intervals: [100, 250, 500] }).toBe(true);
  const fixture = info!;
  const ui = async (verb: string, ...args: string[]) => {
    commands.push({ command: `ui ${verb}`, ...(args.includes("--name") ? { name: args[args.indexOf("--name") + 1] } : {}), ...(verb === "viewport" ? { width: args[1], height: args[3] } : {}) });
    return runControlOmb(["ui", verb, "--ui", fixture.ui, ...args]) as Promise<Record<string, any>>;
  };
  const evaluate = async (js: string) => (await ui("eval", "--js", js)).result;
  const snapshot = async () => String((await ui("snapshot")).snapshot);
  const work = async (operation: string, body?: unknown, id?: string) => {
    commands.push({ command: "executive-work", operation });
    return runControlOmb(["executive-work", "--operation", operation, "--url", fixture.url, ...(body ? ["--json", JSON.stringify(body)] : []), ...(id ? ["--id", id] : [])]) as Promise<Record<string, any>>;
  };
  const api = fixtureApi(fixture.url);
  const routinesBefore = await api("GET", "/api/routines");
  const { bots } = await api("GET", "/api/bots?messages=0");
  const bot = bots.find((candidate: { id: string }) => candidate.id === fixture.botId);
  expect(bot?.threadId).toEqual(expect.any(String));
  await ui("viewport", "--width", "1440", "--height", "1000");
  await expect(ui("viewport", "--width", "239", "--height", "844")).rejects.toThrow("between 240 and 4096");
  await ui("click", "--name", "Chief work");
  await expect.poll(snapshot, { timeout: 15_000 }).toContain("Chief work and email review");
  await expect.poll(snapshot).toContain("No supported mailbox connection is available");
  expect(await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Scan mail now')?.disabled")).toBe(true);
  const initial = await work("read");
  expect(initial.settings.scansEnabled).toBe(false);
  expect(initial.settings.notifications.enabled).toBe(false);

  await evaluate(`(() => {const select=[...document.querySelectorAll('label')].find(label=>label.textContent.startsWith('Preferred mail reviewer'))?.querySelector('select');if(!select)throw Error('Reviewer preference missing');select.value=${JSON.stringify(bot.id)};select.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);

  await evaluate(`(() => {
    const input = [...document.querySelectorAll('label')].find(label=>label.textContent.startsWith('Suggested cadence'))?.querySelector('input');
    if (!input) throw Error('Cadence input missing');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Weekday mornings — proposed only');
    input.dispatchEvent(new Event('input',{bubbles:true})); return true;
  })()`);
  await ui("click", "--name", "Save settings");
  await expect.poll(snapshot).toContain("Settings saved. No new routine or mailbox action was started.");
  const saved = await work("read");
  expect(saved.settings.revision).toBe(initial.settings.revision + 1);
  expect(saved.settings.cadenceProposal).toBe("Weekday mornings — proposed only");
  expect(saved.settings.preferredMailReviewerBotId).toBe(bot.id);
  expect(saved.settings.routineBindings).toEqual([]);
  expect(await api("GET", "/api/routines")).toEqual(routinesBefore);

  const created = await work("create", {
    item: { accountScope: `local:${bot.id}`, source: { kind: "fixture", id: "synthetic-meeting-brief", version: "v2", botId: bot.id, threadId: bot.threadId }, ownerBotId: bot.id, coordinatorBotId: bot.id, sourceThreadId: bot.threadId,
      title: "Synthetic meeting preparation", desiredOutcome: "Prepare the synthetic meeting brief", nextAction: "Review the synthetic artifact", status: "ready-for-review", executionStatus: "succeeded", priority: 2,
      deadline: { value: "2026-11-06", timezone: "America/Los_Angeles", precision: "date", provenance: "Synthetic request gives a date without a time" } },
    mutation: { eventId: "fixture-work-created" },
  });
  expect(created.item.status).toBe("ready-for-review");
  await ui("click", "--name", "Refresh");
  await expect.poll(snapshot).toContain("Synthetic meeting preparation");
  expect(await evaluate("document.body.textContent.includes('2026-11-06 · America/Los_Angeles · date precision')")).toBe(true);
  await ui("screenshot", "--out", join(evidenceDir, "queue-desktop.png"));
  // Native DisclosureTriangle nodes are not included in this browser's refs.
  await evaluate("[...document.querySelectorAll('summary')].find(summary=>summary.textContent.trim()==='Review this item').click(); true");
  await evaluate(`(() => {
    const select=[...document.querySelectorAll('label')].find(label=>label.textContent.startsWith('Work status'))?.querySelector('select');
    if(!select)throw Error('Work status missing');select.value='done';select.dispatchEvent(new Event('change',{bubbles:true}));return true;
  })()`);
  expect(await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Record decision')?.disabled")).toBe(true);
  await ui("type", "--name", "Decision reason", "--text", "Owner confirms the synthetic brief is ready");
  await ui("click", "--name", "Record decision");
  await expect.poll(async () => (await work("read")).items.find((item: { id: string }) => item.id === created.item.id)?.status).toBe("done");
  const resolved = (await work("read")).items.find((item: { id: string }) => item.id === created.item.id);
  expect(resolved.completion).toMatchObject({ kind: "user-confirmed", sourceVersion: "v2", reason: "Owner confirms the synthetic brief is ready" });

  // Reload the real App and re-enter the panel to establish saved persistence.
  await evaluate("location.reload(); true");
  await ui("click", "--name", "Chief work");
  await expect.poll(snapshot).toContain("Sources and settings");
  expect(await evaluate("[...document.querySelectorAll('label')].find(label=>label.textContent.startsWith('Suggested cadence'))?.querySelector('input')?.value")).toBe("Weekday mornings — proposed only");
  expect(await evaluate("[...document.querySelectorAll('label')].find(label=>label.textContent.startsWith('Preferred mail reviewer'))?.querySelector('select')?.value")).toBe(bot.id);
  await ui("screenshot", "--out", join(evidenceDir, "desktop.png"));
  await ui("viewport", "--width", "390", "--height", "844");
  await expect.poll(async () => evaluate("window.innerWidth")).toBe(390);
  expect(await evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(true);
  expect(await evaluate("(() => {const panel=document.querySelector('h2').closest('section'); return getComputedStyle(panel).overflowY==='auto' && panel.scrollHeight>panel.clientHeight;})()")).toBe(true);
  expect(await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Scan mail now')?.disabled")).toBe(true);
  await evaluate("document.querySelector('h2').closest('section').scrollTop=0; true");
  await ui("screenshot", "--out", join(evidenceDir, "mobile.png"));
  await evaluate("[...document.querySelectorAll('h3')].find(heading=>heading.textContent==='Sources and settings').scrollIntoView(); true");
  await ui("screenshot", "--out", join(evidenceDir, "mobile-setup.png"));
  const consoleState = await ui("console");
  expect(await api("GET", "/api/routines")).toEqual(routinesBefore);
  const receipt = { passed: true, attemptId, syntheticOnly: true, realApp: true, fixtureUrl: fixture.url, previewUrl: fixture.previewUrl, dataDir: fixture.dataDir, serverLog: fixture.logPath,
    checks: ["real Chief work navigation", "unavailable mailbox scan disabled", "settings revision and preferred reviewer save and reload", "proposed cadence creates no routine", "canonical queue create and owner-confirmed completion", "date-only deadline preserved", "390px viewport without horizontal overflow and with vertical scrolling"],
    settingsRevision: saved.settings.revision, workItemId: created.item.id, completionRevision: resolved.revision, commands, console: consoleState,
  };
  writeFileSync(join(evidenceDir, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify({ passed: true, receipt: join(evidenceDir, "receipt.json"), serverLog: fixture.logPath }));
} catch (error) {
  writeFileSync(join(evidenceDir, "failure.json"), JSON.stringify({ attemptId, error: error instanceof Error ? error.message : String(error), info, commands, diagnostics }, null, 2) + "\n");
  throw error;
} finally {
  process.emit("SIGINT");
  await launch;
  if (info) {
    const cleaned = !existsSync(info.dataDir);
    const receipt = join(evidenceDir, "receipt.json");
    if (existsSync(receipt)) {
      const saved = JSON.parse(readFileSync(receipt, "utf8"));
      if (saved.attemptId === attemptId) writeFileSync(receipt, JSON.stringify({ ...saved, fixtureDataRemoved: cleaned }, null, 2) + "\n");
    }
    if (!cleaned) cleanupIncomplete = info.dataDir;
  }
}
if (cleanupIncomplete) throw Error(`Fixture cleanup incomplete: ${cleanupIncomplete}`);
