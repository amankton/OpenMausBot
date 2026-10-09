# Retained recorder integration boundary

Read-only audit, 2026-10-07, pinned Platform source
`03b7aad7dc562f4f9769c51a4df08191a0393997`. The current seventeen-service
Chief runtime has MinIO/front storage and no Stream or Datalake service.
The recorder consent checks cover opening, explicit fake device acquisition,
and cancellation. They do not establish recording persistence or playback.

Adding the stock Stream image is insufficient. In
`foundations/stream/cmd/stream/main.go` the recording endpoint is registered
without authentication. Its recording handler and coordinator trust TUS
metadata, and upload lookup is not bound to a caller. The transcoding handler
checks only a nonempty Authorization header before a worker creates a service
token for the requested workspace. `STREAM_INSECURE=false` changes transport
behavior, not these authorization rules. It also forces HTTPS where this local
deployment uses private HTTP links.

The client `plugins/recorder-resources/src/uploader.ts` supplies credentials in
TUS metadata without Authorization headers and cancels with `abort()` rather
than remote termination. Stream's development logger logs full config and
FileInfo, which include secrets. These calls must be removed or redacted.

The raw recorder path requires MultipartStorage, implemented by the Datalake
adapter but not the retained S3 adapter. Current front storage also returns no
video metadata for HLS. The storage choice therefore needs implementation:
either compatible S3 multipart persistence plus metadata/playback integration,
or a separate hardened Datalake integration. Preserve existing file ownership
and authorization; do not migrate owner files merely to enable this feature.

Before exposure, authenticate every TUS request using current Accounts
membership, bind upload IDs to workspace/account and the selected document,
authorize resume/cancel, constrain size/concurrency/paths, define interruption
cleanup, and disable unused transcoding/concatenation endpoints. Verify synthetic
upload, playback, cancellation, restart behavior, expired/revoked credentials,
cross-account/workspace denial and log redaction.

Editor recording is separate from quiet meeting capture. Meeting capture still
requires meeting-scoped authorization and participant consent. The retained
ASR integrations use external providers; no local ASR or agent follow-up was
implemented or verified in this increment.
