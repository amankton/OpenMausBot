import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, lstat, readdir, open, unlink, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';

export const digest = data => createHash('sha256').update(data).digest('hex');
export function inside(root, name) {
  if (typeof name !== 'string' || !name || name.includes('\0') || isAbsolute(name)) throw Error('Invalid relative file');
  const path = resolve(root, name), rel = relative(resolve(root), path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw Error('File escapes its installation');
  return path;
}
export async function regularFile(root, name) {
  const path = inside(root, name), rel = relative(await realpath(root), await realpath(path));
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || !(await lstat(path)).isFile()) throw Error('Unsafe installation file');
  let cursor = path;
  while (cursor !== resolve(root)) { if ((await lstat(cursor)).isSymbolicLink()) throw Error('Linked installation file'); cursor = dirname(cursor); }
  return path;
}
export async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try { if ((await lstat(path)).isSymbolicLink()) throw Error('Linked state file refused'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
}
export function defaultHome(platform = process.platform, env = process.env) {
  if (env.CHIEF_SETUP_HOME) { if (!isAbsolute(env.CHIEF_SETUP_HOME)) throw Error('CHIEF_SETUP_HOME must be absolute'); return resolve(env.CHIEF_SETUP_HOME); }
  return platform === 'win32' ? join(env.LOCALAPPDATA || join(homedir(), 'AppData/Local'), 'ChiefSetup', 'LocalPilot') : join(homedir(), 'Library/Application Support/ChiefSetup/LocalPilot');
}
export async function privateHome(path) {
  const absolute = resolve(path);
  let parent = absolute;
  for (;;) {
    try { if ((await lstat(parent)).isSymbolicLink()) throw Error('Linked setup directory refused'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (dirname(parent) === parent) break; parent = dirname(parent);
  }
  await mkdir(absolute, { recursive: true, mode: 0o700 });
  const marker = join(absolute, 'installation.json');
  try { const info = await lstat(marker); if (!info.isFile() || info.isSymbolicLink() || info.size > 16384) throw Error('Invalid installation marker'); return JSON.parse(await readFile(marker, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if ((await readdir(absolute)).length) throw Error('Setup directory is not empty and has no Chief installation identity');
  if (process.platform === 'win32') {
    const sid = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'], { encoding: 'utf8', windowsHide: true }).trim();
    if (!/^S-1-[\d-]+$/.test(sid)) throw Error('Cannot secure setup directory');
    execFileSync('icacls.exe', [absolute, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { stdio: 'pipe', windowsHide: true });
  }
  const value = { schemaVersion: 1, id: randomUUID(), kind: 'chief-local-pilot', createdAt: new Date().toISOString() };
  await atomicJson(marker, value); return value;
}
export async function acquireLock(home) {
  const path = join(home, 'setup.lock');
  let file;
  try { file = await open(path, 'wx', 0o600); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const record = JSON.parse(await readFile(path, 'utf8'));
    try { process.kill(record.pid, 0); } catch (probe) {
      if (probe.code !== 'ESRCH') throw Error('Cannot establish setup lock ownership');
      await unlink(path); return acquireLock(home);
    }
    throw Error('Another Chief setup process is running');
  }
  const nonce = randomBytes(24).toString('hex');
  await file.writeFile(JSON.stringify({ pid: process.pid, nonce })); await file.close();
  return async () => { const value = JSON.parse(await readFile(path, 'utf8')); if (value.nonce !== nonce) throw Error('Setup lock changed'); await unlink(path); };
}
export async function verifyPayload(root, manifest) {
  if (manifest.schemaVersion !== 1 || manifest.kind !== 'engineering-test-bundle' || !Array.isArray(manifest.files)) throw Error('Unsupported testing manifest');
  const seen = new Set();
  for (const entry of manifest.files) {
    if (seen.has(entry.path) || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw Error('Invalid payload inventory');
    seen.add(entry.path);
    const bytes = await readFile(await regularFile(root, entry.path));
    if (digest(bytes) !== entry.sha256) throw Error(`Transfer integrity failed: ${entry.path}`);
  }
  return manifest.files.length;
}
export function execute(command, args, { cwd, env = process.env, timeout = 1800000, signal, onOutput = () => {} } = {}) {
  return new Promise((done, fail) => {
    // Windows .cmd launchers need a shell; arguments are single-quoted PowerShell
    // literals, never interpolated shell expressions. No credential arguments.
    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)) {
      const quote = s => `'${String(s).replaceAll("'", "''")}'`;
      args = ['-NoProfile', '-NonInteractive', '-Command', '& ' + [command, ...args].map(quote).join(' ')]; command = 'powershell.exe';
    }
    const child = spawn(command, args, { cwd, env, windowsHide: true, signal, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const collect = bytes => { const text = bytes.toString(); output = (output + text).slice(-16000); onOutput(text); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    const timer = setTimeout(() => { child.kill(); fail(Error('Installation step timed out; check its state before retrying')); }, timeout);
    child.on('error', e => { clearTimeout(timer); fail(e); });
    child.on('exit', code => { clearTimeout(timer); if (code === 0) done(output.trim()); else fail(Error(`${command.split(/[\\/]/).pop()} exited ${code}; review the local installation log`)); });
  });
}
export async function download(artifact, target, { fetcher = fetch, maxBytes = 1024 ** 3 * 2 } = {}) {
  const allowed = new Set(['nodejs.org', 'registry.npmjs.org', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'desktop.docker.com']);
  if (!artifact || !/^[a-f0-9]{64}$/.test(artifact.sha256)) throw Error('A locked SHA-256 is required');
  let url = new URL(artifact.url), response;
  for (let n = 0; n < 6; n++) {
    if (url.protocol !== 'https:' || !allowed.has(url.hostname) || url.username || url.password) throw Error('Unapproved download origin');
    response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(600000) });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    await response.body?.cancel(); url = new URL(response.headers.get('location'), url);
    if (n === 5) throw Error('Too many download redirects');
  }
  if (!response?.ok || !response.body) throw Error('Dependency download failed');
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const partial = target + '.partial-' + randomUUID(), file = await open(partial, 'wx', 0o600), hash = createHash('sha256'); let total = 0;
  try {
    for await (const chunk of response.body) { total += chunk.byteLength; if (total > maxBytes) throw Error('Download exceeds its size limit'); hash.update(chunk); await file.write(chunk); }
    if (hash.digest('hex') !== artifact.sha256) throw Error('Dependency checksum mismatch');
    await file.close(); await rename(partial, target); return target;
  } catch (e) { await file.close().catch(() => {}); await unlink(partial).catch(() => {}); throw e; }
}
