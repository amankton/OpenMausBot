# Embedded recording playback

Patch0008 changes only the presentation file cookie in a secure embedded context.
Native video requests cannot add an Authorization header. The default SameSite
cookie was withheld when localhost:18087 was embedded by 127.0.0.1, producing a
401 response and the player's misleading "Unable to play media" message.

The cookie now uses `SameSite=None; Secure; Partitioned` in a secure iframe. Its
host-only scope, workspace-specific storage path, session lifetime and token stay
the same. Standalone/insecure contexts retain their previous policy. No token is
added to media URLs and no file authorization checks are removed. Chromium's
[partitioned cookies](https://developer.chrome.com/docs/extensions/reference/api/cookies)
keep the embedded session associated with its top-level site.

A synthetic diagnostic reproduced the original failure: the identical WebM
returned 206 and decoded at top level, 401 inside the iframe, then 206 and decoded
with a partitioned cookie. `embedded-playback.test.mjs` checks the actual source
function's context selection and path scoping. `verify-chief-embedded-playback.mjs`
records through the real global REC control, saves to Drive, reopens and seeks in
a sandboxed cross-site iframe, then verifies the resulting file cookie is withheld
under a different top-level site and from an anonymous unpartitioned request.

All writes and media capture in the browser runner use the isolated acceptance
workspace and generated camera frames. It never imports the owner's browser state
or reads/changes the owner's recordings. Compiled and deployed receipts are stored
separately in `docs/verification/evidence/chief-embedded-playback-<mode>.json`.
Existing saved recordings need no conversion or replacement for this cookie fix.

The runner restores the synthetic account's account cookies into the test frame's
partition to start signed in. It deliberately does not inject a file cookie; that
must be set by the actual compiled application. Account sign-in persistence after
a full browser refresh is a separate existing limitation, outside this playback
patch. The production file cookie and its cross-site isolation are both exercised
by the runner.

Deployed October 8, 2026 at 00:07 America/Los_Angeles as frontend image
`sha256:ba0a3ac0c9908c2cef8d1068da62ec466539fa03f206e0e90a088e1437dce828`.
Build receipt SHA-256 is
`319de3f5d66e1d2d6545b06aa1dd62c9345a47b5eb50349e6a63eee3ac85dd19`.
Three source tests, presentation package validation, all eight patch reconstructions,
both production configurations, the existing consent/recording/meeting-capture/Card
template browser gates, and compiled/deployed embedded playback checks passed.
The deployed test clip was 640×360 with 2.930 seconds of finite duration; playback
advanced, decoded frames were observed, and seeking passed. The rollout receipt
confirms all 17 services running, only the frontend container replaced, and all
mounts and other images preserved. The owner's original sample was not modified.

After the owner signed back in, CUA confirmed their original saved sample playing:
duration 7.734 seconds, 640×360, currentTime 0.22642, paused false, readyState 4,
and no media error. Only the normal Play control was used; the file was not
downloaded, converted or replaced. This observation is recorded in the rollout
receipt as `ownerPlaybackVerified: true`.
