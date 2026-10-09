import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, relative, basename, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { DatabaseSync, backup } from "node:sqlite";

// Preserve only this Chief launcher's own temporary workspace. Never discover
// or snapshot an installed application's data, and never print file contents.
const root = fileURLToPath(new URL("..", import.meta.url));
const info = JSON.parse(await readFile(join(root, ".chief-local/preview.json"), "utf8"));
const source = resolve(info.dataDir);
const withinTemp = relative(resolve(tmpdir()), source);
if (!withinTemp || withinTemp.startsWith("..") || isAbsolute(withinTemp) || !basename(source).startsWith("openmausbot-verify-data-")) throw new Error("Preview data is not this launcher's temporary workspace");
const destination = join(root, ".chief-local", "recovery", new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(destination, { recursive: true, mode: 0o700 });
await cp(source, join(destination, "workspace"), {
  recursive: true,
  filter: path => {
    const local = relative(source, path).replaceAll("\\", "/");
    // SQLite's online backup captures a consistent DB, including its WAL.
    return !["tmp", "messages.db", "messages.db-wal", "messages.db-shm", "openmausbot-server.lease"].some(excluded => local === excluded || local.startsWith(`${excluded}/`));
  },
});
let messageDatabaseVerified = false;
if (existsSync(join(source, "messages.db"))) {
  const database = new DatabaseSync(join(source, "messages.db"), { readOnly: true });
  try { await backup(database, join(destination, "workspace/messages.db")); } finally { database.close(); }
  const recovered = new DatabaseSync(join(destination, "workspace/messages.db"), { readOnly: true });
  try {
    const result = recovered.prepare("PRAGMA quick_check").get();
    if (result?.quick_check !== "ok") throw new Error("Recovered message database failed its integrity check");
    messageDatabaseVerified = true;
  } finally { recovered.close(); }
}
await writeFile(join(destination, "recovery.json"), JSON.stringify({ createdAt: new Date().toISOString(), originalDataDir: source, originalBackendUrl: info.url, note: "Private local recovery snapshot. Includes newly configured preview provider state. Keep private. Restore only to this Chief preview after stopping its launcher; absolute provider paths may require restoring to originalDataDir. JSON files are atomically copied; the message database uses SQLite online backup." }, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ recoveredTo: destination, messageDatabaseVerified, originalPreviewUnchanged: true }));
