import { readFile } from 'node:fs/promises';
import { digest } from './security.mjs';

export async function migrationFiles() {
  return await Promise.all(['001-pairing.sql', '002-membership-epoch.sql', '003-tracker-actions.sql'].map(async (file, index) => {
    const sql = await readFile(new URL(file, import.meta.url), 'utf8');
    return { version: index + 1, sql, checksum: digest(sql) };
  }));
}
export async function verifySchema(sql) {
  const rows = await sql`SELECT version, checksum FROM chief_lifecycle.schema_version ORDER BY version`;
  const migrations = await migrationFiles();
  if (rows.length !== migrations.length || migrations.some((m, i) => rows[i].version !== m.version || rows[i].checksum !== m.checksum)) {
    throw Error('Lifecycle schema is missing or differs from this release');
  }
}
