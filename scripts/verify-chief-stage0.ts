// Stage 0 baseline only: two real Chief servers, synthetic members/files, fake agents.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { launchVerificationServer, runControlOmb } from "./control-omb.ts";
import type { OfficeCommand, OfficeSnapshot } from "../shared/office.ts";

const output = resolve(process.argv[2] ?? "work/chief-stage0-two-workspace.json");
const fixtures: Awaited<ReturnType<typeof launchVerificationServer>>[] = [];
const evidence: Record<string, unknown> = {
  schemaVersion: 1, simulated: true,
  scope: "Two isolated Chief runtimes; NOT retained Platform tenancy or member-to-agent pairing acceptance",
  checks: [],
};
const check = (name: string) => (evidence.checks as string[]).push(name);
try {
  // Launch sequentially so free port discovery cannot collide.
  for (const label of ["A", "B"]) {
    const fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, undefined, [], undefined, {});
    fixtures.push(fixture);
    console.log(`Started synthetic workspace ${label}`);
  }
  const [a, b] = fixtures;
  assert.notEqual(a!.info.dataDir, b!.info.dataDir);
  const api = async (index: number, path: string, body?: unknown, token?: string) => {
    const url = fixtures[index]!.info.url;
    return fetch(url + path, { method: body === undefined ? "GET" : "POST",
      headers: { origin: url, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  };
  const command = async (index: number, command: OfficeCommand, token?: string) => {
    const snapshot = await (await api(index, "/api/office", undefined, token)).json() as OfficeSnapshot;
    const response = await api(index, "/api/office", { revision: snapshot.office.revision, command }, token);
    assert.equal(response.status, 200);
    return response.json() as Promise<OfficeSnapshot & { links: Array<{ code: string }> }>;
  };
  const members: Array<{ token: string; personId: string }> = [];
  const bots: Array<{ id: string; threadId: string }> = [];
  const files: string[] = [];
  for (const index of [0, 1]) {
    const label = index === 0 ? "A" : "B";
    const created = await command(index, { type: "person.add", name: `Synthetic member ${label}`, title: "Stage 0 only" });
    const personId = created.office.people.at(-1)!.id;
    const invited = await command(index, { type: "invite.create", roomId: "huddle", personIds: [personId] });
    const claim = await api(index, "/api/office/claim", { code: invited.links[0]!.code });
    assert.equal(claim.status, 200);
    const member = await claim.json() as { token: string; personId: string };
    members.push(member);
    assert.equal((await api(index, "/api/office/claim", { code: invited.links[0]!.code })).status, 401);
    const invitationId = invited.office.invitations.find(i => i.personId === personId)!.id;
    await command(index, { type: "invite.respond", invitationId, accept: true }, member.token);
    await command(index, { type: "meeting.join", roomId: "huddle" }, member.token);
    check(`${label}: member claim is single use and accepted meeting persists`);
    const result = await runControlOmb(["new-bot", "--name", `Synthetic specialist ${label}`, "--url", fixtures[index]!.info.url]) as { bot: { id: string; threadId: string } };
    assert.ok(result.bot?.id);
    bots.push(result.bot);
    await runControlOmb(["send", "--bot", result.bot.id, "--text", `Synthetic food hall brief ${label}. Reply with fixture evidence.`, "--url", fixtures[index]!.info.url]);
    const waited = await runControlOmb(["wait", "--bot", result.bot.id, "--timeout", "30", "--url", fixtures[index]!.info.url]) as { status: string };
    assert.equal(waited.status, "settled");
    const transcript = await runControlOmb(["messages", "--bot", result.bot.id, "--limit", "10", "--url", fixtures[index]!.info.url]);
    assert.match(JSON.stringify(transcript), /Synthetic food hall brief/);
    evidence[`transcript${label}`] = transcript;
    check(`${label}: fake specialist turn settles through real server`);
    const uploaded = await fetch(fixtures[index]!.info.url + `/api/files?name=synthetic-${label}.txt`, {
      method: "POST", headers: { origin: fixtures[index]!.info.url, "content-type": "text/plain" }, body: `SYNTHETIC_FILE_${label}`, signal: AbortSignal.timeout(10000) });
    assert.equal(uploaded.status, 201);
    const file = await uploaded.json() as { path: string };
    assert.ok(file.path.startsWith(fixtures[index]!.info.dataDir));
    assert.equal(readFileSync(file.path, "utf8"), `SYNTHETIC_FILE_${label}`);
    // A one-pixel synthetic PNG exercises the actual HTTP attachment reader;
    // text uploads are local file references, not this image/audio endpoint.
    const pixels = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=", "base64");
    const image = await fetch(fixtures[index]!.info.url + "/api/attachments", {
      method: "POST", headers: { origin: fixtures[index]!.info.url, "content-type": "image/png" }, body: pixels });
    assert.equal(image.status, 201);
    const imageFile = await image.json() as { path: string };
    const fileUrl = `/api/attachments/${basename(imageFile.path)}`;
    files.push(fileUrl);
    const downloaded = await api(index, fileUrl);
    assert.equal(downloaded.status, 200);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), pixels);
    const persisted = JSON.parse(readFileSync(resolve(fixtures[index]!.info.dataDir, "bots.json"), "utf8")) as Array<{ id: string }>;
    assert.ok(persisted.some(bot => bot.id === result.bot.id));
    check(`${label}: synthetic file and bot persisted in disposable data directory`);
  }
  for (const [from, to] of [[0, 1], [1, 0]] as const) {
    assert.equal((await api(to, "/api/office", undefined, members[from]!.token)).status, 401);
    assert.equal((await api(from, "/api/bots", undefined, members[from]!.token)).status, 401);
    assert.equal((await api(to, files[from]!)).status, 404);
    const ownBots = await (await api(to, "/api/bots")).json() as { bots: Array<{ id: string }> };
    assert.ok(!ownBots.bots.some(bot => bot.id === bots[from]!.id));
    check(`${from}->${to}: foreign member credential, bot identity and file are isolated`);
  }
  evidence.fixtures = fixtures.map(f => f.info); // No session tokens or credentials.
  evidence.ok = true;
} catch (error) {
  evidence.ok = false;
  evidence.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  const cleanup = await Promise.allSettled(fixtures.map(f => f.close()));
  evidence.cleanup = cleanup.map(r => r.status);
  if (cleanup.some(r => r.status === "rejected")) process.exitCode = 1;
  evidence.completedAt = new Date().toISOString();
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify({ output, ok: evidence.ok, checks: evidence.checks, error: evidence.error, cleanup: evidence.cleanup }, null, 2));
}
