// Export the login wordmark over the accepted nine-patch frontend stack.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const directory = join(root, 'integrations/platform/patches');
const source = join(root, '.chief-local/platform-source');
const baseline = join(root, 'work/chief-login-logo-baseline');
const hash = value => createHash('sha256').update(value).digest('hex');
const previous = JSON.parse(readFileSync(join(directory, 'chief-branding-provenance.json'), 'utf8'));
const frozen = { ...previous.previousPatches, [previous.patch]: previous.patchSha256 };
for (const [name, expected] of Object.entries(frozen)) if (hash(readFileSync(join(directory, name))) !== expected) throw Error('Accepted patch changed: ' + name);
const paths = ['plugins/login-resources/src/components/LoginApp.svelte', 'plugins/login-resources/src/components/LoginAppBase.svelte', 'dev/prod/public/chief/wordmark-white.svg'];
const temporary = mkdtempSync(join(root, '.chief-local/login-logo-export-'));
const inputs = [];
for (const file of paths) {
  const after = readFileSync(join(source, file));
  const before = existsSync(join(baseline, file)) ? readFileSync(join(baseline, file)) : null;
  for (const [side, bytes] of [['old', before], ['new', after]]) {
    if (bytes === null) continue;
    const path = join(temporary, side, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes);
  }
  inputs.push({ file, beforeSha256: before === null ? null : hash(before), sha256: hash(after) });
}
const diff = spawnSync('git', ['-c', 'core.autocrlf=false', 'diff', '--no-index', '--no-ext-diff', '--', 'old', 'new'], { cwd: temporary, encoding: 'utf8', maxBuffer: 1024 * 1024 });
if (diff.status !== 1) throw Error('Expected scoped login logo diff');
const patch = diff.stdout.replaceAll('a/old/', 'a/').replaceAll('b/new/', 'b/').replaceAll('a/new/', 'a/');
const name = '0010-chief-login-wordmark.patch';
writeFileSync(join(directory, name), patch);
writeFileSync(join(directory, 'chief-login-logo-provenance.json'), JSON.stringify({ sourceRevision: previous.sourceRevision, createdAt: new Date().toISOString(), patch: name, patchSha256: hash(patch), previousPatches: frozen, assetSource: 'public/brand/chief-lockup-full-color-on-ink.svg', inputs }, null, 2) + '\n');
console.log(JSON.stringify({ patch: name, sha256: hash(patch), files: inputs.length }));
