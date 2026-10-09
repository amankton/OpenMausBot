// Synthetic acceptance only. Never point this runner at owner sessions or another service.
// Prepare a NEW raw-recording production build first; existing frozen receipts are not changed.
// Usage: node scripts/verify-chief-platform-recording.mjs --check
//        node scripts/verify-chief-platform-recording.mjs --mode=compiled
//        node scripts/verify-chief-platform-recording.mjs --mode=deployed
// Required independent fixture: .chief-local/platform/acceptance-outsider.json:
// {"slug":"chiefrecordingoutsider","workspace":"<UUID>","stateFile":"acceptance-outsider-state.json"}
// The referenced Playwright state must belong to a separately registered synthetic account
// with its own workspace, never invited to chiefacceptance. This script does not provision it.
import { chromium, expect, request } from '@playwright/test';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, join, sep } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const origin = 'http://localhost:18087';
const local = join(root, '.chief-local/platform');
const logs = join(root, '.chief-local/platform-build-logs');
const dist = join(root, '.chief-local/platform-source/dev/prod/dist');
const evidence = join(root, 'docs/verification/evidence');
const workspace = 'b3ece3dc-e200-41c7-a9d8-2cb86c8c9fdb';
const cardId = '6ac6aa185b1567fb393c76f2';
const cardUrl = `${origin}/workbench/chiefacceptance/card/${cardId}`;
const flags = process.argv.slice(2);
if (flags.some(flag => !['--check', '--mode=compiled', '--mode=deployed'].includes(flag)) || flags.filter(flag => flag.startsWith('--mode=')).length > 1) throw Error('Unsupported recording acceptance argument.');
const mode = flags.includes('--mode=deployed') ? 'deployed' : 'compiled';
const sha = value => createHash('sha256').update(value).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const requireCheck = (condition, message) => { if (!condition) throw Error(message); };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const manifest = await json(join(local, 'manifest.json'));
requireCheck(manifest.project === 'chief-platform' && manifest.url === origin && manifest.status === 'ready', 'Independent Chief Platform fixture must be ready.');
const statePath = join(local, 'acceptance-state.json');
const state = await json(statePath);
function syntheticState(value, slug) {
  return value.origins?.some(entry => entry.origin === origin && entry.localStorage?.some(item => item.name.includes(slug))) && !JSON.stringify(value).includes('chiefexecutivesuite');
}
requireCheck(syntheticState(state, 'chiefacceptance'), 'Expected isolated synthetic acceptance state.');
const outsider = await json(join(local, 'acceptance-outsider.json')).catch(() => { throw Error('Prepare the independent synthetic outsider fixture described in this script before running acceptance.'); });
requireCheck(outsider.slug === 'chiefrecordingoutsider' && uuidPattern.test(outsider.workspace) && outsider.workspace !== workspace && outsider.stateFile === 'acceptance-outsider-state.json', 'Unexpected outsider fixture identity.');
const outsiderState = await json(join(local, outsider.stateFile));
requireCheck(syntheticState(outsiderState, outsider.slug) && !syntheticState(outsiderState, 'chiefacceptance'), 'Outsider must be a separate synthetic account/workspace.');
function fixtureToken(value, expectedWorkspace) {
  const cookie = value.cookies?.find(item => item.name === 'presentation-metadata-Token' && item.domain === 'localhost' && item.path === `/files/${expectedWorkspace}`);
  requireCheck(cookie?.value, 'Synthetic fixture needs a current workspace-scoped file cookie.');
  return decodeURIComponent(cookie.value);
}
const outsiderToken = fixtureToken(outsiderState, outsider.workspace);
const raw = await json(join(root, 'integrations/platform/patches/raw-recording-provenance.json'));
requireCheck(sha(await readFile(join(root, 'integrations/platform/patches/0004-bounded-raw-recording.patch'))) === raw.patchSha256, 'Raw recording patch differs from provenance.');
const buildPath = join(logs, 'production-build-receipt.json');
const buildBytes = await readFile(buildPath);
const build = JSON.parse(buildBytes);
requireCheck(build.productionConfigurationsPassed === 2 && build.sourceRevision === manifest.sourceRevision && raw.sourceRevision === build.sourceRevision, 'A successful matching production build is required.');
for (const input of raw.inputs) requireCheck(build.inputs?.[input.file] === input.currentSha256, `Production build predates the raw-recording change: ${input.file}`);
requireCheck(sha(await readFile(join(dist, 'index.html'))) === build.assets?.['index.html']?.sha256, 'Built entry differs from its receipt.');
if (mode === 'deployed') {
  const image = await json(join(local, 'front-image.json'));
  requireCheck(image.sourceRevision === build.sourceRevision && image.webpackReceiptSha256 === sha(buildBytes), 'Deployed-mode image receipt must reference this production build.');
}
if (flags.includes('--check')) {
  console.log(JSON.stringify({ ready: true, mode, sourceRevision: build.sourceRevision, rawPatchSha256: raw.patchSha256, browserStarted: false }));
  process.exit(0);
}

