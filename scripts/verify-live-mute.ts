import { launchVerificationServer } from "./control-omb.ts";
import { mountPreview, parkUntilSignal } from "./testing/preview-fixture.ts";
const fixture = await launchVerificationServer(process.env);
const ui = await mountPreview(fixture, { entry: "/scripts/testing/live-mute-preview.tsx", route: "/__mute-preview.html", title: "Isolated mute verification" });
console.log(JSON.stringify({ previewUrl: ui.previewUrl, dataDir: fixture.info.dataDir }));
try { await parkUntilSignal(); } finally { await ui.close(); await fixture.close(); }
