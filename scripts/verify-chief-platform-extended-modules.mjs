// Prepared against the retained source; --plan performs no browser/service work.
// Run only when the coordinator releases the single synthetic browser slot.
import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve, sep } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const plan = {
  scope: 'Synthetic chiefacceptance only; no owner workspace, external email, or changes to existing members/roles',
  phases: {
    contacts: 'Employee and Guest empty create forms/cancel; User cannot edit another employee; self remains editable',
    guest: 'Create one distinct Guest through a one-use local copy-invite and Sign Up & Join; verify backend denies Guest role escalation',
    structures: 'Create a dedicated Card Type and Space through the retained UI; reload both',
    content: 'Append a synthetic file, document mention and rich emoji to the existing synthetic Card; verify from a fresh member context',
    templates: 'Create a synthetic text template, insert it into the synthetic Card and verify persistence',
    planner: 'Create one own-calendar 30-minute synthetic Action Item slot; verify persistence, reschedule/restore, and Team Planner views',
    persistence: 'Read pre-restart synthetic Person, Company, exact avatar/attachment bytes and Tracker assignment/status'
  },
  pending: [
    'ReadOnlyGuest and destructive member lifecycle operations are outside this acceptance scope',
    'Cross-member private-calendar visibility is not covered by own-calendar scheduling acceptance'
  ]
};
const args = process.argv.slice(2);
if (!args.includes('--run')) {
  if (args.some(arg => arg !== '--plan')) throw Error('Use --plan or --run [--phase=contacts|guest|structures|content|templates|planner|persistence] [--mode=deployed|compiled]');
  console.log(JSON.stringify(plan, null, 2));
} else {
  await run();
}

