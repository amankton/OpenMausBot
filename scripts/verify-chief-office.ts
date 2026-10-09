import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
import { launchVerificationServer } from "./control-omb.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const evidenceDir = join(root, "docs/verification/evidence");
mkdirSync(evidenceDir, { recursive: true });
const media = JSON.parse(readFileSync(join(root, ".chief-local/media.json"), "utf8"));
const fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, undefined, [], undefined, { media });
const ui = await createServer({ root, logLevel: "error", server: { host: "127.0.0.1", port: 0, proxy: { "/api": { target: fixture.info.url, ws: true } } } });
let browser;
try {
  await ui.listen();
  const url = new URL("/office", ui.resolvedUrls!.local[0]).href;
  browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const guestContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const owner = await ownerContext.newPage();
  const guest = await guestContext.newPage();
  const errors: string[] = [];
  for (const page of [owner, guest]) {
    page.on("pageerror", error => errors.push(error.message));
    // Screen sharing is synthetic too: no OS chooser or owner desktop capture.
    await page.addInitScript(() => {
      (window as any).chiefTestTracks = [];
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => {
        const stream = await original(constraints);
        (window as any).chiefTestTracks.push(...stream.getTracks());
        return stream;
      };
      navigator.mediaDevices.getDisplayMedia = async () => {
        const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 360;
        const context = canvas.getContext("2d")!;
        const timer = setInterval(() => { context.fillStyle = "#277b77"; context.fillRect(0, 0, 640, 360); context.fillStyle = "white"; context.fillText(`Synthetic screen ${Date.now()}`, 30, 80); }, 100);
        const stream = canvas.captureStream(10);
        stream.getVideoTracks()[0]!.addEventListener("ended", () => clearInterval(timer));
        (window as any).chiefTestTracks.push(...stream.getTracks());
        return stream;
      };
    });
  }
  await owner.goto(url);
  await expect(owner.getByRole("heading", { name: "Your team, in one place." })).toBeVisible();
  await owner.getByRole("button", { name: "Add a person", exact: true }).click();
  await owner.getByLabel("Full name", { exact: true }).fill("Test colleague");
  await owner.getByLabel("Role or team", { exact: true }).fill("Design · synthetic verification");
  await owner.getByRole("button", { name: "Create space", exact: true }).click();
  await expect(owner.getByRole("checkbox", { name: "Select Test colleague", exact: true })).toBeVisible();
  await owner.getByLabel("Photo for Test colleague", { exact: true }).setInputFiles(join(root, "public/brand/chief-avatar-ink.png"));
  await expect(owner.locator(".office-person").filter({ hasText: "Test colleague" }).getByRole("img", { name: "Test colleague" })).toBeVisible();
  await owner.getByRole("checkbox", { name: "Select Test colleague", exact: true }).check();
  const ownerRoom = owner.locator(".office-room").filter({ has: owner.getByRole("heading", { name: "Meeting room", exact: true }) });
  await ownerRoom.getByRole("button", { name: "Invite 1", exact: true }).click();
  const invitation = owner.getByRole("textbox", { name: "Invitation link for Test colleague", exact: true });
  await expect(invitation).toBeVisible();
  await guest.goto(await invitation.inputValue());
  await guest.getByRole("button", { name: "Accept office access", exact: true }).click();
  await expect(guest.getByRole("button", { name: "Accept invitation", exact: true })).toBeVisible();
  await expect(guest.getByRole("button", { name: "Add a person", exact: true })).toHaveCount(0);
  await expect(guest.getByRole("link", { name: "Open my agent workspace" })).toHaveCount(0);
  const guestRoom = guest.locator(".office-room").filter({ has: guest.getByRole("heading", { name: "Meeting room", exact: true }) });
  await expect(guestRoom.getByRole("button", { name: "Invitation required", exact: true })).toBeDisabled();
  await guest.getByRole("button", { name: "Accept invitation", exact: true }).click();
  await expect(guestRoom.getByRole("button", { name: "Join room", exact: true })).toBeEnabled();
  // Refresh before each actor's revision-sensitive mutation after another actor writes.
  await owner.reload();
  await ownerRoom.getByRole("button", { name: "Join room", exact: true }).click();
  await expect(owner.getByRole("button", { name: "Connect audio & video", exact: true })).toBeVisible();
  await guest.reload();
  await guestRoom.getByRole("button", { name: "Join room", exact: true }).click();
  for (const page of [owner, guest]) {
    await page.getByRole("button", { name: "Connect audio & video", exact: true }).click();
    await expect(page.getByRole("button", { name: "Enable mic", exact: true })).toBeEnabled({ timeout: 20000 });
    await page.getByRole("button", { name: "Enable mic", exact: true }).click();
    await expect(page.getByRole("button", { name: "Mute", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Enable camera", exact: true }).click();
    await expect(page.getByLabel("Your camera preview", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Share screen", exact: true }).click();
    await expect(page.getByLabel("Your screen share", { exact: true })).toBeVisible();
  }
  for (const page of [owner, guest]) {
    await expect.poll(() => page.locator(".office-media-tracks video").count(), { timeout: 20000 }).toBe(4);
    await expect.poll(() => page.locator(".office-media-tracks audio").count(), { timeout: 20000 }).toBe(1);
  }
  await guest.getByLabel("Record type").selectOption("concern");
  await guest.getByLabel("Your statement", { exact: true }).fill("I need more time to review the launch checklist.");
  await guest.getByRole("button", { name: "Add to meeting record", exact: true }).click();
  await expect(owner.locator(".office-records")).toContainText("I need more time", { timeout: 10000 });
  await owner.getByLabel("Record type").selectOption("action");
  await owner.getByLabel("Action owner").selectOption({ label: "Test colleague" });
  await owner.getByLabel("Your statement", { exact: true }).fill("Send the revised checklist tomorrow.");
  await owner.getByRole("button", { name: "Add to meeting record", exact: true }).click();
  const selectedNote = owner.getByRole("checkbox", { name: "Select action note: Send the revised checklist tomorrow.", exact: true });
  await expect(selectedNote).toBeVisible(); await selectedNote.check();
  const downloadPromise = owner.waitForEvent("download");
  await owner.getByRole("button", { name: "Download selected notes", exact: true }).click();
  const download = await downloadPromise;
  const downloadedText = readFileSync((await download.path())!, "utf8");
  expect(downloadedText).toContain("Send the revised checklist tomorrow.");
  expect(downloadedText).not.toContain("I need more time");
  const privateApiStatus = await guest.evaluate(async () => {
    const token = sessionStorage.getItem(`chief-office-session:${location.origin}`);
    return (await fetch("/api/bots", { headers: { authorization: `Bearer ${token}` } })).status;
  });
  expect(privateApiStatus).toBe(401);
  await owner.screenshot({ path: join(evidenceDir, "chief-office-meeting.png"), fullPage: true });
  await guest.getByRole("button", { name: "Return to my space", exact: true }).click();
  await expect(guest.getByRole("region", { name: "Meeting audio and video", exact: true })).toHaveCount(0);
  await expect.poll(() => guest.evaluate(() => (window as any).chiefTestTracks.every((track: MediaStreamTrack) => track.readyState === "ended"))).toBe(true);
  await expect(ownerRoom).toContainText("1 /", { timeout: 10000 });
  await owner.getByRole("button", { name: "Return to my space", exact: true }).click();
  await expect(owner.getByRole("region", { name: "Meeting audio and video", exact: true })).toHaveCount(0);
  await expect.poll(() => owner.evaluate(() => (window as any).chiefTestTracks.every((track: MediaStreamTrack) => track.readyState === "ended"))).toBe(true);
  await owner.reload();
  await owner.getByLabel("Meeting history", { exact: true }).selectOption({ index: 1 });
  await expect(owner.locator(".office-records")).toContainText("Send the revised checklist tomorrow.");
  // Seed 20 spaces in this disposable fixture to check the realistic layout.
  for (let index = 2; index < 20; index++) {
    const state = await (await fetch(`${fixture.info.url}/api/office`)).json();
    const response = await fetch(`${fixture.info.url}/api/office`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ revision: state.office.revision, command: { type: "person.add", name: `Sample colleague ${index + 1}`, title: "Synthetic layout data" } }) });
    expect(response.status).toBe(200);
  }
  await owner.reload(); await expect(owner.locator(".office-person")).toHaveCount(20);
  await owner.screenshot({ path: join(evidenceDir, "chief-office-desktop.png"), fullPage: true });
  await owner.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await owner.screenshot({ path: join(evidenceDir, "chief-office-mobile.png"), fullPage: true });
  await owner.getByRole("link", { name: "Open my agent workspace" }).click();
  await expect(owner).toHaveURL(new URL("/", url).href);
  await guest.getByRole("button", { name: "End session", exact: true }).click();
  await expect(guest.getByRole("heading", { name: "Office session ended.", exact: true })).toBeVisible();
  await guest.reload();
  await expect(guest.getByRole("heading", { name: "Office access needed", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  const evidence = { verifiedAt: new Date().toISOString(), source: "Actual Chief UI, two isolated browser contexts and disposable backend, synthetic media only", checks: ["person and photo", "one-use access then explicit invitation acceptance", "room join", "real UI mic/camera/screen controls and remote rendering", "participant-authored concern and assigned action", "selected-only download", "private agent API rejection", "leave stops every acquired track", "history survives browser reload", "20 personal spaces", "390px no horizontal overflow", "owner navigation", "logout cannot fall back to owner"], privateApiStatus, pageErrors: errors };
  writeFileSync(join(evidenceDir, "chief-office-ui.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally { await browser?.close(); await ui.close(); await fixture.close(); }
