// Reconstruct the reviewed source in a fresh private directory; never edit the live checkout.
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname, resolve, sep } from 'node:path';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const source = join(root, '.chief-local/platform-source');
const directory = join(root, 'integrations/platform/patches');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const lf = bytes => bytes.toString('utf8').replace(/\r\n/g, '\n');
export const frontendPatchNames = ['0001-explicit-media-consent.patch', '0002-member-meeting-admission.patch', '0003-room-interaction.patch', '0004-bounded-raw-recording.patch', '0005-consented-meeting-capture.patch', '0006-card-body-editor-actions.patch', '0007-visible-media-devices.patch', '0008-embedded-media-playback.patch'];

export async function verifyFrontendPatchStack() {
  const raw = JSON.parse(await readFile(join(directory, 'raw-recording-provenance.json'), 'utf8'));
  const capture = JSON.parse(await readFile(join(directory, 'meeting-capture-provenance.json'), 'utf8'));
  const card = JSON.parse(await readFile(join(directory, 'card-editor-provenance.json'), 'utf8'));
  const devices = JSON.parse(await readFile(join(directory, 'device-label-provenance.json'), 'utf8'));
  const playback = JSON.parse(await readFile(join(directory, 'embedded-playback-provenance.json'), 'utf8'));
  const revision = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (revision !== '03b7aad7dc562f4f9769c51a4df08191a0393997' || raw.sourceRevision !== revision) throw Error('Unexpected pinned source revision.');
  const patches = [], paths = new Set(), patchHashes = {};
  for (const name of frontendPatchNames) {
    const bytes = await readFile(join(directory, name));
    const expected = name.startsWith('0008-') ? playback.patchSha256 : name.startsWith('0007-') ? devices.patchSha256 : name.startsWith('0006-') ? card.patchSha256 : name.startsWith('0005-') ? capture.patchSha256 : name.startsWith('0004-') ? raw.patchSha256 : raw.previousPatches[name];
    if (!expected || sha(bytes) !== expected) throw Error(`Patch differs from the frozen stack baseline: ${name}`);
    if(name < '0008-' && playback.previousPatches[name]!==expected)throw Error(`Playback patch does not preserve the accepted stack: ${name}`);
    if(name < '0007-' && devices.previousPatches[name]!==expected)throw Error(`Device patch does not preserve the accepted stack: ${name}`);
    if(name < '0006-' && card.previousPatches[name]!==expected)throw Error(`Card patch does not preserve the accepted stack: ${name}`);
    patchHashes[name] = expected;
    const content = lf(bytes);
    const matches = [...content.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)];
    if (!matches.length) throw Error(`Missing patch paths: ${name}`);
    for (const [, before, after] of matches) {
      if (before !== after || !/^[\w./-]+$/.test(after) || after.split('/').some(part => part === '..' || part === '.')) throw Error(`Unsupported patch path: ${name}`);
      paths.add(after);
    }
    patches.push({ name, content });
  }
  const temp = await mkdtemp(join(root, '.chief-local/platform-patch-check-'));
  const tree = join(temp, 'tree');
  await mkdir(tree);
  const tracked = new Set(execFileSync('git', ['-C', source, 'ls-tree', '-r', '--name-only', '-z', revision, '--', ...paths], { encoding: 'utf8' }).split('\0').filter(Boolean));
  for (const path of tracked) {
    const target = resolve(tree, path);
    if (!target.startsWith(tree + sep)) throw Error('Patch reconstruction path escaped its temporary directory.');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, execFileSync('git', ['-C', source, 'show', `${revision}:${path}`], { maxBuffer: 8 * 1024 * 1024 }));
  }
  execFileSync('git', ['init', '--quiet', tree], { stdio: 'pipe' });
  for (const [index, patch] of patches.entries()) {
    const path = join(temp, patch.name);
    await writeFile(path, patch.content);
    execFileSync('git', ['-C', tree, '-c', 'core.autocrlf=false', 'apply', '--check', path], { stdio: 'pipe' });
    execFileSync('git', ['-C', tree, '-c', 'core.autocrlf=false', 'apply', path], { stdio: 'pipe' });
    if (index === 2) {
      // The baseline was captured on Windows. Accept only LF/CRLF conversion,
      // not whitespace/content changes, when comparing the portable Git tree.
      for (const input of raw.inputs) {
        const canonical = lf(await readFile(join(tree, input.file)));
        if (![sha(canonical), sha(canonical.replace(/\n/g, '\r\n'))].includes(input.baselineSha256)) throw Error(`Patch0004 baseline differs from ordered patches0001–0003: ${input.file}`);
      }
    }
    if(index===3)for(const input of capture.inputs.filter(input=>input.beforeSha256)){
      const canonical=lf(await readFile(join(tree,input.file)));
      if(![sha(canonical),sha(canonical.replace(/\n/g,'\r\n'))].includes(input.beforeSha256))throw Error(`Capture baseline differs from ordered patches0001–0004: ${input.file}`);
    }
    if(index===4)for(const input of card.inputs){
      const canonical=lf(await readFile(join(tree,input.file)));
      if(![sha(canonical),sha(canonical.replace(/\n/g,'\r\n'))].includes(input.beforeSha256))throw Error(`Card baseline differs from ordered patches0001–0005: ${input.file}`);
    }
    if(index===5)for(const input of devices.inputs){
      const canonical=lf(await readFile(join(tree,input.file)));
      if(![sha(canonical),sha(canonical.replace(/\n/g,'\r\n'))].includes(input.beforeSha256))throw Error(`Device baseline differs from ordered patches0001–0006: ${input.file}`);
    }
    if(index===6)for(const input of playback.inputs){
      const canonical=lf(await readFile(join(tree,input.file)));
      if(![sha(canonical),sha(canonical.replace(/\n/g,'\r\n'))].includes(input.beforeSha256))throw Error(`Playback baseline differs from ordered patches0001–0007: ${input.file}`);
    }
  }
  for (const path of paths) {
    if (lf(await readFile(join(source, path))) !== lf(await readFile(join(tree, path)))) throw Error(`Current source differs from reconstructed ordered patch stack: ${path}`);
  }
  for (const input of raw.inputs) {
    if (sha(await readFile(join(source, input.file))) !== input.currentSha256) throw Error(`Raw-recording source differs from provenance: ${input.file}`);
  }
  for(const input of capture.inputs)if(sha(await readFile(join(source,input.file)))!==input.sha256)throw Error(`Capture source differs from provenance: ${input.file}`);
  for(const input of card.inputs)if(sha(await readFile(join(source,input.file)))!==input.sha256)throw Error(`Card source differs from provenance: ${input.file}`);
  for(const input of devices.inputs)if(sha(await readFile(join(source,input.file)))!==input.sha256)throw Error(`Device source differs from provenance: ${input.file}`);
  for(const input of playback.inputs)if(sha(await readFile(join(source,input.file)))!==input.sha256)throw Error(`Playback source differs from provenance: ${input.file}`);
  return { sourceRevision: revision, patchOrder: frontendPatchNames, patchHashes, filesVerified: paths.size, baselineImage: raw.baselineFrontendImage, newlineNormalization: 'LF/CRLF only', reconstructedFromPinnedUpstream: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await verifyFrontendPatchStack()));
