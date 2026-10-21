import { Agent } from "node:http";

/** Frame acknowledgements must reuse sockets instead of exhausting Windows ports. */
export function chiefPreviewProxy(target: string) {
  const agent = new Agent({ keepAlive: true, maxFreeSockets: 16 });
  return {
    agent,
    routes: {
      "/api": { target, ws: true, agent },
      "/.well-known/openmausbot/environment": { target, agent },
    },
  };
}
