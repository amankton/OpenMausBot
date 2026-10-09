// Actual built frontend, isolated synthetic account, fake browser devices only.
import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join, sep } from 'node:path';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const flags = process.argv.slice(2);
if (flags.some(flag => !['--mode=compiled', '--mode=deployed'].includes(flag)) || flags.length > 1) throw new Error('Use --mode=compiled or --mode=deployed.');
const mode = flags.includes('--mode=deployed') ? 'deployed' : 'compiled';
const origin = 'http://localhost:18087';
const runtime = join(root, '.chief-local/platform');
const logs = join(root, '.chief-local/platform-build-logs');
const dist = join(root, '.chief-local/platform-source/dev/prod/dist');
const statePath = join(runtime, 'acceptance-state.json');
const manifest = JSON.parse(await readFile(join(runtime, 'manifest.json'), 'utf8'));
if (manifest.project !== 'chief-platform' || manifest.url !== origin || manifest.status !== 'ready') throw new Error('Independent fixture is not ready.');
const state = JSON.parse(await readFile(statePath, 'utf8'));
if (!state.origins.some(entry => entry.origin === origin && entry.localStorage.some(item => item.name.includes('chiefacceptance')))) throw new Error('Expected synthetic acceptance state.');
await stat(join(dist, 'index.html'));
const build = JSON.parse(await readFile(join(logs, 'production-build-receipt.json'), 'utf8'));
if (build.productionConfigurationsPassed !== 2 || build.sourceRevision !== manifest.sourceRevision) throw new Error('No matching successful production build receipt.');
if (createHash('sha256').update(await readFile(join(dist, 'index.html'))).digest('hex') !== build.assets['index.html']?.sha256) throw new Error('Built entry differs from its receipt.');

