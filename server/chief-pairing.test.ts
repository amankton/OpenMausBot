import { afterEach, describe, expect, it } from "vitest";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ChiefPairingRuntime, lifecycleOrigin } from "./chief-pairing.ts";
import { PAIRING_PRIVATE_DIRECTORY, PAIRING_PRIVATE_FILE } from "./chief-pairing-storage.ts";
import { excludedWorkspaceAuthPath } from "./workspace-backup-policy.ts";
import { removeTempDir } from "./testing/cleanup.ts";

const directories: string[] = [];
const privateFile = (directory: string) => join(directory, PAIRING_PRIVATE_DIRECTORY, PAIRING_PRIVATE_FILE);
afterEach(async () => { for (const path of directories.splice(0)) await removeTempDir(path); });
function fixture(fetcher: typeof fetch = async () => { throw Error("unavailable"); }) {
  const directory = mkdtempSync(join(tmpdir(), "chief-pairing-")); directories.push(directory);
  return { directory, runtime: new ChiefPairingRuntime({ directory, origin: "http://127.0.0.1:12345", hasBot: id => id === "fixture-bot", fetcher }) };
}
const invitation = () => ({ challenge: "a".repeat(43), workspace: randomUUID(), account: randomUUID(), expiresAt: new Date(Date.now() + 30000).toISOString() });

describe("personal Chief pairing boundary", () => {
  it.each(["http://remote.test", "http://localhost:1234/path", "https://host.test/?token=secret", "https://user:pass@host.test", "file:///data"])("rejects unapproved origins: %s", origin => {
    expect(() => lifecycleOrigin(origin)).toThrow();
  });
  it("rejects unknown agents and expired invitations before network access", async () => {
    let calls = 0; const { runtime } = fixture(async () => { calls++; throw Error(); });
    await expect(runtime.pair(invitation(), ["somebody-elses-bot"])).rejects.toMatchObject({ status: 400 });
    await expect(runtime.pair({ ...invitation(), expiresAt: new Date(0).toISOString() }, ["fixture-bot"])).rejects.toMatchObject({ status: 400 });
    expect(calls).toBe(0);
  });
  it("retains its identity across restart without returning private keys", () => {
    const { directory, runtime } = fixture();
    const before = JSON.parse(readFileSync(privateFile(directory), "utf8"));
    const restarted = new ChiefPairingRuntime({ directory, origin: "http://127.0.0.1:12345", hasBot: () => true });
    expect(restarted.list()).toEqual(runtime.list());
    expect(JSON.parse(readFileSync(privateFile(directory), "utf8")).runtimeId).toBe(before.runtimeId);
    expect(JSON.stringify(runtime.list())).not.toContain(before.privateKey);
    expect(() => new ChiefPairingRuntime({ directory, origin: "https://other.test", hasBot: () => true })).toThrow(/different/);
  });
  it("moves an existing private identity without replacing keys or changing the data directory permissions", () => {
    const { directory } = fixture();
    const bytes = readFileSync(privateFile(directory), "utf8");
    const mode = statSync(directory).mode;
    const legacy = join(directory, PAIRING_PRIVATE_FILE);
    renameSync(privateFile(directory), legacy);
    new ChiefPairingRuntime({ directory, origin: "http://127.0.0.1:12345", hasBot: () => true });
    expect(readFileSync(privateFile(directory), "utf8")).toBe(bytes);
    expect(existsSync(legacy)).toBe(false);
    expect(statSync(directory).mode).toBe(mode);
  });
  it("refuses conflicting identities and linked private files", () => {
    const { directory } = fixture();
    const bytes = readFileSync(privateFile(directory), "utf8");
    writeFileSync(join(directory, PAIRING_PRIVATE_FILE), bytes);
    expect(() => new ChiefPairingRuntime({ directory, origin: "http://127.0.0.1:12345", hasBot: () => true })).toThrow(/Conflicting/);
    const second = fixture();
    linkSync(privateFile(second.directory), join(second.directory, "linked-key"));
    expect(() => new ChiefPairingRuntime({ directory: second.directory, origin: "http://127.0.0.1:12345", hasBot: () => true })).toThrow(/unlinked/);
  });
  it("refuses a redirected private directory", () => {
    const directory = mkdtempSync(join(tmpdir(), "chief-pairing-link-")); directories.push(directory);
    const target = join(directory, "elsewhere"); mkdirSync(target);
    symlinkSync(target, join(directory, PAIRING_PRIVATE_DIRECTORY), process.platform === "win32" ? "junction" : "dir");
    expect(() => new ChiefPairingRuntime({ directory, origin: "http://127.0.0.1:12345", hasBot: () => true })).toThrow(/unlinked/);
    expect(existsSync(join(target, PAIRING_PRIVATE_FILE))).toBe(false);
  });
  it("restricts the private directory and inherited atomic writes to the owner", () => {
    const { directory, runtime } = fixture();
    runtime.forget(randomUUID()); // Exercises replacement by a fresh atomic file.
    if (process.platform !== "win32") {
      expect(statSync(join(directory, PAIRING_PRIVATE_DIRECTORY)).mode & 0o777).toBe(0o700);
      expect(statSync(privateFile(directory)).mode & 0o777).toBe(0o600);
      return;
    }
    const script = `
$ErrorActionPreference = 'Stop'
Import-Module "$PSHOME/Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1"
$owner = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$folder = Get-Acl -LiteralPath $env:CHIEF_TEST_PRIVATE_DIRECTORY
$file = Get-Acl -LiteralPath $env:CHIEF_TEST_PRIVATE_FILE
$result = @($folder, $file) | ForEach-Object {
  $rules = @($_.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
  @{ protected = $_.AreAccessRulesProtected; owner = $_.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $owner; count = $rules.Count; unexpected = @($rules | Where-Object { $_.IdentityReference.Value -notin @($owner, 'S-1-5-18') -or $_.AccessControlType -ne 'Allow' }).Count }
}
ConvertTo-Json -InputObject $result -Compress
`;
    const result = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
      env: { ...process.env, CHIEF_TEST_PRIVATE_DIRECTORY: join(directory, PAIRING_PRIVATE_DIRECTORY), CHIEF_TEST_PRIVATE_FILE: privateFile(directory) }, encoding: "utf8", windowsHide: true, stdio: "pipe",
    }));
    expect(result[0]).toMatchObject({ protected: true, owner: true, count: 2, unexpected: 0 });
    expect(result[1]).toMatchObject({ owner: true, count: 2, unexpected: 0 });
  });
  it("never follows a redirect or stores an upstream diagnostic", async () => {
    const { runtime } = fixture(async (_url, init) => {
      expect(init?.redirect).toBe("error");
      return new Response("private-diagnostic", { status: 503 });
    });
    await expect(runtime.pair(invitation(), ["fixture-bot"])).rejects.toMatchObject({ status: 503 });
    expect(runtime.list()).toEqual([]);
  });
  it("excludes runtime credentials and temporary writes from portable backups", () => {
    expect(excludedWorkspaceAuthPath(".chief-pairing-private")).toBe(true);
    expect(excludedWorkspaceAuthPath(".chief-pairing-private/workspace-pairing.private.json.123.123abc.tmp")).toBe(true);
    expect(excludedWorkspaceAuthPath("workspace-pairing.private.json")).toBe(true);
    expect(excludedWorkspaceAuthPath("workspace-pairing.private.json.123.123abc.tmp")).toBe(true);
    expect(excludedWorkspaceAuthPath("notes/workspace-pairing.private.json")).toBe(false);
  });
});
