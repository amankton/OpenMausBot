# Platform media consent increment

Reviewable source patch for release `s0.7.426`, commit `03b7aad7dc562f4f9769c51a4df08191a0393997`. The complete checkout lives at ignored `.chief-local/platform-source`; it was created independently from the public Platform repository. No live environment, credentials, workspaces or container contents were copied. `source-provenance.json` records the base revision, changed-file hashes and patch hash. Original source license notices are preserved; the retained code is EPL-2.0 (see `../upstream/LICENSE`).

`0001-explicit-media-consent.patch` changes:

- Recorder initialization leaves camera/microphone off. Existing device buttons explicitly enable capture; opening a settings selector only enumerates devices. Screen sharing remains an explicit browser permission action. Late camera/screen permission results are released after cancellation.
- Office connection leaves camera/microphone off even when saved preferences say on. Existing device buttons remain available. Joining, invitation acceptance and navigation do not imply device consent.
- The muted-speech detector previously acquired a separate microphone stream while muted. It now requires explicit opt-in through microphone settings for each connection; disconnect clears consent. The English label explicitly explains that this uses the microphone while muted. Other existing translations are unchanged and need wording review before localized release.
- Guest entry defaults video, microphone and recording acceptance off. Preview starts only from the video control; closing or disabling preview releases late permission results.
- Shared media settings enumerate devices without capture. Expanding camera settings displays an explicit camera on/off preview button; stopping or closing preview releases late permission results. This closes the shared settings path used by Office as well as the recorder-specific selectors.

Patch `0001` contains no invitation admission/backend changes, model migration, service configuration or deployment changes. The eventual combined frontend also includes separately reviewed patches `0002` and `0003`; its build receipt hashes every modified/new frontend source file. Recording/transcription authorization on the server is separate from this capture-default change. Settings can initially show fewer device labels before the user explicitly enables a device; this is the browser's permission behavior. Media reconnection with devices already explicitly enabled in the same live connection retains existing behavior.

## Verification

From Chief's root:

```powershell
node --test integrations/platform/patches/media-consent.test.mjs
git -C .chief-local/platform-source diff --check
git -C .chief-local/platform-source apply --reverse --check ../../integrations/platform/patches/0001-explicit-media-consent.patch
```

The tests transpile and execute the actual edited TypeScript modules and guest component script using Chief's already-installed TypeScript. Media devices, LiveKit, the Svelte store interface and browser lifecycle are controlled test doubles. Love connection tests also execute the release's actual `media-resources/src/utils.ts` session creation. They never request real microphone, camera or screen access.

Twelve tests cover initialization with zero media requests; explicit capture controls; remembered-preference isolation; permission denial and accurate off state; pending camera/screen/guest/settings-preview cancellation; default-off guest recording consent; muted-speech opt-in and consent reset. They are focused behavior tests, not a substitute for Svelte rendering, full package type validation or real multiuser media acceptance.

The dependency closure build passed (290 operations), as did targeted package TypeScript validation (184 operations). The final incremental Love and shared Media build/type checks also passed, including admission and room-interaction additions. Explicit Svelte checks passed for Love, Recorder and shared Media with zero errors; existing style/export/accessibility warnings remain. The room background's pointer shortcut has a native Open room button as its keyboard equivalent. Production webpack passed both configurations at the coordinated 2,560 MiB cap with the bounded options below. Compiled synthetic browser verification passed: Contacts/Office opening, media settings camera preview opt-in/stop/close, and actual Drive Record defaults, explicit microphone/camera controls and cancellation. All capture used guarded fake devices in a separate headless account. A local frontend image was built and inspected; deployment and connected multiuser Office acceptance are separate pending steps. A diagnostics tool is unavailable in this session.

## Build preparation status

Pinned Rush 5.178.1 and pnpm 10.15.1 were bootstrapped using `common/scripts/install-run-rush.js`; Node 24.21.0 matches `.nvmrc` and `rush.json`. Targeted `install --check-only` passed. The resumed filtered install completed. Rush lists 290 projects in the `pod-front` dependency closure. pnpm initially selected 288; explicitly adding `analytics-service` and `measurements-otlp` repaired the two missing package links. At that frontend-only checkpoint, the original and generated lockfiles retained 2,462 package entries; 11 dependency resolutions differed in optional peer suffixes, recorded privately in `dependency-resolution-diff.json`. The meeting backend subsequently expands the filtered install. The production build receipt records the exact generated lockfile hash used by its build. No source dependency manifest or original lockfile was edited.