const checks = [], served = new Set(), errors = [], pageErrors = [];
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
let page;
try {
  const context = await browser.newContext({ storageState: statePath, viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  if (!process.env.CHIEF_BASELINE_PROBE) await context.grantPermissions(['camera', 'microphone', 'local-network-access'], { origin });
  await context.addInitScript(() => {
    const calls = [], streams = [];
    window.__chiefCapture = { calls, streams };
    window.__chiefHiddenKinds = [];
    const enumerate = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
    navigator.mediaDevices.enumerateDevices = async () => (await enumerate()).map(device => window.__chiefHiddenKinds.includes(device.kind)
      ? { kind: device.kind, deviceId: '', groupId: '', label: '' } : device);
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const devices = await enumerate();
      const inputs = devices.filter(device => device.kind === 'videoinput' || device.kind === 'audioinput');
      if (!inputs.length || inputs.some(device => !/fake/i.test(device.label))) throw new Error('Synthetic browser devices are not active; capture refused.');
      calls.push({ kind: 'devices', audio: Boolean(constraints.audio), video: Boolean(constraints.video) });
      const stream = await original(constraints); streams.push(stream);
      window.__chiefHiddenKinds = window.__chiefHiddenKinds.filter(kind => !(['audioinput', 'audiooutput'].includes(kind) && constraints.audio) && !(kind === 'videoinput' && constraints.video));
      return stream;
    };
    navigator.mediaDevices.getDisplayMedia = async () => {
      calls.push({ kind: 'screen' });
      throw new DOMException('Synthetic test cancels screen selection', 'AbortError');
    };
  });
  if (!process.env.CHIEF_BASELINE_PROBE && mode === 'compiled') await context.route(`${origin}/**`, async route => {
    const request = route.request();
    const pathname = decodeURIComponent(new URL(request.url()).pathname);
    const file = request.isNavigationRequest() ? join(dist, 'index.html') : resolve(dist, `.${pathname}`);
    if (!file.startsWith(dist + sep)) return route.continue();
    if (!(await stat(file).catch(() => null))?.isFile()) return route.continue();
    served.add(file.slice(dist.length + 1));
    await route.fulfill({ path: file });
  });
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('console', msg => { if (['error','warning','log','info'].includes(msg.type())) errors.push(msg.text().replace(/eyJ[A-Za-z0-9_.-]+/g, '[redacted-token]')); });
  page.on('requestfailed', req => { const u = new URL(req.url()); errors.push(`request failed ${u.origin}${u.pathname}: ${req.failure()?.errorText}`); });
  page.on('response', res => { if (res.status() >= 400) { const u = new URL(res.url()); errors.push(`response ${res.status()} ${u.origin}${u.pathname}`); } });

  page.on('pageerror', error => {
    const message = error.message.replace(/eyJ[A-Za-z0-9_.-]+/g, '[redacted-token]');
    pageErrors.push(message); errors.push(message);
  });
  await page.goto(`${origin}/workbench/chiefacceptance/contact/persons`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Person', exact: true }).last()).toBeVisible({ timeout: 30000 });
  if (await page.getByRole('button', { name: 'Clear filters', exact: true }).isVisible()) await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.getByText('Synthetic Ada Chief Fixture', { exact: true })).toBeVisible({ timeout: 30000 });
  if (process.env.CHIEF_BASELINE_PROBE) { console.log('Baseline synthetic Contacts visible'); await browser.close(); process.exit(0); }
  if (mode === 'compiled' && served.size < 2) throw new Error('Built frontend assets were not used.');
  expect(await page.evaluate(() => window.__chiefCapture.calls)).toEqual([]);
  checks.push('Actual built frontend loads synthetic Contacts without requesting media');
  const cardUrl = `${origin}/workbench/chiefacceptance/card/6ac6aa185b1567fb393c76f2`;
  await page.goto(cardUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.getByPlaceholder('Card', { exact: true })).toHaveValue('Chief Synthetic Card', { timeout: 30000 });
  if (!(await page.locator('.floorGrid-room').count())) {
    await page.locator('button.app.small').filter({ has: page.locator('use[href$="#office"]') }).click();
  }
  const ownOffice = page.locator('.floorGrid-room.myOffice').first();
  const ownTile = ownOffice.locator('.floorGrid-room__field[draggable="true"]').first();
  await expect(ownTile).toBeVisible({ timeout: 30000 });
  const actions = ownOffice.getByRole('button', { name: 'Room actions', exact: true });
  await expect(actions).toHaveCSS('pointer-events', 'none');
  await ownTile.hover();
  await expect(actions).toHaveCSS('pointer-events', 'auto');
  expect(await ownTile.evaluate(node => {
    const box = node.getBoundingClientRect();
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('.floorGrid-room__field') === node;
  })).toBe(true);
  await actions.click();
  await expect(page.getByText('Open room', { exact: true })).toBeVisible();
  await expect(page.getByText('Invite a person to this room', { exact: true })).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: join(logs, 'consent-card-office-actions.png') });
  await page.getByText('Invite a person to this room', { exact: true }).click();
  const invitation = page.locator('.chief-room-invite');
  await expect(invitation).toBeVisible();
  expect(page.url()).toBe(cardUrl);
  await expect(page.getByPlaceholder('Card', { exact: true })).toHaveValue('Chief Synthetic Card');
  expect(await page.evaluate(() => window.__chiefCapture.calls)).toEqual([]);
  await invitation.getByRole('button', { name: 'Close', exact: true }).click();
  checks.push('Compact Office exposes room actions without blocking avatar dragging; opening and closing its invitation picker preserves the Card and requests no capture');
  await page.goto(`${origin}/workbench/chiefacceptance/love`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Edit office', exact: true })).toBeVisible({ timeout: 30000 });
  expect(await page.evaluate(() => window.__chiefCapture.calls)).toEqual([]);
  checks.push('Opening retained Office does not request media');
  await page.screenshot({ animations: 'disabled', path: join(logs, 'consent-built-office.png') });
  await page.locator('.hot-controls-container button.statusButton').click();
  const mediaPopup = page.locator('.mediaPopup');
  await expect(mediaPopup).toBeVisible({ timeout: 30000 });
  expect(await page.evaluate(() => window.__chiefCapture.calls)).toEqual([]);
  await mediaPopup.locator('.ap-box > .mediaPopupItem').last().locator('.mediaPopupItem-header').first().click();
  await expect(mediaPopup.getByRole('button', { name: 'Turn on camera', exact: true })).toBeVisible({ timeout: 30000 });
  expect(await page.evaluate(() => window.__chiefCapture.calls)).toEqual([]);
  checks.push('Opening shared media settings and expanding camera settings does not request capture');
  await page.screenshot({ animations: 'disabled', path: join(logs, 'consent-settings-off.png') });
  const liveTracks = () => page.evaluate(() => window.__chiefCapture.streams.flatMap(stream => stream.getTracks()).filter(track => track.readyState === 'live').length);
  await mediaPopup.getByRole('button', { name: 'Turn on camera', exact: true }).click();
  await expect.poll(liveTracks).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__chiefCapture.calls.every(call => call.video && !call.audio))).toBe(true);
  checks.push('Explicit shared camera preview starts only a synthetic video track');
  await mediaPopup.getByRole('button', { name: 'Turn off camera', exact: true }).click();
  await expect.poll(liveTracks).toBe(0);
  await mediaPopup.getByRole('button', { name: 'Turn on camera', exact: true }).click();
  await expect.poll(liveTracks).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(mediaPopup).toBeHidden();
  await expect.poll(liveTracks).toBe(0);
  checks.push('Stopping preview and closing camera settings both end every synthetic input track');
  await page.evaluate(() => { window.__chiefHiddenKinds = ['audioinput', 'audiooutput', 'videoinput']; });
  const disclosureCallsBefore = await page.evaluate(() => window.__chiefCapture.calls.length);
  await page.locator('.hot-controls-container button.statusButton').click();
  await expect(mediaPopup.getByText('Default microphone', { exact: true })).toBeVisible();
  await expect(mediaPopup.getByText('Default camera', { exact: true })).toBeVisible();
  await expect(mediaPopup.getByText('Default speaker', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__chiefCapture.calls.length)).toBe(disclosureCallsBefore);
  await mediaPopup.getByRole('button', { name: 'Show audio device names', exact: true }).click();
  await expect(mediaPopup.getByRole('button', { name: 'Show audio device names', exact: true })).toBeHidden();
  await expect(mediaPopup.locator('.ap-box > .mediaPopupItem').first().locator('.mediaPopupItem-header__label')).toContainText(/fake/i);
  await expect(mediaPopup.locator('.ap-box > .mediaPopupItem').nth(1).locator('.mediaPopupItem-header__label')).toContainText(/fake/i);
  await expect.poll(liveTracks).toBe(0);
  await mediaPopup.getByRole('button', { name: 'Show camera name', exact: true }).click();
  await expect(mediaPopup.getByRole('button', { name: 'Show camera name', exact: true })).toBeHidden();
  await expect(mediaPopup.locator('.ap-box > .mediaPopupItem').last().locator('.mediaPopupItem-header__label')).toContainText(/fake/i);
  await expect.poll(liveTracks).toBe(0);
  expect(await page.evaluate(() => window.__chiefCapture.calls.slice(-2))).toEqual([{kind:'devices',audio:true,video:false},{kind:'devices',audio:false,video:true}]);
  await page.screenshot({ animations: 'disabled', path: join(logs, 'device-names-visible.png') });
  await page.keyboard.press('Escape');
  await expect(mediaPopup).toBeHidden();
  checks.push('Hidden microphone and camera names render visible defaults; explicit individual disclosure updates both real synthetic labels and releases every temporary track');
  await page.goto(`${origin}/workbench/chiefacceptance/drive`, { waitUntil: 'domcontentloaded' });
  const driveName = 'Chief Consent Test Drive';
  await expect(page.locator('.antiNav-subheader')).toBeVisible({ timeout: 30000 });
  if (!(await page.getByText(driveName, { exact: true }).first().isVisible())) {
    const createDrive = page.getByRole('button', { name: 'Create Drive', exact: true });
    if (!(await createDrive.isVisible())) await page.locator('.antiNav-subheader button').last().click();
    await page.getByText('Create Drive', { exact: true }).last().click();
    await page.getByPlaceholder('Name', { exact: true }).fill(driveName);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
  }
  await page.getByText(driveName, { exact: true }).first().click();
  await page.locator('.antiNav-subheader button').last().click();
  await page.getByText('Record', { exact: true }).click();
  const recorder = page.locator('.hulyModal-container').filter({ hasText: 'Record video' });
  await expect(recorder).toBeVisible({ timeout: 30000 });
  await expect(recorder.getByText('Enable video camera or share screen to record', { exact: true })).toBeVisible();
  await expect(recorder.getByRole('button', { name: 'Record', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.__chiefCapture.calls)).toEqual([]);
  await page.screenshot({ animations: 'disabled', path: join(logs, 'consent-recorder-off.png') });
  checks.push('Drive Record opens the actual recorder with camera and microphone off and recording disabled');
  const deviceButtons = recorder.locator('.hulyModal-footer .hulySplitButton-main');
  await expect(deviceButtons).toHaveCount(3);
  await deviceButtons.nth(1).click();
  await expect.poll(liveTracks).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__chiefCapture.calls.every(call => call.audio && !call.video))).toBe(true);
  await deviceButtons.nth(1).click();
  await expect.poll(liveTracks).toBe(0);
  await deviceButtons.nth(2).click();
  await expect.poll(liveTracks).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__chiefCapture.calls.at(-1).video && !window.__chiefCapture.calls.at(-1).audio)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(recorder).toBeHidden();
  await expect.poll(liveTracks).toBe(0);
  checks.push('Explicit recorder microphone/camera controls acquire only selected synthetic inputs; cancellation ends every captured input track without recording or upload');
  expect(pageErrors).toEqual([]);
  const inventory = await page.locator('button, [role="button"], a').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent?.trim(), label: node.getAttribute('aria-label'), title: node.getAttribute('title') })).filter(item => item.text || item.label || item.title));
  await writeFile(join(logs, 'consent-browser-controls.json'), JSON.stringify(inventory, null, 2));
  const receipt = { checkedAt: new Date().toISOString(), scope: 'Compiled frontend opening, settings preview, recorder explicit opt-in and cancellation; does not assert connected meeting consent', sourceRevision: manifest.sourceRevision, buildReceiptSha256: createHash('sha256').update(await readFile(join(logs, 'production-build-receipt.json'))).digest('hex'), consentChecksPassed: true, deviceLabelsPassed: true, deploymentModified: false, isolatedSyntheticAccount: true, fakeDevicesOnly: true, servedBuiltAssets: served.size, checks, errors, pending: ['Connected two-member meeting behavior is covered by its separate browser acceptance', 'Raw recording upload, playback and cancellation require separate authenticated FileStorage browser acceptance'] };
  receipt.mode = mode;
  receipt.scope = `${mode} frontend opening, visible device labels, settings preview, recorder explicit opt-in and cancellation; does not assert connected meeting consent`;
  await writeFile(join(logs, mode === 'compiled' ? 'consent-browser.json' : 'consent-browser-deployed.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ animations: 'disabled', path: join(logs, 'consent-failure.png') }).catch(() => {});
    const controls = await page.locator('button, [role="button"], a').evaluateAll(nodes => nodes.map(node => ({
      text: node.textContent?.trim().replace(/eyJ[A-Za-z0-9_.-]+/g, '[redacted-token]'),
      label: node.getAttribute('aria-label'), title: node.getAttribute('title'), class: node.className
    }))).catch(() => []);
    await writeFile(join(logs, 'consent-failure-controls.json'), JSON.stringify(controls, null, 2));
  }
  await writeFile(join(logs, 'consent-failure-errors.json'), JSON.stringify({ errors, served: [...served], checks }, null, 2));
  throw error;
} finally {
  await browser.close();
}









