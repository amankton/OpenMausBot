# Prepared local meeting-notes configuration

This is additive configuration, not evidence of deployment or recording acceptance.
Run `node scripts/prepare-chief-meeting-capture.mjs` only after the existing private
Platform/meeting settings and local model directory exist. It creates no service,
starts no process, and prints only the prepared config path and volume name.

The dedicated `.chief-local/meeting-capture/` directory contains `worker.json`,
`capture.env` and private `audio/`. Windows DACLs allow only the current user and
SYSTEM, with inherited broad access removed. Existing valid keys are reused;
conflicting keys/configuration fail instead of rotating credentials. Paths and
their ancestors must resolve as expected; symlinks/junctions/reparse entries are
rejected before permissions or files are changed. Model integrity is checked by
the worker separately, before it reports ready.

The worker config fixes Love to `http://localhost:18087/_love` and LiveKit to
`ws://localhost:18087/_livekit`, uses `.chief-local/capture-models/tiny.en` and the
dedicated audio directory. Its random worker credential differs from existing
Platform/LiveKit secrets. It is never a personal Chief key or member session.

The meeting launcher includes this explicit Compose env file:

`--env-file .chief-local/meeting-capture/capture.env`

Manual/private maintenance helpers using the meeting overlay also need that
argument. Ambient `CHIEF_CAPTURE_*`, `CHIEF_PLATFORM_*` and `COMPOSE_*` variables
cannot override the guarded launcher's private inputs. No credential is passed
on a CLI argument or emitted in resolved configuration output.

The only new persistent volume is `chief-platform_capture_metadata`, mounted only
by Love at `/var/lib/chief-capture`. The five original volume definitions remain
unchanged. The launcher checks existing volume ownership and refuses a capture
volume mounted by any other service/project. No new port, service, host mount,
workspace migration, model upgrade or private-agent bridge is introduced.

Verification:44 deployment boundary tests pass, including a disposable Windows
ACL/config fixture, repeat preparation without credential rotation, inherited
child-file access validation, redirected storage rejection, foreign mounts,
credential propagation and exact localhost endpoints. No live preparation,
deployment, container or owner workspace action was performed for these tests.