Reproduce serially from `.chief-local/platform-source` (measure available memory first):

```powershell
$env:NODE_OPTIONS='--max-old-space-size=1536'
$env:npm_config_child_concurrency='1'
$env:RUSH_PARALLELISM='1'
node common/scripts/install-run-rush.js install --to @hcengineering/pod-front --to @hcengineering/analytics-service --to @hcengineering/measurements-otlp --network-concurrency 1
node common/scripts/install-run-rush.js build --to @hcengineering/pod-front --parallelism 1
node common/scripts/install-run-rush.js validate --to @hcengineering/love-resources --to @hcengineering/love-assets --to @hcengineering/recorder-resources --parallelism 1
node plugins/love-resources/node_modules/svelte-check/bin/svelte-check --workspace plugins/love-resources --output human
node plugins/recorder-resources/node_modules/svelte-check/bin/svelte-check --workspace plugins/recorder-resources --output human
```

From Chief's root, production packaging uses the pinned webpack configuration with one worker and parallel minification disabled:

```powershell
$env:NODE_OPTIONS='--max-old-space-size=1536'
$env:NODE_PATH=(Resolve-Path .chief-local/platform-source/dev/prod/node_modules).Path
node integrations/platform/patches/build-frontend.mjs
```

`NODE_PATH` resolves the release's `common/scripts/sass-quiet.js` dependency from the selected frontend package. It does not install or substitute Sass. The helper avoids the release's Unix-only deletion/copy shell commands on Windows and runs separate webpack configurations serially. Package and Svelte validation run separately to avoid concurrent checker processes.

The production compile command, from Chief's root, is:

```powershell
$env:NODE_OPTIONS='--max-old-space-size=2560'
$env:NODE_PATH=(Resolve-Path .chief-local/platform-source/dev/prod/node_modules).Path
node integrations/platform/patches/build-frontend.mjs --omit-debug-artifacts --native-minify
```

`--omit-debug-artifacts` disables webpack/esbuild/Svelte source maps and the bundle-analysis report using supported options. `--native-minify` uses the pinned esbuild-loader `EsbuildPlugin` / esbuild 0.25.12 with ES2021, preserved function names, inline legal comments, explicitly serialized transforms and per-chunk IIFE scope. Production mode, application code, minification, chunking and compressed assets remain enabled. Exact differences are recorded in `production-build-receipt.json` alongside 25 input hashes and 2,583 emitted asset hashes, including gzip assets. The main configuration completed in 82.8 seconds; minimum sampled host headroom was 3.52 GiB. The receipt SHA-256 is `8bb3f7f1eeb7f9de99d48a143c0bb81c5b90ae1f0dcc0cbde85fbe94e79c98bd`.

Memory guards are 3.5 GiB host availability for a 1,536 MiB heap, 4.5 GiB for 2,048 MiB, and 5 GiB for 2,560 MiB. The runner samples available host memory every five seconds and terminates only its own build if it falls below 2 GiB. The successful run used a coordinated maintenance window; restoring services and subsequent browser checks are separate operations.

Earlier diagnostic attempts are preserved: the original and reduced-debug/native 1,536 MiB builds exhausted JavaScript heap; an initial 2,560 MiB attempt was refused by its startup guard; a 2,048 MiB attempt exited with code 2 when runtime headroom fell below the floor. No failed attempt produced a successful receipt or image.

Private logs are in `.chief-local/platform-build-logs`. The upstream installer warns about ancestor `node_modules` folders; neither Chief's dependencies nor the owner's global files were removed. The filtered packages have their own resolved links. Missing optional LiveKit type peers were warned about, but package and Svelte checks passed. Do not run a concurrent build or raise the heap limit without a fresh capacity check.

## Local image gate

