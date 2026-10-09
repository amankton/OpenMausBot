// Local-only image assembly after compiled synthetic browser consent verification.
import { readFile, writeFile, mkdir, mkdtemp, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname, resolve, sep } from 'node:path';
import { verifyFrontendPatchStack, frontendPatchNames } from './verify-frontend-patch-stack.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const source = join(root, '.chief-local/platform-source');
const runtime = join(root, '.chief-local/platform');
const logs = join(root, '.chief-local/platform-build-logs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const buildBytes = await readFile(join(logs, 'production-build-receipt.json'));
const build = JSON.parse(buildBytes);
const browserBytes = await readFile(join(logs, 'consent-browser.json'));
const browser = JSON.parse(browserBytes);
const recordingBytes = await readFile(join(root, 'docs/verification/evidence/chief-platform-recording.json'));
const recording = JSON.parse(recordingBytes);
const captureBytes = await readFile(join(root, 'docs/verification/evidence/chief-platform-capture.json'));
const capture = JSON.parse(captureBytes);
const templateBytes=await readFile(join(root,'docs/verification/evidence/chief-platform-extended-templates-compiled.json'));
const templates=JSON.parse(templateBytes);
const embeddedBytes=await readFile(join(root,'docs/verification/evidence/chief-embedded-playback-compiled.json'));
const embedded=JSON.parse(embeddedBytes);
const lock = JSON.parse(await readFile(join(root, 'integrations/platform/image-lock.json'), 'utf8'));
if (build.productionConfigurationsPassed !== 2 || build.sourceRevision !== lock.platformSourceRevision ||
    build.minifier?.format !== 'iife' ||
    browser.sourceRevision !== build.sourceRevision || browser.consentChecksPassed !== true ||
    browser.buildReceiptSha256 !== hash(buildBytes)) {
  throw new Error('Matching production build and successful compiled browser consent receipts are required.');
}
const patchStack = await verifyFrontendPatchStack();
if(embedded.passed!==true||embedded.mode!=='compiled'||embedded.syntheticOnly!==true||embedded.fakeDevicesOnly!==true||embedded.partitionedCookieVerified!==true||embedded.buildReceiptSha256!==hash(buildBytes)||embedded.patchSha256!==patchStack.patchHashes['0008-embedded-media-playback.patch'])throw Error('Matching embedded Drive recording playback and cookie partition acceptance is required.');
if (browser.deviceLabelsPassed !== true) throw new Error('Compiled microphone, audio output and camera label acceptance is required.');
if(templates.passed!==true||templates.mainBodyTemplate!==true||templates.buildReceiptSha256!==hash(buildBytes)||templates.mode!=='compiled'||!Array.isArray(templates.servedBuiltAssets)||!templates.servedBuiltAssets.includes('index.html'))throw Error('Matching compiled main Card body template acceptance is required.');
if(capture.passed!==true||capture.syntheticOnly!==true||capture.fakeInputsOnly!==true||capture.buildReceiptSha256!==hash(buildBytes)||capture.capturePatchSha256!==patchStack.patchHashes['0005-consented-meeting-capture.patch'])throw Error('Matching successful synthetic consented meeting capture acceptance is required.');
if (recording.passed !== true || recording.syntheticOnly !== true || recording.fakeInputsOnly !== true ||
    recording.sourceRevision !== build.sourceRevision || recording.buildReceiptSha256 !== hash(buildBytes) ||
    recording.rawPatchSha256 !== patchStack.patchHashes['0004-bounded-raw-recording.patch']) {
  throw new Error('Matching successful synthetic raw-recording browser acceptance is required.');
}
for (const name of ['build-frontend.mjs', 'frontend-minify-options.mjs', 'frontend-memory-policy.mjs']) {
  if (hash(await readFile(new URL(name, import.meta.url))) !== build.buildRecipe?.[name]) throw new Error(`Build recipe changed: ${name}`);
}
for (const [name, expected] of Object.entries(build.inputs)) {
  if (hash(await readFile(join(source, name))) !== expected) throw new Error(`Reviewed build input changed: ${name}`);
}
const changedFrontendFiles = [
  ...execFileSync('git', ['-C', source, 'diff', '--name-only', '-z', '--', 'plugins', 'models', 'packages', 'dev/prod'], { encoding: 'utf8' }).split('\0'),
  ...execFileSync('git', ['-C', source, 'ls-files', '--others', '--exclude-standard', '-z', '--', 'plugins', 'models', 'packages', 'dev/prod'], { encoding: 'utf8' }).split('\0')
].filter(Boolean);
if (changedFrontendFiles.some(name => !(name in build.inputs))) throw new Error('Additional frontend source changed after the reviewed build.');
const baseImage = lock.images.front.digest;
const baseId = execFileSync('docker', ['image', 'inspect', '--format', '{{.Id}}', baseImage], { encoding: 'utf8' }).trim();
if (!/^sha256:[a-f0-9]{64}$/.test(baseId)) throw new Error('Pinned base image is not installed.');
const dockerfile = join(root, 'integrations/platform/Frontend.Dockerfile');
if (!(await readFile(dockerfile, 'utf8')).includes(`FROM ${baseImage}`)) throw new Error('Dockerfile differs from the locked base.');
const context = await mkdtemp(join(root, '.chief-local/platform-front-build-'));
const copy = async (from, to) => { await mkdir(dirname(to), { recursive: true }); await copyFile(from, to); };
for (const [name, asset] of Object.entries(build.assets)) {
  const from = resolve(source, 'dev/prod/dist', name);
  if (!from.startsWith(join(source, 'dev/prod/dist') + sep)) throw new Error('Unexpected emitted asset path.');
  if (hash(await readFile(from)) !== asset.sha256) throw new Error(`Built asset changed: ${name}`);
  await copy(from, join(context, 'dist', name));
}
// Match upstream front packaging: public tracked assets, excluding runtime config.json.
const publicFiles = [...new Set([
  ...execFileSync('git', ['-C', source, 'ls-files', '-z', 'dev/prod/public'], { encoding: 'utf8' }).split('\0').filter(Boolean),
  ...Object.keys(build.inputs).filter(name => name.startsWith('dev/prod/public/')),
])];
for (const name of publicFiles) {
  const relative = name.slice('dev/prod/public/'.length);
  if (relative === 'config.json') continue;
  await copy(join(source, name), join(context, 'dist', relative));
}
const notices = join(context, 'source-notice');
await copy(join(source, 'LICENSE'), join(notices, 'LICENSE'));
const patchHashes = patchStack.patchHashes;
for (const name of frontendPatchNames) {
  const from = join(root, 'integrations/platform/patches', name);
  await copy(from, join(notices, name));
}
await copy(join(root, 'integrations/platform/patches/raw-recording-provenance.json'), join(notices, 'raw-recording-provenance.json'));
await copy(join(root, 'integrations/platform/patches/RAW_RECORDING.md'), join(notices, 'RAW_RECORDING.md'));
await copy(join(root, 'integrations/platform/patches/FIX_WEBM_DURATION_LICENSE.txt'), join(notices, 'FIX_WEBM_DURATION_LICENSE.txt'));
await copy(join(root, 'integrations/platform/patches/webm-duration-dependency.json'), join(notices, 'webm-duration-dependency.json'));
await copy(join(root, 'integrations/platform/patches/meeting-capture-provenance.json'), join(notices, 'meeting-capture-provenance.json'));
await copy(join(root, 'docs/architecture/chief-meeting-capture.md'), join(notices, 'chief-meeting-capture.md'));
await writeFile(join(notices, 'capture-browser.json'), captureBytes);
await copy(join(root,'integrations/platform/patches/card-editor-provenance.json'),join(notices,'card-editor-provenance.json'));
await copy(join(root,'integrations/platform/patches/device-label-provenance.json'),join(notices,'device-label-provenance.json'));
await copy(join(root,'integrations/platform/patches/MEDIA_DEVICE_LABELS.md'),join(notices,'MEDIA_DEVICE_LABELS.md'));
await copy(join(root,'integrations/platform/patches/embedded-playback-provenance.json'),join(notices,'embedded-playback-provenance.json'));
await copy(join(root,'integrations/platform/patches/EMBEDDED_PLAYBACK.md'),join(notices,'EMBEDDED_PLAYBACK.md'));
await copy(join(root,'integrations/platform/patches/chief-branding-provenance.json'),join(notices,'chief-branding-provenance.json'));
await copy(join(root,'integrations/platform/patches/chief-login-logo-provenance.json'),join(notices,'chief-login-logo-provenance.json'));
await copy(join(root,'integrations/platform/patches/chief-login-icon-provenance.json'),join(notices,'chief-login-icon-provenance.json'));
await copy(join(root,'integrations/platform/patches/CHIEF_BRANDING.md'),join(notices,'CHIEF_BRANDING.md'));
await writeFile(join(notices,'embedded-playback-browser.json'),embeddedBytes);
await writeFile(join(notices,'card-template-browser.json'),templateBytes);
await writeFile(join(notices, 'recording-browser.json'), recordingBytes);
await writeFile(join(notices, 'provenance.json'), JSON.stringify({ repository: 'https://github.com/Platform-Collective/platform', sourceRevision: build.sourceRevision, baseImage, buildReceiptSha256: hash(buildBytes), recordingReceiptSha256: hash(recordingBytes), templateReceiptSha256: hash(templateBytes), patchHashes, patchStack }, null, 2));
await copy(join(logs, 'production-build-receipt.json'), join(notices, 'production-build-receipt.json'));
await writeFile(join(context, '.dockerignore'), '*\n!dist/\n!dist/**\n!source-notice/\n!source-notice/**\n');
const tag = `chief-platform-front:source-${build.sourceRevision.slice(0, 8)}-${Date.now()}`;
execFileSync('docker', ['build', '--pull=false', '--network=none', '--iidfile', join(context, 'image-id'), '--tag', tag, '--file', dockerfile, context], { stdio: 'inherit' });
const image = (await readFile(join(context, 'image-id'), 'utf8')).trim();
if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error('Build did not produce an immutable image ID.');
const receipt = { name: 'front', image, tag, sourceRevision: build.sourceRevision, baseImage, baseImageId: baseId, builtAt: new Date().toISOString(), webpackReceiptSha256: hash(buildBytes), browserReceiptSha256: hash(browserBytes), recordingReceiptSha256: hash(recordingBytes), captureReceiptSha256: hash(captureBytes), templateReceiptSha256: hash(templateBytes), patchHashes, patchStack, deploymentChanged: false, serverBundle: 'Unmodified pinned upstream runtime; source-built frontend assets replaced.' };
receipt.embeddedPlaybackReceiptSha256 = hash(embeddedBytes);
await writeFile(join(runtime, 'front-image.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt));
