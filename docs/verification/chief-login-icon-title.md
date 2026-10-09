# Chief login icon correction — October 9, 2026

Owner supplied `chief-mark-one-color-ink.svg` from their downloaded Chief logo
files and clarified: replace only the icon, keeping “Chief Executive Suite”.

Both native login components now restore the configured title and display that
exact SVG at 24 × 24 CSS pixels. CSS `brightness(0) invert(1)` renders its visible
pixels white; its geometry, alpha and original file bytes are unchanged.
Original asset SHA-256:
`1b5b8bf94db4fc4081c8ab546c1d53ae65106ff8a1874490cd1c490dd4a49ef3`.

Incremental patch 0011 preserves all ten earlier patch files. Ordered source
reconstruction verifies 65 files and intermediate provenance. Four changed/native
Svelte components compile; the changed build/provenance helpers pass lint. A
separate static browser preview confirms the loaded icon, white filter and title.
That preview is not evidence of deployment.

## Current rollout status

**Deployed and visually verified.** The owner explicitly asked whether the memory
guard was self-imposed and authorized changing it. An opt-in `--constrained-memory`
profile now requires 4,096 MiB available to start and retains a 1,280 MiB running
minimum. The compiler still uses 2,048 MiB old space and one worker. The original
standard profile remains unchanged. Four policy tests cover standard thresholds,
the constrained thresholds, oversized heaps and invalid/unbounded limits. The
policy helper hash and selected profile are recorded in the production receipt
and checked by image assembly.

Both production configurations passed. The sampled minimum free memory was
2,055 MiB and peak compiler RSS was 2,519 MiB. Exact-build consent, recording,
capture, templates and embedded playback acceptance all passed. The frontend-only
rollout and deployed playback passed. All original storage mounts and the other
16 Chief container identities were preserved.

Current image:
`sha256:4b7b88e27c2044310e26a72618c9aa7fa2e8107150d0a7304697f5e9cfc949cf`.
Evidence: `docs/verification/evidence/chief-branding-rollout.json` and
`docs/verification/evidence/chief-embedded-playback-deployed.json`.

A fresh separate browser tab verified the loaded exact icon, computed white
filter, 24 × 24 geometry, and adjacent “Chief Executive Suite” text on the actual
deployed login route. The pair fits a 390 CSS pixel viewport with no horizontal
overflow. The test override was cleared and test tab closed. The owner's original
sign-in tab was left untouched. Live screenshot: `chief-icon-title-live.jpg` in
chat outputs. No installer change, commit or push.

## Earlier memory blockage and cache diagnosis

Before the authorized profile adjustment, the initial build was refused
at 3,623 MiB available against the existing 4,608 MiB start guard. Docker/WSL then
showed roughly 1.7 GB file cache and 2 GB reclaimable slab. One cache reclamation
after flushing pending writes freed enough Windows memory for another guarded
build attempt. Every running container ID remained unchanged. No restart,
configuration tuning, file deletion or volume removal was used. This was a
one-time debugging action; cache eviction can temporarily increase I/O, as
described in the [Linux kernel documentation](https://kernel.org/doc/html/latest/admin-guide/sysctl/vm.html#drop-caches).

The first retry passed the first production configuration, but the memory monitor
stopped the main build when host memory fell to 2,010 MiB, below its unchanged
2,048 MiB running minimum. No image was assembled or deployed from this attempt.
The previous image remains available for rollback. The owner's sign-in tab was not touched.
Source/evidence/build-receipt/image-metadata backups are retained in
`work/chief-login-icon-baseline`.

For future local builds on this machine, use the documented production command
with `--constrained-memory` when the standard reserve is unnecessarily blocking
the build. Continue exact-build acceptance and frontend-only rollout checks.
