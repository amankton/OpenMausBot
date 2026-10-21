"""Export build inputs, never the operator's live workspace or credentials."""
import hashlib
import json
import subprocess
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
out = root / 'release' / f'Chief-Mac-Source-{version}.zip'
out.parent.mkdir(exist_ok=True)
trees = ['src', 'server', 'shared', 'electron', 'companion', 'scripts', 'skills', 'third_party', 'public', 'build']
top = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'electron-builder.yml', 'vite.config.ts', 'index.html', 'LICENSE', 'NOTICE', 'LICENSING.md', 'AGENTS.md', 'docs/CHIEF_MAC_BUILD.md', 'docs/CHIEF_DESKTOP_RELEASE.md', 'docs/operations/MAC-WHITE-LABEL-UPDATES-SOP.md', 'docs/operations/MAC-TAILSCALE-SOP.md', 'docs/operations/WHITE-LABEL-UPDATES-SOP.md', 'docs/operations/INSTALLATION-RECORD.md', 'docs/verification/README.md']
source_commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
tracked = set(subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode('utf-8').split('\0'))
files = [root / name for name in top] + list(root.glob('tsconfig*.json'))
for tree in trees:
    files.extend((root / tree).rglob('*'))
inventory = []
for file in sorted(set(files)):
    if not file.is_file() or file.is_symlink():
        continue
    relative = file.relative_to(root)
    if relative.as_posix() not in tracked:
        continue
    if any(part in {'.git', '.chief-local', '.omb-scratch', 'node_modules', 'enterprise', 'release', '__pycache__'} or part.endswith('.app') for part in relative.parts):
        continue
    if file.name.startswith('.env') or file.suffix in {'.pem', '.key', '.p12', '.pfx', '.keystore', '.log', '.tsbuildinfo', '.pyc'}:
        continue
    if relative.as_posix() == 'electron/resources/speech-helper':
        continue
    if not file.resolve().is_relative_to(root):
        raise RuntimeError(f'File escapes source root: {relative}')
    inventory.append((file, relative.as_posix()))
with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for file, relative in inventory:
        archive.write(file, f'chief-executive-suite/{relative}')
    archive.writestr('chief-executive-suite/README.md', (root / 'docs/CHIEF_MAC_BUILD.md').read_text(encoding='utf-8'))
    archive.writestr('chief-executive-suite/SOURCE-MANIFEST.json', json.dumps({
        'product': 'Chief Executive Suite', 'version': version, 'sourceCommit': source_commit,
        'excludes': ['owner agents', 'runtime data', 'credentials', 'enterprise', 'shared workspace stack'],
        'files': [{'path': relative, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()} for file, relative in inventory],
    }, indent=2))
print(json.dumps({'path': str(out), 'files': len(inventory), 'bytes': out.stat().st_size, 'sha256': hashlib.sha256(out.read_bytes()).hexdigest()}))
