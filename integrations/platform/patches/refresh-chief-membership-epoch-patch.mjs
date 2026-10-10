// Separate Accounts patch: not a frontend patch or permission to migrate live DB.
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const source = join(root, '.chief-local/platform-source');
const files = ['server/account/src/collections/postgres/migrations.ts', 'server/account/src/collections/postgres/postgres.ts', 'server/account/src/__tests__/postgres.test.ts'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const revision = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (revision !== '03b7aad7dc562f4f9769c51a4df08191a0393997') throw Error('Unexpected Accounts baseline');
const patch = execFileSync('git', ['-C', source, '-c', 'core.autocrlf=false', 'diff', '--no-ext-diff', '--', ...files]);
const inputs = await Promise.all(files.map(async file => ({ file,
  beforeSha256: sha(execFileSync('git', ['-C', source, 'show', `${revision}:${file}`])), sha256: sha(await readFile(join(source, file))) })));
const name = 'chief-accounts-membership-epochs.patch';
await writeFile(new URL(name, import.meta.url), patch);
await writeFile(new URL('chief-accounts-membership-epochs-provenance.json', import.meta.url), JSON.stringify({
  sourceRevision: revision, createdAt: new Date().toISOString(), patch: name, patchSha256: sha(patch), inputs,
  scope: 'Additive Accounts SQL membership epochs, atomic role-change epoch replacement, public current-member response. Requires separate Accounts image and migration; no live deployment.'
}, null, 2) + '\n');
console.log(JSON.stringify({ patch: name, files: files.length, sha256: sha(patch) }));
