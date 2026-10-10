import { pathToFileURL } from 'node:url';
import postgres from './driver.mjs';
import { lifecycleConfig, encryptionKeyFile } from './config.mjs';
import { fileEntitlements } from './entitlements.mjs';
import { accountsMemberVerifier } from './member.mjs';
import { PairingService, migratePairing, transaction } from './pairing.mjs';
import { credentialVault } from './security.mjs';
import { verifySchema } from './migrations.mjs';
export { verifySchema } from './migrations.mjs';
import { createLifecycleServer } from './http.mjs';

export async function rotateCredentials(sql, oldKey, newKey) {
  const oldVault = credentialVault(oldKey), newVault = credentialVault(newKey);
  await transaction(sql, async tx => {
    const rows = await tx`SELECT id, workspace, account, credential FROM chief_lifecycle.member_session WHERE revoked_at IS NULL FOR UPDATE`;
    for (const row of rows) {
      const binding = `${row.workspace}:${row.account}:${row.id}`;
      const replacement = newVault.seal(oldVault.open(row.credential, binding), binding);
      await tx`UPDATE chief_lifecycle.member_session SET credential=${replacement} WHERE id=${row.id}`;
    }
  });
}
export async function main(command = process.argv[2] ?? 'serve') {
  if (!['serve', 'migrate', 'rotate-key', 'revoke-all'].includes(command)) throw Error('Unknown lifecycle operation');
  const config = await lifecycleConfig();
  const sql = postgres(config.database, { max: 8, connect_timeout: 5, idle_timeout: 20, onnotice() {} });
  let server;
  try {
    if (command === 'migrate') { await migratePairing(sql); return; }
    await verifySchema(sql);
    if (command === 'rotate-key') {
      const key = await encryptionKeyFile(process.env.CHIEF_LIFECYCLE_NEW_KEY_FILE ?? '');
      await rotateCredentials(sql, config.encryptionKey, key); return;
    }
    const pairing = new PairingService({ sql, encryptionKey: config.encryptionKey,
      verifyMember: accountsMemberVerifier(config), entitlement: fileEntitlements({ file: config.policyFile, mode: config.mode }) });
    if (command === 'revoke-all') {
      await transaction(sql, async tx => {
        const sessions = await tx`SELECT id FROM chief_lifecycle.member_session WHERE revoked_at IS NULL FOR UPDATE`;
        for (const session of sessions) await pairing.revokeSession(tx, session.id);
      }); return;
    }
    server = createLifecycleServer({ pairing, origin: config.origin, readiness: async () => { await sql`SELECT 1`; } });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve); });
    console.log(JSON.stringify({ event: 'chief-lifecycle-ready', mode: config.mode, port: config.port }));
    await new Promise(resolve => { process.once('SIGTERM', resolve); process.once('SIGINT', resolve); });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await sql.end({ timeout: 5 });
  }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(() => { console.error('Lifecycle operation failed; check configuration, authority availability and schema.'); process.exitCode = 1; });
}
