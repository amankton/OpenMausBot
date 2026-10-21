import { readFileSync, writeFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { composeMessage, intakeFiles, type Attachment } from "../src/lib/composer-attachments.ts";

it("delivers arbitrary browser uploads to an agent and downloads them only through their message", async () => {
  const fixture = await launchVerificationServer();
  const env = { OPENMAUSBOT_URL: fixture.info.url };
  const nativeFetch = globalThis.fetch;
  const cases = [
    // Valid empty ZIP: uploading must not require extracting an archive.
    { name: "bundle.zip", mime: "application/zip", bytes: Buffer.from("504b0506000000000000000000000000000000000000", "hex") },
    { name: "main.py", mime: "text/plain", bytes: Buffer.from("print('fixture')\n") },
    { name: "page.html", mime: "text/html", bytes: Buffer.from("<script>throw 'never execute'</script>") },
    { name: "data.parquet", mime: "", bytes: Buffer.from([0, 255, 80, 65, 82, 49]) },
    { name: "Dockerfile", mime: "", bytes: Buffer.from("FROM scratch\n") },
    { name: ".env", mime: "", bytes: Buffer.from("FIXTURE=true\n") },
  ];
  try {
    const created = await nativeFetch(`${fixture.info.url}/api/bots`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Attachment fixture" }),
    });
    expect(created.status).toBe(201);
    const { bot } = await created.json() as {
      bot: { id: string; threadId: string };
    };
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation((url, init) =>
      nativeFetch(typeof url === "string" && url.startsWith("/") ? `${fixture.info.url}${url}` : url, init));
    let attachments: Attachment[];
    try {
      const result = await intakeFiles(cases.map(({ name, mime, bytes }) => new File([bytes], name, { type: mime })), {
        allowImages: true, getPath: () => "", uploadImage: async () => null,
      });
      expect(result.notice).toBeNull();
      expect(result.attachments).toHaveLength(cases.length);
      attachments = result.attachments;
    } finally {
      fetch.mockRestore();
    }
    const text = composeMessage("Inspect these fixture files.", attachments);
    const sent = await runControlOmb(["send", "--bot", bot.id, "--text", text], { env });
    const wait = await runControlOmb(["wait", "--bot", bot.id, "--timeout", "30"], { env });
    expect(wait).toMatchObject({ status: "settled" });
    const dump = JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")) as { prompt: unknown };
    for (const attachment of attachments) {
      if (attachment.kind !== "file") throw new Error("expected file attachment");
      expect(JSON.stringify(dump.prompt)).toContain(attachment.name);
    }
    const exported = await nativeFetch(`${fixture.info.url}/api/threads/${bot.threadId}/export?format=json`);
    expect(exported.status).toBe(200);
    const { messages } = await exported.json() as { messages: Array<{ id: string; role: string; text?: string }> };
    const message = messages.find((value) => value.role === "user" && value.text === text);
    expect(message).toBeDefined();
    const receipts = [];
    for (const [index, attachment] of attachments.entries()) {
      if (attachment.kind !== "file") throw new Error("expected file attachment");
      expect(readFileSync(attachment.path)).toEqual(cases[index]!.bytes);
      const response = await nativeFetch(`${fixture.info.url}/api/threads/${bot.threadId}/messages/${message!.id}/file`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: attachment.path }),
      });
      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(cases[index]!.bytes);
      expect(response.headers.get("content-disposition")).toMatch(/^attachment;/);
      expect(response.headers.get("content-disposition")).toContain(attachment.name);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      const unshared = await nativeFetch(`${fixture.info.url}/api/threads/${bot.threadId}/messages/${message!.id}/file`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: `${attachment.path}.unshared` }),
      });
      expect(unshared.status).toBe(403);
      receipts.push({ name: attachment.name, bytes: attachment.size, downloadStatus: response.status, unsharedStatus: unshared.status });
    }
    const transcript = await runControlOmb(["messages", "--bot", bot.id, "--limit", "10"], { env });
    expect(JSON.stringify(transcript)).toContain("hello from fake claude");
    writeFileSync(`${fixture.info.logPath}.attachments.json`, JSON.stringify({ fixture: fixture.info, sent, wait, transcript, receipts }, null, 2));
    console.log(`Attachment fixture evidence: ${fixture.info.logPath}.attachments.json`);
  } finally {
    await fixture.close();
  }
}, 90_000);
