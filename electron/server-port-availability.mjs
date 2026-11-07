import { createServer } from "node:net";

// This is only a preflight, not a reservation. The child's existing identity
// probe still handles another process taking the port after this socket closes.
export function loopbackServerPortAvailable(port, { createServerImpl = createServer } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError("Invalid desktop server port");
  return new Promise((resolve, reject) => {
    const server = createServerImpl(socket => socket.destroy());
    let finishing = false;
    const finish = (bindError) => {
      if (finishing) return;
      finishing = true;
      server.close((closeError) => {
        const error = bindError ?? (closeError?.code === "ERR_SERVER_NOT_RUNNING" ? null : closeError);
        if (error?.code === "EADDRINUSE") resolve(false);
        else if (error) {
          const code = /^[A-Z0-9_]+$/.test(error.code ?? "") ? error.code : "BIND_FAILED";
          reject(new Error(`Cannot check desktop server port ${port}: ${code}`));
        } else resolve(true);
      });
    };
    server.once("error", finish);
    server.unref();
    try { server.listen({ host: "127.0.0.1", port, exclusive: true }, () => finish()); }
    catch (error) { finish(error); }
  });
}
