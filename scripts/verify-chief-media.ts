import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
import { launchVerificationServer } from "./control-omb.ts";
import type { OfficeCommand, OfficeSnapshot } from "../shared/office.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const media = JSON.parse(readFileSync(join(root, ".chief-local/media.json"), "utf8"));
const fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, undefined, [], undefined, { media });
const ui = await createServer({ root, logLevel: "error", server: { host: "127.0.0.1", port: 0 } });
let browser;
try {
  await ui.listen();
  const request = async (path: string, body?: unknown, credential?: string) => {
    const res = await fetch(`${fixture.info.url}${path}`, { method: body ? "POST" : "GET", headers: { ...(body ? { "content-type": "application/json" } : {}), ...(credential ? { authorization: `Bearer ${credential}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!res.ok) throw new Error(`Fixture request ${path}: ${res.status} ${await res.text()}`);
    return res.json();
  };
  const update = async (command: OfficeCommand, credential?: string) => {
    const s: OfficeSnapshot = await request("/api/office", undefined, credential);
    return request("/api/office", { revision: s.office.revision, command }, credential);
  };
  const added: OfficeSnapshot = await update({ type: "person.add", name: "Synthetic guest", title: "Verification only" });
  const guestId = added.office.people.find(p => p.id !== added.office.ownerId)!.id;
  const invitation = await update({ type: "invite.create", roomId: "boardroom", personIds: [guestId] });
  const member = await request("/api/office/claim", { code: invitation.links[0].code });
  const guestState: OfficeSnapshot = await request("/api/office", undefined, member.token);
  await update({ type: "invite.respond", invitationId: guestState.office.invitations[0]!.id, accept: true }, member.token);
  await update({ type: "meeting.join", roomId: "boardroom" });
  await update({ type: "meeting.join", roomId: "boardroom" }, member.token);
  const ownerConnection = await request("/api/office/media", {});
  const guestConnection = await request("/api/office/media", {}, member.token);
  const privateRes = await fetch(`${fixture.info.url}/api/bots`, { headers: { authorization: `Bearer ${member.token}` } });
  expect(privateRes.status).toBe(401);
  browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--autoplay-policy=no-user-gesture-required"] });
  const owner = await (await browser.newContext()).newPage();
  const guest = await (await browser.newContext()).newPage();
  const pageUrl = new URL("/scripts/testing/chief-media-fixture.html", ui.resolvedUrls!.local[0]).href;
  await Promise.all([owner.goto(pageUrl), guest.goto(pageUrl)]);
  await Promise.all([owner.waitForFunction(() => Boolean((window as any).chiefMediaFixture)), guest.waitForFunction(() => Boolean((window as any).chiefMediaFixture))]);
  await owner.evaluate(args => (window as any).chiefMediaFixture.connect(args), ownerConnection);
  await guest.evaluate(args => (window as any).chiefMediaFixture.connect(args), guestConnection);
  await Promise.all([owner.evaluate(() => (window as any).chiefMediaFixture.publish()), guest.evaluate(() => (window as any).chiefMediaFixture.publish())]);
  for (const page of [owner, guest]) await expect.poll(async () => {
    const stats = await page.evaluate(() => (window as any).chiefMediaFixture.stats());
    return stats.tracks.filter((t: { bytes: number }) => t.bytes > 0).length;
  }, { timeout: 30_000 }).toBe(3);
  const ownerStats = await owner.evaluate(() => (window as any).chiefMediaFixture.stats());
  const guestStats = await guest.evaluate(() => (window as any).chiefMediaFixture.stats());
  expect(await guest.evaluate(() => (window as any).chiefMediaFixture.close())).toBe(true);
  await update({ type: "meeting.leave" }, member.token);
  expect(await owner.evaluate(() => (window as any).chiefMediaFixture.close())).toBe(true);
  await update({ type: "meeting.leave" });
  const finalState: OfficeSnapshot = await request("/api/office");
  expect(finalState.office.meetings[0]!.endedAt).not.toBeNull();
  mkdirSync(join(root, "docs/verification/evidence"), { recursive: true });
  const evidence = { verifiedAt: new Date().toISOString(), source: "two isolated browser contexts, synthetic canvas + oscillator tracks; no real devices", ownerStats, guestStats, privateAgentApiStatus: privateRes.status, allTracksStopped: true, meetingEnded: true };
  writeFileSync(join(root, "docs/verification/evidence/chief-media.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally { await browser?.close(); await ui.close(); await fixture.close(); }
