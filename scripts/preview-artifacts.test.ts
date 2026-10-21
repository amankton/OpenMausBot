import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { createServer, optimizeDeps, resolveConfig } from "vite";
import config from "../vite.config.ts";
import { removeTempDir } from "../server/testing/cleanup.ts";

it("discovers app and lazy-route dependencies without crawling generated HTML", async () => {
  const project = fileURLToPath(new URL("../", import.meta.url));
  const root = await mkdtemp(join(tmpdir(), "chief-preview-deps-"));
  try {
    for (const directory of ["src", "work/evidence", ".chief-local", "release"]) await mkdir(join(root, directory), { recursive: true });
    await symlink(join(project, "node_modules"), join(root, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    await writeFile(join(root, "index.html"), '<script type="module" src="/src/main.ts"></script>');
    await writeFile(join(root, "src/main.ts"), 'import React from "react"; console.log(React); import("./page");');
    await writeFile(join(root, "src/page.ts"), 'import { createRoot } from "react-dom/client"; console.log(createRoot);');
    for (const directory of ["work/evidence", ".chief-local", "release"]) {
      await writeFile(join(root, directory, "capture.html"), '<script type="module">import "chief-generated-capture-must-not-resolve";</script>');
    }
    const resolved = await resolveConfig({ ...config, configFile: false, root, cacheDir: join(root, ".vite"), plugins: [], logLevel: "error" }, "serve");
    const metadata = await optimizeDeps(resolved);
    expect(metadata.optimized).toHaveProperty("react");
    expect(metadata.optimized).toHaveProperty("react-dom/client");
    expect(Object.keys(metadata.optimized)).not.toContain("chief-generated-capture-must-not-resolve");
  } finally {
    await removeTempDir(root);
  }
}, 30_000);

it("scans application and fixture styles without scanning generated evidence", async () => {
  const project = fileURLToPath(new URL("../", import.meta.url));
  const root = await mkdtemp(join(tmpdir(), "chief-preview-sources-"));
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    for (const directory of ["src", "work/evidence", ".release-validation", "scripts/testing"]) {
      await mkdir(join(root, directory), { recursive: true });
    }
    await symlink(join(project, "node_modules"), join(root, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    const styles = await readFile(join(project, "src/styles.css"), "utf8");
    // Use the real stylesheet's source declarations and real Tailwind plugin.
    await writeFile(join(root, "src/styles.css"), styles.split("@custom-variant touch")[0]!);
    await writeFile(join(root, "src/App.tsx"), '<div className="rounded-xl z-[194731]" />');
    await writeFile(join(root, "scripts/testing/fixture.tsx"), '<div className="z-[194732]" />');
    await writeFile(join(root, "work/evidence/capture.html"), '<div class="z-[194733]" />');
    await writeFile(join(root, ".release-validation/report.html"), '<div class="z-[194734]" />');
    await writeFile(join(root, "index.html"), '<link rel="stylesheet" href="/src/styles.css">');
    server = await createServer({
      ...config,
      configFile: false,
      root,
      cacheDir: join(root, ".vite"),
      logLevel: "error",
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { ...config.server, port: 0, strictPort: false, proxy: {} },
    });
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture address");
    const response = await fetch(`http://127.0.0.1:${address.port}/src/styles.css?direct`, { signal: AbortSignal.timeout(15_000) });
    expect(response.ok).toBe(true);
    const css = await response.text();
    expect(css).toContain("z-index: 194731");
    expect(css).toContain("z-index: 194732");
    expect(css).toContain(".rounded-xl");
    expect(css).not.toContain("z-index: 194733");
    expect(css).not.toContain("z-index: 194734");
  } finally {
    await server?.close();
    await removeTempDir(root);
  }
}, 30_000);
