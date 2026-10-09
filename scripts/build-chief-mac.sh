#!/usr/bin/env bash
set -euo pipefail
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
if [ "$(uname -s)" != Darwin ]; then echo "Run this on the Mac."; exit 1; fi
command -v node >/dev/null || { echo "Install Node.js 24 LTS from nodejs.org, then run this again."; exit 1; }
node -e 'if(Number(process.versions.node.split(".")[0])<24)process.exit(1)' || { echo "Node.js 24 or newer is required."; exit 1; }
command -v pnpm >/dev/null || { echo "Run: npm install -g pnpm@10.33.0"; exit 1; }
xcode-select -p >/dev/null 2>&1 || { echo "Run: xcode-select --install, finish Apple's installer, then run this again."; exit 1; }
pnpm install --frozen-lockfile
pnpm package:mac
for app in release/mac*/Chief\ Executive\ Suite.app; do
  [ -d "$app" ] || continue
  node scripts/verify-chief-package.mjs "$app/Contents/Resources"
done
echo "Mac artifacts are in the release folder. They still require native launch and permission testing."
echo "For normal distribution, verify Developer ID signing and Apple notarization; see docs/CHIEF_MAC_BUILD.md."
