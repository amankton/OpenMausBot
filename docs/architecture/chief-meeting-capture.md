# Local meeting notes implementation contract

2026-10-07. Selected Chief work, following the verified retained Shared Workspace
meeting and Card Activity recorder increments. The separate Shared Office
prototype remains retired. This document describes the next implementation;
it is not evidence that capture has shipped.

## Boundaries

- Audio only, with an explicit request and affirmative consent from every
  currently connected human participant. Opening a room never starts capture.
- Consent binds a generated session ID, revision, exact workspace and exact
  MeetingMinutes ID, plus an immutable participant identity/session snapshot.
- A participant joining, leaving, reconnecting under another session, withdrawing,
  or losing authorization stops this capture. Starting again creates a new
  request and obtains fresh consent. This deliberately avoids silently carrying
  consent across attendance changes.
- Capture is visibly pending/starting/capturing/stopping/processing/ready/failed.
  Any captured participant can stop it. A quiet worker never speaks or publishes
  audio, video, screen tracks or data. It does not infer emotion.
- Backend membership and room ACL checks remain authoritative. Past recordings
  and transcripts are readable only by this session's participants who still
  have workspace membership and access to the meeting. Workspace membership
  alone, or joining a later session in the same room, grants no transcript access.
- Use a dedicated capture metadata store. Do not put transcript/audio blobs in
  the workspace-wide file endpoint, and do not migrate owner records.
- One local capture/transcription job at a time; maximum eight participants,
  sixty minutes and 256 MiB of mono 16 kHz signed 16-bit PCM per session. Exceeding
  a bound stops capture with a visible explanation and retains valid earlier
  audio for transcription.
- Transcribe locally with pinned faster-whisper and verified cached tiny.en
  weights. No provider key or paid API is necessary. Initial language is English.
  Raw PCM is private, bounded and deleted after successful transcript delivery;
  failed jobs remain explicitly retryable/deletable, with a bounded cleanup policy.
- Suggested decisions/action items retain their source utterance and speaker.
  They are drafts for review, never automatic assignments or messages.
- A member exports only reviewed material to their personal Chief workspace.
  Use a versioned UTF-8 JSON bundle and an explicit personal import/review step;
  do not bridge browser cookies, credentials, private histories or automatic sends.

## Member API (under retained Love /capture)

Every call uses the current Platform bearer token and caller-scoped meeting
reads. Mutations are serialized and persist before returning. IDs are opaque;
request bodies are size bounded and never choose filesystem paths.

- GET `/capture/status?meetingId=...`: availability, worker state, authenticated
  self person, whether currently joined, latest accessible session and limits.
- GET `/capture/history?meetingId=...`: participant-filtered session summaries.
- GET `/capture/session/:sessionId`: authorized transcript and suggestions.
- POST `/capture/request` `{meetingId}`: freeze current connected humans,
  create a pending request; requester must also consent explicitly.
- POST `/capture/consent` `{sessionId,revision,accept}`: records this caller's
  decision only. Reject stale revision, changed attendance, duplicate conflicting
  decision, ended session or a claimed identity in the request body.
- POST `/capture/stop` `{sessionId,revision}`: stop pending or active capture.
- DELETE `/capture/session/:sessionId`: initiator deletion with worker cleanup;
  content is unavailable immediately and deletion stays durable across restart.

Public session shape:

```ts
type CaptureSession = {
  id: string; workspace: string; meetingId: string; title: string;
  revision: number; state: 'pending' | 'starting' | 'capturing' | 'stopping' |
    'processing' | 'ready' | 'failed' | 'cancelled' | 'deleted';
  requestedBy: string; requestedAt: number; startedAt?: number; stoppedAt?: number;
  reason?: string;
  participants: Array<{personId: string; name: string; consent: 'pending' | 'accepted' | 'declined'}>;
  segments?: Array<{id: string; personId: string; speaker: string; startMs: number; endMs: number; text: string}>;
  suggestions?: Array<{id: string; kind: 'decision' | 'action'; text: string; sourceSegmentId: string; personId: string}>;
};
```

Public views exclude service tokens, participant session SIDs, raw paths and
worker secrets. No capture begins until the configured worker reports ready and
every snapshot participant has consented; capture status becomes `capturing`
only after the worker confirms a successful listen-only connection.

## Worker API and process

The worker runs natively on the local Windows host, which can use the verified
loopback LiveKit transport. It pulls jobs through `http://localhost:18087/_love`;
there is no worker HTTP listener or Docker-to-host inbound port. The server owns
and validates a distinct random worker credential, never the personal Chief key.

