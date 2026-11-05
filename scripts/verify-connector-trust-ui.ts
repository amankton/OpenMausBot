// Real App and disposable browser; ONLY trust HTTP responses are supplied by
// this test-owned stub. Actual backend authorization has separate route tests.
import { Writable } from "node:stream";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { CONNECTOR_TRUST_CATALOG_FINGERPRINT, CONNECTOR_TRUST_OPERATIONS, connectorTrustReviewSchema, type ConnectorTrustPolicy } from "../shared/connector-trust.ts";
import { runControlOmb } from "./control-omb.ts";
import { launchUi } from "./testing/control-omb-ui.ts";
import { fixtureApi, type PreviewRoute } from "./testing/preview-fixture.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const evidenceDir = resolve(root, "docs/verification/evidence/connector-trust-ui");
mkdirSync(evidenceDir, { recursive: true });
const attemptId = new Date().toISOString();
const policies = new Map<string, ConnectorTrustPolicy>();
const httpCalls: Array<{ method: string; botId: string; action?: string; expectedRevision?: number; catalogFingerprint?: string; grants?: unknown }> = [];
let identitiesAvailable = true;
let forceConflict = false;
const previewRoutes: PreviewRoute[] = [{
  path: /^\/api\/bots\/([\w-]+)\/connector-trust(?:\/(revoke))?$/,
  async handler(req, res, match) {
    const botId = match![1]!;
    const action = match?.[2];
    const method = req.method ?? "GET";
    res.setHeader("content-type", "application/json");
    const respond = (status: number, body: unknown) => { res.statusCode = status; res.end(JSON.stringify(body)); };
    if (method === "GET") {
      httpCalls.push({ method, botId });
      respond(200, { policy: policies.get(botId) ?? null, operations: CONNECTOR_TRUST_OPERATIONS, catalogFingerprint: CONNECTOR_TRUST_CATALOG_FINGERPRINT,
        accounts: identitiesAvailable ? [{ accountId: "synthetic-mailbox-one", identity: "reader@example.test", status: "active", verifiedAt: Date.now() }, { accountId: "synthetic-unverified", status: "active", verifiedAt: 0 }] : [],
        ...(!identitiesAvailable ? { gap: "Synthetic provider unavailable. Existing trust may still be revoked." } : {}),
      }); return;
    }
    let raw = "";
    for await (const chunk of req) { raw += String(chunk); if (raw.length > 100_000) { respond(413, { error: "Fixture body too large" }); return; } }
    const body = JSON.parse(raw);
    httpCalls.push({ method, botId, ...(action ? { action } : {}), expectedRevision: body.expectedRevision, ...(body.catalogFingerprint ? { catalogFingerprint: body.catalogFingerprint } : {}), ...(body.grants ? { grants: body.grants } : {}) });
    const prior = policies.get(botId);
    if (forceConflict) {
      forceConflict = false;
      policies.set(botId, { botId, provider: "composio", catalogFingerprint: CONNECTOR_TRUST_CATALOG_FINGERPRINT, revision: (prior?.revision ?? 0) + 1, state: "active", grants: [], reviewedAt: Date.now(), reviewedBy: "synthetic-other-owner" });
      respond(409, { error: "Synthetic policy changed; refresh its revision before reviewing again" }); return;
    }
    if (body.expectedRevision !== (prior?.revision ?? 0)) { respond(409, { error: "Synthetic revision conflict" }); return; }
    if (method === "PUT" && !action) {
      const review = connectorTrustReviewSchema.parse(body);
      const grants = review.grants.map(grant => ({ ...grant, tools: [...new Set(grant.operations.flatMap(id => CONNECTOR_TRUST_OPERATIONS.find(operation => operation.id === id)!.tools))] }));
      const policy: ConnectorTrustPolicy = { botId, provider: "composio", catalogFingerprint: review.catalogFingerprint, revision: review.expectedRevision + 1, state: "active", grants, reviewedAt: Date.now(), reviewedBy: "synthetic-owner" };
      policies.set(botId, policy); respond(200, { policy }); return;
    }
    if (method === "POST" && action === "revoke") {
      const policy: ConnectorTrustPolicy = { botId, provider: "composio", catalogFingerprint: prior?.catalogFingerprint ?? CONNECTOR_TRUST_CATALOG_FINGERPRINT, revision: body.expectedRevision + 1, state: "revoked", grants: [], reviewedAt: Date.now(), reviewedBy: "synthetic-owner" };
      policies.set(botId, policy); respond(200, { policy }); return;
    }
    respond(405, { error: "Unsupported synthetic trust method" });
  },
}];
const env = { ...process.env };
const browserRoot = process.platform === "win32" && env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Programs/chief-executive-suite/resources/browser-engine") : undefined;
if (browserRoot) {
  const binary = join(browserRoot, "agent-browser.exe");
  const chrome = join(browserRoot, "chrome/chrome-headless-shell-win64/chrome-headless-shell.exe");
  if (!env.OMB_AGENT_BROWSER_PATH && existsSync(binary)) env.OMB_AGENT_BROWSER_PATH = binary;
  if (!env.AGENT_BROWSER_EXECUTABLE_PATH && existsSync(chrome)) env.AGENT_BROWSER_EXECUTABLE_PATH = chrome;
}
let output = "";
let diagnostics = "";
let launchError: unknown;
let cleanupIncomplete: string | undefined;
let info: { ui: string; url: string; previewUrl: string; botId: string; dataDir: string; logPath: string } | undefined;
const commands: Array<{ command: string; name?: string }> = [];
const launch = launchUi([], env, {
  stdout: new Writable({ write(chunk, _encoding, done) { output += String(chunk); done(); } }),
  stderr: new Writable({ write(chunk, _encoding, done) { diagnostics += String(chunk); done(); } }),
}, { previewRoutes }).catch(error => { launchError = error; });
try {
  await expect.poll(() => { if (launchError) throw launchError; try { info = JSON.parse(output); return Boolean(info?.ui); } catch { return false; } }, { timeout: 180_000, intervals: [100, 250, 500] }).toBe(true);
  const fixture = info!;
  const ui = async (verb: string, ...args: string[]) => {
    commands.push({ command: `ui ${verb}`, ...(args.includes("--name") ? { name: args[args.indexOf("--name") + 1] } : {}) });
    return runControlOmb(["ui", verb, "--ui", fixture.ui, ...args]) as Promise<Record<string, any>>;
  };
  const evaluate = async (js: string) => (await ui("eval", "--js", js)).result;
  const snapshot = async () => String((await ui("snapshot")).snapshot);
  const api = fixtureApi(fixture.url);
  const routinesBefore = await api("GET", "/api/routines");
  const botsBefore = (await api("GET", "/api/bots?messages=0")).bots.map((bot: Record<string, unknown>) => ({ id: bot.id, name: bot.name, soul: bot.soul, modelSelection: bot.modelSelection, composio: bot.composio, connectorTools: bot.connectorTools }));
  await ui("viewport", "--width", "1440", "--height", "1000");
  await ui("click", "--name", "Chief work");
  await expect.poll(snapshot).toContain("Agent for bounded email trust");
  await evaluate(`(() => {const select=[...document.querySelectorAll('label')].find(label=>label.textContent.startsWith('Agent for bounded email trust')).querySelector('select');select.value=${JSON.stringify(fixture.botId)};select.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  await expect.poll(snapshot).toContain("Not configured. Existing connector permissions are unchanged.");
  expect(httpCalls.filter(call => call.method !== "GET")).toHaveLength(0);
  expect(await evaluate("document.querySelector('input[aria-label=\"Select mailbox synthetic-unverified\"]').disabled")).toBe(true);
  const selectReads = async () => {
    await ui("click", "--name", "Select mailbox reader@example.test");
    await ui("click", "--name", "Read mailbox identity for reader@example.test");
    await ui("click", "--name", "Search mail for reader@example.test");
  };
  await selectReads();
  await ui("click", "--name", "Review bounded access");
  expect(httpCalls.filter(call => call.method !== "GET")).toHaveLength(0);
  expect(await evaluate("document.activeElement.textContent")).toBe("Cancel trust review");
  const reviewText = await evaluate("document.querySelector('section[aria-labelledby$=\"review-title\"]').textContent");
  expect(reviewText).toContain("Pepper"); expect(reviewText).toContain("Composio Gmail"); expect(reviewText).toContain("reader@example.test"); expect(reviewText).toContain("synthetic-mailbox-one"); expect(reviewText).toContain("GMAIL_FETCH_EMAILS"); expect(reviewText).not.toContain("GMAIL_SEND_EMAIL");
  await ui("screenshot", "--out", join(evidenceDir, "review-desktop.png"));
  await ui("click", "--name", "Cancel trust review");
  expect(httpCalls.filter(call => call.method !== "GET")).toHaveLength(0);
  await ui("click", "--name", "Review bounded access"); forceConflict = true;
  await ui("click", "--name", "Save reviewed bounded access");
  await expect.poll(snapshot).toContain("Synthetic policy changed");
  expect(httpCalls.filter(call => call.method === "PUT")).toHaveLength(1);
  expect(await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Review bounded access').disabled")).toBe(true);
  await ui("click", "--name", "Refresh trust and identities");
  await expect.poll(snapshot).toContain("Configured · revision 1");
  await selectReads(); await ui("click", "--name", "Review bounded access");
  await ui("click", "--name", "Save reviewed bounded access");
  await expect.poll(snapshot).toContain("Bounded access saved and verified at revision 2");
  expect(policies.get(fixture.botId)?.grants).toEqual([{ accountId: "synthetic-mailbox-one", identity: "reader@example.test", operations: ["read-profile", "search-mail"], tools: ["GMAIL_GET_PROFILE", "GMAIL_WHO_AM_I", "GMAIL_FETCH_EMAILS"] }]);
  expect(httpCalls.filter(call => call.method === "PUT").every(call => call.catalogFingerprint === CONNECTOR_TRUST_CATALOG_FINGERPRINT)).toBe(true);
  identitiesAvailable = false;
  await ui("click", "--name", "Refresh trust and identities");
  await expect.poll(snapshot).toContain("Synthetic provider unavailable");
  await ui("click", "--name", "Review revocation");
  await ui("viewport", "--width", "390", "--height", "844");
  expect(await evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
  await evaluate("document.querySelector('section[aria-labelledby$=\"review-title\"]').scrollIntoView(); true");
  await ui("screenshot", "--out", join(evidenceDir, "revoke-mobile.png"));
  await ui("click", "--name", "Revoke reviewed bounded access");
  await expect.poll(snapshot).toContain("Bounded access revoked and verified at revision 3");
  expect(policies.get(fixture.botId)).toMatchObject({ state: "revoked", revision: 3, grants: [] });
  identitiesAvailable = true; await ui("click", "--name", "Refresh trust and identities");
  await expect.poll(snapshot).toContain("Revoked · revision 3");
  expect(await evaluate("document.querySelector('input[aria-label=\"Select mailbox reader@example.test\"]').checked")).toBe(false);
  await evaluate("[...document.querySelectorAll('h3')].find(heading=>heading.textContent==='Bounded email trust').scrollIntoView(); true");
  await ui("screenshot", "--out", join(evidenceDir, "revoked-mobile.png"));
  expect(await api("GET", "/api/routines")).toEqual(routinesBefore);
  expect((await api("GET", "/api/bots?messages=0")).bots.map((bot: Record<string, unknown>) => ({ id: bot.id, name: bot.name, soul: bot.soul, modelSelection: bot.modelSelection, composio: bot.composio, connectorTools: bot.connectorTools }))).toEqual(botsBefore);
  const receipt = { passed: true, attemptId, syntheticTrustHttpStub: true, realAppAndDisposableServer: true, actualBackendTrustAuthorizationTestedHere: false,
    checks: ["explicit existing agent selection", "unverified account disabled", "complete exact review before mutation", "Cancel default focus and no write", "stale revision stops and requires refresh", "grant readback", "revocation during provider outage", "revoked tombstone persists without legacy fallback", "390px review layout", "profiles models generic grants and routines unchanged"],
    fixtureUrl: fixture.url, previewUrl: fixture.previewUrl, serverLog: fixture.logPath, commands, httpCalls,
  };
  writeFileSync(join(evidenceDir, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify({ passed: true, receipt: join(evidenceDir, "receipt.json"), serverLog: fixture.logPath }));
} catch (error) {
  writeFileSync(join(evidenceDir, "failure.json"), JSON.stringify({ attemptId, error: error instanceof Error ? error.message : String(error), info, commands, httpCalls, diagnostics }, null, 2) + "\n"); throw error;
} finally {
  process.emit("SIGINT"); await launch;
  if (info) {
    const cleaned = !existsSync(info.dataDir);
    const path = join(evidenceDir, "receipt.json");
    if (existsSync(path)) { const receipt = JSON.parse(readFileSync(path, "utf8")); if (receipt.attemptId === attemptId) writeFileSync(path, JSON.stringify({ ...receipt, fixtureDataRemoved: cleaned }, null, 2) + "\n"); }
    if (!cleaned) cleanupIncomplete = info.dataDir;
  }
}
if (cleanupIncomplete) throw Error(`Fixture cleanup incomplete: ${cleanupIncomplete}`);
