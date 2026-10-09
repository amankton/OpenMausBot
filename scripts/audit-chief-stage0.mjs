// Read-only inventory. Never inspect container environments or runtime records.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, '.chief-local/platform-source');
const output = resolve(process.argv[2] ?? join(root, 'work/chief-stage0-inventory.json'));
const run = (bin, args, cwd = root) => execFileSync(bin, args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trimEnd();
const git = (args, cwd = root) => run('git', args, cwd);
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const excluded = new Set(['node_modules', '.git', '.rush', 'dist', 'lib', 'rush-logs', '.validate', 'work']);
function walk(dir, accept) {
  const result = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (item.isSymbolicLink()) continue;
    const path = join(dir, item.name);
    if (item.isDirectory() && !excluded.has(item.name) && item.name !== '.chief-local') result.push(...walk(path, accept));
    else if (item.isFile() && accept(item.name)) result.push(path);
  }
  return result;
}
const describe = path => ({ path: relative(root, path).replaceAll('\\', '/'), sha256: sha(path) });
const sourceChanges = git(['status', '--porcelain', '-uall'], source).split('\n').filter(Boolean);
const sourceFiles = git(['ls-files', '--modified', '--others', '--exclude-standard', '-z'], source).split('\0').filter(Boolean);
const sourceTracked = git(['ls-files', '-z'], source).split('\0').filter(Boolean);
const packages = sourceTracked.filter(p => p.endsWith('package.json')).map(p => join(source, p)).map(path => {
  const p = json(path);
  return { ...describe(path), name: p.name, version: p.version, license: p.license ?? null };
});
const installed = [];
const store = join(root, 'node_modules/.pnpm');
if (existsSync(store)) for (const entry of readdirSync(store, { withFileTypes: true })) {
  const modules = join(store, entry.name, 'node_modules');
  if (!entry.isDirectory() || !existsSync(modules)) continue;
  for (const item of readdirSync(modules, { withFileTypes: true })) {
    if (!item.isDirectory() || item.isSymbolicLink()) continue;
    const paths = item.name.startsWith('@')
      ? readdirSync(join(modules, item.name)).map(n => join(modules, item.name, n))
      : [join(modules, item.name)];
    for (const path of paths) if (existsSync(join(path, 'package.json'))) {
      const p = json(join(path, 'package.json'));
      installed.push({ name: p.name, version: p.version, license: p.license ?? null, legacyLicenses: p.licenses ?? null,
        notices: readdirSync(path).filter(n => /^(licen[sc]e|notice|copying)/i.test(n)) });
    }
  }
}
const lock = json(join(root, 'integrations/platform/image-lock.json'));
const containers = [];
let dockerError;
try {
  const ids = run('docker', ['ps', '-q', '--filter', 'label=com.docker.compose.project=chief-platform']).split('\n').filter(Boolean);
  for (const id of ids) {
    const c = jsonFrom('docker', ['inspect', '--format', '{"name":{{json .Name}},"imageId":{{json .Image}},"configuredImage":{{json .Config.Image}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"state":{{json .State.Status}}}', id]);
    const image = jsonFrom('docker', ['image', 'inspect', '--format', '{"id":{{json .Id}},"repoDigests":{{json .RepoDigests}},"revision":{{with (index .Config "Labels")}}{{json (index . "org.opencontainers.image.revision")}}{{else}}null{{end}},"source":{{with (index .Config "Labels")}}{{json (index . "org.opencontainers.image.source")}}{{else}}null{{end}}}', c.imageId]);
    containers.push({ ...c, image, lockedDigest: lock.images[c.service]?.digest ?? null,
      matchesBaseLock: lock.images[c.service] ? image.repoDigests?.includes(lock.images[c.service].digest) === true : null });
  }
} catch (error) { dockerError = String(error.message).split('\n')[0]; }
function jsonFrom(bin, args) { return JSON.parse(run(bin, args)); }
const upstreamManifest = json(join(root, 'integrations/platform/upstream/source.json'));
const result = {
  schemaVersion: 1, observedAt: new Date().toISOString(), scope: 'metadata and source only; no runtime data or credentials',
  branch: git(['branch', '--show-current']), head: git(['rev-parse', 'HEAD']),
  statusAtInventory: git(['status', '--short', '--untracked-files=normal']).split('\n').filter(Boolean),
  baselineBranch: git(['rev-parse', 'codex/chief-executive-suite']),
  sourceHead: git(['rev-parse', 'HEAD'], source), sourceChanges,
  sourceModifiedHashes: [...new Set(sourceFiles)].filter(p => existsSync(join(source, p))).map(p => describe(join(source, p))),
  instructions: [...walk(root, n => n === 'AGENTS.md'), ...walk(source, n => n === 'AGENTS.md')].map(describe),
  submodules: { chief: git(['submodule', 'status']), platform: git(['submodule', 'status'], source), platformGitmodules: readFileSync(join(source, '.gitmodules'), 'utf8') },
  notices: [join(root, 'LICENSE'), join(root, 'integrations/platform/patches/FIX_WEBM_DURATION_LICENSE.txt'), ...walk(join(root, 'integrations/platform'), n => /^(LICENSE|NOTICE|COPYING)/i.test(n)), ...walk(source, n => /^(LICENSE|NOTICE|COPYING)/i.test(n))].map(describe),
  sourcePackages: packages, installedChiefPackages: [...new Map(installed.map(p => [p.name + '@' + p.version, p])).values()],
  upstreamHashes: upstreamManifest.files.map(f => ({ path: f.path, matches: sha(join(root, 'integrations/platform/upstream', f.path)) === f.sha256 })),
  patchFiles: walk(join(root, 'integrations/platform/patches'), n => /\.patch$|provenance\.json$|LICENSE/.test(n)).map(describe),
  containers, dockerError,
  limitations: ['Package manifest license fields and top-level notices are not a full distribution SBOM.', 'Image digest identifies bytes, not a source build attestation.', 'No owner database, container environment, credentials, or meeting records inspected.']
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ output, sourcePackages: packages.length, installedChiefPackages: result.installedChiefPackages.length, containers: containers.length, dockerError, instructions: result.instructions, sourceChanges: sourceChanges.length, upstreamHashes: result.upstreamHashes }, null, 2));
