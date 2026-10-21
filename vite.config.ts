import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The About dialog shows the shipped version; package.json is the one place
// it is already maintained, so it is inlined at build time rather than
// round-tripped through the preload bridge (which is absent in dev).
const { version } = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"),
) as { version: string };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The optimizer's default HTML crawl ignores neither runtime captures nor
  // packaging output. Start at the actual app; its lazy routes are discovered
  // through imports, without scanning work/, .chief-local/, or release/.
  optimizeDeps: { entries: ["index.html"] },
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  test: {
    environment: "node",
    include: [
      "evals/**/*.test.ts",
      "server/**/*.test.ts",
      "electron/**/*.test.mjs",
      "src/**/*.test.ts",
      "shared/**/*.test.ts",
      "companion/**/*.test.ts",
      "enterprise/**/*.test.ts",
      "scripts/**/*.test.mjs",
      "scripts/**/*.test.ts",
    ],
    setupFiles: ["server/testing/setup.ts"],
    // the suite spawns fake provider CLIs and a real harness server;
    // parallel files introduce load-sensitive flakes for no win
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    // IPv4 explicitly — a bare ::1 bind makes localhost a coin-flip for
    // clients that resolve IPv4 first
    host: "127.0.0.1",
    port: Number(process.env.OMB_UI_PORT) || 5299,
    // Generated evidence and packager output must not trigger CSS rebuilds
    // or full-page reloads while the app is being exercised.
    watch: {
      ignored: ["**/.chief-local/**", "**/work/**", "**/.release-validation/**", "**/.worktrees/**", "**/release/**", "**/build/**", "**/dist/**", "**/electron/resources/**"],
    },
    // Local media keys, launch metadata and recovery snapshots are private
    // runtime files, never dev-server source assets (including /@fs access).
    fs: { deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/.chief-local/**"] },
    // the harness server owns every provider process; the app only ever
    // talks to /api — clients hold no transports
    proxy: {
      "/api": {
        ws: true,
        target: `http://127.0.0.1:${process.env.OMB_PORT || process.env.OGB_PORT || 8899}`,
      },
      "/.well-known/openmausbot/environment": {
        target: `http://127.0.0.1:${process.env.OMB_PORT || process.env.OGB_PORT || 8899}`,
      },
    },
  },
});
