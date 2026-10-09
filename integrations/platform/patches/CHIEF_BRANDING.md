# Chief customer-facing branding and workspace shell

Patch 0009 is additive over the eight accepted frontend patches, at retained
source revision `03b7aad7dc562f4f9769c51a4df08191a0393997`.

**Latest owner-approved correction:** patch 0011 restores the visible
“Chief Executive Suite” title and replaces only the icon with the owner's supplied
single-color SVG, displayed all white using CSS. The original SVG bytes and shape
are preserved. All ten prior patches remain frozen; eleven reconstruct 65 files.
Current deployed image is
`sha256:4b7b88e27c2044310e26a72618c9aa7fa2e8107150d0a7304697f5e9cfc949cf`.
Production compilation, compiled acceptance, deployed playback and actual desktop/
390px login checks passed. See `docs/verification/chief-login-icon-title.md`.
The full wordmark change in patch 0010 below was an incorrect interpretation and
is retained as history, superseded by patch 0011.

Patch 0010 adds the owner's requested white-lettered Chief wordmark to both login
components, including the actual LoginApp route missed by patch 0009. It copies
the existing transparent Chief lockup without modification. All prior patch hashes
remain frozen; ten ordered patches reconstruct 64 source files. The new image
`sha256:2939c8ddef20e8557e2bf6d9ddc9c66838014e0b3c4c719ff1e7d05a9a5e66b5`
is deployed after the full compiled acceptance gates and deployed playback passed.
Only the frontend container changed. See
`docs/verification/chief-workspace-navigation-logo.md` for the latest verification.

The retained application uses **Chief Executive Suite** for its startup title,
default configured title, login identity and default favicon. It uses the
existing Chief avatar asset. Customer workspace names, icons and cached workspace
favicons retain their existing behavior. EPL notices and inherited attribution
remain intact. Provider names and service identifiers are not renamed.

`ChiefBrand.svelte` adds a 112 × 32 px slot to the retained application's native
top bar. When opened directly, it displays the Chief mark and name. When embedded,
the React host places its Chief menu over that reserved slot and expands the
iframe to the full viewport. The menu contains personal workspace, direct shared
workspace, connection check and sign-in/media guidance. An older frontend keeps
a compact 44 px host bar until the new native slot is available.

The bridge carries only readiness and slot coordinates. The host checks the
exact iframe window and configured origin, accepts only bounded top-bar geometry,
and ignores malformed messages. The child accepts a handshake only from its
actual parent on the opposite loopback hostname. No session, token, workspace
data or navigation command crosses the bridge. Existing iframe sandbox,
no-referrer policy, cookie boundary and explicit media permissions are retained.

## Verification and rollout status, October 9, 2026

- 46 focused host/branding tests passed; root TypeScript checks passed.
- Three changed Svelte components compiled; platform entry syntax passed.
- Nine patches reconstructed against pinned upstream: 62 files; all previous
  patch hashes and their final source hashes preserved.
- Real isolated Chief host plus the actual compiled ChiefBrand component passed
  browser checks for full-frame geometry, 390 px responsive layout, menu dismissal,
  draft persistence during a successful connection check, and blocked top navigation.
- The initial fixture work content was synthetic. Subsequent compiled consent,
  recording, capture, templates and embedded playback gates passed against the
  exact production receipt; deployed embedded playback also passed.
- After the earlier memory failures, the guarded 2,048 MiB production build
  completed with sufficient free RAM. The memory guard was not lowered. Previous
  assets, receipts and evidence remain backed up in `work/chief-branding-baseline`.
- Initial branding image `sha256:a7e20d654f192646e6174770921fa3f2da027ce1e9801460a10a0d85e49d75a2`
  was deployed before the incremental login wordmark update above. Only `front` was replaced; all storage mounts and the other 16 Chief
  container identities were preserved. The source preview now uses the native
  full-frame slot; live desktop and mobile geometry checks passed.
- Full native package type checking was not run. The installer remains separate.

Run `node integrations/platform/patches/verify-chief-branding-source.mjs` for the
bounded compile check, and `node --experimental-strip-types scripts/preview-chief-branding.ts`
for the disposable browser fixture (stop it with Ctrl-C). The fixture prints its
specific URLs; never substitute the owner's application URL for mutation checks.

For future rebuilds, use the existing guarded frontend build command, rerun the
compiled frontend acceptance checks against that exact receipt, and assemble the
image using `build-frontend-image.mjs`. The image assembler includes
new public assets captured in build inputs, so `/chief/avatar.svg` is packaged,
and includes this note and branding provenance. Preserve the existing production
build receipts before rebuilding. Deploy only the frontend service; the installer
baseline remains a separate branch and release. `scripts/rollout-chief-branding.mjs`
provides `--check` and `--apply`, checks the single-service image change, preserves
storage and other services, probes branding, and restores the previous frontend
on failure. See `docs/verification/chief-branding-workspace.md` for current receipts.

The retained build requires `NODE_PATH` to resolve its existing dependencies:

```powershell
$env:NODE_PATH = (Resolve-Path -LiteralPath .chief-local/platform-source/dev/prod/node_modules).Path
node --max-old-space-size=2048 integrations/platform/patches/build-frontend.mjs --omit-debug-artifacts --native-minify
```

The owner authorized an opt-in `--constrained-memory` profile for this machine:
4 GiB free to start, 1.25 GiB minimum while running, with the same 2 GiB old-space
cap and serial compiler. Standard thresholds remain unchanged. The selected
profile, memory samples and policy source hash are included in the build receipt.
This profile passed the complete build and acceptance sequence for patch 0011.
