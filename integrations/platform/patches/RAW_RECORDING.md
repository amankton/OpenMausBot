# Bounded recording increment (not deployed)

Patch `0004-bounded-raw-recording.patch` applies after the existing consent/admission/room patches. Its baseline is the exact edited source used for frontend image `sha256:c79fa3251ded2d6e6a3ff6e949e9c2d3138dd939b47ad393401a29b3b111cec7`; the baseline copies and hashes are retained privately in `.chief-local/raw-recording-baseline`. Patches0001–0003 and frozen image/build/browser receipts are not rewritten. Upstream source is pinned to `03b7aad7dc562f4f9769c51a4df08191a0393997`, EPL-2.0; source copyright/license headers remain.

## Behavior

- Recorder camera, microphone and screen capture still require the existing explicit controls. Recorder availability now checks browser WebM recording and configured file storage, while retaining the account-role gate; no fake Stream endpoint is configured.
- A visible limit explains two minutes (wall time, including pauses) or 64 MiB. Recording stops automatically at two minutes or near the size ceiling. Every received chunk is counted before retaining it; a chunk crossing the hard ceiling rejects the recording rather than uploading corrupt/truncated data. Browser-delivered individual chunks can temporarily exceed the cap before application code can reject them.
- Finished WebM uploads through the existing authenticated `presentation.uploadFile`, preserving its registered upload guard. The helper accepts optional progress/AbortSignal and expected workspace. Upload is bounded to two minutes; cancellation also settles stalled optional metadata extraction.
- Capture and composer cleanup occur before awaiting upload completion. The popup then shows upload status and an explicit Cancel upload button. Error states display a message and allow closing. A real File is retained until Save/cancel and passed to the original attachment callback; size, MIME, `.webm` extension and `originalWidth/originalHeight` metadata are consistent. Drive creation remains the existing fallback when no target is supplied.
- The source workspace is captured on recorder initialization. Upload/save reject a workspace change; deletion uses the captured storage/token/workspace and only this recording's generated UUID. Tokens are never written to logs or URLs.
- Ordinary FileStorage/VideoViewer native playback is retained. No Stream service, transcoding, HLS generation, meeting transcription, or service configuration change is introduced.

## Access and cancellation limits

This retains existing workspace-file authorization; it does not introduce document-specific blob ACLs. Existing `/files` checks bearer/cookie workspace membership and URL workspace, but does not verify a target Card's access policy. Do not describe this as confidential per-document recording storage.

Cancellation attempts deletion of only the recording's generated blob, with a five-second cleanup wait bound. A network failure or server-side upload commit racing an aborted request/deletion can leave an unattached blob; the existing endpoint has no transactional upload-abort contract. This is a remaining integration limitation, not an asserted orphan-free guarantee. No other file is deleted.

## Latest compiled acceptance — 2026-10-07 23:00:32 UTC

Production build completed using a 2048 MiB heap cap (minimum Windows available 2309 MiB, maximum child RSS 2660 MiB). Build receipt SHA-256: `47ba6af278d04e6730842b93618b7fb049a2c936908c3744e1fcd89d9bf733c3`. The compiled recording acceptance passed six checks using 137 verified assets. Its real saved WebM was 93,853 bytes, 640×360, duration 2.933 seconds; reload, native playback and seeking passed. All twelve anonymous/invalid-token/independent-outsider/wrong-workspace GET/POST/DELETE requests returned 401 or 403 while the valid member retained access. Evidence: `docs/verification/evidence/chief-platform-recording.json` and `.png`.

**Verified surface:** the Card Activity comment composer (legacy `chunter`), not the main Card body or newer communication MessageInput. Recorder Save adds a local attachment draft; explicit comment Send persists an Attachment attached to a ChatMessage whose parent is the synthetic Card. The test follows this exact relation and scrolls the lazy Activity section into view to play the inline retained Video after reload. Main Card body ContentEditor passes empty recorder actions and is not covered. The REST adapter restores scalar query values omitted by transport compression, matching the retained official client. No product source change was needed for these test corrections.

