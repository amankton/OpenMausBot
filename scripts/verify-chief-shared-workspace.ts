// Host integration only: the collaboration application below is deliberately
// synthetic. This is not Contacts acceptance or proof of a Platform deployment.
import { createServer as createHttpServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, type Browser } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { launchVerificationServer, type VerificationServer } from "./control-omb.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const evidenceDir = join(root, "docs/verification/evidence");
mkdirSync(evidenceDir, { recursive: true });
const requests: Array<{ path: string; cookie: boolean; authorization: boolean; referer: boolean }> = [];
let available = true;
const synthetic = createHttpServer((req, res) => {
  requests.push({ path: req.url ?? "/", cookie: Boolean(req.headers.cookie), authorization: Boolean(req.headers.authorization), referer: Boolean(req.headers.referer) });
  res.setHeader("cache-control", "no-store");
  if (req.url === "/config.json") {
    res.writeHead(available ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify({ fixture: "Chief host verification — not Platform Contacts" })); return;
  }
  res.writeHead(200, { "content-type": "text/html;charset=utf-8" });
  res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic collaboration fixture</title>
    <style>body{font:16px system-ui;margin:0;padding:24px;background:#f5f7fb;color:#203040}button{padding:10px;margin:8px 8px 8px 0}h1{font-size:22px}p{line-height:1.5}</style>
    <h1>Synthetic collaboration fixture</h1><p>Host integration test only. This is not Platform or Contacts.</p>
    <button id="interact">Test embedded interaction</button><output id="count">0</output>
    <label>Draft note <textarea id="draft"></textarea></label>
    <button id="start-media">Start fake camera and microphone</button><button id="stop-media">Stop media</button><output id="media-status">Off</output>
    <video id="preview" autoplay muted playsinline></video>
    <button id="escape">Test top navigation isolation</button><output id="escape-status">Not attempted</output>
    <script>window.fixtureTracks=[];
    const stopMedia=()=>{for(const track of window.fixtureTracks)track.stop();document.getElementById('preview').srcObject=null;document.getElementById('media-status').textContent='Stopped'};
    document.getElementById('start-media').onclick=async()=>{try{const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:true});window.fixtureTracks=stream.getTracks();document.getElementById('preview').srcObject=stream;document.getElementById('media-status').textContent='On'}catch(error){document.getElementById('media-status').textContent=error.name}};
    document.getElementById('stop-media').onclick=stopMedia;addEventListener('pagehide',stopMedia);
    document.getElementById('interact').onclick=()=>document.getElementById('count').textContent=String(Number(document.getElementById('count').textContent)+1);
    document.getElementById('escape').onclick=()=>{try{top.location.href='http://localhost:'+location.port+'/escape';document.getElementById('escape-status').textContent='requested'}catch{document.getElementById('escape-status').textContent='blocked'}};</script></html>`);
});

let fixture: VerificationServer | undefined;
let ui: ViteDevServer | undefined;
let browser: Browser | undefined;
try {
  // Bind only loopback. A distinct hostname isolates host-scoped browser cookies.
  await new Promise<void>((resolve, reject) => { synthetic.once("error", reject); synthetic.listen(0, "127.0.0.1", resolve); });
  const address = synthetic.address();
  if (!address || typeof address === "string") throw new Error("Synthetic service did not bind a port");
  const platformUrl = `http://localhost:${address.port}/workbench/fixture/contact/persons`;
  fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, undefined, [], undefined, { platformUrl });
  ui = await createServer({ root, logLevel: "error", server: { host: "127.0.0.1", port: 0, proxy: { "/api": { target: fixture.info.url, ws: true }, "/.well-known/openmausbot/environment": { target: fixture.info.url } } } });
  await ui.listen();
  const origin = new URL(ui.resolvedUrls!.local[0]).origin;
  const hostUrl = `${origin}/workspace`;
  const session = await (await fetch(`${fixture.info.url}/api/auth/session`)).json();
  expect(session.kind).toBe("loopback");
  // Only the temporary fixture's welcome state changes; no real account setup.
  const prepare = await fetch(`${fixture.info.url}/api/config`, { method: "PUT", headers: { "content-type": "application/json", origin: fixture.info.url }, body: JSON.stringify({ onboarding: { completedAt: new Date().toISOString(), version: 1, reelSeen: true, hintsSeen: [] }, profile: { name: "Synthetic host verifier", email: "fixture@example.test" } }) });
  expect(prepare.ok).toBe(true);
  const denied = await fetch(`${fixture.info.url}/api/shared-workspace`, { headers: { origin: "http://example.test", "sec-fetch-site": "cross-site" } });
  expect(denied.status).toBe(403);
  const ready = await (await fetch(`${fixture.info.url}/api/shared-workspace`)).json();
  expect(ready).toMatchObject({ enabled: true, available: true, url: platformUrl });

  browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--use-fake-device-for-media-stream"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // Chromium checks media consent against both the requesting and embedding
  // origins. Grants are restricted to these two disposable fixture origins.
  await context.grantPermissions(["camera", "microphone", "local-network-access"], { origin });
  await context.grantPermissions(["camera", "microphone", "local-network-access"], { origin: new URL(platformUrl).origin });
  await context.addCookies([{ name: "chief_host_fixture", value: "synthetic-cookie-must-not-cross", url: origin }]);
  await context.addInitScript(() => {
    const probe = globalThis as unknown as { chiefMediaCalls: number };
    probe.chiefMediaCalls = 0;
    if (navigator.mediaDevices) {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = constraints => { probe.chiefMediaCalls++; return original(constraints); };
    }
    if (location.hostname === "127.0.0.1") {
      sessionStorage.setItem(`chief-office-session:${location.origin}`, "synthetic-session-must-not-cross");
      localStorage.setItem("chief-host-verifier", "synthetic-private-marker");
    }
  });
  const personal = await context.newPage();
  await personal.goto(`${origin}/`);
  const launch = personal.getByRole("link", { name: "Shared workspace", exact: true });
  await expect(launch).toBeVisible({ timeout: 30000 });
  const popupPromise = context.waitForEvent("page");
  await launch.click();
  const shared = await popupPromise;
  await shared.waitForURL(hostUrl);
  expect(personal.isClosed()).toBe(false);
  expect(personal.url()).toBe(`${origin}/`);
  await expect(personal.getByRole("button", { name: "Team map", exact: true })).toBeVisible();
  await expect(personal.getByRole("link", { name: "Shared office", exact: true })).toHaveCount(0);
  await personal.getByRole("button", { name: "Team map", exact: true }).click();
  await expect(personal.getByRole("heading", { name: "Team map", exact: true })).toBeVisible();
  await expect(personal.getByRole("link", { name: "Shared workspace", exact: true })).toHaveCount(2);
  for (const link of await personal.getByRole("link", { name: "Shared workspace", exact: true }).all()) {
    await expect(link).toHaveAttribute("href", "/workspace");
  }
  expect(await shared.evaluate(() => window.opener === null)).toBe(true);
  const iframe = shared.locator('iframe[title="Chief organization workspace"]');
  await expect(iframe).toHaveAttribute("src", platformUrl);
  const embedded = shared.frameLocator('iframe[title="Chief organization workspace"]');
  await expect(embedded.getByRole("heading", { name: "Synthetic collaboration fixture", exact: true })).toBeVisible();
  await embedded.getByRole("button", { name: "Test embedded interaction", exact: true }).click();
  await expect(embedded.locator("#count")).toHaveText("1");
  await embedded.getByRole("button", { name: "Test top navigation isolation", exact: true }).click();
  await expect(embedded.locator("#escape-status")).toHaveText("blocked");
  expect(shared.url()).toBe(hostUrl);
  const frame = shared.frames().find(item => item.url() === platformUrl)!;
  expect(await shared.evaluate(() => (globalThis as unknown as { chiefMediaCalls: number }).chiefMediaCalls)).toBe(0);
  expect(await frame.evaluate(() => (globalThis as unknown as { chiefMediaCalls: number }).chiefMediaCalls)).toBe(0);
  const isolation = await frame.evaluate(() => {
    let parentReadable = false;
    try { void parent.document.cookie; parentReadable = true; } catch { /* expected cross-origin boundary */ }
    const policy = (document as Document & { featurePolicy: { allowsFeature: (name: string, origin?: string) => boolean; getAllowlistForFeature: (name: string) => string[] } }).featurePolicy;
    return { parentReadable, cookieEmpty: document.cookie === "", privateStorageEmpty: !localStorage.getItem("chief-host-verifier"),
      mediaPermissions: Object.fromEntries(["camera", "microphone", "display-capture", "local-network", "loopback-network", "clipboard-read", "clipboard-write", "geolocation"].map(name => [name, policy.allowsFeature(name)])),
      delegatedOrigins: Object.fromEntries(["camera", "microphone", "display-capture", "local-network", "loopback-network"].map(name => [name, policy.getAllowlistForFeature(name)])),
      foreignOriginDenied: ["camera", "microphone", "display-capture", "local-network", "loopback-network"].every(name => !policy.allowsFeature(name, "http://example.test")) };
  });
  expect(isolation).toEqual({ parentReadable: false, cookieEmpty: true, privateStorageEmpty: true,
    mediaPermissions: { camera: true, microphone: true, "display-capture": true, "local-network": true, "loopback-network": true, "clipboard-read": false, "clipboard-write": false, geolocation: false },
    delegatedOrigins: Object.fromEntries(["camera", "microphone", "display-capture", "local-network", "loopback-network"].map(name => [name, [new URL(platformUrl).origin]])), foreignOriginDenied: true });
  await embedded.getByRole("button", { name: "Start fake camera and microphone", exact: true }).click();
  await expect(embedded.locator("#media-status")).toHaveText("On");
  const mediaStarted = await frame.evaluate(() => ({ calls: (globalThis as unknown as { chiefMediaCalls: number }).chiefMediaCalls,
    tracks: (globalThis as unknown as { fixtureTracks: MediaStreamTrack[] }).fixtureTracks.map(track => ({ kind: track.kind, state: track.readyState })) }));
  expect(mediaStarted).toEqual({ calls: 1, tracks: [{ kind: "audio", state: "live" }, { kind: "video", state: "live" }] });
  await embedded.getByRole("button", { name: "Stop media", exact: true }).click();
  await expect.poll(() => frame.evaluate(() => (globalThis as unknown as { fixtureTracks: MediaStreamTrack[] }).fixtureTracks.map(track => track.readyState))).toEqual(["ended", "ended"]);

  // A successful health probe must retain the document, its draft and its frame.
  await embedded.getByRole("textbox", { name: "Draft note", exact: true }).fill("Unsaved synthetic draft survives a health check");
  await iframe.evaluate(element => { element.setAttribute("data-fixture-identity", "original-frame"); });
  let releaseProbe!: () => void;
  let probeStarted!: () => void;
  const probeGate = new Promise<void>(resolve => { releaseProbe = resolve; });
  const probeSeen = new Promise<void>(resolve => { probeStarted = resolve; });
  await shared.route("**/api/shared-workspace", async route => { probeStarted(); await probeGate; await route.continue(); }, { times: 1 });
  await shared.getByRole("button", { name: "Retry connection", exact: true }).click();
  await probeSeen;
  try {
    await expect(iframe).toHaveAttribute("data-fixture-identity", "original-frame");
    await expect(embedded.getByRole("textbox", { name: "Draft note", exact: true })).toHaveValue("Unsaved synthetic draft survives a health check");
    await expect(embedded.locator("#count")).toHaveText("1");
  } finally { releaseProbe(); }
  await expect(shared.getByRole("button", { name: "Retry connection", exact: true })).toBeEnabled();
  await expect(iframe).toHaveAttribute("data-fixture-identity", "original-frame");
  await expect(embedded.getByRole("textbox", { name: "Draft note", exact: true })).toHaveValue("Unsaved synthetic draft survives a health check");
  expect(requests.some(request => request.path === "/config.json")).toBe(true);
  expect(requests.some(request => request.path === "/workbench/fixture/contact/persons")).toBe(true);
  expect(requests.every(request => !request.cookie && !request.authorization && !request.referer)).toBe(true);
  await shared.screenshot({ path: join(evidenceDir, "chief-shared-workspace-host.png"), fullPage: true });
  await shared.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => shared.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(embedded.getByRole("button", { name: "Test embedded interaction", exact: true })).toBeVisible();
  await shared.screenshot({ path: join(evidenceDir, "chief-shared-workspace-host-mobile.png"), fullPage: true });

  await shared.goto(`${origin}/office?token=retired-fixture-token#invite=retired-fixture-invite`);
  await shared.waitForURL(hostUrl);
  await expect(embedded.getByRole("heading", { name: "Synthetic collaboration fixture", exact: true })).toBeVisible();
  expect(requests.every(request => !request.path.includes("retired-fixture"))).toBe(true);

  available = false;
  await shared.getByRole("button", { name: "Retry connection", exact: true }).click();
  await expect(shared.getByRole("heading", { name: "Shared workspace is not available yet", exact: true })).toBeVisible();
  await expect(shared.locator("iframe")).toHaveCount(0);
  expect(personal.isClosed()).toBe(false);
  await shared.screenshot({ path: join(evidenceDir, "chief-shared-workspace-host-unavailable.png"), fullPage: true });
  available = true;
  await shared.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(embedded.getByRole("heading", { name: "Synthetic collaboration fixture", exact: true })).toBeVisible();

  const evidence = { verifiedAt: new Date().toISOString(), scope: "Host integration only — synthetic collaboration service, NOT Contacts acceptance", source: "Real Chief isolated fake-engine server, real Vite/React host, fresh Chrome context", chiefUrl: hostUrl, syntheticPlatformUrl: platformUrl, serverLog: fixture.info.logPath,
    checks: ["trusted local owner API and cross-site denial", "real server availability probe", "sidebar opens separate host window and personal Team map remains", "retired Shared Office navigation is absent and Team map opens Shared Workspace", "legacy office URL redirects to workspace without forwarding old credentials", "interactive iframe on distinct hostname", "no cookies/authorization/referrer forwarded", "no parent access or private storage", "sandbox blocks top navigation", "media and local-network policy delegated only to exact iframe origin; clipboard/geolocation remain denied", "no initial media acquisition; explicit fake camera/microphone start succeeds and Stop ends all tracks", "successful availability retry retains frame and unsaved draft", "390px layout", "unavailable state unmounts iframe", "retry recovers"], fakeDevicesOnly: true, screenCaptureInvoked: false, mediaStarted, isolation, requests };
  writeFileSync(join(evidenceDir, "chief-shared-workspace-host.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser?.close();
  await ui?.close();
  await fixture?.close();
  synthetic.closeAllConnections();
  await new Promise<void>(resolve => synthetic.close(() => resolve()));
}
