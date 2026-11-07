import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { createConnection, createServer } from "node:net";
import test from "node:test";
import { loopbackServerPortAvailable } from "./server-port-availability.mjs";

async function listen(server, port = 0) {
  server.listen({ host: "127.0.0.1", port, exclusive: true });
  await once(server, "listening");
  return server.address().port;
}
const close = server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));

test("an occupied IPv4 loopback port is skipped without disturbing its listener", async () => {
  const owner = createServer();
  const port = await listen(owner);
  try {
    assert.equal(await loopbackServerPortAvailable(port), false);
    assert.equal(owner.listening, true);
    assert.equal(await loopbackServerPortAvailable(port), false);
  } finally { await close(owner); }
});

test("an available port is reported only after the probe releases its socket", async () => {
  const previous = createServer();
  const port = await listen(previous);
  await close(previous);
  assert.equal(await loopbackServerPortAvailable(port), true);
  const next = createServer();
  await listen(next, port);
  await close(next);
});

test("a connection racing the short-lived probe is closed instead of holding startup open", { timeout: 5000 }, async t => {
  const previous = createServer();
  const port = await listen(previous);
  await close(previous);
  let client, probe;
  t.after(() => { client?.destroy(); if (probe?.listening) probe.close(); });
  const available = await loopbackServerPortAvailable(port, { createServerImpl: onConnection => {
    probe = createServer(onConnection);
    const originalListen = probe.listen.bind(probe);
    probe.listen = (options, onListening) => originalListen(options, () => {
      client = createConnection({ host: options.host, port: options.port });
      client.once("close", onListening);
    });
    return probe;
  } });
  assert.equal(available, true);
  assert.equal(client.destroyed, true);
  assert.equal(probe.listening, false);
});

test("unexpected bind errors fail closed, close the probe and retain a safe diagnostic", async () => {
  const probe = new EventEmitter();
  let closed = 0;
  probe.unref = () => {};
  probe.listen = options => {
    assert.deepEqual(options, { host: "127.0.0.1", port: 18899, exclusive: true });
    queueMicrotask(() => probe.emit("error", Object.assign(new Error("private diagnostic"), { code: "EACCES" })));
  };
  probe.close = callback => { closed++; callback(Object.assign(new Error("not running"), { code: "ERR_SERVER_NOT_RUNNING" })); };
  await assert.rejects(loopbackServerPortAvailable(18899, { createServerImpl: () => probe }), { message: "Cannot check desktop server port 18899: EACCES" });
  assert.equal(closed, 1);
});

test("synchronous bind and close errors cannot report an available port", async () => {
  for (const bindThrows of [true, false]) {
    const probe = new EventEmitter();
    let closed = 0;
    probe.unref = () => {};
    probe.listen = (_options, callback) => {
      if (bindThrows) throw Object.assign(new Error("private diagnostic"), { code: "EINVAL" });
      callback();
    };
    probe.close = callback => { closed++; callback(Object.assign(new Error("private diagnostic"), { code: "EIO" })); };
    await assert.rejects(loopbackServerPortAvailable(18899, { createServerImpl: () => probe }), { message: `Cannot check desktop server port 18899: ${bindThrows ? "EINVAL" : "EIO"}` });
    assert.equal(closed, 1);
  }
});

test("invalid ports fail before allocating a socket", () => {
  for (const port of [0, -1, 65536, 1.5, "8899", NaN]) {
    assert.throws(() => loopbackServerPortAvailable(port, { createServerImpl: () => { throw Error("must not allocate"); } }), /Invalid desktop server port/);
  }
});
