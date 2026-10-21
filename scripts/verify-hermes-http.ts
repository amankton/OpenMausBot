/** Opt-in paid real-provider smoke through a disposable application backend.
 * Usage: node --experimental-strip-types scripts/verify-hermes-http.ts /absolute/hermes/.env
 * Only the API_SERVER_KEY is read; no Hermes configuration is changed. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "@playwright/test";
import { launchVerificationServer, runControlOmb } from "./control-omb.ts";
import { mountPreview, type MountedPreview } from "./testing/preview-fixture.ts";
import { parseSse } from "../server/drivers/hermes-http-client.ts";

const envFile = process.argv[2];
assert(envFile, "Pass the Hermes server .env file (its secret is never printed)");
const env = Object.fromEntries(readFileSync(envFile, "utf8").split(/\r?\n/).filter(line => /^\w+=/.test(line)).map(line => {
  const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1).trim().replace(/^(['"])(.*)\1$/, '$2')];
}));
const key = env.API_SERVER_KEY; assert(key, "API_SERVER_KEY missing from selected file");
const acpPids = () => process.platform === 'win32' ? JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', "@((Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'hermes|python' -and $_.CommandLine -match '\\bhermes\\b.*\\bacp\\b' }).ProcessId) | ConvertTo-Json -Compress"], { encoding: 'utf8', windowsHide: true }).trim() || '[]') as number[] : [];
const beforeAcp = acpPids();
const baseUrl = process.env.HERMES_API_BASE_URL || "http://127.0.0.1:8642";
const health = await fetch(`${baseUrl}/health`); assert.equal(health.status, 200);
const caps = await fetch(`${baseUrl}/v1/capabilities`, { headers: { Authorization: `Bearer ${key}` } }); assert.equal(caps.status, 200);
const capabilities = await caps.json() as { model: string; features: Record<string, unknown> };
assert(capabilities.features.run_events_sse && capabilities.features.run_stop);
const fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, undefined, [], undefined, undefined,
  { baseUrl, apiKey: key, model: process.env.HERMES_API_MODEL || capabilities.model });
const controller = new AbortController();
const observed: Array<{ type: string; delta?: string; at: number; stopReason?: string }> = [];
const stream = await fetch(`${fixture.info.url}/api/events`, { signal: controller.signal });
assert(stream.body);
const consume = (async () => {
  try {
    for await (const frame of parseSse(stream.body!)) {
      const message = JSON.parse(frame.data);
      assert(!frame.data.includes(key), 'API key leaked into browser event stream');
      if (message.kind === 'runtime') observed.push({ type: message.event.type, delta: message.event.delta, stopReason: message.event.stopReason, at: performance.now() });
    }
  } catch (error) { if (!controller.signal.aborted) throw error; }
})();
let ui: MountedPreview | undefined;
let browser: Browser | undefined;
try {
  const created = await runControlOmb(['new-bot', '--name', 'HTTP Smoke', '--url', fixture.info.url]) as { bot: { id: string } };
  const botId = created.bot.id;
  await runControlOmb(['set-model', '--bot', botId, '--instance', 'hermes', '--model', process.env.HERMES_API_MODEL || capabilities.model, '--url', fixture.info.url]);
  ui = await mountPreview(fixture, { entry: '/scripts/testing/threads-preview.tsx', route: '/__hermes-http.html', title: 'Isolated Hermes HTTP acceptance' });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let networkSecret = false;
  page.on('request', request => { if (JSON.stringify(request.headers()).includes(key) || request.url().startsWith(baseUrl)) networkSecret = true; });
  await page.goto(ui.previewUrl, { waitUntil: 'commit' });
  await page.getByRole('button', { name: /HTTP Smoke/ }).first().click({ timeout: 120000 });
  const composer = page.getByRole('textbox', { name: 'Message HTTP Smoke', exact: true });
  await composer.waitFor({ timeout: 120000 });
  await page.evaluate(() => {
    const probe = window as unknown as { hermesPartialSamples: number[] };
    probe.hermesPartialSamples = [];
    new MutationObserver(() => {
      const length = document.querySelector('[data-partial-reply]')?.textContent?.length ?? 0;
      if (length && probe.hermesPartialSamples.at(-1) !== length) probe.hermesPartialSamples.push(length);
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  const token = `hermes-${randomUUID().slice(0, 8)}`;
  const send = async (text: string) => {
    const from = observed.length, started = performance.now();
    await composer.fill(text); await composer.press('Enter');
    const wait = await runControlOmb(['wait', '--bot', botId, '--timeout', '120', '--url', fixture.info.url]);
    const events = observed.slice(from);
    assert(events.some(e => e.type === 'content.delta'), 'No frontend deltas');
    assert(events.some(e => e.type === 'turn.completed' && e.stopReason === 'end_turn'), `Turn did not complete: ${JSON.stringify(wait)}`);
    return { events, firstContentMs: Math.round(events.find(e => e.type === 'content.delta')!.at - started), totalMs: Math.round(performance.now() - started) };
  };
  const first = await send(`Remember the code ${token}. Reply with the code and then count from one to ten. Do not use tools.`);
  const second = await send('What code did I ask you to remember? Reply only with that code. Do not use tools.');
  const messages = await runControlOmb(['messages', '--bot', botId, '--limit', '6', '--url', fixture.info.url]);
  assert(JSON.stringify(messages).includes(token), 'Conversation code missing');
  assert(second.events.map(e => e.delta || '').join('').includes(token), 'Second response lost conversation context');
  const stopFrom = observed.length;
  await runControlOmb(['send', '--bot', botId, '--text', 'Write a very long numbered list of 500 short sentences about clouds. Do not use tools.', '--url', fixture.info.url]);
  const stopDeadline = Date.now() + 30000;
  while (!observed.slice(stopFrom).some(e => e.type === 'content.delta') && Date.now() < stopDeadline) await new Promise(r => setTimeout(r, 100));
  await runControlOmb(['interrupt', '--bot', botId, '--url', fixture.info.url]);
  await runControlOmb(['wait', '--bot', botId, '--timeout', '30', '--url', fixture.info.url]);
  assert(observed.slice(stopFrom).some(e => e.type === 'turn.completed' && e.stopReason === 'interrupted'), 'Stop did not interrupt');
  const logs = readFileSync(fixture.info.logPath, 'utf8');
  assert(!logs.includes(key), 'API key leaked to backend logs');
  assert(!networkSecret, 'Browser sent Hermes credentials or called Hermes directly');
  await page.getByRole('log', { name: 'Conversation with HTTP Smoke', exact: true }).getByText(token, { exact: true }).first().waitFor();
  const partialSamples = await page.evaluate(() => (window as unknown as { hermesPartialSamples: number[] }).hermesPartialSamples);
  assert(partialSamples.length >= 2, 'No visible incremental partial reply');
  await page.screenshot({ path: fileURLToPath(new URL('../docs/verification/evidence/hermes-http.png', import.meta.url)), fullPage: true });
  const afterAcp = acpPids(); assert(afterAcp.every(pid => beforeAcp.includes(pid)), 'A new Hermes ACP process appeared');
  const timings = logs.split(/\r?\n/).filter(line => line.startsWith('{') && line.includes('"component":"hermes.http"')).map(line => JSON.parse(line));
  const evidence = { checkedAt: new Date().toISOString(), health: health.status, capabilities: caps.status, fixtureUrl: fixture.info.url, logPath: fixture.info.logPath,
    first: { firstContentMs: first.firstContentMs, totalMs: first.totalMs, deltaCount: first.events.filter(e => e.type === 'content.delta').length },
    second: { firstContentMs: second.firstContentMs, totalMs: second.totalMs }, conversationContinuity: true, stop: true, renderedInRealChatUi: true, visiblePartialReplyLengths: partialSamples, noNewAcpProcess: true, existingAcpProcessCount: beforeAcp.length, browserEventsAndLogsContainNoKey: true, timings };
  writeFileSync(new URL('../docs/verification/evidence/hermes-http.json', import.meta.url), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally { controller.abort(); await consume; await browser?.close(); await ui?.close(); await fixture.close(); }
