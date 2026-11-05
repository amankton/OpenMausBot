import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CHIEF_ENHANCEMENT_ADDENDUM, MAIL_REVIEW_ADDENDUM } from "../shared/chief-enhancement-setup.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const name = process.argv[i];
  if (!name?.startsWith("--") || !process.argv[i + 1] || args.has(name)) throw Error("Use explicit --installer --source-commit --base-commit --gates --out arguments");
  args.set(name, process.argv[i + 1]);
}
for (const key of args.keys()) if (!["--installer", "--source-commit", "--base-commit", "--gates", "--out", "--signature", "--baseline-overlay-sha256", "--source-repository"].includes(key)) throw Error(`Unknown option ${key}`);
if (args.has("--baseline-overlay-sha256") && !/^[a-f0-9]{64}$/.test(args.get("--baseline-overlay-sha256"))) throw Error("Baseline overlay must be a SHA-256 digest");
const sourceRepository = args.get("--source-repository") ?? null;
if (sourceRepository && !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(sourceRepository)) throw Error("Use an explicit public GitHub repository URL without credentials");
for (const key of ["--installer", "--source-commit", "--base-commit", "--gates", "--out"]) if (!args.has(key)) throw Error(`Missing ${key}`);
const git = (...values) => execFileSync("git", values, {cwd: root, encoding: "utf8", windowsHide: true}).trim();
for (const key of ["--source-commit", "--base-commit"]) {
  if (!/^[a-f0-9]{40}$/.test(args.get(key))) throw Error(`${key} must be an exact commit SHA`);
  git("cat-file", "-e", `${args.get(key)}^{commit}`);
}
const installer = resolve(args.get("--installer"));
if (!existsSync(installer) || !statSync(installer).isFile()) throw Error("The exact built installer is required");
const gateInput = JSON.parse(readFileSync(resolve(args.get("--gates")), "utf8"));
const validStates = new Set(["passed", "failed", "blocked", "not-exercised", "excluded"]);
if (!Array.isArray(gateInput) || !gateInput.length) throw Error("Provide explicit acceptance gates");
for (const gate of gateInput) {
  if (typeof gate.id !== "string" || !validStates.has(gate.status) || typeof gate.detail !== "string") throw Error("Every gate needs id, status and detail");
  if (/[A-Za-z]:[\\/]|\/(?:Users|home)\//.test(gate.detail)) throw Error("Gate details must not contain private absolute paths");
  if (gate.evidence && (!Array.isArray(gate.evidence) || gate.evidence.some(value => typeof value !== "string" || value.includes("\\") || value.includes(":") || value.startsWith("/") || value.split("/").includes("..")))) throw Error("Published evidence references must be repository-relative");
}
const digest = value => createHash("sha256").update(value).digest("hex");
const output = resolve(args.get("--out"));
mkdirSync(output, {recursive: true});
const docs = join(root, "docs/chief-install-handoff");
const documentNames = readdirSync(docs).filter(name => name.endsWith(".md")).sort();
for (const name of documentNames) copyFileSync(join(docs, name), join(output, name));
const evidenceManifest = [];
for (const path of [...new Set(gateInput.flatMap(gate => gate.evidence ?? []))].sort()) {
  if (!path.startsWith("docs/verification/") || !/\.(?:md|json|png)$/.test(path)) continue;
  const source = join(root, path), target = join(output, "evidence", path);
  if (!existsSync(source) || !statSync(source).isFile()) throw Error(`Missing published verification evidence ${path}`);
  mkdirSync(dirname(target), {recursive: true}); copyFileSync(source, target);
  evidenceManifest.push({path:`evidence/${path}`,sha256:digest(readFileSync(source))});
}
const statusDocument = ["# Verified release status", "", "These are the observed gates for this exact installer. A blocked or unexercised gate is not a pass.", "", ...gateInput.flatMap(gate => [`## ${gate.id}: ${gate.status}`, "", gate.detail, "", ...(gate.evidence ?? []).map(path => {
  const copied = evidenceManifest.some(item => item.path === `evidence/${path}`);
  const target = copied ? `evidence/${path}` : sourceRepository ? `${sourceRepository}/blob/${args.get("--source-commit")}/${path}` : null;
  return target ? `- [${path}](${target})` : `- Evidence in source checkout: ${path}`;
}), ""])].join("\n");
writeFileSync(join(output, "RELEASE-STATUS.md"), statusDocument);
documentNames.push("RELEASE-STATUS.md");
for (const [name, title, content] of [["CHIEF-ADDENDUM.md", "Chief instruction addendum", CHIEF_ENHANCEMENT_ADDENDUM], ["MAIL-ADDENDUM.md", "Correspondence instruction addendum", MAIL_REVIEW_ADDENDUM]]) {
  const expected = `# ${title}\n\n${content}\n`;
  if (readFileSync(join(docs, name), "utf8").replaceAll("\r\n", "\n") !== expected) throw Error(`The handoff ${name} differs from the actual reviewed setup bundle`);
}
const packagedInstaller = join(output, basename(installer));
if (resolve(packagedInstaller) !== installer) copyFileSync(installer, packagedInstaller);
const skills = ["executive-check-in", "execute-and-verify", "coordinate-and-review", "decision-brief", "scan-mail", "classify-and-prioritize", "prepare-reply", "reconcile-follow-ups"];
const skillManifest = [];
for (const name of skills) {
  const source = join(root, "skills", name, "SKILL.md");
  const target = join(output, "skills", name, "SKILL.md");
  mkdirSync(dirname(target), {recursive: true}); copyFileSync(source, target);
  skillManifest.push({name, path: `skills/${name}/SKILL.md`, sha256: digest(readFileSync(source))});
}
// This is an explicit source inventory, not proof that generated native inputs,
// external tools and a dirty customized checkout can be reproduced from Git.
const sourcePaths = git("ls-files", "--cached", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean)
  .filter(path => /^(?:server|shared|src|scripts|electron|public|skills|companion|build|integrations|third_party)\//.test(path) || (!path.includes("/") && /\.(?:html|[cm]?js|tsx?|json|ya?ml)$/.test(path)))
  .filter(path => existsSync(join(root, path)) && statSync(join(root, path)).isFile()).sort();
const inputs = sourcePaths.map(path => ({path,sha256:digest(readFileSync(join(root, path)))}));
const inputFingerprint = digest(JSON.stringify(inputs));
const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  product: "Chief Executive Suite",
  version: JSON.parse(readFileSync(join(root,"package.json"),"utf8")).version,
  source: {repository:sourceRepository,featureCommit:args.get("--source-commit"),baseCommit:args.get("--base-commit"),buildCheckoutCommit:git("rev-parse","HEAD"),
    workingInputsPresent:git("status","--porcelain").length > 0,inputFingerprint,
    baselineOverlaySha256:args.get("--baseline-overlay-sha256") ?? null,
    inventoryScope:"Repository source directories and root HTML/JavaScript/TypeScript/JSON/YAML inputs. Generated native inputs and external toolchains are not inventoried here.",
    reproducibility:"Feature commit identifies the reviewed delta. A customized binary additionally depends on its recorded source inventory, baseline overlay, generated native inputs and toolchain; this manifest does not claim complete reproducibility from the feature commit."},
  installer: {file:basename(installer),bytes:statSync(installer).size,sha256:digest(readFileSync(installer)),platform:process.platform,arch:process.arch,signature:args.get("--signature") ?? "unverified"},
  defaults: {accounts:[],createAgent:false,changeModel:false,enableScans:false,createSchedule:false,enableNotifications:false,expandGrants:false},
  supported: {provider:"Composio Gmail",nativeImap:false,agentRoles:"Select existing identities; one agent may fill both roles"},
  skills:skillManifest,
  documents:documentNames.map(path => ({path,sha256:digest(readFileSync(join(output,path)))})),
  evidence:evidenceManifest,
  gates:gateInput,
  buildInputs:inputs,
};
writeFileSync(join(output,"RELEASE-MANIFEST.json"),JSON.stringify(manifest,null,2)+"\n");
const checksums = [{path:manifest.installer.file,sha256:manifest.installer.sha256},...manifest.documents,...manifest.skills,...manifest.evidence,{path:"RELEASE-MANIFEST.json",sha256:digest(readFileSync(join(output,"RELEASE-MANIFEST.json")))}];
writeFileSync(join(output,"CHECKSUMS.txt"), checksums.map(({path,sha256}) => `${sha256}  ${path}`).join("\n")+"\n");
console.log(JSON.stringify({out:output,version:manifest.version,installer:manifest.installer.file,sha256:manifest.installer.sha256,inputFingerprint,gates:gateInput.map(({id,status})=>({id,status}))}));
