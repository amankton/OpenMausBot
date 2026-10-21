import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WebSocket, WebSocketServer } from "ws";
import { expect, it } from "vitest";
import { assertChiefUiBuild, chiefUiDirectory, chiefUiSourceHash, publishChiefUiBuild, recordChiefUiBuild } from "./chief-ui-build.ts";
import { readFile } from "node:fs/promises";
import { serveChiefUi } from "./chief-ui-server.ts";
import { removeTempDir } from "../server/testing/cleanup.ts";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "chief-built-ui-"));
  await mkdir(join(root, "src"));
  await mkdir(join(chiefUiDirectory(root), "assets"), { recursive: true });
  for (const name of ["index.html", "package.json", "pnpm-lock.yaml", "vite.config.ts", "tsconfig.json"]) await writeFile(join(root, name), "{}");
  await writeFile(join(root, "src/main.ts"), "private-source-sentinel");
  await writeFile(join(root, ".chief-local/media.json"), "private-runtime-sentinel");
  await writeFile(join(chiefUiDirectory(root), "index.html"), '<html><body><div id="root">Built Chief</div><script type="module" src="/assets/app-123.js"></script></body></html>');
  await writeFile(join(chiefUiDirectory(root), "assets/app-123.js"), 'console.log("built");');
  recordChiefUiBuild(root, chiefUiSourceHash(root));
  return root;
}

it("rejects missing, stale, or altered builds before opening a listener", async () => {
  const root = await fixture();
  try {
    expect(assertChiefUiBuild(root).sourceHash).toBe(chiefUiSourceHash(root));
    await writeFile(join(root, "src/main.ts"), "changed-source");
    await expect(serveChiefUi({ root, target: "http://127.0.0.1:1", port: 0 })).rejects.toThrow("out of date");
    recordChiefUiBuild(root, chiefUiSourceHash(root));
    await writeFile(join(chiefUiDirectory(root), "assets/app-123.js"), "changed-output");
    expect(() => assertChiefUiBuild(root)).toThrow("out of date");
    const absent = join(root, "absent");
    expect(() => assertChiefUiBuild(absent)).toThrow("missing");
  } finally { await removeTempDir(root); }
});

it("publishes complete staged assets before switching HTML and retains assets for open clients", async () => {
  const root = await fixture();
  const staging = join(root, ".chief-local/ui-next-test");
  try {
    await mkdir(join(staging, "assets"), { recursive: true });
    await writeFile(join(staging, "index.html"), '<script src="/assets/app-new.js"></script>');
    await writeFile(join(staging, "assets/app-new.js"), "new-asset");
    const oldIndex = await readFile(join(chiefUiDirectory(root), "index.html"), "utf8");
    expect(() => publishChiefUiBuild(root, staging, "stale")).toThrow("source changed");
    expect(await readFile(join(chiefUiDirectory(root), "index.html"), "utf8")).toBe(oldIndex);
    publishChiefUiBuild(root, staging, chiefUiSourceHash(root));
    expect(await readFile(join(chiefUiDirectory(root), "index.html"), "utf8")).toContain("app-new.js");
    expect(await readFile(join(chiefUiDirectory(root), "assets/app-new.js"), "utf8")).toBe("new-asset");
    expect(await readFile(join(chiefUiDirectory(root), "assets/app-123.js"), "utf8")).toContain("built");
    expect(assertChiefUiBuild(root).sourceHash).toBe(chiefUiSourceHash(root));
  } finally { await removeTempDir(root); }
});

it("serves built SPA routes and preserves same-origin API, SSE and WebSocket transport", async () => {
  const root = await fixture();
  const backend = createServer((req, res) => {
    if (req.url === "/api/events") { res.writeHead(200, { "content-type": "text/event-stream" }); res.write('data: {"ready":true}\n\n'); }
    else { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ path: req.url, cookie: req.headers.cookie, origin: req.headers.origin })); }
  });
  const socketServer = new WebSocketServer({ server: backend });
  socketServer.on("connection", socket => socket.on("message", data => socket.send(data)));
  backend.listen(0, "127.0.0.1"); await once(backend, "listening");
  const target = `http://127.0.0.1:${(backend.address() as { port: number }).port}`;
  let ui: Awaited<ReturnType<typeof serveChiefUi>> | undefined;
  const controller = new AbortController();
  let socket: WebSocket | undefined;
  try {
    ui = await serveChiefUi({ root, target, port: 0 });
    for (const route of ["", "workspace", "pair", "desktop-viewer"]) {
      const response = await fetch(new URL(route, ui.url));
      expect(response.ok).toBe(true);
      const html = await response.text();
      expect(html).toContain("Built Chief");
      expect(html).not.toContain("/@vite/client");
    }
    expect(await (await fetch(new URL("assets/app-123.js", ui.url))).text()).toContain('console.log("built")');
    for (const route of ["src/main.ts", ".chief-local/media.json"]) {
      expect(await (await fetch(new URL(route, ui.url))).text()).not.toContain("sentinel");
    }
    const api = await fetch(new URL("api/health", ui.url), { headers: { cookie: "fixture=session", origin: ui.url.slice(0, -1) } });
    expect(await api.json()).toEqual({ path: "/api/health", cookie: "fixture=session", origin: ui.url.slice(0, -1) });
    expect((await (await fetch(new URL(".well-known/openmausbot/environment", ui.url))).json()).path).toBe("/.well-known/openmausbot/environment");
    const stream = await fetch(new URL("api/events", ui.url), { signal: controller.signal });
    expect(new TextDecoder().decode((await stream.body!.getReader().read()).value)).toContain('"ready":true');
    socket = new WebSocket(new URL("api/ws", ui.url).href.replace("http:", "ws:"));
    await once(socket, "open");
    const reply = once(socket, "message"); socket.send("fixture-echo");
    expect(String((await reply)[0])).toBe("fixture-echo");
  } finally {
    controller.abort(); socket?.terminate();
    for (const client of socketServer.clients) client.terminate();
    await ui?.close();
    socketServer.close(); backend.closeAllConnections();
    await new Promise<void>(resolve => backend.close(() => resolve()));
    await removeTempDir(root);
  }
}, 20_000);