The browser is closed. Product/source inputs and patch0004 did not change after the successful build. Deployment and deployed-mode verification remain separate pending steps; the frozen prior image is not relabeled as this build. Earlier planning/check descriptions below are historical.

## Verification

`node --test integrations/platform/patches/raw-recording.test.mjs integrations/platform/patches/media-consent.test.mjs` passes 30 tests: 18 new raw-recording behaviors and 12 existing consent behaviors. New tests execute source modules and the actual Save handler against synthetic media/storage boundaries; they cover bytes and File metadata, size rejection, errors, cancellation (including late initialization), workspace changes, original-context deletion, upload guard/progress/abort, stalled metadata cancellation, two-minute stop and capture-before-upload cleanup.

After host memory recovered, the pinned rig's `compile.js validate` passed serially for `packages/presentation` and `plugins/recorder-resources` at a 1536 MiB Node heap cap. Recorder Svelte check passed across 1961 files with zero errors and 33 existing upstream warnings. The final private diagnostic is `.chief-local/raw-recording-svelte-check.log`; its hash is recorded in provenance. The initial checks used no browser. A later production build attempt was aborted safely by its host memory floor; updated duration-repair source has since been built and compiled-tested as recorded above. Only the isolated generated-canvas browser proof described below has run, with no app session, device capture or service mutation.

Before producing/deploying another image, run the existing production build guards, then verify with the isolated synthetic account: real WebM recording/upload/playback/reopen including duration/seek; attachment type and nonzero size; cancel before/during/after upload; HTTP unauthenticated/outsider/cross-workspace rejection; upload restrictions; and device tracks ending on every error/close path. Basic native playback is supported by source structure but remains unverified for raw output. Do not change owner browser state.

## Browser acceptance preparation

`scripts/verify-chief-platform-recording.mjs` now passes in compiled mode as recorded above. It uses the existing synthetic Card (`chiefacceptance`, Card `6ac6aa185b1567fb393c76f2`, workspace `b3ece3dc-e200-41c7-a9d8-2cb86c8c9fdb`). It records generated Chrome camera frames through the real Card Activity comment recorder action, uploads through the actual service, submits the synthetic comment, verifies the attachment and parent comment through caller-authenticated REST, reloads and plays the retained file, and checks finite duration/seek. It deliberately fails if raw WebM cannot satisfy those checks. It retains the successfully saved synthetic attachment as evidence and deletes only its own discarded recordings.

Before running it, provision a separate disposable synthetic outsider account through the normal local sign-up flow, in a fresh headless Playwright context with **no imported state**. Use an `@example.test` address and a fresh password held in memory; never reuse owner credentials. Create only its own workspace named **Chief Recording Outsider**, with URL slug `chiefrecordingoutsider`. Do not invite this account to Chief Acceptance or to any owner workspace. Wait for its workbench to load so the retained application creates its workspace-scoped file cookie. No new fixture was provisioned during script preparation.

Save this fresh context with `context.storageState({path: '.chief-local/platform/acceptance-outsider-state.json'})`. Keep this file private; never print or commit its cookies, local storage, email, password, or tokens. Obtain its workspace UUID from the authenticated application's `/files/<workspace-UUID>` cookie path without logging the cookie value. Write this separate, non-secret identity file to `.chief-local/platform/acceptance-outsider.json`:

```json
{
  "slug": "chiefrecordingoutsider",
  "workspace": "<actual UUID of the synthetic outsider workspace>",
  "stateFile": "acceptance-outsider-state.json"
}
```

The runner permits only those exact fixture filenames/slug, checks that the selected token resolves to this workspace, and calls `getUserWorkspaces` to require that this is the account's sole workspace. The existing meeting partner is a member of Chief Acceptance and cannot serve as an outsider fixture. An expired/missing outsider session is a failure, not a skipped security test.

After a resource-coordinated new production build:

```powershell
node scripts/verify-chief-platform-recording.mjs --check
node scripts/verify-chief-platform-recording.mjs --mode=compiled
```

