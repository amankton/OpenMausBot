import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

export const chiefUiDirectory = (root: string) => join(root, ".chief-local", "ui");
const receiptPath = (root: string) => join(root, ".chief-local", "ui-build.json");

function filesUnder(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : entry.isFile() ? [path] : [];
  });
}
function hashFiles(root: string, files: string[]): string {
  const hash = createHash("sha256");
  for (const file of files.sort()) hash.update(relative(root, file).replaceAll("\\", "/")).update("\0").update(readFileSync(file)).update("\0");
  return hash.digest("hex");
}
export function chiefUiSourceHash(root: string): string {
  const files = ["src", "shared", "public", "scripts/testing"].flatMap(directory => filesUnder(join(root, directory)))
    .filter(file => !/\.test\.[cm]?[jt]sx?$/.test(file));
  for (const name of ["index.html", "package.json", "pnpm-lock.yaml", "vite.config.ts", "tsconfig.json"]) files.push(join(root, name));
  return hashFiles(root, files);
}
function artifactHash(root: string): string {
  const directory = chiefUiDirectory(root);
  if (!existsSync(join(directory, "index.html"))) throw new Error("Chief's built UI is missing. Run: node --experimental-strip-types scripts/build-chief-ui.ts");
  return hashFiles(directory, filesUnder(directory));
}
export function recordChiefUiBuild(root: string, sourceHash: string) {
  if (chiefUiSourceHash(root) !== sourceHash) throw new Error("UI source changed during the build; build again before starting Chief.");
  const receipt = { builtAt: new Date().toISOString(), sourceHash, artifactHash: artifactHash(root) };
  writeFileSync(receiptPath(root), JSON.stringify(receipt, null, 2) + "\n");
  return receipt;
}
/** Keep old content-hashed assets available to open clients; switch HTML last. */
export function publishChiefUiBuild(root: string, staging: string, sourceHash: string) {
  if (chiefUiSourceHash(root) !== sourceHash) throw new Error("UI source changed during the build; build again before publishing Chief.");
  const stagedIndex = join(staging, "index.html");
  if (!existsSync(stagedIndex)) throw new Error("The staged Chief UI has no index.html.");
  const output = chiefUiDirectory(root);
  for (const source of filesUnder(staging)) {
    if (source === stagedIndex) continue;
    const destination = join(output, relative(staging, source));
    mkdirSync(dirname(destination), { recursive: true });
    renameSync(source, destination);
  }
  mkdirSync(output, { recursive: true });
  // Staging is on the same volume, so replacement does not expose partial HTML.
  renameSync(stagedIndex, join(output, "index.html"));
  return recordChiefUiBuild(root, sourceHash);
}
export function assertChiefUiBuild(root: string) {
  if (!existsSync(receiptPath(root))) throw new Error("Chief's built UI is missing. Run: node --experimental-strip-types scripts/build-chief-ui.ts");
  const receipt = JSON.parse(readFileSync(receiptPath(root), "utf8")) as { builtAt: string; sourceHash: string; artifactHash: string };
  if (receipt.sourceHash !== chiefUiSourceHash(root) || receipt.artifactHash !== artifactHash(root)) {
    throw new Error("Chief's built UI is out of date. Run: node --experimental-strip-types scripts/build-chief-ui.ts (or use --dev explicitly).");
  }
  return receipt;
}