- POST `/capture/worker/poll` with worker bearer and
  `{workerId,ready,model,activeSessionId?,phase?}`. Returns `{serverTime,command}`.
  A capture command has `{kind:'capture',sessionId,revision,workspace,meetingId,
  roomName,identity,token,expiresAt,participants:[{personId,name,identity,sid}],limits}`.
  Native worker configuration supplies the local LiveKit URL. Commands may also
  be `{kind:'stop',sessionId,reason}`, `{kind:'delete',sessionId}` or `{kind:'idle'}`.
- POST `/capture/worker/event` with worker bearer and
  `{workerId,sessionId,revision,type,...}`. Types are `connected`, `stopped`,
  `transcript`, `failed`, `deleted`; transcript carries bounded `segments` with
  only known speaker identities and offsets bounded by the authorized capture.
  Repeated identical completion is idempotent; stale/conflicting results fail.

The server uses current LiveKit participant identities/SIDs and admission state,
not client-supplied names. Tokens are short lived, scoped to exactly one room,
subscribe only, and cannot publish. On stop/attendance change/revocation the
server removes the exact worker participant before reporting stop complete.
Worker heartbeat loss also removes it and ends capture; the worker disconnects
on lost authorization, unexpected participants, lost connection or expired lease.
Server restart invalidates active capture and does not automatically resume it.

### Finalized wire details (increment 0005)

- Status is `{available,reason?,worker:{state:'offline'|'ready'|'busy'},selfPersonId,joined,session?,limits}`.
  History is `{sessions}`; session reads and member mutations return `{session}`.
  Revision stays fixed for one immutable consent generation; votes do not increment it.
  A new attendance roster requires a new opaque session and affirmative votes.
- Worker poll adds optional nonnegative integer `durationMs` and `bytes` alongside
  `activeSessionId`; counters cannot decrease. Its response includes `leaseUntil`.
  Poll at most two seconds apart and disconnect locally at that deadline if renewal
  fails. The capture command's `expiresAt` is the initial ten-second connection-token
  expiry; the renewable poll lease controls an established capture.
- `stopped` supplies both `durationMs` and `bytes`. `transcript` supplies `segments`
  containing only `{personId,startMs,endMs,text}`. The server stamps output segment
  IDs and speaker names from its frozen roster. It rejects unknown speakers, extra
  identity fields, invalid offsets and conflicting repeated completion. Worker
  events return `{ok:true}` after durable acceptance; only then delete raw audio.
  The `stopped` acknowledgment additionally returns authoritative `durationMs`,
  capped at the server's consented start/stop interval. Clamp retained metadata
  and transcription offsets to that value before producing segments.
- POST `/capture/retry` `{sessionId,revision}` is requester-only and requires current
  room access. It only retries failed retained audio younger than 72 hours. Worker
  command `{kind:'transcribe',sessionId,revision,durationMs,participants:[{personId,name}],limits}`
  never contains a room name or token and must never join RTC.
- Delete commands also carry revision. A worker confirms filesystem cleanup with
  `deleted`; inaccessible tombstones persist. Failed audio cleanup is bounded to
  72 hours, independently enforced by the worker. Backend history expires after
  seven days (limits expose `retentionMs`); deleted history is never returned.
- Suggestions are cue-based drafts preserving the exact source utterance, speaker
  and segment reference; no inferred assignee, due date, emotion, or automatic send.
- Backend configuration uses `CHIEF_CAPTURE_DIRECTORY` (dedicated private mount)
  and `CHIEF_CAPTURE_WORKER_SECRET` (distinct random credential of at least 32
  characters). Missing configuration leaves capture unavailable. Store files contain
  no Platform bearer, LiveKit token, or worker credential.
- Historical room access is rechecked using current Accounts membership, active
  Employee and caller-scoped meeting/room reads. Restricted-room signed invitation
  expiry remains authoritative; this increment does not create permanent room grants.

Worker capture streams go directly to bounded WAV files under a private generated
session directory. Keep independent participant tracks for attribution, then
merge recognized segments by timestamp. Do not load an hour of PCM into RAM.
No UI event, transcript text or model output is an executable instruction.

## Verification and ownership

- office_ui: retained Love capture authorization/state/store/worker routes and
  focused tests. Preserve existing admission and deployed meeting behavior.
- chief_branding: retained shared capture controls/history/review/export UI and
  focused tests, using the API contract above. No server or personal app edits.
- root: local capture/transcription worker, private import/review, deployment
  configuration, patch provenance, resource coordination and end-to-end gates.

Use new patch0005 over the frozen deployed raw recorder source. Preserve
patches0001–0004 and all accepted image/build/browser receipts. Synthetic tests
must cover no initial capture; unanimous consent; decline; late join/leave;
withdrawal; revoked membership; worker loss; wrong workspace/session/speaker;
restart recovery; quota stop; actual generated audio transcription; participant
access; reviewed export/import; and no private-agent request until explicit Send.
