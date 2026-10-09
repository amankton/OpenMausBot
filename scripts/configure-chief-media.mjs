import { randomBytes } from "node:crypto";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL("../.chief-local/", import.meta.url));
mkdirSync(root, { recursive: true });
const json = join(root, "media.json"), yaml = join(root, "livekit.yaml");
if (existsSync(json) || existsSync(yaml)) {
  if (!existsSync(json) || !existsSync(yaml)) throw new Error("Partial Chief media configuration found. Preserve and repair it before continuing.");
  console.log("Using existing Chief-only media configuration.");
} else {
  const key = "chief-local", secret = randomBytes(32).toString("hex");
  writeFileSync(json, JSON.stringify({ url: "ws://127.0.0.1:18920", key, secret }), { mode: 0o600 });
  writeFileSync(yaml, `port: 18920\nrtc:\n  tcp_port: 18921\n  udp_port: 18922\n  use_external_ip: false\n  node_ip: 127.0.0.1\nkeys:\n  ${key}: ${secret}\n`, { mode: 0o600 });
  console.log("Created Chief-only local media credentials; values are not printed.");
}
