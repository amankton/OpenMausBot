import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { build } from "vite";
import { assertChiefUiBuild, chiefUiSourceHash, publishChiefUiBuild } from "./chief-ui-build.ts";
import { removeTempDir } from "../server/testing/cleanup.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
if (process.argv.includes("--check")) {
  console.log(JSON.stringify({ status: "ready", ...assertChiefUiBuild(root) }));
} else {
  const sourceHash = chiefUiSourceHash(root);
  const runtime = join(root, ".chief-local");
  mkdirSync(runtime, { recursive: true });
  const staging = mkdtempSync(join(runtime, "ui-next-"));
  try {
    await build({ root, build: { outDir: staging, emptyOutDir: true } });
    console.log(JSON.stringify(publishChiefUiBuild(root, staging, sourceHash)));
  } finally { await removeTempDir(staging); }
}