async function run() {
  const selected = args.find(arg => arg.startsWith('--phase='))?.slice(8);
  const mode = args.find(arg => arg.startsWith('--mode='))?.slice(7) ?? 'deployed';
  if (!['compiled', 'deployed'].includes(mode)) throw Error('Unknown mode');
  if (selected && !Object.hasOwn(plan.phases, selected)) throw Error('Unknown phase');
  if (args.some(arg => arg !== '--run' && arg !== `--phase=${selected}` && arg !== `--mode=${mode}`)) throw Error('Unknown argument');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const runtime = join(root, '.chief-local/platform');
  const manifest = JSON.parse(await readFile(join(runtime, 'manifest.json'), 'utf8'));
  if (manifest.project !== 'chief-platform' || manifest.url !== 'http://localhost:18087' || manifest.status !== 'ready') throw Error('Expected ready independent Chief fixture');
  const readState = async filename => {
    const state = JSON.parse(await readFile(join(runtime, filename), 'utf8'));
    if (JSON.stringify(state).includes('chiefexecutivesuite') || !state.origins.some(o => o.origin === manifest.url && o.localStorage.some(i => i.name.includes('chiefacceptance')))) throw Error('Expected synthetic acceptance state');
    return state;
  };
  const ownerState = await readState('acceptance-state.json');
  const memberState = await readState('acceptance-partner-state.json');
  const base = `${manifest.url}/workbench/chiefacceptance`;
  const cardUrl = `${base}/card/6ac6aa185b1567fb393c76f2`;
  const evidence = join(root, 'docs/verification/evidence');
  await mkdir(evidence, { recursive: true });
  const suffix = selected ?? 'all';
  const checks = [];
  const sha = data => createHash('sha256').update(data).digest('hex');
  const provenance = {};
  const dist = join(root, '.chief-local/platform-source/dev/prod/dist');
  const servedBuiltAssets = new Set();
  let build;
  let buildReceiptSha256;
  if (mode === 'compiled' || selected === 'templates' || !selected) {
    const bytes = await readFile(join(root, '.chief-local/platform-build-logs/production-build-receipt.json'));
    build = JSON.parse(bytes); buildReceiptSha256 = sha(bytes);
    const input = 'plugins/card-resources/src/components/ContentEditor.svelte';
    if (build.sourceRevision !== '03b7aad7dc562f4f9769c51a4df08191a0393997' || build.productionConfigurationsPassed !== 2) throw Error('Expected complete pinned-source production build');
    if (build.inputs?.[input] !== sha(await readFile(join(root, '.chief-local/platform-source', input)))) throw Error('Card editor build does not match current reviewed source');
    if (!build.assets?.['index.html']?.sha256 || !Object.keys(build.assets).some(name => name.endsWith('.js'))) throw Error('Incomplete compiled asset receipt');
    if (mode === 'deployed') {
      const front = JSON.parse(await readFile(join(runtime, 'front-image.json'), 'utf8'));
      const actualImage = execFileSync('docker', ['inspect', 'chief-platform-front-1', '--format', '{{.Image}}'], { encoding: 'utf8', windowsHide: true }).trim();
      if (front.webpackReceiptSha256 !== buildReceiptSha256 || actualImage !== front.image) throw Error('Deployed frontend does not match reviewed template build');
      provenance.frontImage = actualImage;
    }
  }
  const journalPath = join(runtime, 'extended-module-mutations.json');
  let journal = { workspace: 'b3ece3dc-e200-41c7-a9d8-2cb86c8c9fdb', operations: {} };
  try { journal = JSON.parse(await readFile(journalPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (journal.workspace !== 'b3ece3dc-e200-41c7-a9d8-2cb86c8c9fdb' || !journal.operations) throw Error('Invalid synthetic mutation journal');
  const record = async (key, value) => {
    journal.operations[key] = { ...journal.operations[key], ...value, updatedAt: new Date().toISOString() };
    const temporary = `${journalPath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(journal, null, 2) + '\n', { mode: 0o600 });
    await rename(temporary, journalPath);
  };
  const once = async (key, exists, mutate) => {
    // A pending write is never blindly replayed: its first response may have been lost.
    if (journal.operations[key] && journal.operations[key].status !== 'prepared') {
      await expect.poll(exists, { timeout: 30000, message: `Reconcile existing synthetic ${key}; no repeated write` }).toBe(true);
      await record(key, { status: 'verified' });
      return;
    }
    let found = false;
    for (let attempt = 0; attempt < 10 && !found; attempt++) {
      found = await exists(); // Selector ambiguity is a failure, never "not found".
      if (!found) await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (found) { await record(key, { status: 'verified', adoptedExisting: true }); return; }
    await record(key, { status: 'prepared' });
    await mutate();
    await expect.poll(exists, { timeout: 30000 }).toBe(true);
    await record(key, { status: 'verified' });
  };
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  let page;
  let stage = 'initialize';
  let forbiddenRequests = 0;
  let guestInviteId;
  let guestEmail;
  const contexts = [];
  const diagnostics = { pageErrors: [], failedRequests: [], httpErrors: [], console: [], sockets: [] };
  const newContext = async storageState => {
    const context = await browser.newContext({ storageState, serviceWorkers: 'block', viewport: { width: 1600, height: 1000 } });
    contexts.push(context);
    await context.grantPermissions(['local-network-access'], { origin: manifest.url });
    context.on('page', target => {
      target.on('console', message => { if (message.type() === 'error') diagnostics.console.push({ type: message.type(), text: message.text().replace(/eyJ[A-Za-z0-9_.%-]+/g, '[redacted]').replace(/https?:\S+|wss?:\S+/g, '[URL omitted]').slice(0, 500) }); });
      target.on('websocket', socket => { const entry = { opened: true, framesReceived: 0, framesSent: 0, closed: false }; diagnostics.sockets.push(entry); socket.on('framereceived', () => entry.framesReceived++); socket.on('framesent', () => entry.framesSent++); socket.on('close', () => entry.closed = true); });
      target.on('pageerror', error => diagnostics.pageErrors.push(error.message.replace(/eyJ[A-Za-z0-9_.%-]+/g, '[redacted]').replace(/https?:\S+/g, '[URL omitted]').slice(0, 500)));
      target.on('requestfailed', request => diagnostics.failedRequests.push({ path: new URL(request.url()).pathname, method: request.method(), error: request.failure()?.errorText }));
      target.on('response', response => { if (response.status() >= 400) diagnostics.httpErrors.push({ path: new URL(response.url()).pathname, status: response.status() }); });
    });
    await context.addInitScript(() => {
      for (const name of ['getUserMedia', 'getDisplayMedia']) {
        if (navigator.mediaDevices) Object.defineProperty(navigator.mediaDevices, name, { value: async () => { throw Error('Device capture forbidden in module verification'); } });
      }
    });
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const wrongWorkspace = url.pathname.startsWith('/workbench/') && !url.pathname.startsWith('/workbench/chiefacceptance/');
      let method = ''; let params;
      try { const body = request.postDataJSON(); method = body?.method ?? ''; params = body?.params; } catch { /* Binary uploads are expected. */ }
      const allowedInvite = stage === 'guest' && method === 'createInvite' && params?.role === 'GUEST' && params?.limit === 1 && params?.exp > 0 && params.exp <= 3600000;
      const allowedSignup = stage === 'guest' && method === 'signUpJoin' && params?.email === guestEmail && params?.inviteId === guestInviteId && !params?.workspaceUrl;
      if (wrongWorkspace || /^(sendInvite|resendInvite|ensurePerson|createWorkspace|setRole|updateRole|updateWorkspaceRole|assignWorkspace)$/i.test(method) || (method === 'createInvite' && !allowedInvite) || (method === 'signUpJoin' && !allowedSignup)) {
        forbiddenRequests++;
        await route.abort();
      } else if (url.origin === manifest.url || ['data:', 'blob:'].includes(url.protocol)) {
        if (mode === 'compiled' && url.origin === manifest.url && request.method() === 'GET') {
          const candidate = request.isNavigationRequest() ? join(dist, 'index.html') : resolve(dist, '.' + decodeURIComponent(url.pathname));
          if (candidate.startsWith(dist + sep) && (await stat(candidate).catch(() => null))?.isFile()) {
            const name = candidate.slice(dist.length + 1).split(sep).join('/');
            if (sha(await readFile(candidate)) !== build.assets[name]?.sha256) throw Error('Unreviewed compiled asset');
            servedBuiltAssets.add(name);
            return route.fulfill({ path: candidate });
          }
        }
        await route.continue();
      }
      else await route.abort();
    });
    return context;
  };
  const goto = async (target, url) => {
    if (!url.startsWith(`${base}/`)) throw Error('Refusing non-fixture route');
    await target.goto(url, { waitUntil: 'networkidle' });
    expect(new URL(target.url()).pathname.startsWith('/workbench/chiefacceptance/')).toBe(true);
  };
  const body = target => target.locator('.ProseMirror.flex-grow');
  const assertCard = async target => {
    await expect(target.getByPlaceholder('Card', { exact: true })).toHaveValue('Chief Synthetic Card');
    await expect(body(target)).toContainText('Chief synthetic editable card content.');
    await expect(body(target).locator('table')).toContainText('Synthetic table cell');
  };
  const append = async () => {
    const anchor = body(page).locator(':scope > p').filter({ hasText: 'Chief synthetic editable card content.' });
    await expect(anchor).toHaveCount(1);
    await anchor.evaluate(element => {
      element.closest('[contenteditable=true]').focus();
      const range = document.createRange(); range.selectNodeContents(element); range.collapse(false);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    });
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
  };
  const phases = {
    async persistence() {
      const sources = {
        contacts: join(evidence, 'chief-platform-contacts.json'),
        avatarTracker: join(evidence, 'chief-platform-contact-tracker.json'),
        rollout: join(evidence, 'chief-platform-capture-rollout.json'),
        restored: join(runtime, 'capture-maintenance-restored.json')
      };
      const previous = {};
      for (const [name, path] of Object.entries(sources)) {
        const bytes = await readFile(path); previous[name] = JSON.parse(bytes);
        provenance[name + 'ReceiptSha256'] = sha(bytes);
      }
      expect(previous.rollout.passed).toBe(true);
      expect(previous.rollout.allOriginalMountsPreserved).toBe(true);
      expect(previous.restored.exactServiceIdsPreserved).toBe(true);
      expect(previous.restored.mountsPreserved).toBe(true);
      expect(previous.restored.forceUsed).toBe(false);
      for (const value of [previous.contacts, previous.avatarTracker]) expect(Date.parse(value.verifiedAt)).toBeLessThan(Date.parse(previous.restored.restoredAt));
      const context = await newContext(memberState); const target = await context.newPage();
      await goto(target, `${base}/contact/persons`);
      if (await target.getByRole('button', { name: 'Clear filters', exact: true }).isVisible()) await target.getByRole('button', { name: 'Clear filters', exact: true }).click();
      await target.getByText('Synthetic Ada Chief Fixture', { exact: true }).click();
      await expect(target.getByPlaceholder('Location', { exact: true })).toHaveValue('Acceptance Lab Updated');
      const readBlob = async href => {
        const url = new URL(href, manifest.url);
        if (url.origin !== manifest.url || !url.pathname.startsWith('/files/b3ece3dc-e200-41c7-a9d8-2cb86c8c9fdb/')) throw Error('Unexpected fixture storage URL');
        const response = await context.request.get(url.href); expect(response.ok()).toBe(true);
        return response.body();
      };
      const avatar = target.locator('.hulyAvatar-container.hulyAvatarSize-x-large').first().locator('img');
      await expect(avatar).toBeVisible();
      const avatarBytes = await readBlob(await avatar.getAttribute('src'));
      expect(avatarBytes.length).toBe(previous.avatarTracker.avatar.bytes);
      expect(sha(avatarBytes)).toBe(previous.avatarTracker.avatar.sha256);
      const attachment = target.getByText('chief-person-attachment.txt', { exact: true });
      await expect(attachment).toBeVisible();
      const attachmentBytes = await readBlob(await attachment.getAttribute('href'));
      expect(attachmentBytes.length).toBe(previous.contacts.attachment.bytes);
      expect(sha(attachmentBytes)).toBe(previous.contacts.attachment.sha256);
      await goto(target, `${base}/contact/companies`);
      await target.getByText('Chief Synthetic Company', { exact: true }).click();
      await expect(target.getByText('Synthetic company description for acceptance testing.', { exact: true })).toBeVisible();
      checks.push('Pre-restart Person location, exact saved avatar and attachment bytes, and Company rich text remain readable by a fresh ordinary member');
      await goto(target, `${base}/tracker/TSK-1`);
      await expect(target.getByPlaceholder('Issue title', { exact: true })).toHaveValue('Chief Synthetic Issue');
      if (!await target.locator('.popupPanel-body__aside-grid').first().isVisible()) await target.locator('#btnPAside').click();
      const assignee = target.locator('.popupPanel-body__aside-grid > .labelOnPanel').filter({ hasText: 'Assignee' }).locator('xpath=following-sibling::*[1]').getByRole('button');
      await expect(assignee).toContainText(previous.avatarTracker.tracker.assignee);
      await expect(target.getByRole('button', { name: previous.avatarTracker.tracker.persistedStatus, exact: true })).toBeVisible();
      checks.push('Pre-restart Tracker TSK-1 assignment and status persist; this phase only reads fixtures and binds the exact service/mount preservation receipts');
      await target.screenshot({ path: join(evidence, 'chief-platform-extended-persistence-tracker.png') });
      await context.close();
    },
    async guest() {
      const [account] = JSON.parse(execFileSync('docker', ['inspect', 'chief-platform-account-1'], { encoding: 'utf8', windowsHide: true }));
      if (!account?.State?.Running || account.Config.Labels['com.docker.compose.project'] !== 'chief-platform' || account.Config.Labels['com.docker.compose.service'] !== 'account') throw Error('Expected running owned Chief account');
      if (account.Config.Env.some(value => value.startsWith('MAIL_URL=') && value !== 'MAIL_URL=')) throw Error('Guest sign-up refused: mail service configured');
      const statePath = join(runtime, 'acceptance-guest-state.json');
      let guestState;
      try { guestState = await readState('acceptance-guest-state.json'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      let accountsUrl;
      if (!guestState) {
        let link;
        try { link = JSON.parse(await readFile(join(runtime, 'acceptance-guest-invite.json'), 'utf8')).url; } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (journal.operations.guestSignup && (!link || journal.operations.guestSignup.status !== 'invite-created')) throw Error('Guest signup was previously attempted; recover its private state/identity before any new invitation or signup');
        if (!link) {
        await goto(page, `${base}/setting`);
        await page.getByText('Invite to workspace', { exact: true }).click();
        const popup = page.locator('.antiPopup').filter({ hasText: 'Share this link to invite other users' });
        await popup.getByText('Use workspace invite settings', { exact: true }).click();
        if (await popup.locator('input[type=checkbox]').nth(1).isChecked()) await popup.getByText('Unlimited uses:', { exact: true }).click();
        await popup.locator('input[type=number]').nth(0).fill('1');
        await popup.locator('input[type=number]').nth(1).fill('1');
        await popup.getByRole('button', { name: 'User', exact: true }).click();
        await page.getByText('Guest', { exact: true }).last().click();
        // Intent is durable before the first mutating request, not before harmless
        // form setup. A lost response must not create another invite/account.
        guestEmail = `chief-guest-${randomBytes(6).toString('hex')}@example.invalid`;
        await record('guestSignup', { status: 'pending', email: guestEmail });
        const inviteRequest = page.waitForRequest(request => { try { return request.postDataJSON()?.method === 'createInvite'; } catch { return false; } });
        await popup.getByRole('button', { name: 'Get invite link', exact: true }).click();
        accountsUrl = (await inviteRequest).url();
        link = await popup.locator('.link').innerText();
        const url = new URL(link);
        if (url.origin !== manifest.url || url.pathname !== '/login/join' || !url.searchParams.get('inviteId')) throw Error('Expected local one-use invite link');
        guestInviteId = url.searchParams.get('inviteId');
        await record('guestSignup', { status: 'invite-created', inviteSha256: createHash('sha256').update(guestInviteId).digest('hex'), expiresNoLaterThan: new Date(Date.now() + 3600000).toISOString() });
        await writeFile(join(runtime, 'acceptance-guest-invite.json'), JSON.stringify({ url: link }), { flag: 'wx', mode: 0o600 });
        await popup.getByRole('button', { name: 'Close', exact: true }).click();
        }
        const recovered = new URL(link);
        guestInviteId = recovered.searchParams.get('inviteId');
        guestEmail = journal.operations.guestSignup.email;
        if (recovered.origin !== manifest.url || recovered.pathname !== '/login/join' || !guestInviteId || createHash('sha256').update(guestInviteId).digest('hex') !== journal.operations.guestSignup.inviteSha256 || !/^chief-guest-[a-f0-9]+@example\.invalid$/.test(guestEmail)) throw Error('Invalid recovered fixture invite');
        const guest = await newContext(undefined); const joinPage = await guest.newPage();
        await joinPage.goto(link, { waitUntil: 'networkidle' });
        await expect(joinPage.getByText('Join Chief Acceptance', { exact: true })).toBeVisible();
        const password = randomBytes(24).toString('base64url') + 'Aa1!';
        await joinPage.locator('input[name=given-name]').fill('Chief');
        await joinPage.locator('input[name=family-name]').fill('Module Guest');
        await joinPage.locator('input[name=email]').fill(guestEmail);
        await joinPage.locator('input[name=new-password]').nth(0).fill(password);
        await joinPage.locator('input[name=new-password]').nth(1).fill(password);
        const [stillAccount] = JSON.parse(execFileSync('docker', ['inspect', 'chief-platform-account-1'], { encoding: 'utf8', windowsHide: true }));
        if (stillAccount.Id !== account.Id || stillAccount.Config.Env.some(value => value.startsWith('MAIL_URL=') && value !== 'MAIL_URL=')) throw Error('Account/mail configuration changed before synthetic signup');
        await record('guestSignup', { status: 'signup-submitted' });
        await joinPage.getByRole('button', { name: 'Sign Up & Join', exact: true }).click();
        await joinPage.waitForURL(url => url.pathname.startsWith('/workbench/chiefacceptance/'));
        guestState = await guest.storageState();
        await writeFile(statePath, JSON.stringify(guestState), { flag: 'wx', mode: 0o600 });
        await record('guestSignup', { status: 'session-saved' });
        await guest.close();
      }
      const guest = await newContext(guestState); const guestPage = await guest.newPage();
      await goto(guestPage, `${base}/time`);
      const tokenCookie = guestState.cookies.find(cookie => cookie.name === 'presentation-metadata-Token' && cookie.domain === 'localhost' && cookie.path === '/files/b3ece3dc-e200-41c7-a9d8-2cb86c8c9fdb');
      if (!tokenCookie) throw Error('Guest lacks the exact synthetic workspace token');
      if (!accountsUrl) {
        const config = await (await guest.request.get(`${manifest.url}/config.json`)).json();
        accountsUrl = config.ACCOUNTS_URL;
      }
      const endpoint = new URL(accountsUrl, manifest.url);
      if (endpoint.origin !== manifest.url) throw Error('Nonlocal account endpoint refused');
      const rpc = async (method, params) => (await guest.request.post(endpoint.href, { headers: { Authorization: 'Bearer ' + decodeURIComponent(tokenCookie.value) }, data: { method, params } })).json();
      const current = await rpc('getLoginInfoByToken', {});
      expect(current.result?.role).toBe('GUEST');
      expect(current.result?.workspace).toBe('b3ece3dc-e200-41c7-a9d8-2cb86c8c9fdb');
      await record('guestSignup', { status: 'verified', account: current.result.account });
      const denied = await rpc('createInvite', { exp: 60000, emailMask: '', limit: 1, role: 'USER' });
      expect(denied.result).toBeUndefined();
      expect(JSON.stringify(denied.error)).toContain('Forbidden');
      await goto(page, `${base}/contact/guests`);
      await expect(page.getByText('Chief Module Guest', { exact: true })).toBeVisible();
      checks.push('Distinct synthetic Guest joins via local one-use link without email; current account API confirms exact workspace/GUEST role and rejects inviting elevated USER');
      await guest.close();
    },
    async contacts() {
      for (const [route, label] of [['employees', 'Employee'], ['guests', 'Guest']]) {
        await goto(page, `${base}/contact/${route}`);
        await page.locator('button.antiButton[type=submit]').filter({ hasText: label }).click();
        const form = page.locator('.antiCard').filter({ has: page.getByPlaceholder('First name', { exact: true }) });
        await expect(form.getByRole('button', { name: 'Create', exact: true })).toBeDisabled();
        await expect(form.getByPlaceholder('Last name', { exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(form).toHaveCount(0);
      }
      checks.push('Employee/Guest creation forms validate empty input and cancel without submitting invitation-capable actions');
      await goto(page, `${base}/contact/employees`);
      await page.getByText('Chief Meeting Partner', { exact: true }).click();
      const partnerUrl = page.url();
      await expect(page.getByPlaceholder('First name', { exact: true })).toBeEnabled();
      const member = await newContext(memberState);
      const own = await member.newPage();
      await goto(own, partnerUrl);
      await expect(own.getByPlaceholder('First name', { exact: true })).toBeEnabled();
      // Known synthetic owner's Person ID. No identity/name mutation is performed.
      const ids = partnerUrl.match(/[a-f0-9]{24}/g) ?? [];
      if (ids.length !== 1) throw Error('Employee panel route does not contain one unambiguous Person ID');
      const syntheticOwnerUrl = partnerUrl.replace(ids[0], '6ac6a722f2bac8b54dff7fbd');
      await goto(own, syntheticOwnerUrl);
      await expect(own.getByPlaceholder('First name', { exact: true })).toBeDisabled();
      checks.push('Synthetic Owner can edit a coworker; ordinary User can edit self but another Employee name editor is disabled (UI boundary only)');
      await member.close();
    },
    async structures() {
      const typeName = 'Chief Synthetic Extended Type';
      await goto(page, `${base}/setting/types`);
      await expect(page.locator('[id="new-master-tag"]').last()).toBeVisible();
      await once('cardType', () => page.locator('#navGroup-types').getByRole('button', { name: typeName, exact: true }).isVisible(), async () => {
        // Upstream assigns the same ID to import and add; last is the add button.
        await page.locator('[id="new-master-tag"]').last().click();
        const dialog = page.locator('.antiCard').filter({ has: page.getByPlaceholder('Name', { exact: true }) });
        await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeDisabled();
        await dialog.getByPlaceholder('Name', { exact: true }).fill(typeName);
        await record('cardType', { status: 'pending' });
        await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      });
      await page.reload({ waitUntil: 'networkidle' });
      await expect(page.locator('#navGroup-types').getByRole('button', { name: typeName, exact: true })).toBeVisible();
      const spaceName = 'Chief Synthetic Extended Space';
      await goto(page, `${base}/card/browser`);
      await expect(page.getByRole('button', { name: 'Create space', exact: true })).toBeVisible();
      await once('cardSpace', () => page.getByText(spaceName, { exact: true }).first().isVisible(), async () => {
        await page.getByRole('button', { name: 'Create space', exact: true }).click();
        await page.locator('#teamspace-title input').fill(spaceName);
        const dialog = page.locator('.antiCard').filter({ has: page.locator('#teamspace-title') });
        await record('cardSpace', { status: 'pending' });
        await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      });
      await page.reload({ waitUntil: 'networkidle' });
      await expect(page.getByText(spaceName, { exact: true }).first()).toBeVisible();
      checks.push('Dedicated synthetic Card Type and Space created through UI and persist after reload; no existing schema or space changed');
    },
    async content() {
      await goto(page, cardUrl); await assertCard(page);
      const failedEmoji = body(page).locator('table p').filter({ hasText: 'Chief synthetic emoji' });
      if (journal.operations.cardEmoji?.status === 'pending' && await failedEmoji.count()) {
        await expect(failedEmoji).toHaveCount(1);
        expect(await failedEmoji.innerText()).toMatch(/^Chief synthetic emoji .+lightly_smiling_face: Synthetic table cell$/u);
        await failedEmoji.evaluate(element => {
          const range = document.createRange(); range.selectNodeContents(element);
          const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
          element.closest('[contenteditable=true]').focus();
        });
        await page.keyboard.insertText('Synthetic table cell');
        await expect(body(page).locator('table')).not.toContainText('Chief synthetic emoji');
        await record('cardEmoji', { status: 'prepared', recoveryEvidence: 'Removed only failed synthetic emoji prefix; restored exact pre-existing table cell text' });
      }
      const fileName = 'chief-card-body-acceptance.txt';
      const fileText = 'Chief synthetic Card body attachment. No user data.\n';
      await once('cardFile', () => body(page).getByText(fileName, { exact: true }).isVisible(), async () => {
        await record('cardFile', { status: 'pending' });
        await append();
        await body(page).evaluate((element, fixture) => {
          const clipboardData = new DataTransfer();
          clipboardData.items.add(new File([fixture.text], fixture.name, { type: 'text/plain' }));
          element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
        }, { name: fileName, text: fileText });
      });
      await expect(body(page).getByText(fileName, { exact: true })).toBeVisible();
      await once('cardEmoji', () => body(page).locator('[data-type="emoji"]').filter({ hasText: '🙂' }).isVisible(), async () => {
        await record('cardEmoji', { status: 'pending' });
        await append();
        await body(page).evaluate(element => {
          const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', 'Chief synthetic emoji 🙂 ');
          element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
        });
      });
      await expect(body(page).locator('[data-type="emoji"]').filter({ hasText: '🙂' })).toBeVisible();
      await once('cardMention', () => body(page).getByText('Chief Synthetic Document', { exact: true }).isVisible(), async () => {
        await record('cardMention', { status: 'pending' });
        await append(); await page.keyboard.type('@Chief Synthetic Document', { delay: 35 });
        await page.locator('.mentionPoup .ap-menuItem').filter({ hasText: 'Chief Synthetic Document' }).click();
      });
      await expect(body(page).getByText('Chief Synthetic Document', { exact: true })).toBeVisible();
      const fresh = await newContext(memberState); const other = await fresh.newPage();
      await goto(other, cardUrl); await assertCard(other);
      await expect(body(other).getByText(fileName, { exact: true })).toBeVisible();
      await expect(body(other).locator('[data-type="emoji"]').filter({ hasText: '🙂' })).toBeVisible();
      await expect(body(other).getByText('Chief Synthetic Document', { exact: true })).toBeVisible();
      const fileUrl = new URL(await body(other).getByRole('link', { name: fileName, exact: true }).getAttribute('href'), manifest.url);
      if (fileUrl.origin !== manifest.url || !fileUrl.pathname.startsWith('/files/b3ece3dc-e200-41c7-a9d8-2cb86c8c9fdb/')) throw Error('Unexpected attachment URL');
      const downloaded = await fresh.request.get(fileUrl.href); expect(downloaded.ok()).toBe(true);
      expect(await downloaded.text()).toBe(fileText);
      checks.push(`Card body file, document reference and rich emoji persist for a fresh member; downloaded file exact bytes SHA256 ${createHash('sha256').update(fileText).digest('hex')}`);
      await fresh.close();
    },
    async templates() {
      const title = 'Chief Synthetic Extended Template';
      const text = 'Chief synthetic reusable template content.';
      await goto(page, cardUrl); await assertCard(page);
      await goto(page, `${base}/setting/message-templates`);
      await page.getByRole('button', { name: 'Text Templates', exact: true }).click({ timeout: 60000 });
      await expect(page.locator('#create-template button')).toBeVisible();
      await once('textTemplate', () => page.getByText(title, { exact: true }).first().isVisible(), async () => {
        await page.locator('#create-template button').click();
        await page.getByPlaceholder('New template', { exact: true }).fill(title);
        // The retained model includes a default Templates group; absence must fail,
        // not silently create unrelated settings or accept a save with no category.
        await page.locator('.ProseMirror[contenteditable="true"]').fill(text);
        await record('textTemplate', { status: 'pending' });
        await page.getByRole('button', { name: 'Save template', exact: true }).click();
        await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
      });
      await page.reload({ waitUntil: 'networkidle' });
      await page.getByText(title, { exact: true }).click();
      await expect(page.getByText(text, { exact: true })).toBeVisible();
      await goto(page, cardUrl); await assertCard(page);
      const otherEditors = page.locator('.ProseMirror:not(.flex-grow)');
      const activityBefore = await otherEditors.allTextContents();
      const editor = body(page).locator('xpath=ancestor::div[contains(concat(" ",normalize-space(@class)," ")," ref-container ")][1]');
      await expect(editor).toHaveCount(1);
      const control = editor.locator('.buttons-panel button').filter({ has: page.locator('use[href$="#template"]') });
      await expect(control).toBeEnabled();
      const templateAlreadyPresent = await body(page).getByText(text, { exact: true }).isVisible();
      // Reconcile only the documented failures before a template selection:
      // Activity-only draft, then a toolbar anchor removed before click.
      const priorTemplateAttempt = journal.operations.cardTemplate;
      const knownFailure = {
        '2026-10-08T00:16:14.161Z': 'Known pre-fix Activity-only draft is absent in fresh context',
        '2026-10-08T00:31:40.289Z': 'Compiled pointer probe confirmed toolbar node removed on mousedown before click; no template popup or selection occurred'
      }[priorTemplateAttempt?.updatedAt];
      if (priorTemplateAttempt?.status === 'pending' && knownFailure) {
        await expect(body(page)).not.toContainText(text);
        expect(activityBefore.some(value => value.includes(text))).toBe(false);
        await record('cardTemplate', { status: 'prepared', priorAttempt: priorTemplateAttempt, recoveryEvidence: knownFailure + '; main body has no inserted template. Original template record is reused.' });
      }
      await once('cardTemplate', () => body(page).getByText(text, { exact: true }).isVisible(), async () => {
        await append();
        await control.click();
        const template = page.locator('.template-popup .item').filter({ hasText: title });
        await expect(template).toBeVisible();
        await record('cardTemplate', { status: 'pending' });
        await template.click();
      });
      if (templateAlreadyPresent) {
        // A deployed recheck exercises the repaired pointer lifecycle without
        // inserting a duplicate template or changing the saved Card content.
        const before = await body(page).innerText();
        await body(page).click();
        await expect(control).toBeEnabled();
        await control.click();
        await expect(page.locator('.template-popup .item').filter({ hasText: title })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.template-popup')).toHaveCount(0);
        expect(await body(page).innerText()).toBe(before);
      }
      await expect(body(page)).toContainText(text);
      expect(await otherEditors.allTextContents()).toEqual(activityBefore);
      await page.reload({ waitUntil: 'networkidle' }); await assertCard(page);
      await expect(body(page)).toContainText(text);
      const fresh = await newContext(memberState); const target = await fresh.newPage();
      await goto(target, cardUrl); await assertCard(target);
      await expect(body(target)).toContainText(text);
      await fresh.close();
      checks.push('A synthetic text template is saved in workspace settings, inserted using the main Card body toolbar, and persists for a fresh ordinary member; Activity editors stay unchanged');
    },
    async planner() {
      const slotTitle = 'Chief Synthetic Extended Planner Slot';
      // The full scheduling form explicitly uses the fixture's own calendar and
      // default reminders=[], rather than changing an existing calendar event.
      await goto(page, `${base}/time`);
      await page.getByText('All', { exact: true }).first().click();
      await once('plannerSlot', () => page.locator('.hulyToDoLine-container').filter({ hasText: slotTitle }).isVisible(), async () => {
        const quickAdd = page.getByPlaceholder('Add Action Item, press Enter to save', { exact: true });
        await expect(quickAdd).toBeVisible();
        await quickAdd.locator('xpath=..').getByRole('button').click();
        const popup = page.locator('.eventPopup-container');
        await popup.getByPlaceholder('Add Title', { exact: true }).fill(slotTitle);
        await popup.getByRole('button', { name: 'Only visible to you', exact: true }).click();
        await page.getByText('Visible to everyone', { exact: true }).last().click();
        await popup.getByRole('button', { name: 'Add Slot', exact: true }).click();
        await expect(popup.locator('.slot')).toHaveCount(1);
        await expect(popup.locator('.duration')).toContainText('30');
        await record('plannerSlot', { status: 'pending' });
        await popup.getByRole('button', { name: 'Add Action Item', exact: true }).click();
        await expect(popup).toHaveCount(0);
      });
      await page.reload({ waitUntil: 'networkidle' });
      await page.getByText('All', { exact: true }).first().click();
      const scheduled = page.locator('.hulyToDoLine-container').filter({ hasText: slotTitle });
      await expect(scheduled).toBeVisible();
      await scheduled.click();
      await expect(page.locator('.slot')).toHaveCount(1);
      await expect(page.locator('.duration')).toContainText('30');
      checks.push('New synthetic public Action Item owns one 30-minute local WorkSlot with no reminders; title and slot duration persist after reload');
      const slotTimes = async () => {
        const values = await page.locator('.slot .datetime-input .digit').allTextContents();
        if (values.length !== 4 || values.some(value => !/^\d{2}$/.test(value.trim()))) throw Error('Expected exactly one start/end time editor');
        return values.map(value => Number(value.trim()));
      };
      const reopenSlot = async () => {
        await goto(page, `${base}/time`);
        await page.getByText('All', { exact: true }).first().click();
        await page.locator('.hulyToDoLine-container').filter({ hasText: slotTitle }).click();
        await expect(page.locator('.slot')).toHaveCount(1);
      };
      const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
      const adjustStart = async delta => {
        const minute = page.locator('.slot .datetime-input').first().locator('.digit').nth(1);
        await minute.focus(); // Keyboard control avoids opening the time popup.
        await minute.press(delta > 0 ? 'ArrowUp' : 'ArrowDown');
        await minute.press('Tab');
      };
      let move = journal.operations.plannerReschedule;
      if (!move) {
        const before = await slotTimes();
        const delta = (before[0] === 23 && before[1] === 59) || (before[2] === 23 && before[3] === 59) ? -1 : 1;
        const shifted = offset => {
          const value = (before[offset] * 60 + before[offset + 1] + delta + 1440) % 1440;
          return [Math.floor(value / 60), value % 60];
        };
        await record('plannerReschedule', { status: 'pending', before, after: [...shifted(0), ...shifted(2)], delta });
        move = journal.operations.plannerReschedule;
      }
      let current = await slotTimes();
      const reusedMoveProof = move.status === 'restored';
      if (move.status === 'restored') {
        expect(current).toEqual(move.before);
      } else {
        if (move.status === 'pending' && same(current, move.before)) {
          await adjustStart(move.delta);
          await expect.poll(slotTimes).toEqual(move.after);
          await reopenSlot(); current = await slotTimes();
        }
        if (move.status === 'restore-pending' && same(current, move.before)) {
          await record('plannerReschedule', { status: 'restored' });
        } else {
          expect(current).toEqual(move.after);
          await expect(page.locator('.duration')).toContainText('30');
          await record('plannerReschedule', { status: 'restore-pending', moveVerifiedAt: new Date().toISOString() });
          await adjustStart(-move.delta);
          await expect.poll(slotTimes).toEqual(move.before);
          await reopenSlot(); expect(await slotTimes()).toEqual(move.before);
          await expect(page.locator('.duration')).toContainText('30');
          await record('plannerReschedule', { status: 'restored' });
        }
      }
      checks.push(reusedMoveProof
        ? 'Previously verified synthetic slot reschedule is still restored to its journaled exact original start/end/duration'
        : 'Synthetic slot start/end shift together by one minute, persist on reopen, and are restored to exact original times/duration; retry reconciles endpoints instead of repeating increments');
      await goto(page, `${base}/team`);
      await expect(page.getByText('Team Planner', { exact: true })).toBeVisible();
      const project = page.locator('.hulyNavPanel-container .hulyNavItem-container').first();
      await expect(project).toBeVisible();
      const projectLabel = (await project.innerText()).trim();
      if (!projectLabel) throw Error('Joined fixture project has no visible label');
      await project.click();
      await expect(page.getByRole('radio', { name: 'Agenda', exact: true })).toBeVisible();
      await page.locator('label[data-id=tab-calendar]').click();
      await expect(page.locator('.timeline-resource-content')).toBeVisible();
      await expect(page.locator('.timeline-resource-content .timeline-row')).not.toHaveCount(0);
      await expect(page.locator('.timeline').getByText(slotTitle, { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Day', exact: true }).click();
      await page.getByText('Week', { exact: true }).click();
      await expect(page.locator('.timeline')).toBeVisible();
      await page.locator('label[data-id=tab-agenda]').click();
      checks.push('Team Planner joined-project selection displays the persisted own-member scheduled item in day view; Agenda and week calendar render');
    }
  };
  try {
    const context = await newContext(ownerState); page = await context.newPage(); page.setDefaultTimeout(20000);
    for (const name of selected ? [selected] : Object.keys(phases)) {
      stage = name;
      await phases[name]();
      expect(forbiddenRequests).toBe(0);
      await page.screenshot({ path: join(evidence, `chief-platform-extended-${name}.png`) });
    }
    if (mode === 'compiled') {
      expect(servedBuiltAssets.has('index.html')).toBe(true);
      expect([...servedBuiltAssets].some(name => name.endsWith('.js'))).toBe(true);
    }
    const receipt = { passed: true, verifiedAt: new Date().toISOString(), scope: plan.scope, phase: suffix, mode, buildReceiptSha256, servedBuiltAssets: [...servedBuiltAssets].sort(), mainBodyTemplate: selected === 'templates' || !selected, checks, remainingCoverage: plan.pending, forbiddenRequests, ...provenance };
    await writeFile(join(evidence, `chief-platform-extended-${suffix}${mode === 'compiled' ? '-compiled' : ''}.json`), JSON.stringify(receipt, null, 2) + '\n');
    console.log(JSON.stringify(receipt));
  } catch (error) {
    // A failed guest form can display a still-valid invite or an input call log.
    if (page && stage !== 'guest') await page.screenshot({ path: join(evidence, `chief-platform-extended-${suffix}-failure.png`) }).catch(() => {});
    const description = stage === 'guest' ? String(error).split('\n')[0].replace(/https?:\S+/g, '[URL omitted]').slice(0, 200) : String(error).slice(0, 1800);
    const formControls = stage === 'guest' && page ? await page.locator('input,button,label').evaluateAll(nodes => nodes.map(n => ({ tag: n.tagName, name: n.getAttribute('name'), placeholder: n.getAttribute('placeholder'), type: n.getAttribute('type'), text: n.tagName === 'INPUT' ? undefined : n.textContent?.trim().slice(0, 90) }))).catch(() => []) : undefined;
    await writeFile(join(runtime, `extended-${suffix}-failure.json`), JSON.stringify({ at: new Date().toISOString(), stage, checks, error: description, forbiddenRequests, formControls, diagnostics, servedBuiltAssets: [...servedBuiltAssets] }, null, 2) + '\n');
    if (stage === 'guest') throw Error(description);
    throw error;
  } finally { for (const context of contexts) await context.close().catch(() => {}); await browser.close(); }
}
