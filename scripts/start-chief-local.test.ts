import { mkdtempSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { removeTempDir } from "../server/testing/cleanup.ts";
import { chiefUiSourceHash, recordChiefUiBuild } from "./chief-ui-build.ts";
import { chiefIsHealthy, chiefPortAvailable, launchSavedChief, startChiefLocal } from "./start-chief-local.ts";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await removeTempDir(root); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "chief-node-start-"));
  roots.push(root);
  for (const dir of [".chief-local/ui", "data", "scripts"]) mkdirSync(join(root, dir), { recursive: true });
  for (const name of ["index.html", "package.json", "pnpm-lock.yaml", "vite.config.ts", "tsconfig.json"]) writeFileSync(join(root, name), "{}");
  for (const name of ["config.json", "bots.json"]) writeFileSync(join(root, "data", name), '{"sentinel":"preserve"}');
  writeFileSync(join(root, ".chief-local/preview.json"), JSON.stringify({ dataDir: join(root, "data"), previewUrl: "http://127.0.0.1:5299", media: "local LiveKit", pairingOrigin: "http://localhost:18087" }));
  writeFileSync(join(root, ".chief-local/ui/index.html"), "built");
  recordChiefUiBuild(root, chiefUiSourceHash(root));
  return root;
}
function dependencies() {
  return { healthy: vi.fn(async () => false), portAvailable: vi.fn(async () => true), launch: vi.fn(async () => 0) };
}

it("refuses missing saved data and stale UI before any probe or launcher", async () => {
  const root = fixture();
  const deps = dependencies();
  unlinkSync(join(root, "data/bots.json"));
  await expect(startChiefLocal({ root }, deps)).rejects.toThrow("bots.json");
  writeFileSync(join(root, "data/bots.json"), "{}");
  writeFileSync(join(root, "index.html"), "changed");
  await expect(startChiefLocal({ root }, deps)).rejects.toThrow("out of date");
  expect(deps.healthy).not.toHaveBeenCalled();
  expect(deps.launch).not.toHaveBeenCalled();
});

it("checks readiness without probing, writing data, or starting processes", async () => {
  const root = fixture();
  const deps = dependencies();
  const before = readFileSync(join(root, "data/bots.json"), "utf8");
  expect(await startChiefLocal({ root, checkOnly: true }, deps)).toMatchObject({ status: "ready" });
  expect(deps.healthy).not.toHaveBeenCalled();
  expect(readFileSync(join(root, "data/bots.json"), "utf8")).toBe(before);
});

it("does not duplicate a healthy instance or replace an occupied unhealthy port", async () => {
  const root = fixture();
  const deps = dependencies();
  deps.healthy.mockResolvedValue(true);
  expect(await startChiefLocal({ root }, deps)).toMatchObject({ status: "running" });
  expect(deps.portAvailable).not.toHaveBeenCalled();
  deps.healthy.mockResolvedValue(false);
  deps.portAvailable.mockResolvedValue(false);
  await expect(startChiefLocal({ root }, deps)).rejects.toThrow("occupied");
  expect(deps.launch).not.toHaveBeenCalled();
});

it("preserves optional services and returns child failure without replacing data", async () => {
  const root = fixture();
  const deps = dependencies();
  deps.launch.mockResolvedValue(7);
  expect(await startChiefLocal({ root }, deps)).toMatchObject({ status: "exited", exitCode: 7 });
  expect(deps.launch).toHaveBeenCalledWith(root, ["--with-local-media", "--with-chief-pairing"]);
  expect(readFileSync(join(root, "data/config.json"), "utf8")).toContain("preserve");
  writeFileSync(join(root, "index.html"), "changed");
  await startChiefLocal({ root, development: true }, deps);
  expect(deps.launch).toHaveBeenLastCalledWith(root, ["--dev", "--with-local-media", "--with-chief-pairing"]);
});

it("runs a real isolated child with separate output logs and propagates its exit code", async () => {
  const root = fixture();
  writeFileSync(join(root, "scripts/chief-preview.ts"), 'console.log(JSON.stringify(process.argv.slice(2))); console.error("fixture-error"); process.exitCode = 9;');
  expect(await launchSavedChief(root, ["--with-local-media"])).toBe(9);
  const logs = readdirSync(join(root, ".chief-local")).filter(name => name.startsWith("startup-"));
  expect(logs).toHaveLength(2);
  expect(logs.map(name => readFileSync(join(root, ".chief-local", name), "utf8")).join("\n")).toContain("fixture-error");
  expect(logs.map(name => readFileSync(join(root, ".chief-local", name), "utf8")).join("\n")).toContain("--with-local-media");
});

it("bounds actual health requests and recognizes occupied loopback listeners", async () => {
  let app = "openmausbot";
  const server = createServer((req, res) => {
    if (req.url === "/api/health") res.end(JSON.stringify({ app }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  try {
    expect(await chiefPortAvailable(port)).toBe(false);
    expect(await chiefIsHealthy(`http://127.0.0.1:${port}`)).toBe(true);
    app = "unrelated-service";
    expect(await chiefIsHealthy(`http://127.0.0.1:${port}`)).toBe(false);
    expect(await chiefIsHealthy(`http://127.0.0.1:${port}/unanswered`, 50)).toBe(false);
  } finally { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
  expect(await chiefPortAvailable(port)).toBe(true);
});
