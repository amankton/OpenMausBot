import { execFileSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export const PAIRING_PRIVATE_DIRECTORY = ".chief-pairing-private";
export const PAIRING_PRIVATE_FILE = "workspace-pairing.private.json";

export function pairingPathExists(path: string): boolean {
  // existsSync follows links and would treat a dangling link as a missing key.
  try { lstatSync(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

/** This protects against other ordinary OS accounts, not programs running as
 * the owner. Full-access local agents share the owner's OS trust boundary. */
export function protectPairingPath(path: string, directory: boolean): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) {
    throw new Error("Pairing storage must use a private directory and regular, unlinked files.");
  }
  if (process.platform !== "win32") {
    if (process.getuid && stat.uid !== process.getuid()) throw new Error("Pairing storage belongs to another OS account.");
    chmodSync(path, directory ? 0o700 : 0o600);
    return;
  }
  // Node's mode bits do not set a Windows DACL. Pass the path as data, never
  // interpolate it into a shell command. A fresh ACL also removes explicit
  // grants; merely disabling inheritance would leave those grants intact.
  const script = `
$ErrorActionPreference = 'Stop'
Import-Module "$PSHOME/Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1"
$target = $env:CHIEF_PAIRING_ACL_PATH
$isDirectory = $env:CHIEF_PAIRING_ACL_DIRECTORY -eq '1'
$item = Get-Item -LiteralPath $target -Force
if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse point refused' }
$owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
$system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$current = Get-Acl -LiteralPath $target
if ($current.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $owner.Value) { throw 'Foreign owner refused' }
$acl = if ($isDirectory) { [Security.AccessControl.DirectorySecurity]::new() } else { [Security.AccessControl.FileSecurity]::new() }
$acl.SetOwner($owner)
$acl.SetAccessRuleProtection($true, $false)
$inherit = if ($isDirectory) { [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
foreach ($sid in @($owner, $system)) {
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', $inherit, 'None', 'Allow'))
}
if ($isDirectory) { [IO.Directory]::SetAccessControl($target, $acl) } else { [IO.File]::SetAccessControl($target, $acl) }
$verified = Get-Acl -LiteralPath $target
$rules = $verified.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])
if (-not $verified.AreAccessRulesProtected -or $rules.Count -ne 2) { throw 'Private ACL not established' }
foreach ($rule in $rules) {
  if ($rule.IdentityReference.Value -notin @($owner.Value, $system.Value) -or $rule.AccessControlType -ne 'Allow' -or $rule.FileSystemRights -ne 'FullControl') { throw 'Unexpected ACL' }
}
`;
  try {
    execFileSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
        env: { ...process.env, CHIEF_PAIRING_ACL_PATH: path, CHIEF_PAIRING_ACL_DIRECTORY: directory ? "1" : "0" },
        windowsHide: true, timeout: 10000, stdio: "pipe",
      });
  } catch { throw new Error("Could not establish private Windows pairing storage. Pairing is unavailable."); }
}

export function pairingPrivateDirectory(dataDirectory: string): string {
  const directory = join(dataDirectory, PAIRING_PRIVATE_DIRECTORY);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  protectPairingPath(directory, true);
  return directory;
}
