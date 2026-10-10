// Export only CON-01 source changes against the retained pre-edit snapshot.
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const source = join(root, '.chief-local/platform-source');
const baseline = join(root, '.chief-local/m1-pairing/native-before');
const directory = join(root, 'integrations/platform/patches');
const existing = ['packages/presentation/src/index.ts', 'plugins/setting-resources/src/components/integrations/Integrations.svelte', 'plugins/setting-resources/src/components/Settings.svelte', 'plugins/workbench-resources/src/connect.ts', 'plugins/workbench-resources/src/utils.ts'];
const added = ['packages/presentation/src/chief-session.ts', 'plugins/setting-resources/src/components/integrations/ChiefPairing.svelte'];
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => value.toString('utf8').replace(/\r\n/g, '\n');
const temp = await mkdtemp(join(root, '.chief-local/m1-pairing/patch-'));
const parts = [], inputs = [];
for (const file of [...existing, ...added]) {
  const after = await readFile(join(source, file));
  const before = existing.includes(file) ? await readFile(join(baseline, file)) : null;
  if (before !== null) {
    await writeFile(join(temp, 'before'), canonical(before)); await writeFile(join(temp, 'after'), canonical(after));
    let patch;
    try { patch = execFileSync('git', ['diff', '--no-index', '--no-ext-diff', '--', join(temp, 'before'), join(temp, 'after')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { if (error.status !== 1) throw error; patch = error.stdout; }
    parts.push(patch.replace(/^diff --git .*$/m, `diff --git a/${file} b/${file}`).replace(/^--- .*$/m, `--- a/${file}`).replace(/^\+\+\+ .*$/m, `+++ b/${file}`));
  } else {
    const lines = canonical(after).replace(/\n$/, '').split('\n');
    parts.push(`diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(line => '+' + line).join('\n')}\n`);
  }
  inputs.push({ file, beforeSha256: before === null ? null : hash(before), sha256: hash(after) });
}
const icon = JSON.parse(await readFile(join(directory, 'chief-login-icon-provenance.json'), 'utf8'));
const patch = '0012-chief-member-pairing.patch', content = parts.join('');
await writeFile(join(directory, patch), content);
await writeFile(join(directory, 'chief-member-pairing-provenance.json'), JSON.stringify({
  sourceRevision: icon.sourceRevision, createdAt: new Date().toISOString(), patch, patchSha256: hash(content),
  previousPatches: { ...icon.previousPatches, [icon.patch]: icon.patchSha256 }, inputs,
  scope: 'CON-01 browser approval and logout/account-switch hooks; service remains disabled until configured; no dispatch'
}, null, 2) + '\n');
console.log(JSON.stringify({ patch, files: inputs.length }));
