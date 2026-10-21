// Documentation-only handoff. Never copies runtime data or application binaries.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(root, 'release/Chief-Mac-Codex-Handoff-2026-10-11');
if (existsSync(out)) throw new Error(`Refusing to overwrite an existing handoff: ${out}`);
const seeds = [
  'docs/operations/MAC-AGENT-HANDOFF.md',
  'docs/operations/MAC-TAILSCALE-SOP.md',
  'docs/operations/MAC-WHITE-LABEL-UPDATES-SOP.md',
  'docs/operations/CHIEF-BRANDING-AUDIT-2026-10-11.md',
  'docs/operations/INSTALLATION-RECORD.md',
  'docs/CHIEF_MAC_BUILD.md',
  'AGENTS.md',
];
const sha = data => createHash('sha256').update(data).digest('hex');
const outside = rel => rel === '..' || rel.startsWith('../') || path.isAbsolute(rel);
const sources = new Map();
const omitted = new Set();
function resolveLink(file, target) {
  if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('#')) return null;
  const withoutFragment = target.split('#')[0];
  const rel = path.relative(root, path.resolve(root, path.dirname(file), withoutFragment)).replaceAll('\\', '/');
  if (outside(rel)) throw new Error(`Reference escapes the repository: ${file}: ${target}`);
  return rel;
}
function transformLinks(text, transform) {
  let fenced = false;
  return text.split('\n').map(line => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return line; }
    if (fenced) return line;
    return line.replace(/(!?)\[([^\]]*)\]\(([^)]+)\)/g, (whole, image, label, target) => transform(whole, image, label, target));
  }).join('\n');
}
const queue = [...seeds];
while (queue.length) {
  const file = queue.shift();
  if (sources.has(file)) continue;
  if (sources.size > 300) throw new Error('Unexpectedly large documentation dependency graph; review before packaging.');
  if (file.split('/').some(p => p.startsWith('.') || p === 'node_modules' || p === 'work')) throw new Error(`Private/generated path refused: ${file}`);
  const bytes = readFileSync(path.join(root, file));
  const text = bytes.toString('utf8').replaceAll('\r\n', '\n');
  sources.set(file, { text, hash: sha(bytes) });
  transformLinks(text, (whole, image, label, target) => {
    const rel = resolveLink(file, target);
    if (!rel) return whole;
    if (rel.endsWith('.md')) {
      if (!existsSync(path.join(root, rel))) throw new Error(`Missing supporting document: ${rel}`);
      queue.push(rel);
    } else omitted.add(rel);
    return whole;
  });
}

