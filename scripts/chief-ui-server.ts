import { createServer, preview } from "vite";
import { assertChiefUiBuild, chiefUiDirectory } from "./chief-ui-build.ts";
import { chiefPreviewProxy } from "./chief-preview-proxy.ts";

/** Saved workspaces serve immutable build assets; development is explicit. */
export async function serveChiefUi({ root, target, development = false, port = 5299 }: {
  root: string; target: string; development?: boolean; port?: number;
}) {
  if (!development) assertChiefUiBuild(root);
  const proxy = chiefPreviewProxy(target);
  let server: Awaited<ReturnType<typeof createServer>> | Awaited<ReturnType<typeof preview>> | undefined;
  try {
    const options = { host: "127.0.0.1", port, strictPort: true, proxy: proxy.routes };
    server = development
      ? await createServer({ root, server: options })
      : await preview({ root, configFile: false, envFile: false, appType: "spa", build: { outDir: chiefUiDirectory(root) }, preview: options });
    if (development) await (server as Awaited<ReturnType<typeof createServer>>).listen();
    return {
      url: server.resolvedUrls!.local[0]!,
      async close() { proxy.agent.destroy(); await server!.close(); },
    };
  } catch (error) { proxy.agent.destroy(); await server?.close(); throw error; }
}
