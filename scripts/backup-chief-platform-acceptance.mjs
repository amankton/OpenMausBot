/** Supported backup of either exact Chief workspace. No model upgrade or live service replacement. */
import { readFileSync, writeFileSync, mkdirSync, lstatSync, realpathSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { execFileSync, spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const local = resolve(root, '.chief-local/platform');
const options = process.argv.slice(2);
if (new Set(options).size !== options.length || options.some(option => !['--owner-read-only', '--meeting-repair'].includes(option))) throw Error('Only exact workspace and meeting repair backup options are accepted.');
const owner = options.includes('--owner-read-only');
const repair = options.includes('--meeting-repair');
const slug = owner ? 'chiefexecutivesuite' : 'chiefacceptance';
const uuid = owner ? '5d4f208d-e8ca-4bec-809c-f8ea0556d37f' : 'b3ece3dc-e200-41c7-a9d8-2cb86c8c9fdb';
const sourceRevision = '03b7aad7dc562f4f9769c51a4df08191a0393997';
const folder = resolve(local, `backups/${slug}-${repair ? 'before-meeting-repair-20261007' : 'before-admission'}`);
const container = `chief-platform-${slug}-backup`;
const digest = data => createHash('sha256').update(data).digest('hex');
const docker = (args, options = {}) => execFileSync('docker', args, { encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024, ...options }).trim();
const regular = path => { if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink() || realpathSync(path).toLowerCase() !== path.toLowerCase()) throw Error('Expected regular private file.'); return readFileSync(path); };
const context = docker(['context', 'show']);
if (!/^(npipe|unix):\/\//.test(docker(['context', 'inspect', context, '--format', '{{.Endpoints.docker.Host}}']))) throw Error('Local Docker only.');
for (const service of ['cockroach', 'account', 'transactor']) {
  const item = JSON.parse(docker(['inspect', `chief-platform-${service}-1`]))[0];
  const labels = item.Config.Labels;
  if (!item.State.Running || labels['com.docker.compose.project'] !== 'chief-platform' || labels['com.docker.compose.service'] !== service || resolve(labels['com.docker.compose.project.working_dir']).toLowerCase() !== resolve(root, 'integrations/platform').toLowerCase()) throw Error('Chief service ownership could not be verified.');
}
if (docker(['network', 'inspect', 'chief-platform_backend', '--format', '{{index .Labels "com.docker.compose.project"}}']) !== 'chief-platform') throw Error('Expected private Chief network.');
const verified = docker(['exec', '-i', 'chief-platform-cockroach-1', 'sh', '-c', 'exec cockroach sql --url="postgresql://$COCKROACH_USER:$COCKROACH_PASSWORD@localhost:26257/chief_platform?sslmode=disable" --format=csv'], { input: `SELECT uuid,url FROM global_account.workspace WHERE url='${slug}';` });
if (verified.replaceAll('\r', '') !== `uuid,url\n${uuid},${slug}`) throw Error('Workspace slug/UUID mismatch.');
const images = {};
for (const name of ['tool', 'transactor', 'workspace']) {
  const receipt = JSON.parse(regular(resolve(local, `${name}-image.json`)));
  if (receipt.name !== name || receipt.sourceRevision !== sourceRevision || !/^sha256:[a-f0-9]{64}$/.test(receipt.image)) throw Error('Unreviewed tool/model image.');
  if (docker(['image', 'inspect', receipt.image, '--format', '{{.Id}}']) !== receipt.image) throw Error('Image unavailable.');
  images[name] = receipt.image;
}
if (existsSync(folder)) throw Error('Backup folder already exists; preserve evidence and inspect it before another run.');
mkdirSync(folder, { recursive: true });
if (realpathSync(folder).toLowerCase() !== folder.toLowerCase()) throw Error('Unexpected backup path redirect.');
const values = Object.fromEntries(regular(resolve(local, 'platform.env')).toString().split(/\r?\n/).filter(Boolean).map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
const env = { SERVER_SECRET: values.CHIEF_PLATFORM_SECRET, ACCOUNT_DB_URL: values.CHIEF_PLATFORM_DB_URL, DB_URL: values.CHIEF_PLATFORM_DB_URL, STORAGE_CONFIG: values.CHIEF_PLATFORM_STORAGE, ACCOUNTS_URL: 'http://account:3000', TRANSACTOR_URL: 'ws://transactor:3333', QUEUE_CONFIG: 'redpanda:9092', FULLTEXT_URL: 'http://fulltext:4700', KVS_URL: 'http://kvs:8094', NODE_OPTIONS: '--max-old-space-size=384' };
if (Object.values(env).some(value => !value || /[\r\n]/.test(value))) throw Error('Required private configuration unavailable.');
const envPath = resolve(local, 'migration-tool.env');
writeFileSync(envPath, Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 });
const args = ['run', '--name', container, '--label', 'io.chief.verification=acceptance-backup', '--network', 'chief-platform_backend', '--memory', '512m', '--cpus', '0.75', '--env-file', envPath, '--mount', `type=bind,source=${folder},target=/backup`, images.tool, 'node', 'bundle.js', 'backup', '/backup', uuid, '--fullVerify'];
let output = '';
let backupFailure;
try { const result = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 }); output = String(result.stdout ?? '') + '\n' + String(result.stderr ?? ''); if (result.status !== 0) throw Error('Backup tool failed; inspect the private backup log.'); }
catch (error) { backupFailure = error; }
let cleanupFailure;
try {
  writeFileSync(resolve(folder, 'tool.log'), output, { mode: 0o600 });
  const state = JSON.parse(docker(['inspect', container]))[0];
  if (state.Config.Labels['io.chief.verification'] !== 'acceptance-backup' || state.Image !== images.tool) throw Error('Backup container ownership changed.');
  if (state.State.Running) throw Error('Backup container is still running; no forced stop performed.');
  docker(['rm', container]);
}
catch (error) { cleanupFailure = error; }
if (backupFailure && cleanupFailure) throw new AggregateError([backupFailure, cleanupFailure], 'Backup failed and cleanup also requires attention.');
if (backupFailure) throw backupFailure;
if (cleanupFailure) throw cleanupFailure;
if (/Failed to backup workspace|backup error|Error:|please provide/i.test(output)) throw Error('Backup output reports a failure; inspect private log.');
const manifest = regular(resolve(folder, 'backup.json.gz'));
const info = JSON.parse(gunzipSync(manifest));
if (info.workspace !== uuid || !info.lastTxId || info.snapshots?.length !== 1 || !Object.keys(info.snapshots[0].domains).length || !/end backup/.test(output)) throw Error('Incomplete workspace backup.');
const files = {};
function walk(path) { for (const entry of readdirSync(path, { withFileTypes: true })) { const full = resolve(path, entry.name); if (entry.isDirectory()) walk(full); else if (entry.name !== 'tool.log') files[relative(folder, full).replaceAll('\\', '/')] = digest(regular(full)); } }
walk(folder);
for (const domain of Object.values(info.snapshots[0].domains)) for (const file of [...domain.snapshots ?? [], ...domain.storage ?? [], ...domain.snapshot ? [domain.snapshot] : []]) if (!files[file]) throw Error('Referenced backup file missing.');
const receipt = { schemaVersion: 1, status: 'passed', slug, uuid, completedAt: new Date().toISOString(), sourceRevision, images, manifestSha256: digest(manifest), logSha256: digest(output), files, domains: Object.keys(info.snapshots[0].domains), existingLiveServicesReplaced: false, ownerWorkspaceModified: false };
const receiptPath = resolve(folder, 'receipt.json');
writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ status: receipt.status, slug, uuid, receiptPath: relative(local, receiptPath).replaceAll('\\', '/'), receiptSha256: digest(readFileSync(receiptPath)), manifestSha256: receipt.manifestSha256, fileCount: Object.keys(files).length, domainCount: receipt.domains.length }));