await mkdir(logs, { recursive: true });
await mkdir(evidence, { recursive: true });
const run = Date.now().toString(36);
const recordingName = `Chief synthetic ${run}.webm`;
const checks = [], served = new Set(), uploads = [], captures = [], auth = [];
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
let context, page, api, releaseHeld;
const summarizeError = error => String(error?.message ?? error).replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/eyJ[A-Za-z0-9_.%-]+/g, '[redacted-token]').slice(0, 1800);
try {
  // This request context has no browser cookies: a negative Bearer test must never
  // inherit the member cookie, which the retained file endpoint prefers to headers.
  api = await request.newContext({ baseURL: origin, timeout: 20000, extraHTTPHeaders: { Cookie: '' } });
  const who = await api.post('/_accounts', { headers: { Authorization: `Bearer ${outsiderToken}` }, data: { method: 'getWorkspaceInfo', params: {} } });
  requireCheck(who.ok(), 'Outsider fixture token is expired or invalid.');
  const whoBody = await who.json();
  const outsiderInfo = whoBody.result ?? whoBody;
  requireCheck(outsiderInfo.uuid === outsider.workspace && outsiderInfo.url === outsider.slug, 'Outsider token does not select the independent synthetic workspace.');
  const memberships = await api.post('/_accounts', { headers: { Authorization: `Bearer ${outsiderToken}` }, data: { method: 'getUserWorkspaces', params: {} } });
  requireCheck(memberships.ok(), 'Cannot verify the outsider membership boundary.');
  const membershipBody = await memberships.json();
  const outsiderWorkspaces = membershipBody.result ?? membershipBody;
  requireCheck(Array.isArray(outsiderWorkspaces) && outsiderWorkspaces.length === 1 && outsiderWorkspaces[0].uuid === outsider.workspace, 'Outsider fixture must belong only to its independent synthetic workspace.');
  if (mode === 'deployed') {
    const entry = await api.get('/');
    requireCheck(entry.ok() && sha(await entry.body()) === build.assets['index.html'].sha256, 'Actual deployed HTML differs from the reviewed build.');
  }

  context = await browser.newContext({ storageState: statePath, serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
  await context.grantPermissions(['camera', 'microphone', 'local-network-access'], { origin });
  await context.addInitScript(() => {
    const calls = [], streams = [], recorders = [];
    window.__chiefRaw = { calls, streams, recorders };
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(device => ['videoinput', 'audioinput'].includes(device.kind));
      if (!inputs.length || inputs.some(device => !/fake/i.test(device.label))) throw Error('Refusing capture: fake browser inputs are not active.');
      calls.push({ audio: Boolean(constraints.audio), video: Boolean(constraints.video) });
      const stream = await original(constraints); streams.push(stream); return stream;
    };
    navigator.mediaDevices.getDisplayMedia = async () => { throw new DOMException('No real display capture in recording acceptance', 'AbortError'); };
    window.MediaRecorder = new Proxy(window.MediaRecorder, { construct(Target, args) {
      const recorder = new Target(...args);
      const observation = { recorder, bytes: 0, chunks: 0, mimeType: recorder.mimeType };
      recorders.push(observation);
      recorder.addEventListener('dataavailable', event => { observation.bytes += event.data.size; observation.chunks++; });
      return recorder;
    } });
  });
  if (mode === 'compiled') await context.route(`${origin}/**`, async route => {
    const req = route.request();
    if (req.method() !== 'GET') return route.continue();
    const pathname = decodeURIComponent(new URL(req.url()).pathname);
    const candidate = req.isNavigationRequest() ? join(dist, 'index.html') : resolve(dist, `.${pathname}`);
    if (!candidate.startsWith(dist + sep) || !(await stat(candidate).catch(() => null))?.isFile()) return route.continue();
    const relative = candidate.slice(dist.length + 1).split(sep).join('/');
    const bytes = await readFile(candidate);
    requireCheck(build.assets?.[relative]?.sha256 === sha(bytes), `Asset differs from build receipt: ${relative}`);
    served.add(relative);
    await route.fulfill({ path: candidate });
  });
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('response', async response => {
    const req = response.request();
    if (req.method() !== 'POST' || new URL(req.url()).pathname !== `/files/${workspace}` || !response.ok()) return;
    const result = await response.json().catch(() => null);
    if (Array.isArray(result) && uuidPattern.test(result[0]?.id)) uploads.push({ uuid: result[0].id, size: result[0].metadata?.size, type: result[0].metadata?.contentType });
  });
  const liveTracks = () => page.evaluate(() => window.__chiefRaw.streams.flatMap(stream => stream.getTracks()).filter(track => track.readyState === 'live').length);
  const recorder = () => page.locator('.hulyModal-container').filter({ hasText: 'Record video' });
  const assertCard = async () => {
    expect(page.url()).toBe(cardUrl);
    await expect(page.getByPlaceholder('Card', { exact: true })).toHaveValue('Chief Synthetic Card');
  };
  async function openRecorder() {
    await assertCard();
    const before = await page.evaluate(() => window.__chiefRaw.calls.length);
    // Source: Card Activity's legacy AttachmentRefInput + recorder-assets #record.
    const action = page.locator('.buttons-panel button').filter({ has: page.locator('use[href$="#record"]') });
    await expect(action).toHaveCount(1);
    await action.click();
    await expect(recorder()).toBeVisible();
    await expect(recorder()).toContainText('Up to 2 minutes or 64 MiB. Recording stops automatically.');
    await expect(recorder().getByRole('button', { name: 'Record', exact: true })).toBeDisabled();
    expect(await page.evaluate(() => window.__chiefRaw.calls.length)).toBe(before);
  }
  async function startClip() {
    await openRecorder();
    const buttons = recorder().locator('.hulyModal-footer .hulySplitButton-main');
    await expect(buttons).toHaveCount(3);
    await buttons.nth(2).click(); // Explicit fake camera.
    await expect.poll(liveTracks).toBeGreaterThan(0);
    await recorder().getByRole('button', { name: 'Record', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__chiefRaw.recorders.at(-1)?.chunks ?? 0)).toBeGreaterThanOrEqual(2);
  }
  async function stopClip() {
    await recorder().getByRole('button', { name: 'Stop', exact: true }).click();
    await expect.poll(liveTracks).toBe(0);
  }
  async function confirmDiscard() {
    await page.keyboard.press('Escape');
    const confirm = page.locator('.msgbox-container').filter({ hasText: 'Are you sure you want to cancel recording?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Ok', exact: true }).click();
    await expect(recorder()).toBeHidden();
    await expect.poll(liveTracks).toBe(0);
  }
  await page.goto(cardUrl, { waitUntil: 'domcontentloaded' });
  await assertCard();
  expect(await page.evaluate(() => window.__chiefRaw.calls)).toEqual([]);
  const token = fixtureToken(await context.storageState(), workspace);
  const memberHeaders = { Authorization: `Bearer ${token}` };
  const fileUrl = uuid => `/files/${workspace}/${uuid}?file=${uuid}&workspace=${workspace}`;
  async function findFixtureDocs(className, query) {
    const params = new URLSearchParams({ class: className, query: JSON.stringify(query), options: JSON.stringify({ limit: 5 }) });
    const response = await api.get(`/_transactor/api/v1/find-all/${workspace}?${params}`, { headers: memberHeaders });
    requireCheck(response.ok(), 'Caller-authenticated attachment query failed.');
    const result = await response.json();
    // The retained RPC serializer wraps FindResult arrays that carry a total.
    const values = result?.dataType === 'TotalArray' ? result.value : result;
    requireCheck(Array.isArray(values), 'Unexpected attachment query response.');
    // Match api-client/rest/rest.ts: transport omits scalar equality fields
    // already supplied by the query; the official client restores those values.
    for (const doc of values) for (const [key, value] of Object.entries(query)) {
      if (value !== null && typeof value !== 'object' && !key.startsWith('$')) doc[key] ??= value;
    }
    return values;
  }
  const attachments = (name, uuid) => findFixtureDocs('attachment:class:Attachment', { name, file: uuid });
  // Cancellation before and during collection must not create a blob.
  await openRecorder(); await page.keyboard.press('Escape'); await expect(recorder()).toBeHidden();
  await startClip(); await confirmDiscard(); expect(uploads.length).toBe(0);
  checks.push('Opening/cancelling requests no capture; explicit synthetic capture cancelled before upload leaves no successful upload');

  // Hold precisely our next multipart POST so cancellation is deterministic. This
  // does not claim to prove rollback after a server has already committed a request.
  let heldUuid;
  const held = new Promise(resolve => { releaseHeld = resolve; });
  let finishHeldRoute;
  const heldRouteFinished = new Promise(resolve => { finishHeldRoute = resolve; });
  let abortOutcome;
  const uploadRoute = async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const prefix = route.request().postDataBuffer()?.subarray(0, 8192).toString('utf8') ?? '';
    heldUuid = prefix.match(/filename="([0-9a-f-]{36})"/i)?.[1];
    requireCheck(uuidPattern.test(heldUuid ?? ''), 'Unexpected recording upload identifier.');
    await held;
    try { await route.abort('aborted'); abortOutcome = 'aborted'; }
    catch (error) { abortOutcome = summarizeError(error); }
    finally { finishHeldRoute(); }
  };
  await context.route(`${origin}/files/${workspace}`, uploadRoute);
  await startClip(); await stopClip();
  await expect.poll(() => Boolean(heldUuid)).toBe(true);
  await recorder().getByRole('button', { name: 'Cancel upload', exact: true }).click();
  releaseHeld(); await heldRouteFinished;
  requireCheck(abortOutcome === 'aborted', `Held upload route did not abort successfully: ${abortOutcome}`);
  await context.unroute(`${origin}/files/${workspace}`, uploadRoute);
  await expect(recorder()).toBeHidden(); await expect.poll(liveTracks).toBe(0);
  const heldRead = await api.get(fileUrl(heldUuid), { headers: memberHeaders });
  if (heldRead.status() !== 404) {
    const bytes = await heldRead.body();
    throw Error(`Held synthetic blob read was not 404: ${JSON.stringify({ uuid: heldUuid, status: heldRead.status(), contentType: heldRead.headers()['content-type'], bytes: bytes.length, sha256: sha(bytes), prefixHex: bytes.subarray(0, 16).toString('hex'), successfulUploads: uploads.length, abortOutcome })}`);
  }
  checks.push('Cancellation of a transport-held upload ends inputs; confirmed route.abort completes before unroute, recorder closes and blob read is 404');

  // Real completed upload, then discard: the exact created blob must disappear.
  await startClip(); await stopClip();
  await expect(recorder().getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  await expect.poll(() => uploads.length).toBe(1);
  const discarded = uploads[0];
  expect((await api.get(fileUrl(discarded.uuid), { headers: memberHeaders })).ok()).toBe(true);
  await confirmDiscard();
  await expect.poll(async () => (await api.get(fileUrl(discarded.uuid), { headers: memberHeaders })).status()).toBe(404);
  checks.push('Discarding an uploaded unsaved recording deletes only its generated blob');

  await startClip(); await stopClip();
  await expect(recorder().getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  await expect.poll(() => uploads.length).toBe(2);
  const saved = uploads[1];
  await recorder().getByPlaceholder('Name', { exact: true }).fill(recordingName);
  await recorder().getByRole('button', { name: 'Save', exact: true }).click();
  await expect(recorder()).toBeHidden(); await assertCard();
  // Recorder Save adds a local Activity-comment draft attachment. The normal
  // comment Send action creates its attachment and parent ChatMessage documents.
  // This is Card Activity coverage, not recording into the main Card body.
  expect(await attachments(recordingName, saved.uuid)).toEqual([]);
  const activityInput = page.locator('.ref-input').filter({ has: page.locator('.buttons-panel use[href$="#record"]') });
  const send = activityInput.locator('.buttons-panel > button');
  await expect(send).toHaveCount(1); await expect(send).toBeEnabled(); await send.click();
  await expect.poll(async () => (await attachments(recordingName, saved.uuid)).length).toBe(1);
  const attachment = (await attachments(recordingName, saved.uuid))[0];
  expect(attachment.attachedToClass).toBe('chunter:class:ChatMessage');
  await expect.poll(async () => (await findFixtureDocs(attachment.attachedToClass, { _id: attachment.attachedTo, attachedTo: cardId })).length).toBe(1);
  expect(attachment.file).toBe(saved.uuid); expect(attachment.size).toBeGreaterThan(0); expect(attachment.size).toBe(saved.size); expect(attachment.type).toBe('video/webm');
  expect(attachment.metadata.originalWidth).toBeGreaterThan(0); expect(attachment.metadata.originalHeight).toBeGreaterThan(0);
  const bodyResponse = await api.get(fileUrl(saved.uuid), { headers: memberHeaders });
  expect(bodyResponse.ok()).toBe(true); const body = await bodyResponse.body();
  expect(body.length).toBe(attachment.size); expect(body.subarray(0, 4).toString('hex')).toBe('1a45dfa3');
  checks.push('Card Activity recorder Save creates a draft; explicit comment Send persists its WebM attachment and parent comment on the synthetic Card, with dimensions and exact blob size');
  captures.push(...await page.evaluate(() => window.__chiefRaw.calls));
  await expect.poll(liveTracks).toBe(0);

  // Reload proves persistence and cookie-authenticated native playback, without
  // carrying a Blob URL or injecting any media file into the player.
  await page.reload({ waitUntil: 'domcontentloaded' }); await assertCard();
  // Activity.svelte wraps message presenters in Lazy: materialize the section
  // through its normal scroll interaction before locating the saved attachment.
  await page.locator('.p-activity').scrollIntoViewIfNeeded();
  // AttachmentVideoPreview renders the retained native Video inline. Its
  // download anchor belongs to a hidden actions menu, not the playback control.
  const video = page.locator(`video[src*="/files/"][src*="${saved.uuid}"]`);
  await expect(video).toBeVisible();
  await video.evaluate(async node => { node.muted = true; await node.play(); });
  await expect.poll(() => video.evaluate(node => node.readyState)).toBeGreaterThanOrEqual(2);
  const dimensions = await video.evaluate(node => ({ width: node.videoWidth, height: node.videoHeight, duration: node.duration }));
  expect(dimensions.width).toBe(attachment.metadata.originalWidth); expect(dimensions.height).toBe(attachment.metadata.originalHeight);
  await video.evaluate(async node => { node.muted = true; await node.play(); });
  await expect.poll(() => video.evaluate(node => node.currentTime)).toBeGreaterThan(0.2);
  requireCheck(Number.isFinite(dimensions.duration) && dimensions.duration > 0, 'Raw WebM plays but lacks a finite duration; seekability is not accepted.');
  const seekTo = Math.min(0.5, dimensions.duration / 2);
  await video.evaluate((node, target) => { node.pause(); node.currentTime = target; }, seekTo);
  await expect.poll(() => video.evaluate(node => node.seeking)).toBe(false);
  expect(await video.evaluate(node => node.currentTime)).toBeCloseTo(seekTo, 1);
  checks.push('Persisted Card Activity comment attachment reopens after reload and native playback, dimensions, finite duration and seeking pass');
  await page.screenshot({ animations: 'disabled', path: join(evidence, 'chief-platform-recording.png') });

  // Positive control above establishes the blob exists. Negatives deliberately
  // omit browser cookies and operate only on this run's synthetic UUIDs.
  for (const [label, headers, targetWorkspace] of [
    ['anonymous', {}, workspace],
    ['invalid bearer', { Authorization: 'Bearer chief-synthetic-invalid-token' }, workspace],
    ['valid outsider', { Authorization: `Bearer ${outsiderToken}` }, workspace],
    ['member wrong workspace URL', memberHeaders, outsider.workspace]
  ]) {
    const path = `/files/${targetWorkspace}/${saved.uuid}?file=${saved.uuid}&workspace=${targetWorkspace}`;
    const get = await api.get(path, { headers });
    requireCheck([401, 403].includes(get.status()), `${label} GET was not denied with an authorization status.`);
    const deletion = await api.delete(path, { headers });
    requireCheck([401, 403].includes(deletion.status()), `${label} DELETE was not denied with an authorization status.`);
    const upload = await api.post(`/files/${targetWorkspace}`, { headers, multipart: { file: { name: randomUUID(), mimeType: 'video/webm', buffer: Buffer.from('chief-synthetic-denied-upload') } } });
    requireCheck([401, 403].includes(upload.status()), `${label} POST was not denied with an authorization status.`);
    auth.push({ case: label, get: get.status(), delete: deletion.status(), post: upload.status() });
  }
  expect((await api.get(fileUrl(saved.uuid), { headers: memberHeaders })).ok()).toBe(true);
  checks.push('Anonymous, invalid-token, valid outsider and cross-workspace file GET/POST/DELETE are denied; original member blob remains readable');
  expect(await page.evaluate(() => window.__chiefRaw.calls)).toEqual([]);
  if (mode === 'compiled') requireCheck(served.size > 2, 'Compiled frontend assets were not exercised.');
  const receipt = { checkedAt: new Date().toISOString(), passed: true, mode, sourceRevision: build.sourceRevision, rawPatchSha256: raw.patchSha256, buildReceiptSha256: sha(buildBytes), syntheticOnly: true, fakeInputsOnly: true, deploymentModified: false, servedBuiltAssets: served.size, checks, captureRequests: captures, attachment: { name: recordingName, bytes: body.length, sha256: sha(body), width: dimensions.width, height: dimensions.height, duration: dimensions.duration }, auth, remainingLimits: ['Existing file authorization is workspace-wide, not target-document ACL', 'Transport-held cancellation does not prove transactional rollback of a server-side upload commit race'] };
  await writeFile(join(evidence, 'chief-platform-recording.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
} catch (error) {
  await writeFile(join(logs, 'recording-acceptance-failure.json'), JSON.stringify({ checkedAt: new Date().toISOString(), passed: false, mode, checks, error: summarizeError(error) }, null, 2) + '\n');
  console.error('Synthetic recording acceptance failed:', summarizeError(error));
  process.exitCode = 1;
} finally {
  releaseHeld?.();
  await context?.close();
  await api?.dispose();
  await browser.close();
}
