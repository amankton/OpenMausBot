// Export only the consent-owned source files; preserve other contributors' patches.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const source = fileURLToPath(new URL('../../../.chief-local/platform-source/', import.meta.url));
const metadataUrl = new URL('./source-provenance.json', import.meta.url);
const metadata = JSON.parse(await readFile(metadataUrl, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const files = [...new Set([...metadata.modifiedFiles.map(file => file.path),
  'plugins/media-resources/src/components/MediaPopup.svelte',
  'plugins/media-resources/src/components/MediaPopupCamPreview.svelte'
])].sort();
if (execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== metadata.revision) {
  throw new Error('Source revision differs from reviewed release.');
}
const patch = execFileSync('git', ['-C', source, 'diff', '--no-ext-diff', '--', ...files], { maxBuffer: 1024 * 1024 });
await writeFile(new URL('./0001-explicit-media-consent.patch', import.meta.url), patch);
metadata.patchSha256 = hash(patch);
metadata.modifiedFiles = await Promise.all(files.map(async path => ({
  path,
  baseSha256: hash(execFileSync('git', ['-C', source, 'show', `${metadata.revision}:${path}`])),
  patchedSha256: hash(await readFile(join(source, path)))
})));
metadata.verification.sharedMediaValidationPending = true;
await writeFile(metadataUrl, JSON.stringify(metadata, null, 2) + '\n');
console.log(`Exported consent patch for ${files.length} files; other source edits excluded.`);
