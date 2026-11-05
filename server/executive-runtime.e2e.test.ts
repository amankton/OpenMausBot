import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";

it("runs an explicitly bound check-in through the existing scheduler without dispatching a model", async () => {
  const fixture = await launchVerificationServer();
  const control = (operation: string, body?: unknown, id?: string) => runControlOmb([
    "executive-work", "--operation", operation, "--url", fixture.info.url,
    ...(body ? ["--json", JSON.stringify(body)] : []), ...(id ? ["--id", id] : []),
  ]);
  const api = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(fixture.info.url + path, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const value = await r.json() as { routine: {id:string}; run: {id:string;threadId:string}; routines: Array<{id:string;enabled:boolean}>; runs: Array<{id:string;threadId:string;status:string}> }; expect(r.ok, JSON.stringify(value)).toBe(true); return value;
  };
  try {
    const { bots } = await runControlOmb(["bots", "--url", fixture.info.url]) as { bots: Array<{ id: string; threadId: string }> };
    const bot = bots[0];
    const { routine } = await api("POST", "/api/routines", { name: "Read-only check-in", prompt: "A prompt cannot authorize any external effects.", botId: bot.id, enabled: false, schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 3_600_000 } });
    await control("settings", { expectedRevision: 0, checkInEnabled: true, routineBindings: [{ routineId: routine.id, kind: "check-in" }] });
    const { run } = await api("POST", `/api/routines/${routine.id}/run`);
    await expect.poll(async () => (await api("GET", "/api/routines")).runs.find((r: { id: string }) => r.id === run.id)?.status, { timeout: 15_000 }).toBe("completed");
    const snapshot = await control("read") as { runs: Array<{ id: string; kind: string; status: string }> };
    expect(snapshot.runs).toContainEqual(expect.objectContaining({ id: run.id, kind: "check-in", status: "completed" }));
    expect(existsSync(fixture.fixtureDumpPath)).toBe(false);
    const finished=(await api("GET", "/api/routines")).runs.find((r: {id:string})=>r.id===run.id);
    if(!finished)throw new Error("The completed fixture run is missing");
    const messages = await runControlOmb(["messages", "--bot", bot.id, "--task", finished.threadId, "--url", fixture.info.url]);
    writeFileSync(fixture.info.logPath + ".executive-runtime.json", JSON.stringify({ snapshot, run, messages, noModelDispatch: true }));
    expect((await api("GET", "/api/routines")).routines[0].enabled).toBe(false);
  } finally { await fixture.close(); }
}, 30_000);

it("keeps disabled discovery and setup failures explicit in the real API", async () => {
  const fixture = await launchVerificationServer();
  try {
    const snapshot = await runControlOmb(["executive-work", "--operation", "read", "--url", fixture.info.url]) as { settings: { scansEnabled: boolean }; capabilities: { scan: boolean } };
    expect(snapshot.settings.scansEnabled).toBe(false);
    expect(snapshot.capabilities.scan).toBe(false);
    await expect(runControlOmb(["executive-work", "--operation", "scan", "--json", JSON.stringify({ accountScopes: ["unapproved"], eventId: "disabled" }), "--url", fixture.info.url])).rejects.toThrow(/Enable read-only discovery/);
    expect(readFileSync(fixture.info.logPath, "utf8")).not.toContain("uncaughtException");
  } finally { await fixture.close(); }
}, 30_000);
