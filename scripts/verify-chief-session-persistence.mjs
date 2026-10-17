// Dedicated synthetic account only; no owner cookies, credentials or browser tabs.
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { join } from 'node:path';
import { ROOT, dockerEnvironment } from './configure-chief-platform.mjs';

const mode = process.argv[2];
if (process.argv.length !== 3 || !['baseline', 'candidate', 'deployed'].includes(mode)) throw Error('Use baseline, candidate or deployed');
const origin = 'http://localhost:18087';
const workspace = 'b3ece3dc-e200-41c7-a9d8-2cb86c8c9fdb';
const base = origin + '/workbench/chiefacceptance/tracker';
const local = join(ROOT, '.chief-local/session-persistence');
await mkdir(local, { recursive: true });
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const docker = args => {
  try { return execFileSync('docker', args, { env: dockerEnvironment(), encoding: 'utf8', windowsHide: true, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { throw Error('Fixture Docker operation failed (private output suppressed)'); }
};
const [account] = JSON.parse(docker(['inspect', 'chief-platform-account-1']));
if (!account.State.Running || account.Config.Labels['com.docker.compose.project'] !== 'chief-platform' || account.Config.Env.some(v => v.startsWith('MAIL_URL=') && v !== 'MAIL_URL=')) throw Error('Expected isolated Chief account service with no outgoing mail');
const state = await json(join(ROOT, '.chief-local/platform/acceptance-state.json'));
if (JSON.stringify(state).includes('chiefexecutivesuite') || !state.origins.some(o => o.origin === origin && o.localStorage.some(i => i.name.includes('chiefacceptance')))) throw Error('Synthetic acceptance identity required');
const token = state.cookies.find(c => c.name === 'presentation-metadata-Token' && c.path === `/files/${workspace}`)?.value;
if (!token) throw Error('Synthetic workspace credential missing');
const rpc = async (method, params, credential) => {
  const result = await (await fetch(origin + '/_accounts', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(credential ? { Authorization: 'Bearer ' + credential } : {}) }, body: JSON.stringify({ method, params }) })).json();
  if (result.error) throw Error('Synthetic account operation failed: ' + method);
  return result.result;
};
const identityPath = join(local, 'synthetic-identity.json');
let identity;
try { identity = await json(identityPath); } catch (error) {
  if (error.code !== 'ENOENT') throw error;
  identity = { email: `chief-session-${randomBytes(8).toString('hex')}@example.invalid`, password: randomBytes(24).toString('base64url') + 'Aa1!', stage: 'prepared' };
  await writeFile(identityPath, JSON.stringify(identity), { flag: 'wx', mode: 0o600 });
}
if (!/^chief-session-[a-f0-9]+@example\.invalid$/.test(identity.email)) throw Error('Unexpected synthetic identity');
if (identity.stage === 'prepared') {
  identity.stage = 'invite-pending'; await save(identityPath, identity);
  identity.invite = await rpc('createInvite', { exp: 3600000, emailMask: identity.email, limit: 1, role: 'USER' }, token);
  identity.stage = 'invited'; await save(identityPath, identity);
}
if (identity.stage === 'invited') {
  identity.stage = 'signup-pending'; await save(identityPath, identity);
  const result = await rpc('signUpJoin', { email: identity.email, password: identity.password, first: 'Synthetic', last: 'Session Tester', inviteId: identity.invite, workspaceUrl: 'chiefacceptance' });
  if (result.workspace !== workspace) throw Error('Unexpected synthetic workspace');
  identity.stage = 'ready'; delete identity.invite; await save(identityPath, identity);
}
if (identity.stage !== 'ready') throw Error('Synthetic provisioning needs recovery; duplicate signup refused');

let frameUrl = base;
const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(req.url === '/away' ? '<p>Personal workspace fixture</p>' : `<iframe title="Chief organization workspace" style="width:100vw;height:100vh;border:0" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads" allow="local-network ${origin}; loopback-network ${origin}" src="${frameUrl}"></iframe>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const parent = `http://127.0.0.1:${server.address().port}`;
const otherParent = `http://localhost:${server.address().port}`;
const profile = await mkdtemp(join(local, `${mode}-profile-`));
let context, page, candidate;
const checks = [];
const open = async () => {
  context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  context.setDefaultTimeout(30000);
  await context.grantPermissions(['local-network-access'], { origin });
  await context.grantPermissions(['local-network-access'], { origin: parent });
  if (candidate) await context.route(origin + '/_accounts/cookie', async route => {
    // Keep cookie parsing in the browser's real network stack. Only the
    // destination port changes; this fixture has the same localhost hostname.
    await route.continue({ url: candidate + '/_accounts/cookie' });
  });
  page = await context.newPage();
  await page.goto(parent);
  return frame();
};
const frame = () => page.frames().find(f => f.url().startsWith(origin));
const ready = async () => {
  await expect(page.frameLocator('iframe').getByText('My issues', { exact: true })).toBeVisible({ timeout: 30000 });
  if (!frame().url().startsWith(origin + '/workbench/chiefacceptance/')) throw Error('Unexpected workspace');
};
const login = async target => {
  await expect(target.locator('input[name=email]')).toBeVisible();
  if (!(await target.locator('input[name=current-password]').isVisible())) await target.getByText('Login with password', { exact: true }).click();
  await target.locator('input[name=email]').fill(identity.email);
  await target.locator('input[name=current-password]').fill(identity.password);
  await target.getByRole('button', { name: 'Log In', exact: true }).click();
  await target.getByText('Chief Acceptance', { exact: true }).click();
  await target.waitForURL(url => url.pathname.startsWith('/workbench/chiefacceptance/'));
};
const cookieInfo = async () => (await context.cookies()).filter(c => c.name === 'account-metadata-Token').map(({ value: _value, ...metadata }) => metadata);
try {
  if (mode === 'candidate') {
    const [nginx] = JSON.parse(docker(['inspect', 'chief-platform-nginx-1']));
    docker(['run', '--detach', '--name', 'chief-session-proxy-fixture', '--label', 'io.chief.verification=session-persistence', '--network', 'chief-platform_backend', '--memory', '64m', '--cpus', '0.5', '--publish', '127.0.0.1::80', '--mount', `type=bind,source=${join(ROOT, 'integrations/platform/nginx-meetings.conf')},target=/etc/nginx/conf.d/default.conf,readonly`, nginx.Image]);
    docker(['exec', 'chief-session-proxy-fixture', 'nginx', '-t']);
    const [fixture] = JSON.parse(docker(['inspect', 'chief-session-proxy-fixture']));
    candidate = 'http://localhost:' + fixture.NetworkSettings.Ports['80/tcp'][0].HostPort;
  }
  await login(await open()); await ready();
  checks.push('Fresh password login through actual embedded form reaches the synthetic workspace');
  await page.reload();
  if (mode === 'baseline') {
    await expect(page.frameLocator('iframe').locator('input[name=email]')).toBeVisible();
    checks.push('Before fix: page reload loses embedded authentication and shows login again');
  } else {
    await ready();
    checks.push('Page reload restores login without injected cookies or local storage');
    const cookies = await cookieInfo();
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatchObject({ httpOnly: true, secure: true, sameSite: 'None', partitionKey: 'http://127.0.0.1' });
    expect(cookies[0].expires).toBeGreaterThan(Date.now() / 1000 + 300 * 86400);
    await page.goto(parent + '/away'); await page.goto(parent); await ready();
    checks.push('Leaving and reopening the embedded workspace retains login');
    await context.close(); await open(); await ready();
    checks.push('Full browser close/restart with its persistent test profile retains login');
    await page.goto(otherParent);
    await expect(page.frameLocator('iframe').locator('input[name=email]')).toBeVisible();
    await page.goto(origin + '/login'); await expect(page.locator('input[name=email]')).toBeVisible();
    checks.push('Different top-level site and direct workspace page do not inherit the embedded session');
    await login(page);
    await expect(page.getByText('My issues', { exact: true })).toBeVisible({ timeout: 30000 });
    await page.reload(); await expect(page.getByText('My issues', { exact: true })).toBeVisible({ timeout: 30000 });
    checks.push('Standalone password login and refresh also work');
    // Deliberately seed one legacy cookie only for this migration regression,
    // after all fresh-login and browser-persistence assertions have passed.
    const legacy = await rpc('login', { email: identity.email, password: identity.password });
    await context.addCookies([{ name: 'account-metadata-Token', value: legacy.token, domain: 'localhost', path: '/', httpOnly: true, secure: false, sameSite: 'Lax', expires: Date.now() / 1000 + 86400 }]);
    expect(await page.evaluate(async () => (await fetch('/_accounts/cookie', { method: 'DELETE' })).status)).toBe(204);
    await page.reload(); await expect(page.locator('input[name=email]')).toBeVisible();
    expect((await cookieInfo()).filter(c => !c.partitionKey)).toHaveLength(0);
    checks.push('Standalone logout expires both current and legacy unpartitioned account cookies');
    await page.goto(parent); await ready();
    const result = await frame().evaluate(async () => (await fetch('/_accounts/cookie', { method: 'DELETE' })).status);
    expect(result).toBe(204);
    await page.reload(); await expect(page.frameLocator('iframe').locator('input[name=email]')).toBeVisible();
    checks.push('Actual logout endpoint clears the embedded session; reload cannot sign back in');
  }
  const receipt = { passed: true, mode, checkedAt: new Date().toISOString(), syntheticOnly: true, freshLoginTestsSeedAuthentication: false, legacyCookieSeededOnlyForLogoutRegression: mode !== 'baseline', checks, cookieMetadata: await cookieInfo(), nginxConfigSha256: createHash('sha256').update(await readFile(mode === 'baseline' ? join(local, 'nginx.before.conf') : join(ROOT, 'integrations/platform/nginx-meetings.conf'))).digest('hex') };
  await save(join(ROOT, `docs/verification/evidence/chief-session-${mode}.json`), receipt);
  console.log(JSON.stringify(receipt));
} catch (error) {
  // Do not log Playwright call details: fill() errors can include passwords.
  console.error('Session persistence check failed at:', checks.at(-1) ?? 'initial login');
  if (page) console.error('Visible page:', await page.locator('body').innerText().catch(() => 'unavailable'));
  if (frame()) console.error('Visible frame:', await frame().locator('body').innerText().catch(() => 'unavailable'));
  console.error(error.message.replaceAll(identity.password, '[redacted]').replaceAll(identity.email, '[synthetic email]'));
  await save(join(local, 'failure.json'), { mode, checks, errorType: error.name });
  process.exitCode = 1;
} finally {
  await context?.close(); server.close();
  if (candidate) {
    const [fixture] = JSON.parse(docker(['inspect', 'chief-session-proxy-fixture']));
    if (fixture.Config.Labels['io.chief.verification'] === 'session-persistence') docker(['rm', '--force', 'chief-session-proxy-fixture']);
  }
}