const start = `# Start here: Chief Mac Codex handoff

Prepared October 11, 2026. **The Mac agent is already doing the branding audit. Continue that work; do not restart it or overwrite its findings.**

## Message to give Mac Codex

> Continue the branding audit already in progress. Read this file, then use the included Windows/source audit as comparison evidence, not as proof of this Mac's condition. Preserve your current findings, edits and the installed customer's customization. Reconcile the evidence and report the remaining Mac release gates. After the audit, use the included Tailscale and brand-preserving update SOPs for the next authorized work. Do not overwrite Chief with an upstream OpenMaus installer or treat an older source ZIP as current. Do not restart, reinstall, re-pair or change the running setup merely to read this package.

## Read in this order

1. [Prior source branding audit and open Mac gates](reference/docs/operations/CHIEF-BRANDING-AUDIT-2026-10-11.md).
2. [Mac-specific agent handoff](reference/docs/operations/MAC-AGENT-HANDOFF.md).
3. [Mac Tailscale setup and background operation](reference/docs/operations/MAC-TAILSCALE-SOP.md).
4. [Mac updates preserving brand and data](reference/docs/operations/MAC-WHITE-LABEL-UPDATES-SOP.md).
5. [Fill in the installation/acceptance record](INSTALLATION-RECORD.md).

The general update policy, Mac build instructions, repository verification procedures, original branding notes and their linked Markdown support documents are included under \`reference\`. Keep this whole folder together after extracting the ZIP. Documentation links work without the Windows computer. Internet links still require internet access.

## Scope and prerequisites

This is a documentation and audit handoff, **not application source, an installer or a runnable build**. It contains no runtime profiles, pairing databases, provider credentials, memory connection configuration or signing keys. Use the actual Chief source checkout and installed application already on the Mac. If the reviewed source is missing, identify that prerequisite before attempting a build; do not install upstream OpenMaus as a substitute.

Source-code and historical screenshot/JSON references that are not included have been converted to clearly labelled repository references rather than broken clickable links. Their inventory is in [SOURCE-REFERENCES.md](SOURCE-REFERENCES.md). Only supporting Markdown files are copied. Source filenames inside code blocks still refer to files in the real Chief checkout, not this handoff folder. Run application commands from that checkout, never from \`reference\`.

## What is already known, and what remains open

- The Windows/source audit found 18/18 original assets preserved and 29 focused tests passing. These are historical checks, not fresh Mac test results.
- The old Mac source ZIP predates the latest routines/OAuth compatibility fixes. Do not assume a shared 0.1.96 version means identical contents.
- A prior Mac handoff records an invalid signature and local repair. Verify the currently delivered app and final DMG rather than assuming that defect is either fixed or still present.
- Runtime brand.json does not replace all hardcoded/native Chief identities. Audit the customer's actual intended brand, app/helper IDs, icons, names, support links and signing identity.
- The standard Mac route requires an awake, signed-in host. Windows unattended settings do not apply.
- Current Mac evidence and the owner's latest instructions take precedence over dated records. Supporting documents include historical Windows, Linux and cloud procedures; they are reference material, not authorization to run them on this Mac.

## Return from the Mac agent

Provide the completed installation record plus: audit findings with paths/screenshots; current brand/build identity; resolved versus pending signing gates; exact changes and tests; Tailscale/cellular results if performed; safe next steps and any source/artifact prerequisites. Do not claim deployment from reading the SOPs.

## Verify transfer integrity

In Terminal, from this extracted folder:

\`\`\`sh
shasum -a 256 -c SHA256SUMS.txt
\`\`\`

The manifest records source and packaged document hashes. Copies have only their unavailable file links annotated; originals in the working repository are unchanged. Do not import the reference AGENTS.md into unrelated projects as new global instructions.
`;
const packaged = new Map([['START-HERE.md', start], ['INSTALLATION-RECORD.md', sources.get('docs/operations/INSTALLATION-RECORD.md').text]]);
const manifest = { preparedDate: '2026-10-11', timezone: 'America/Los_Angeles', kind: 'documentation-only', workflow: 'continue-in-progress-Mac-branding-audit', documents: [], unavailableRepositoryReferences: [...omitted].sort() };
for (const [file, source] of sources) {
  const text = transformLinks(source.text, (whole, image, label, target) => {
    const rel = resolveLink(file, target);
    if (!rel || sources.has(rel)) return whole;
    return `${label || 'Referenced file'} (repository reference: \`${rel}\`; not bundled)`;
  });
  const bundlePath = `reference/${file}`;
  packaged.set(bundlePath, text);
  manifest.documents.push({ source: file, sourceSHA256: source.hash, packagedPath: bundlePath, packagedSHA256: sha(text) });
}
packaged.set('SOURCE-REFERENCES.md', '# References requiring the Chief checkout or historical evidence\n\nThese are not supporting SOP documents. The handoff includes linked Markdown procedures, but does not include application code, executable scripts, historical media or runtime evidence. Consult the actual Chief checkout when a procedure calls for a script. Historical evidence is optional comparison material and does not establish the current Mac state.\n\n' + [...omitted].sort().map(p => `- \`${p}\``).join('\n') + '\n');
packaged.set('MANIFEST.json', JSON.stringify(manifest, null, 2) + '\n');

let checked = 0;
for (const [file, text] of packaged) {
  if (!file.endsWith('.md')) continue;
  transformLinks(text, (whole, image, label, target) => {
    if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('#')) return whole;
    const rel = path.posix.normalize(path.posix.join(path.posix.dirname(file), target.split('#')[0]));
    if (!packaged.has(rel)) throw new Error(`Broken portable link: ${file} -> ${target}`);
    checked++;
    return whole;
  });
}
packaged.set('SHA256SUMS.txt', [...packaged].map(([file, text]) => `${sha(text)}  ${file}`).join('\n') + '\n');
for (const [file, text] of packaged) {
  const target = path.join(out, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text, { encoding: 'utf8', flag: 'wx' });
}
console.log(JSON.stringify({ output: out, supportingDocuments: sources.size, files: packaged.size, localLinksChecked: checked, unavailableSourceReferences: omitted.size }, null, 2));
