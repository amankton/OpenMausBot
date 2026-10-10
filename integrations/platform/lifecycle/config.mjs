import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

const required = (env, name) => {
  const value = env[name];
  if (typeof value !== 'string' || !value.trim()) throw Error('Missing lifecycle configuration: ' + name);
  return value;
};
export async function secretFile(file) {
  if (!isAbsolute(file)) throw Error('Lifecycle secret paths must be absolute');
  const bytes = await readFile(file);
  if (!bytes.length || bytes.length > 16384) throw Error('Invalid lifecycle secret file');
  return bytes.toString('utf8').trim();
}
export async function encryptionKeyFile(file) {
  const value = await secretFile(file);
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw Error('Invalid lifecycle encryption key file');
  return Buffer.from(value, 'base64url');
}
export async function lifecycleConfig(env = process.env) {
  const mode = required(env, 'CHIEF_LIFECYCLE_MODE');
  if (!['staging', 'production'].includes(mode)) throw Error('Invalid lifecycle mode');
  const origin = required(env, 'CHIEF_LIFECYCLE_ORIGIN'), url = new URL(origin);
  if (url.origin !== origin || url.username || url.password ||
      !(url.protocol === 'https:' || (mode === 'staging' && url.protocol === 'http:' && ['127.0.0.1', 'localhost', '127.0.0.2'].includes(url.hostname)))) throw Error('Invalid lifecycle browser origin');
  const database = await secretFile(required(env, 'CHIEF_LIFECYCLE_DATABASE_URL_FILE'));
  const db = new URL(database);
  if (!['postgres:', 'postgresql:'].includes(db.protocol) || !db.username || ['root', 'postgres'].includes(db.username)) throw Error('Use a dedicated lifecycle database role');
  if (db.searchParams.get('sslmode') !== 'verify-full' && !(mode === 'staging' && env.CHIEF_LIFECYCLE_ALLOW_PLAINTEXT_DB === '1')) throw Error('Verified database TLS is required');
  const port = Number(env.CHIEF_LIFECYCLE_PORT ?? 8097);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid lifecycle port');
  const endpoint = name => {
    const value = required(env, name), parsed = new URL(value);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw Error('Invalid lifecycle authority endpoint');
    return value;
  };
  const policyFile = env.CHIEF_LIFECYCLE_POLICY_FILE;
  if (policyFile && !isAbsolute(policyFile)) throw Error('Lifecycle policy path must be absolute');
  return { mode, origin, database, port, host: env.CHIEF_LIFECYCLE_HOST ?? '127.0.0.1',
    accountsUrl: endpoint('CHIEF_LIFECYCLE_ACCOUNTS_URL'), transactorUrl: endpoint('CHIEF_LIFECYCLE_TRANSACTOR_URL'), policyFile,
    encryptionKey: await encryptionKeyFile(required(env, 'CHIEF_LIFECYCLE_ENCRYPTION_KEY_FILE')) };
}
