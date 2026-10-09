// Normal UI signup only; creates/resumes one isolated synthetic account and workspace.
// Run only in a coordinated browser slot: node scripts/provision-chief-platform-recording-outsider.mjs --run
import { chromium, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

if (process.argv.length !== 3 || process.argv[2] !== '--run') throw Error('Use --run only after coordinating the lightweight browser slot.');
const root = fileURLToPath(new URL('..', import.meta.url));
const local = join(root, '.chief-local/platform');
const origin = 'http://localhost:18087';
const slug = 'chiefrecordingoutsider';
const stateFile = 'acceptance-outsider-state.json';
const metadataPath = join(local, 'acceptance-outsider.json');
const statePath = join(local, stateFile);
const manifest = JSON.parse(await readFile(join(local, 'manifest.json'), 'utf8'));
if (manifest.project !== 'chief-platform' || manifest.url !== origin || manifest.status !== 'ready') throw Error('Independent Chief Platform fixture is not ready.');
const existing = await readFile(metadataPath, 'utf8').then(JSON.parse).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
const previous = await readFile(statePath, 'utf8').then(JSON.parse).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
if ((existing === null) !== (previous === null)) throw Error('Incomplete fixture files require review; refusing to overwrite or create another account.');
if (existing !== null && (existing.slug !== slug || existing.stateFile !== stateFile || existing.provisioner !== 'normal-ui-synthetic-outsider-v1' || /chiefacceptance|chiefexecutivesuite/.test(JSON.stringify(previous)))) throw Error('Existing state is not this independent synthetic fixture.');
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-background-networking', '--renderer-process-limit=2'] });
let context;
try {
  context = await browser.newContext({ ...(previous ? { storageState: previous } : {}), viewport: { width: 1100, height: 800 }, serviceWorkers: 'block' });
  await context.grantPermissions(['local-network-access'], { origin });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) return route.abort('blockedbyclient');
    await route.continue();
  });
  await context.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw Error('No capture during synthetic account provisioning'); };
    navigator.mediaDevices.getDisplayMedia = async () => { throw Error('No screen capture during synthetic account provisioning'); };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.goto(existing?.workspace ? `${origin}/workbench/${slug}` : origin, { waitUntil: 'domcontentloaded' });
  if (previous === null) {
    await page.getByText('Sign Up', { exact: true }).click();
    await page.locator('input[name="given-name"]').fill('Chief');
    await page.locator('input[name="family-name"]').fill('Recording Outsider');
    await page.locator('input[name="email"]').fill(`chief-recording-outsider-${Date.now()}@example.test`);
    // Refuse the email OTP flow: only the existing local password signup is used.
    await expect(page.locator('input[name="new-password"]')).toHaveCount(2);
    const password = randomBytes(30).toString('base64url');
    await page.locator('input[name="new-password"]').nth(0).fill(password);
    await page.locator('input[name="new-password"]').nth(1).fill(password);
    await page.getByRole('button', { name: 'Sign Up', exact: true }).click();
    await expect(page.locator('input[name="workspace"]')).toBeVisible({ timeout: 45000 });
    await context.storageState({ path: statePath });
    await writeFile(metadataPath, JSON.stringify({ slug, workspace: null, stateFile, provisioner: 'normal-ui-synthetic-outsider-v1', status: 'creating-workspace' }, null, 2) + '\n');
  }
  if (!existing?.workspace) {
    const field = page.locator('input[name="workspace"]');
    if (!(await field.isVisible())) await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
    await expect(field).toBeVisible();
    await field.fill('Chief Recording Outsider');
    const sampleToggle = page.locator('.demo-toggle input[type="checkbox"]');
    if (await sampleToggle.count() && await sampleToggle.isChecked()) await page.locator('.demo-toggle label.mini-toggle').click();
    await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  }
  await page.waitForURL(url => url.origin === origin && (url.pathname === `/workbench/${slug}` || url.pathname.startsWith(`/workbench/${slug}/`)), { timeout: 180000 });
  await expect.poll(async () => (await context.cookies()).some(cookie => cookie.domain === 'localhost' && cookie.name === 'presentation-metadata-Token' && /^\/files\/[0-9a-f-]{36}$/i.test(cookie.path)), { timeout: 180000 }).toBe(true);
  const cookies = await context.cookies();
  const cookie = cookies.find(value => value.domain === 'localhost' && value.name === 'presentation-metadata-Token' && /^\/files\/[0-9a-f-]{36}$/i.test(value.path));
  const workspace = cookie.path.slice('/files/'.length);
  const token = decodeURIComponent(cookie.value);
  const rpc = async method => {
    const response = await context.request.post(`${origin}/_accounts`, { headers: { Authorization: `Bearer ${token}`, Cookie: '' }, data: { method, params: {} } });
    if (!response.ok()) throw Error('Synthetic account validation request failed.');
    const body = await response.json();
    if (body.error) throw Error('Synthetic account validation was rejected.');
    return body.result;
  };
  const info = await rpc('getWorkspaceInfo');
  const memberships = await rpc('getUserWorkspaces');
  if (info?.uuid !== workspace || info?.url !== slug || !Array.isArray(memberships) || memberships.length !== 1 || memberships[0].uuid !== workspace) throw Error('Outsider is not restricted to its independent synthetic workspace.');
  const state = await context.storageState();
  if (/chiefacceptance|chiefexecutivesuite/.test(JSON.stringify(state))) throw Error('Unexpected membership state; refusing to save.');
  await writeFile(statePath, JSON.stringify(state));
  const receipt = { slug, workspace, stateFile, provisioner: 'normal-ui-synthetic-outsider-v1', status: 'ready', verifiedAt: new Date().toISOString(), soleWorkspaceVerified: true };
  await writeFile(metadataPath, JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
} catch (error) {
  console.error('Outsider provisioning failed:', String(error?.message ?? error).replace(/eyJ[A-Za-z0-9_.%-]+/g, '[redacted-token]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 1400));
  process.exitCode = 1;
} finally {
  await context?.close();
  await browser.close();
}