`--check` validates only local inputs and fixture/build provenance; it does not start a browser or contact services. `--mode=compiled` overlays only hash-verified built frontend assets in the isolated browser, while all authentication, attachments and file storage use the real retained backend. One headless browser context uses fake media flags and validates fake input labels before allowing capture. Real display capture is refused. The script does not modify deployment or the owner's browser.

Successful evidence is `docs/verification/evidence/chief-platform-recording.json` and `chief-platform-recording.png`; failure diagnostics are private at `.chief-local/platform-build-logs/recording-acceptance-failure.json`. It tests anonymous, malformed bearer, independently authenticated outsider, and wrong-workspace GET/POST/DELETE with an API context explicitly excluding browser cookies. An actual positive member read is required before and after the negatives. Its held-transport cancellation test is identified separately from uploaded-unsaved deletion and does not claim to prove the retained server's upload-commit race is atomic.

After a later guarded rollout, `--mode=deployed` additionally requires the matching image/build receipt and actual deployed HTML hash; it serves no asset overrides. This mode has not been run.

## Ordered image provenance

The next production input inventory includes modified `packages` sources, including `packages/presentation/src/file.ts`. The frozen earlier build/image/browser receipts are not regenerated during this preparation.

`verify-frontend-patch-stack.mjs` reconstructs the 40 reviewed files from exact pinned Git objects in a fresh private directory, applies patches0001–0004 **in order**, checks the patch0004 pre-edit baseline after patch0003, and compares the final reconstructed files with current source. Only LF/CRLF normalization is permitted; all frozen patch hashes and raw-input byte hashes are checked. This source-only validation passed. Temporary reconstruction folders are retained under `.chief-local/platform-patch-check-*` and contain no credentials or application data.

The image helper includes all four patches, EPL-2.0 license, raw-recording documentation/provenance, and the matching successful raw-recording browser receipt in its source notices. It requires both prior consent checks and raw-recording acceptance for the same new build before invoking Docker. No image was built by this preparation.

## Duration metadata repair (source update before the next build)

The retained Plyr 3.7.8 maps native Infinity duration to zero and refuses seeks when duration is zero. An isolated Chromium 153 generated-canvas recording confirmed the gap. Run `node scripts/verify-chief-webm-duration.mjs --run` in an available browser slot: ordinary and paused clips initially reported Infinity; repaired clips reported finite duration matching unpaused elapsed time and completed native seek with decoded frames. Evidence: `docs/verification/evidence/chief-webm-duration.json`. This proves the library/native-player path; authenticated attachment playback still requires the full recording acceptance runner.

Before upload, pinned `@fix-webm-duration/fix@1.0.1` repairs Duration using elapsed time excluding pauses. Its parser is pinned to 1.0.1; existing tslib2.8.1 is reused. Repaired output is checked against64MiB again, and the attachment uses actual final File size. Abort/workspace checks run after repair. A ten-second timer bounds asynchronous waiting, but cannot interrupt synchronous parsing inside the library. Bounded input still entails temporary buffer copies, so64MiB is not a total browser-memory cap.

Both packages are MIT licensed; original copyright/permission notice is in `FIX_WEBM_DURATION_LICENSE.txt` and copied into derivative-image source notices. Exact upstream revision:72c0f8f5ec789e87d5d5ce58cc2b375f8f595721 at https://github.com/yusitnikov/fix-webm-duration. Versions, registry SHA-512 integrity and license hash are in `webm-duration-dependency.json`. About99KiB unpacked is added before bundling. No custom EBML parser, service, transcoder or Cues generator is introduced. The library returns the original Blob on parse failure or existing duration; retain actual duration/seek browser gates rather than asserting every future format can be repaired.

Focused tests now30/30 include repaired bytes/final size, invalid duration, post-repair size rejection, cancellation during stalled repair and workspace changes before upload. Recorder package validation passed again with a768MiB Node cap; no Svelte files changed. The filtered pnpm install requested full module replacement and was not accepted. For this existing checkout, only the exact new package was linked from the private isolated verification install; the manifest and18-line lockfile increment describe the reproducible graph for normal Rush/pnpm installation. Existing workspace modules were preserved.
