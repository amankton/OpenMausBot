import { createServer, type Server } from "node:http";
import { afterEach, expect, it } from "vitest";
import { createControlClient } from "./control-client.ts";
import { createGateInterceptor } from "./mcp-bridge.ts";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});

it("allows a first desktop claim that completes after the old two-second deadline", async () => {
  const server = createServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ held: false, helpOpen: false }));
    }, 2_200);
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing fixture address");
  const client = createControlClient({ url: `http://127.0.0.1:${address.port}`, token: "synthetic" });
  const forwarded: string[] = [];
  const refused: string[] = [];
  let reason: string | undefined;
  const gate = createGateInterceptor({
    isHeld: async () => { const state = await client.state(true); reason = state.blockedReason; return state.held; },
    getRefusalReason: () => reason,
    forward: line => forwarded.push(line), refuse: line => refused.push(line),
  });
  const call = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_windows" } });
  await gate(call);
  expect(refused).toEqual([]);
  expect(forwarded).toEqual([call]);
}, 10_000);

it("recovers the same gate after an interrupted access service without replaying actions", async () => {
  let connected = true;
  let auth = true;
  const server = createServer((req, res) => {
    if (!connected) { req.socket.destroy(); return; }
    res.writeHead(auth ? 200 : 401, { "content-type": "application/json" });
    res.end(JSON.stringify({ held: false, helpOpen: false }));
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing fixture address");
  const client = createControlClient({ url: `http://127.0.0.1:${address.port}`, token: "synthetic" });
  let reason: string | undefined;
  const forwarded: number[] = [];
  const refused: any[] = [];
  const gate = createGateInterceptor({
    isHeld: async () => { const state = await client.state(true); reason = state.blockedReason; return state.held; },
    getRefusalReason: () => reason,
    forward: line => forwarded.push(JSON.parse(line).id), refuse: line => refused.push(JSON.parse(line)),
  });
  const call = (id: number) => gate(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call" }));
  await call(1);
  connected = false;
  await call(2);
  expect(refused[0].result.content[0].text).toMatch(/could not reach/i);
  expect(refused[0].result.content[0].text).not.toMatch(/credentials|person has taken/i);
  connected = true;
  auth = false;
  await call(3);
  expect(refused[1].result.content[0].text).toMatch(/authorization.*401/i);
  auth = true;
  await call(4);
  expect(forwarded).toEqual([1, 4]);
  expect(refused.map(frame => frame.id)).toEqual([2, 3]);
});