`build-frontend-image.mjs` requires successful, matching production and synthetic browser consent receipts. It verifies all compiled assets and reviewed inputs, then assembles a fresh allowlisted context under ignored `.chief-local`. The image retains the exact installed front digest from `image-lock.json`, replacing static frontend assets only. Its upstream server bundle/native dependencies remain unchanged. Source patches, the EPL license and build provenance are included in the image. No credentials, live workspace data or environment files enter the context.

The helper writes `.chief-local/platform/front-image.json` with an immutable image ID, base digest, source revision and receipt/patch hashes. It does not start containers, publish an image or change deployment configuration. Matching Love, model and transactor changes remain required for invitation/admission runtime acceptance.

The first 2,560 MiB compile passed webpack but failed the browser gate: esbuild had emitted global helpers outside webpack's existing closure, and later scripts could overwrite those bindings. The corrected runner requires `format: iife`, with a multi-chunk VM regression that verifies no helper globals leak and earlier class factories remain callable after subsequent chunks load. The original receipt is retained privately as `production-build-receipt-unscoped-diagnostic.json`; it is not deployable. The image gate additionally requires the IIFE option and exact build-recipe hashes. Compiled browser controls must pass before a frontend image can be created.


The initial consent-only browser checkpoint used eight checks and 138 source-built assets, producing front image `sha256:c79fa3251ded2d6e6a3ff6e949e9c2d3138dd939b47ad393401a29b3b111cec7`. That historical checkpoint did not establish connected meetings or recording upload. Subsequent deployed two-member meetings and the bounded raw recorder are documented in `RAW_RECORDING.md` and `docs/verification/evidence`; the raw recorder uses authenticated file storage and does not require Stream. The current immutable image is always recorded in `.chief-local/platform/front-image.json`. No owner devices or browser profile are used by these gates.

The final combined frontend includes the coordinate repair, Card companion preservation and compact Room actions menu. Scoped Love build/TypeScript checks passed; Svelte reported zero errors and 129 existing warnings. All 21 focused tests passed (12 consent, 7 room behavior, 2 minifier isolation). The compiled compact browser check confirms the avatar center remains hit-testable, hidden controls do not intercept it, and opening/closing the invitation picker preserves the Card without capture. Full connected two-member acceptance of this final image is owned by the runtime rollout coordinator.

Patch0005 adds consented local meeting notes. Its compiled browser gate passed
on 2026-10-08 at 00:03 UTC with two synthetic members, generated audio sent over
LiveKit, local tiny.en transcription, attendance-change stop, individual
decline/consent/withdrawal controls, participant access checks, exact listener
removal, acknowledged raw-audio deletion and reviewed JSON export. This is a
compiled-asset checkpoint; frontend image promotion and deployed verification
are separate gates. The image builder now requires matching consent, raw
recording and meeting-capture receipts for the same production build.

Patch0006 connects the retained text-template, mention and emoji actions to the
main Card body editor. Read-only and stale-popup guards prevent callbacks from
editing a different or disposed editor. Stable action identities preserve the
toolbar button between mouse-down and click when editor focus changes. Six
focused regression checks and the package/component validations pass. The image gate additionally requires a
matching compiled main-body template insertion and persistence receipt. All six
patches are reconstructed against the pinned upstream revision before assembly;
the preceding five patches remain unchanged.

Patch0007 fixes blank microphone, speaker and camera labels and provides explicit
controls to reveal browser-hidden names. Opening settings only enumerates devices;
temporary disclosure streams are stopped after refresh or popup closure. All seven
patches reconstruct across 55 files. The production build, package validation,
17 media tests, and compiled and deployed browser checks passed. The image gate
requires device-label acceptance alongside recording, meeting-capture and template
checks. See `MEDIA_DEVICE_LABELS.md` and
`docs/verification/evidence/chief-device-label-rollout.json` for current evidence.

Patch0008 scopes the file cookie to the embedding site's partition so native
recording playback remains authenticated inside Chief's cross-site iframe.
`EMBEDDED_PLAYBACK.md` explains the reproduced 401 failure and separate account
sign-in persistence limitation. The image gate now also requires compiled Drive
record/save/reopen/play/seek and cross-partition denial checks. All eight patches
reconstruct from the pinned source across 56 files.
