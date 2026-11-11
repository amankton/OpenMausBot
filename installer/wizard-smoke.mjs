import assert from 'node:assert/strict';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setupServer } from './setup.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = (await readdir(join(root, 'node_modules/.pnpm'))).find(name => name.startsWith('playwright@'));
if (!entry) throw Error('Install the project Playwright development dependency first');
const { chromium } = await import(pathToFileURL(join(root, 'node_modules/.pnpm', entry, 'node_modules/playwright/index.mjs')).href);
const catalogPath = process.argv[2] || join(root, 'installer/payload/agents.json');
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const state = { selected: ['bacca', 'solo'], steps: {} };
const engine = { catalog, close: async () => {}, status: async () => ({ platform: 'win32', arch: 'x64', node: process.version, supported: true, busy: false, home: '(isolated UI fixture)', urls: { personal: 'http://127.0.0.1:9998', shared: 'http://localhost:9999' }, state }), select: async ids => { state.selected = ids; }, action: async name => { state.steps[name] = { state: 'installed', message: 'Isolated scripted action; no software installed' }; }, connectAi: async () => {} };
const ui = await setupServer(engine);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(ui.launchUrl); await page.getByText('2 selected', { exact: true }).waitFor();
  assert.equal(new URL(page.url()).hash, '');
  await page.getByLabel('Search agents').fill('Software Architect');
  assert.equal(await page.locator('.agent').count(), 1);
  await page.locator('.agent input').check(); await page.getByRole('button', { name: 'Save team selection' }).click();
  assert.equal(state.selected.includes('software-architect'), true);
  await page.getByLabel('Search agents').fill('no-such-agent-fixture'); await page.locator('#empty').waitFor({ state: 'visible' });
  await page.getByLabel('Search agents').fill('');
  await page.locator('#save').focus(); await page.waitForTimeout(2300); assert.equal(await page.evaluate(() => document.activeElement?.id), 'save');
  const evidence = join(root, '.chief-local/github-sync-20261103'); await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: join(evidence, 'installer-wizard-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: join(evidence, 'installer-wizard-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, fixtureOnly: true, catalogProfiles: catalog.agents.length, checks: ['private launch consumed', 'individual selection persisted', 'search and empty state', 'polling retains keyboard focus', '375px no horizontal overflow', 'no page errors'], softwareInstalled: false }));
} finally { await browser.close(); await ui.close(); }
