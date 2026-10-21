import { createServer as httpServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";
import { expect, test } from "vitest";
import { chiefPreviewProxy } from "./chief-preview-proxy.ts";

test("frame acknowledgements reuse backend connections while the live stream stays open", async () => {
  const ports = new Set<number>();
  const backend = httpServer((req, res) => {
    req.resume();
    ports.add(req.socket.remotePort!);
    if (req.url === "/api/stream") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("event: ready\ndata: {}\n\n");
    } else { res.setHeader("content-type", "application/json"); res.end('{"ok":true}'); }
  });
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  const target = `http://127.0.0.1:${(backend.address() as { port: number }).port}`;
  const proxy = chiefPreviewProxy(target);
  const root = await mkdtemp(join(tmpdir(), "chief-proxy-test-"));
  const ui = await createServer({ root, configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { watch: null, host: "127.0.0.1", port: 0, proxy: proxy.routes } });
  const controller = new AbortController();
  try {
    await ui.listen();
    const url = `http://127.0.0.1:${(ui.httpServer!.address() as { port: number }).port}`;
    const stream = await fetch(`${url}/api/stream`, { signal: controller.signal });
    expect(new TextDecoder().decode((await stream.body!.getReader().read()).value)).toContain("ready");
    for (let i = 0; i < 250; i++) {
      const response = await fetch(`${url}/api/browser/action`, { method: "POST", body: JSON.stringify({ type: "ack", seq: i }) });
      expect(await response.json()).toEqual({ ok: true });
    }
    expect(ports.size).toBeLessThanOrEqual(3);
  } finally {
    controller.abort();
    proxy.agent.destroy();
    await ui.close();
    backend.closeAllConnections();
    await new Promise<void>(resolve => backend.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
