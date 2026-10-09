import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const source = resolve(root, '.chief-local/platform-source');
const baseline = resolve(root, '.chief-local/raw-recording-baseline');
const destination = resolve(root, 'integrations/platform/patches');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const before = JSON.parse(await readFile(resolve(baseline, 'manifest.json'), 'utf8'));
const inputs = [];
let patch = '';
for (const [file, baselineHash] of Object.entries(before)) {
  const a = await readFile(resolve(baseline, file)), b = await readFile(resolve(source, file));
  if (sha(a) !== baselineHash) throw new Error(`Baseline changed: ${file}`);
  inputs.push({ file, baselineSha256: baselineHash, currentSha256: sha(b) });
  let diff;
  try { diff = execFileSync('git', ['diff', '--no-index', '--no-ext-diff', '--', resolve(baseline, file), resolve(source, file)], { encoding: 'utf8', maxBuffer: 1024 * 1024 }); }
  catch (error) { if (error.status !== 1) throw error; diff = error.stdout; }
  if (!diff) continue;
  const lines = diff.split('\n');
  lines[0] = `diff --git a/${file} b/${file}`;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].startsWith('--- ')) lines[i] = `--- a/${file}`;
    else if (lines[i].startsWith('+++ ')) lines[i] = `+++ b/${file}`;
  }
  patch += lines.join('\n');
}
const patchPath = resolve(destination, '0004-bounded-raw-recording.patch');
await writeFile(patchPath, patch);
execFileSync('git', ['apply', '--reverse', '--check', patchPath], { cwd: source, stdio: 'pipe' });
const previousPatches = {};
for (const name of ['0001-explicit-media-consent.patch', '0002-member-meeting-admission.patch', '0003-room-interaction.patch']) {
  previousPatches[name] = sha(await readFile(resolve(destination, name)));
}
await writeFile(resolve(destination, 'raw-recording-provenance.json'), JSON.stringify({
  sourceRevision: '03b7aad7dc562f4f9769c51a4df08191a0393997',
  license: 'EPL-2.0',
  baselineFrontendImage: 'sha256:c79fa3251ded2d6e6a3ff6e949e9c2d3138dd939b47ad393401a29b3b111cec7',
  description: 'Incremental patch over the edited source used for the frozen frontend image; apply after patches0001–0003.',
  patchSha256: sha(patch), previousPatches, inputs,
  durationRepair: { dependency: '@fix-webm-duration/fix@1.0.1', license: 'MIT', dependencyProvenanceSha256: sha(await readFile(resolve(destination, 'webm-duration-dependency.json'))), isolatedBrowserEvidenceSha256: sha(await readFile(resolve(root, 'docs/verification/evidence/chief-webm-duration.json'))), durationExcludesPauses: true, repairWaitLimitMs: 10000, synchronousParserPreemption: false },
  validation: { focusedTests: 30, reverseApplyCheck: true, packageTypes: 'presentation previously passed; recorder-resources revalidated after duration repair at 768 MiB', svelte: { errors: 0, warnings: 33, files: 1961, logSha256: sha(await readFile(resolve(root, '.chief-local/raw-recording-svelte-check.log'))), note: 'Prior raw increment check; duration repair makes no Svelte edits' }, productionBuild: 'previous attempt aborted safely by host memory floor; updated source not built', browserPlaybackAndAuthorization: 'isolated generated-canvas duration/seek passed; real attachment/auth acceptance not run', deployed: false }
}, null, 2) + '\n');
console.log(JSON.stringify({ files: inputs.length, patchSha256: sha(patch), reverseApplyCheck: true }));
