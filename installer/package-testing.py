"""Build a source-inclusive engineering transfer; never export runtime profiles.

Uses exact compiled outputs from immutable local image IDs. No live container,
volume, owner database, environment file or credential store enters the archive.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import uuid
import zipfile
import runpy

ROOT = Path(__file__).resolve().parent.parent
DOCKER = ['docker']
CUSTOMER_SOURCE = {
    'server/background-work.ts', 'server/background-work.test.ts',
    'server/customer-members.ts', 'server/customer-members.test.ts',
    'integrations/platform/lifecycle/provisioning.mjs',
    'integrations/platform/lifecycle/http.test.mjs',
}


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args]).decode('utf-8').strip()


def copy(source, target):
    if source.is_symlink() or not source.is_file():
        raise ValueError('Only regular source/build files may be packaged: ' + source.name)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)


def export_source(source, dest, hermes=False):
    base_tracked = set(git(source, 'ls-files', '-z').split('\0'))
    tracked = set(base_tracked)
    if not hermes:
        tracked |= set(git(source, 'ls-files', '--others', '--exclude-standard', '-z').split('\0'))
    count = 0
    for name in sorted(tracked):
        if not name:
            continue
        p = Path(name)
        if any(part in {'.git', '.chief-local', 'node_modules', 'release', 'dist', 'dist-server', 'dist-native', 'dist-electron', 'dist-companion', '.venv', '__pycache__', 'work', '.vercel', 'payload'} for part in p.parts):
            continue
        if p.name.startswith('.env') or p.suffix.lower() in {'.pem', '.key', '.p12', '.pfx', '.jks', '.keystore', '.log', '.db', '.sqlite', '.pyc', '.tsbuildinfo'}:
            continue
        if '.test.' in p.name and name not in CUSTOMER_SOURCE and not name.startswith(('installer/', 'server/drivers/hermes-customer-read-scope.test.ts')):
            continue
        if hermes and (p.parts[0] in {'tests', 'test', 'docs', 'examples', 'data', 'profiles', 'memories', '.github', '.agents', '.claude'} or p.name == '.project-root'):
            continue
        if not hermes and p.parts[0] in {'.github', 'evals', 'ios', 'android', 'apps'}:
            continue
        if not hermes and p.parts[0] == 'docs' and not name.startswith(('docs/plans/2026-11-03-chief-', 'docs/verification/README.md', 'docs/verification/hermes-', 'docs/CHIEF_', 'docs/operations/MAC-')):
            continue
        if not hermes and name not in base_tracked and name not in CUSTOMER_SOURCE and not name.startswith(('installer/', 'docs/plans/2026-11-03-chief-', 'server/drivers/hermes-customer-read-scope.test.ts')):
            continue
        file = source / p
        if file.is_file() and not file.is_symlink():
            copy(file, dest / p)
            count += 1
    return count


def make_catalog(target):
    roster = json.loads((Path.home() / '.openmausbot/bots.json').read_text(encoding='utf-8-sig'))
    records = [b for b in roster if str(b.get('section', '')).startswith('Agency - ') or b.get('section') == 'Decision Council']
    core = [
        {'name': 'Bacca', 'title': 'Chief of Staff', 'description': 'Coordinates priorities, delegates to selected specialists and verifies delivery.', 'section': 'Chief Core', 'soul': 'You are the customer\'s Chief of Staff. Keep priorities and ongoing work clear. Delegate to the operator and selected specialists using their actual granted tools. Follow through until the objective is delivered or a concrete decision is needed. Verify outputs and preserve the customer\'s authority and personal/shared context boundaries.', 'color': 'blue'},
        {'name': 'Solo', 'title': 'Operations lead', 'description': 'Executes work, reconciles unfinished tasks and delivers verified results.', 'section': 'Chief Core', 'soul': 'You are the customer\'s operations lead. Carry authorized work from context gathering through execution, testing and delivery. Coordinate with the Chief of Staff and selected specialists. Make routine progress without repeated requests for the same permission. Surface actual blockers and consequential decisions, and keep usable results discoverable.', 'color': 'green'},
    ]
    lenses = {'Council Contrarian': 'test the strongest opposing case and overlooked alternatives', 'Council Pragmatist': 'evaluate feasibility, sequencing and practical resource limits', 'Council Skeptic': 'challenge unsupported claims and inspect failure modes', 'Council Visionary': 'evaluate long-term opportunity and alternative futures', 'Council Analyst': 'compare evidence, assumptions, uncertainty and trade-offs'}
    agents, seen = [], set()
    for bot in core + records:
        name = bot['name']
        role_id = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
        if role_id in seen:
            raise ValueError('Duplicate catalog identity: ' + role_id)
        seen.add(role_id)
        instructions = bot.get('soul', '')
        if name in lenses:
            instructions = f'You are an advisory council member. Your role is to {lenses[name]}. Independently inspect the explicitly supplied decision packet before seeing peer recommendations. Distinguish facts, assumptions and uncertainty. Present a recommendation, reasoning, material risks and the evidence that would change your view. When asked to review peers, preserve reasoned dissent and identify each actual report accurately. Do not simulate other members or claim a round completed without its records. The customer makes the decision. Use only authorized context and tools; do not take external actions from an advisory assignment.'
        role = {'id': role_id, 'name': name, 'title': bot.get('title', ''), 'description': bot.get('description', ''), 'division': bot.get('section', 'Agency'), 'soul': instructions, 'color': bot.get('color', 'blue')}
        if name in lenses:
            role['title'] = name.removeprefix('Council ')
            role['description'] = 'Advisory role: ' + lenses[name] + '.'
        text = json.dumps(role)
        if re.search(r'(?:C:\\\\Users\\\\|AppData|agent-family|brain_recall|brain_remember|\bamankton\b|\bAmon(?:Jamahal)?\b|@(?:gmail|outlook)\.|gh[pousr]_[A-Za-z0-9]{25,}|sk-[A-Za-z0-9_-]{30,})', text, re.I):
            raise ValueError('Customer profile review required: ' + role_id)
        if len((instructions + (ROOT / 'installer/customer-protocol.txt').read_text()).encode()) > 23800:
            raise ValueError('Role instructions exceed portable profile budget: ' + role_id)
        role['revision'] = hashlib.sha256(text.encode()).hexdigest()
        agents.append(role)
    target.write_text(json.dumps({'schemaVersion': 1, 'kind': 'customer-role-catalog', 'source': 'Reviewed owner-authorized Agency roster; role fields only', 'adaptations': 'Core profiles newly authored; five Council profiles rewritten as portable customer roles', 'agents': agents}, indent=2), encoding='utf-8')
    return len(agents)


def image_files(image, names, dest):
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', image):
        raise ValueError('Expected immutable image')
    container = subprocess.check_output([*DOCKER, 'create', '--label', 'io.chief.purpose=installer-static-export', '--entrypoint', '/bin/true', image], text=True).strip()
    if not re.fullmatch(r'[a-f0-9]{64}', container):
        raise ValueError('Unexpected container identity')
    try:
        for name in names:
            subprocess.run([*DOCKER, 'cp', container + ':/usr/src/app/' + name, str(dest / name)], check=True, stdout=subprocess.DEVNULL)
    finally:
        subprocess.run([*DOCKER, 'rm', container], check=True, stdout=subprocess.DEVNULL)


def platform_payload(target):
    global DOCKER
    context = subprocess.check_output(['docker', 'context', 'show'], text=True).strip()
    endpoint = subprocess.check_output(['docker', 'context', 'inspect', context, '--format', '{{.Endpoints.docker.Host}}'], text=True).strip()
    if not re.match(r'^(?:unix|npipe)://', endpoint): raise ValueError('Only a verified local Docker context can export static code')
    DOCKER = ['docker', '--context', context]
    target.mkdir(parents=True)
    lock = json.loads((ROOT / 'integrations/platform/image-lock.json').read_text())
    source = ROOT / '.chief-local/platform-source'
    build = json.loads((ROOT / '.chief-local/platform-build-logs/production-build-receipt.json').read_text())
    front = target / 'front'
    for name, metadata in build['assets'].items():
        file = source / 'dev/prod/dist' / name
        if not file.resolve().is_relative_to((source / 'dev/prod/dist').resolve()) or sha(file) != metadata['sha256']:
            raise ValueError('Compiled frontend does not match the reviewed receipt: ' + name)
        copy(file, front / 'dist' / name)
    for name in git(source, 'ls-files', '-z', 'dev/prod/public').split('\0'):
        if name and Path(name).name != 'config.json':
            copy(source / name, front / 'dist' / Path(name).relative_to('dev/prod/public'))
    images = {'front': {'base': lock['images']['front']['digest'], 'sourceRevision': build['sourceRevision']}}
    # Bundles are code from exact candidate images, not live containers/volumes.
    for name, receipt, names in [('workspace', 'workspace-image.json', ['bundle.js']), ('transactor', 'transactor-image.json', ['bundle.js', 'model.json'])]:
        data = json.loads((ROOT / '.chief-local/platform' / receipt).read_text()); folder = target / name; folder.mkdir()
        image_files(data['image'], names, folder)
        for filename in names:
            if sha(folder / filename) != data['outputs'][filename]:
                raise ValueError('Compiled backend differs from its recorded output')
        images[name] = {'base': lock['images'][name]['digest'], 'sourceImage': data['image'], 'sourceRevision': data['sourceRevision']}
    account = json.loads((ROOT / '.chief-local/platform/con01-account.compose.json').read_text())['services']['account']['image']
    folder = target / 'account'; folder.mkdir(); image_files(account, ['bundle.js'], folder)
    images['account'] = {'base': lock['images']['account']['digest'], 'sourceImage': account, 'sourceRevision': build['sourceRevision']}
    for name, item in images.items():
        folder = target / name
        if name == 'front':
            dockerfile = f'FROM {item["base"]}\nCOPY dist/ /app/dist/\n'
        else:
            dockerfile = f'FROM {item["base"]}\nWORKDIR /usr/src/app\nCOPY bundle.js ./bundle.js\n'
            if name == 'transactor': dockerfile += 'COPY model.json ./model.json\n'
        dockerfile += 'COPY source-notice/ /usr/share/doc/chief-source/\n'
        (folder / 'Dockerfile').write_text(dockerfile)
        notices = folder / 'source-notice'; notices.mkdir()
        copy(source / 'LICENSE', notices / 'LICENSE')
        for patch in (ROOT / 'integrations/platform/patches').glob('*.patch'):
            copy(patch, notices / patch.name)
        (notices / 'SOURCE.json').write_text(json.dumps(item, indent=2))
    (target / 'manifest.json').write_text(json.dumps({'schemaVersion': 1, 'kind': 'reviewed-compiled-code', 'platform': 'linux/amd64', 'images': images}, indent=2))
    return images


def launchers(bundle, dependencies):
    node = dependencies['node']['darwin-arm64']
    shell = f'''#!/bin/bash
set -euo pipefail
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
if ! command -v node >/dev/null || ! node -e 'process.exit(Number(process.versions.node.split(".")[0])>=24?0:1)'; then
  echo "Installing the locked Node.js prerequisite. Complete Apple's Installer, then return here."
  cache="$(mktemp -d -t chief-node)"
  curl --fail --location --proto '=https' --tlsv1.2 '{node['url']}' -o "$cache/Node.pkg"
  echo '{node['sha256']}  '"$cache/Node.pkg" | shasum -a 256 -c -
  pkgutil --check-signature "$cache/Node.pkg"
  open -W "$cache/Node.pkg"
fi
node app/installer/setup.mjs
'''
    (bundle / 'Start-Chief-Mac.command').write_text(shell, encoding='utf-8', newline='\n')
    node = dependencies['node']['win32-x64']
    powershell = f'''$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (!$nodePath -or ([int]((& $nodePath -p 'process.versions.node.split(".")[0]'))) -lt 24) {{
  $cache = Join-Path ([System.IO.Path]::GetTempPath()) ('chief-node-' + [guid]::NewGuid().ToString())
  New-Item -ItemType Directory -Path $cache | Out-Null
  $msi = Join-Path $cache 'Node.msi'
  Invoke-WebRequest -Uri '{node['url']}' -OutFile $msi
  if ((Get-FileHash -LiteralPath $msi -Algorithm SHA256).Hash.ToLowerInvariant() -ne '{node['sha256']}') {{ throw 'Node installer checksum mismatch' }}
  if ((Get-AuthenticodeSignature -LiteralPath $msi).Status -ne 'Valid') {{ throw 'Node installer signature is not valid' }}
  $process = Start-Process msiexec.exe -ArgumentList @('/i', ('"' + $msi + '"'), '/passive') -Wait -PassThru
  if ($process.ExitCode -notin @(0,3010)) {{ throw 'Node installation did not complete' }}
  if ($process.ExitCode -eq 3010) {{ Write-Host 'Restart Windows, then run this same launcher again.'; exit 3010 }}
  $nodePath = Join-Path $env:ProgramFiles 'nodejs\\node.exe'
}}
$env:Path = [System.IO.Path]::GetDirectoryName($nodePath) + [System.IO.Path]::PathSeparator + $env:Path
& $nodePath (Join-Path $PSScriptRoot 'app\\installer\\setup.mjs')
exit $LASTEXITCODE
'''
    (bundle / 'Start-Chief-Windows.ps1').write_text(powershell, encoding='utf-8-sig')
    (bundle / 'Start-Chief-Windows.cmd').write_text('@echo off\r\npowershell.exe -NoProfile -File "%~dp0Start-Chief-Windows.ps1"\r\npause\r\n', encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--output', required=True); parser.add_argument('--resume', action='store_true'); args = parser.parse_args()
    bundle = Path(args.output).resolve()
    marker = bundle / 'BUILD-STAGE.json'
    if args.resume:
        stage = json.loads(marker.read_text())
        if stage.get('kind') != 'chief-owned-engineering-stage' or not bundle.is_relative_to(ROOT / 'release') or stage.get('sourceCommit') != git(ROOT, 'rev-parse', 'HEAD'):
            raise ValueError('Cannot resume an unowned or different source stage')
    elif bundle.exists() or bundle.with_suffix('.zip').exists():
        raise ValueError('Refusing to overwrite a prior testing bundle')
    bundle.mkdir(parents=True, exist_ok=True)
    if not args.resume: marker.write_text(json.dumps({'kind': 'chief-owned-engineering-stage', 'sourceCommit': git(ROOT, 'rev-parse', 'HEAD')}))
    app = bundle / 'app'; app.mkdir(exist_ok=True)
    print('Exporting Chief build source', flush=True); source_count = export_source(ROOT, app)
    for name in CUSTOMER_SOURCE:
        if not (app / name).is_file() or sha(app / name) != sha(ROOT / name):
            raise ValueError('Required customer runtime source missing or stale: ' + name)
    payload = app / 'installer/payload'; payload.mkdir(parents=True, exist_ok=True)
    count = make_catalog(payload / 'agents.json')
    hermes = Path((Path(os.environ.get('LOCALAPPDATA', str(Path.home() / 'AppData/Local'))) / 'hermes/installs/d753893991a5b26a/inputs/.project-root').read_text().strip())
    if args.resume and (payload / 'hermes-source/pyproject.toml').exists(): hermes_count = sum(f.is_file() for f in (payload / 'hermes-source').rglob('*'))
    else:
        print('Exporting Hermes code without profiles', flush=True); hermes_count = export_source(hermes, payload / 'hermes-source', hermes=True)
    runpy.run_path(str(ROOT / 'installer/patch-hermes-budget.py'))['patch'](payload / 'hermes-source')
    if args.resume and (payload / 'platform/manifest.json').exists(): images = json.loads((payload / 'platform/manifest.json').read_text())['images']
    else:
        print('Exporting compiled workspace code', flush=True); images = platform_payload(payload / 'platform')
    copy(Path('C:/workspace/ANTIGRAVITY/agency-agents/agency-agents/LICENSE'), payload / 'AGENCY-LICENSE')
    dependencies = json.loads((ROOT / 'installer/dependencies.json').read_text()); launchers(bundle, dependencies)
    copy(ROOT / 'installer/TEST-ON-TARGET.md', bundle / 'START-HERE.md')
    inventory = []
    # Crypto libraries legitimately contain PEM parser/header strings. A header
    # plus encoded key material is a credential; a bare format marker is not.
    forbidden = re.compile(r'(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----(?:\s|\\[rn])+[A-Za-z0-9+/=]{40,}|\bgh[pousr]_[A-Za-z0-9]{35,}|\bsk-(?:proj-|ant-)[A-Za-z0-9_-]{40,})')
    for file in sorted(bundle.rglob('*')):
        if file.is_file() and not any(part == '__pycache__' or part.endswith('.egg-info') for part in file.parts) and file.suffix != '.pyc':
            if file.parent == bundle and file.name in {'TRANSFER-MANIFEST.json', 'SHA256SUMS.txt'}: continue
            # Scan all text actually exported, including compiled code. Real matches
            # stop packaging; fixtures are not silently exempted from this scan.
            if file.suffix in {'.json', '.js', '.mjs', '.py', '.txt', '.yaml', '.yml', '.toml'} and file.stat().st_size < 80000000:
                if forbidden.search(file.read_text(encoding='utf-8', errors='replace')):
                    raise ValueError('Credential-pattern review required: ' + str(file.relative_to(bundle)))
            inventory.append({'path': file.relative_to(bundle).as_posix(), 'sha256': sha(file), 'bytes': file.stat().st_size})
    manifest = {
        'schemaVersion': 1, 'installerVersion': '0.2.0-test', 'kind': 'engineering-test-bundle',
        'sourceCommit': git(ROOT, 'rev-parse', 'HEAD'), 'sourceHasLocalInstallerChanges': True,
        'hermesSourceCommit': git(hermes, 'rev-parse', 'HEAD'), 'agencyProfiles': count,
        'nativeAcceptance': {'windows': 'personal frontend and isolated workflow verified; clean full install and signing pending', 'macos': 'pending target installation, emulation, login/wake and native packaging'},
        'memberLifecycleProvisioning': 'implemented: authenticated-member profiles, signed broker, leases, scoped pairing and revocation',
        'unattendedProactiveWork': {'implemented': True, 'requestLimit': 20, 'activeWorkMs': 600000, 'activeRoots': 1, 'enabledRoutines': 20, 'minimumIntervalMinutes': 15, 'catchUpMinutes': 30, 'schedulesEnabledBySetup': False},
        'verificationReceipt': 'app/installer/VERIFICATION.json', 'files': inventory,
    }
    (bundle / 'TRANSFER-MANIFEST.json').write_text(json.dumps(manifest, indent=2))
    checksum = '\n'.join(f'{row["sha256"]}  {row["path"]}' for row in inventory) + '\n'
    (bundle / 'SHA256SUMS.txt').write_text(checksum)
    archive = bundle.with_suffix('.zip')
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for file in sorted(bundle.rglob('*')):
            if file.is_file() and not any(part == '__pycache__' or part.endswith('.egg-info') for part in file.parts) and file.suffix != '.pyc':
                info = zipfile.ZipInfo(file.relative_to(bundle).as_posix()); info.compress_type = zipfile.ZIP_DEFLATED; info.create_system = 3
                info.external_attr = (0o100755 if file.name.endswith('.command') else 0o100644) << 16
                z.writestr(info, file.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
    archive.with_suffix('.zip.sha256').write_text(sha(archive) + '  ' + archive.name + '\n')
    print(json.dumps({'zip': str(archive), 'bytes': archive.stat().st_size, 'sha256': sha(archive), 'files': len(inventory), 'profiles': count, 'chiefFiles': source_count, 'hermesFiles': hermes_count, 'overlayImages': list(images)}, indent=2), flush=True)


if __name__ == '__main__':
    main()
