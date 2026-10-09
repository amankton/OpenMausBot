// Real retained UI, existing synthetic records only. No account/role lifecycle,
// external invitations, owner state, or device capture.
import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('..', import.meta.url));
const runtime = join(root, '.chief-local/platform');
const manifest = JSON.parse(await readFile(join(runtime, 'manifest.json'), 'utf8'));
if (manifest.project !== 'chief-platform' || manifest.url !== 'http://localhost:18087' || manifest.status !== 'ready') throw Error('Expected ready independent Chief fixture');
const readState = async name => {
  const state = JSON.parse(await readFile(join(runtime, name), 'utf8'));
  if (!state.origins.some(o => o.origin === manifest.url && o.localStorage.some(i => i.name.includes('chiefacceptance')))) throw Error('Expected synthetic Chief Acceptance session');
  return state;
};
const state = await readState('acceptance-state.json');
const partnerState = await readState('acceptance-partner-state.json');
const base = `${manifest.url}/workbench/chiefacceptance`;
const evidence = join(root, 'docs/verification/evidence');
await mkdir(evidence, { recursive: true });
const checks = [];
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
let page;
let stage = 'initialize';
try {
  const newContext = async storageState => {
    const context = await browser.newContext({ storageState, viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.origin === manifest.url || ['data:', 'blob:'].includes(url.protocol) ? route.continue() : route.abort();
    });
    return context;
  };
  const context = await newContext(state);
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  const openPerson = async target => {
    await target.goto(`${base}/contact/persons`, { waitUntil: 'networkidle' });
    const clear = target.getByRole('button', { name: 'Clear filters', exact: true });
    if (await clear.isVisible()) await clear.click();
    const person = target.getByText('Synthetic Ada Chief Fixture', { exact: true });
    await expect(person).toHaveCount(1);
    await person.click();
    await expect(target.getByPlaceholder('First name', { exact: true })).toHaveValue('Synthetic Ada');
    await expect(target.getByPlaceholder('Last name', { exact: true })).toHaveValue('Chief Fixture');
    if (!decodeURIComponent(target.url()).includes('6ac6a7555ab6380ca5be8f5b')) throw Error('Person route does not identify the exact synthetic record');
  };
  const avatar = target => target.locator('.hulyAvatar-container.hulyAvatarSize-x-large').first();
  const imageUrl = async target => avatar(target).locator('img').getAttribute('src');
  const avatarPopup = () => page.locator('.antiCard').filter({ has: page.getByText('Select avatar', { exact: true }) });
  const openAvatar = async () => {
    await avatar(page).click();
    await expect(page.getByText('Select avatar', { exact: true })).toBeVisible();
  };
  const makeImage = async color => Buffer.from(await page.evaluate(fill => {
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 120;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = fill; ctx.fillRect(0, 0, 160, 120);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(30, 20, 45, 60);
    return canvas.toDataURL('image/png').split(',')[1];
  }, color), 'base64');
  const selectImage = async buffer => {
    await avatarPopup().locator('input[type=file]').setInputFiles({ name: 'chief-synthetic-avatar.png', mimeType: 'image/png', buffer });
    await expect(page.locator('.editavatar-container')).toBeVisible();
    await expect(page.locator('.editavatar-container .cropper-container')).toBeVisible();
  };
  stage = 'avatar-save';
  await openPerson(page);
  const previousImageUrl = await avatar(page).locator('img').count() ? await imageUrl(page) : null;
  const blue = await makeImage('#2255bb');
  const red = await makeImage('#bb4433');
  await openAvatar();
  await selectImage(blue);
  await page.locator('.editavatar-container').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.editavatar-container')).toHaveCount(0);
  await avatarPopup().getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Select avatar', { exact: true })).toHaveCount(0);
  await expect(avatar(page).locator('img')).toBeVisible();
  await expect.poll(async () => {
    const current = await imageUrl(page);
    const url = new URL(current, manifest.url);
    return url.origin === manifest.url && url.pathname.startsWith('/files/') && current !== previousImageUrl;
  }).toBe(true);
  stage = 'avatar-stored-bytes';
  const savedUrl = await imageUrl(page);
  const savedLocation = new URL(savedUrl, manifest.url);
  if (savedLocation.origin !== manifest.url || !savedLocation.pathname.startsWith('/files/')) throw Error('Unexpected retained avatar storage URL');
  const savedResponse = await context.request.get(savedLocation.href);
  if (!savedResponse.ok()) throw Error(`Saved avatar retrieval returned HTTP ${savedResponse.status()}`);
  const savedBytes = await savedResponse.body();
  expect(savedBytes.length).toBeGreaterThan(0);
  checks.push('Existing synthetic Person accepts generated PNG through crop Save and avatar Save; stored image bytes are retrievable');

  stage = 'avatar-crop-cancel';
  await openAvatar();
  await selectImage(red);
  await page.keyboard.press('Escape');
  await expect(page.locator('.editavatar-container')).toHaveCount(0);
  await avatarPopup().locator('#card-close').click();
  await expect(page.getByText('Select avatar', { exact: true })).toHaveCount(0);
  expect(await imageUrl(page)).toBe(savedUrl);
  checks.push('Cancelling a replacement crop and closing avatar selection leaves the saved Person avatar unchanged');

  stage = 'avatar-selection-cancel';
  await openAvatar();
  await selectImage(red);
  await page.locator('.editavatar-container').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.editavatar-container')).toHaveCount(0);
  await avatarPopup().locator('#card-close').click();
  await expect(page.getByText('Select avatar', { exact: true })).toHaveCount(0);
  expect(await imageUrl(page)).toBe(savedUrl);
  await openPerson(page);
  await expect(avatar(page).locator('img')).toBeVisible();
  expect(await imageUrl(page)).toBe(savedUrl);
  const retainedResponse = await context.request.get(savedLocation.href);
  expect(retainedResponse.ok()).toBe(true);
  expect(await retainedResponse.body()).toEqual(savedBytes);
  checks.push('Cancelling after local crop Save does not replace the record; the original image survives navigation and remains downloadable');
  await page.screenshot({ path: join(evidence, 'chief-platform-avatar.png') });

  stage = 'tracker-assignment';
  await page.goto(`${base}/tracker/TSK-1`, { waitUntil: 'networkidle' });
  await expect(page.getByPlaceholder('Issue title', { exact: true })).toHaveValue('Chief Synthetic Issue');
  if (!(await page.locator('.popupPanel-body__aside-grid').first().isVisible())) await page.locator('#btnPAside').click();
  const assigneeControl = target => target.locator('.popupPanel-body__aside-grid > .labelOnPanel').filter({ hasText: 'Assignee' }).locator('xpath=following-sibling::*[1]').getByRole('button');
  const chooseAssignee = async (name, fragment) => {
    await assigneeControl(page).click();
    const popup = page.locator('.selectPopup').filter({ has: page.getByPlaceholder('Assignee', { exact: true }) });
    await popup.getByPlaceholder('Assignee', { exact: true }).fill(fragment);
    await popup.getByRole('button', { name: new RegExp(name) }).click();
    await expect(assigneeControl(page)).toContainText(name);
  };
  // Repeated runs still prove a real assignment change on this one fixture issue.
  if ((await assigneeControl(page).innerText()).includes('Chief Meeting Partner')) await chooseAssignee('Chief Acceptance', 'Acceptance');
  await chooseAssignee('Chief Meeting Partner', 'Meeting');
  stage = 'tracker-status';
  const statusControl = page.getByRole('button', { name: /^(Backlog|Todo|In Progress|Done|Canceled)$/ }).last();
  const previousStatus = (await statusControl.innerText()).trim();
  const nextStatus = previousStatus === 'In Progress' ? 'Todo' : 'In Progress';
  await statusControl.click();
  await page.getByText(nextStatus, { exact: true }).last().click();
  await expect(page.getByRole('button', { name: nextStatus, exact: true })).toBeVisible();
  checks.push('Existing synthetic Tracker issue assigns the real synthetic partner and changes its status through retained controls');
  await page.screenshot({ path: join(evidence, 'chief-platform-tracker-assigned.png') });
  stage = 'fresh-context-persistence';
  const fresh = await newContext(partnerState);
  const partner = await fresh.newPage();
  await openPerson(partner);
  await expect(avatar(partner).locator('img')).toBeVisible();
  const freshImageUrl = new URL(await imageUrl(partner), manifest.url);
  if (freshImageUrl.origin !== manifest.url || !freshImageUrl.pathname.startsWith('/files/')) throw Error('Unexpected persisted avatar URL');
  const freshAvatar = await fresh.request.get(freshImageUrl.href);
  expect(freshAvatar.ok()).toBe(true);
  expect(await freshAvatar.body()).toEqual(savedBytes);
  checks.push('A separately authenticated fresh partner context reads the same persisted avatar image bytes');
  await partner.goto(`${base}/tracker/TSK-1`, { waitUntil: 'networkidle' });
  await expect(partner.getByPlaceholder('Issue title', { exact: true })).toHaveValue('Chief Synthetic Issue');
  if (!(await partner.locator('.popupPanel-body__aside-grid').first().isVisible())) await partner.locator('#btnPAside').click();
  await expect(assigneeControl(partner)).toContainText('Chief Meeting Partner');
  await expect(partner.getByRole('button', { name: nextStatus, exact: true })).toBeVisible();
  checks.push('Assignment and chosen status persist for a separately authenticated partner in a fresh browser context');
  await partner.close();
  const receipt = { verifiedAt: new Date().toISOString(), scope: 'Actual retained Contacts avatar and Tracker controls; existing synthetic Chief Acceptance records only',
    recordIds: { person: '6ac6a7555ab6380ca5be8f5b', issue: 'TSK-1' }, checks,
    avatar: { bytes: savedBytes.length, sha256: createHash('sha256').update(savedBytes).digest('hex') },
    tracker: { assignee: 'Chief Meeting Partner', previousStatus, persistedStatus: nextStatus },
    limitations: ['Retained Assignee search matches stored name fragments; full displayed name Chief Meeting Partner returned no row. This acceptance uses the unique fragment Meeting.'],
    pending: ['Employee/Guest role authorization and lifecycle', 'Card main-body files/mentions/emoji/templates', 'Card Spaces/Types', 'Team planner scheduling'] };
  await writeFile(join(evidence, 'chief-platform-contact-tracker.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
} catch (error) {
  await page?.screenshot({ path: join(evidence, 'chief-platform-contact-tracker-failure.png') }).catch(() => {});
  await writeFile(join(runtime, 'contact-tracker-failure.json'), JSON.stringify({ failedAt: new Date().toISOString(), stage, checks, error: String(error).slice(0, 2000) }, null, 2) + '\n');
  throw Error(`Synthetic Contacts/Tracker acceptance failed at ${stage}; private failure receipt and screenshot saved.`);
} finally { await browser.close(); }
