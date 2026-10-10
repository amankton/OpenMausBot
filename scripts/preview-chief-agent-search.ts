import { createServer } from "node:http";
import { createServer as createViteServer } from "vite";
import { launchVerificationServer } from "./control-omb.ts";
const synthetic = createServer((req, res) => {
  res.setHeader("content-type", req.url === "/config.json" ? "application/json" : "text/html");
  res.end(req.url === "/config.json" ? "{}" : '<!doctype html><html><body style="background:#14171d;color:white;font:16px system-ui;padding:32px"><h1>Isolated workspace fixture</h1><label>Draft note <textarea></textarea></label></body></html>');
});
await new Promise<void>(resolve => synthetic.listen(0, "127.0.0.1", resolve));
const address = synthetic.address();
if (!address || typeof address === "string") throw Error("No fixture port");
const fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, undefined, [], undefined, { platformUrl: `http://localhost:${address.port}/` });
const request = async (path: string, method: string, body: unknown) => {
  const response = await fetch(fixture.info.url + path, { method, headers: { "content-type": "application/json", origin: fixture.info.url }, body: JSON.stringify(body) });
  if (!response.ok) throw Error(`${path}: ${response.status}`);
  return response.json();
};
await request("/api/config", "PUT", { onboarding: { completedAt: new Date().toISOString(), version: 1, reelSeen: true, hintsSeen: [] }, profile: { name: "Search verifier", email: "fixture@example.test" } });
for (const name of ["Game Designer", "Game QA", "Artist"]) {
  const { bot } = await request("/api/bots", "POST", {});
  await request(`/api/bots/${bot.id}`, "PATCH", { name, section: name.startsWith("Game") ? "Game Development" : "Design" });
}
const vite = await createViteServer({ root: process.cwd(), logLevel: "error", plugins: [{ name: "synthetic-pairing-roster", configureServer(server) {
  server.middlewares.use((req, res, next) => {
    if (req.url !== "/api/chief-pairing") return next();
    res.setHeader("content-type", "application/json");
    if (req.method !== "GET") { res.statusCode = 405; res.end('{"error":"Preview does not create connections"}'); return; }
    res.end(JSON.stringify({ enabled: true, bots: [{ id: "bacca", name: "Bacca" }, { id: "game", name: "Game Designer" }, { id: "qa", name: "Game QA" }], connections: [] }));
  });
} }], server: { host: "127.0.0.1", port: 0, proxy: { "/api": { target: fixture.info.url, ws: true } } } });
await vite.listen();
console.log(JSON.stringify({ url: vite.resolvedUrls!.local[0] + "workspace", backend: fixture.info.url }));
let closing = false;
const close = async () => { if (closing) return; closing = true; await vite.close(); synthetic.closeAllConnections(); synthetic.close(); await fixture.close(); process.exit(0); };
process.on("SIGINT", close); process.on("SIGTERM", close);
