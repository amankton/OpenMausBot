# Chief shared office — first vertical slice

## Source and operational boundaries

Independent Git clone: `C:/Users/amank/Documents/ChatGPT/CHIEF SOFTWARE WORKSPACE/chief-executive-suite`, branch `codex/chief-executive-suite`, based on runtime revision `8b01f6f066a38d91fb4466b8081d5c170e692965`. Existing embedding, phone and agent-limit source fixes were carried over. No live data, chats, agents, credentials, pairing state, node_modules or caches were copied from an installation. Dependencies were installed separately.

The old Crewframe backend was stopped through its existing SIGINT handler. Ports 3200/8801/8820/8821 were closed. Installed OpenMausBot PID 81376 remains a tray/background app: CloseMainWindow returned false and AttachConsole returned Windows error 6 (no console). Native tray control is unavailable in this session. Use its tray **Quit** to fully stop it; it was not force-killed or restarted. Other agent tools and shared Docker services were left intact. No visible Crewframe tab was found in the connected Chrome inventory; backend shutdown does not prove every app/tab closed.

## Integration map

- Existing `TeamMapPage` / `TeamCanvas`: agent team layout, preserved; office opens from Team map.
- Existing `store.tsx`, HTTP/SSE and `server/index.ts`: private agent conversations and workflows, preserved.
- Existing core `request-auth.ts` / `sessions.ts`: device credentials and local-owner trust. A paired device is not a human coworker. Hosted human membership is provided by the separately licensed enterprise layer, so it was not reused or bypassed.
- New `shared/office.ts`, `server/office.ts`: explicit human identities, independent office credential hashes, durable atomic file, revision conflict checks, invitations and meeting membership. One office per isolated server/data directory; **not a completed multi-tenant subscription platform**.
- New office credentials authorize only `/api/office*`. The agent gate rejects `chief_office_` tokens even on localhost. The standalone `/office` member entry does not mount the private agent app. Original machine-owner loopback trust still applies to requests without office credentials; this local preview is not a security boundary between malicious processes/users on this same computer.
- Presence comes from recent authenticated polls; personal spaces remain when people enter rooms. Room membership persists separately from network/media connectivity.
- Shared meeting notes are returned only to recorded participants, including denying them to an office owner who did not participate. Speakers can record only their own explicit statements. No private agent history is read. Selected note export is explicit; private-agent navigation does not auto-send notes.

## Media and licensing choice

The [OpenMausBot core](https://github.com/milind-soni/OpenMausBot) is Apache-2.0 with a separately licensed `enterprise/` tree. This feature is independent core code; entitlement checks remain intact. No enterprise code was copied into it. The [Platform Collective Huly fork](https://github.com/Platform-Collective/platform) is a separate EPL-2.0 multi-service stack. The targeted [Huly reuse review](CHIEF_HULY_REUSE.md) pins actual source and compares invitations, presence, LiveKit client, provider reconciliation and its relatively independent transcription worker. That worker is the strongest next extraction candidate; the full UI has 30 direct platform dependencies plus Svelte. No Huly code was imported into this slice.

[LiveKit](https://github.com/livekit/livekit) supplies the media engine. Server-minted [room-scoped access tokens](https://docs.livekit.io/frontends/reference/tokens-grants/) encode only the authenticated participant and the workspace/meeting ID, expire after 60 seconds, and grant no room administration/recording. The client connects with mic/camera off; user actions enable tracks. Leaving disconnects the actor at the media server. A provider error is visible and does not silently declare membership ended. Requests recheck membership/session after async token minting. Existing tokens can retain their short residual initial-connect lifetime under self-hosted LiveKit semantics; production revocation needs provider-aware enforcement beyond this preview.

Local LiveKit 1.13.9 is pinned by Docker digest in `scripts/start-chief-media.ps1`. Ports 18920 (signaling), 18921 (RTC TCP), 18922 (RTC UDP) bind only 127.0.0.1. No firewall rule, cloud account or purchase was made. Secrets are generated in ignored `.chief-local/`, never in source or logs. Do not publish that directory.

## Preview and verification

Run `powershell -File scripts/start-chief-media.ps1`, then `node --experimental-strip-types scripts/chief-preview.ts --with-local-media`. The new Chief UI is `http://127.0.0.1:5299`, office `/office`. The underlying harness initially seeds an isolated home; `.chief-local/preview.json` records its exact PID, data path and log. The initial agent is a **fake-engine verification fixture**, not one of the owner's existing agents. The interactive launcher now preserves its data on shutdown and resumes that exact home on the next start; automated verification scripts still use disposable fixtures. The preview's data path remains in the OS temporary directory, so preserve recovery snapshots before OS cleanup or migration. For normal independent development use Chief's documented default data directory and choose real providers yourself; never point OMB_DATA_DIR at the original installation.

The owner subsequently configured a provider in the running preview. This new state is separate from existing installed applications. Before any restart, `node --experimental-strip-types scripts/preserve-chief-preview.ts` makes a private recovery copy of this exact launcher's temporary workspace, including newly configured provider state; the message database uses SQLite online backup and an integrity check. An initial verified copy was created under ignored `.chief-local/recovery/2026-10-07T18-44-25-378Z`. This is a point-in-time copy, not ongoing backup. Keep this directory private and do not commit it. The original preview remained running throughout verification.

The owner's report of only Claude in the connection list was resolved as unconfigured providers, and no provider support was removed or fabricated. The separate missing Team map report was traced to the inherited Simple/Advanced interface-mode visibility rule, not licensing. The bottom-left navigation now exposes original Team map in both modes, alongside a separate Shared office link, Routines, Triggers and Apps. Existing agent canvas dispatch and entitlement checks remain intact. Ten navigation tests and live desktop/mobile checks verify these entries.

The first local recovery copy exposed a development-server watcher bug: Vite recursively watched a locked npm cache file inside `.chief-local/recovery`, raising EBUSY and ending the preview. The original workspace remained intact. Vite now excludes `.chief-local/**` from watching and explicitly denies it as web content, including `/@fs` requests. Chief resumed the original workspace without resetting its settings. Live HTTP verification returned 200 for `/`, `/office`, `/office/`, `/api/health` and `/api/office`, and 403 for private media/manifest paths and their `/@fs` equivalent. Updated preview process details are in the private manifest; do not rely on historic PIDs.

The browser member link is an unguessable, one-use invitation credential in the URL fragment. Redemption does not join a meeting; the recipient must accept, then choose Join. Links expire after 24 hours; sessions expire after 7 days or explicit sign out. No real invitation was sent. Localhost links work only on this computer. HTTPS, trusted public origin, independent owner sign-in, recovery and per-user private agent bindings are required before inviting remote users.

Verification commands:

```
pnpm exec vitest run server/office.test.ts server/routes/office.test.ts server/office-media.test.ts
node --experimental-strip-types scripts/verify-chief-media.ts
node --experimental-strip-types scripts/verify-chief-office.ts
pnpm build
```

`docs/verification/evidence/chief-media.json` records two isolated real browser clients exchanging synthetic audio/camera/screen-share tracks with positive received bytes and decoded frames, private agent API rejection, track cleanup and meeting completion. No real camera, microphone or desktop was captured. This proves the media transport, not internet NAT traversal or production load.

`docs/verification/evidence/chief-office-ui.json` records a passing actual-UI flow in two isolated Chrome contexts: person/photo creation, invitation redemption followed by separate acceptance, room entry, mic/camera/screen controls and remote rendering, participant-authored concern and assigned action, selected-only Markdown download, private API rejection, leave/track cleanup, persisted history, 20-space layout, 390px width, owner navigation and session logout without owner fallback. A concurrent note could previously cause a stale-revision leave failure; the UI now refreshes and retries once only for the same meeting identity. The seven targeted auth, office, phone and team-import regression files pass all 93 tests. Production build and scoped lint pass; existing CSS `::highlight` optimization and large-chunk advisories remain. Packaging installers, physical media devices and internet clients were not tested.

## Remaining scope

Hermes Windows setup was repaired after the owner updated the installed CLI.
Chief recognizes its strict Python bootstrap `.cmd` format without a shell,
preserves argv and caller environment, and allows a 30-second Hermes version
probe. The preview resumed its same workspace with unchanged configuration;
its manifest now explicitly selects the existing local Hermes home so the
installed dependencies/login can be reused without credential copying.
The real Managed Accounts probe passed. See [verification details](verification/chief-hermes.md).

Automatic recording, transcription, agent-generated summaries and optional speaking agents are not enabled. This slice has participant-authored structured notes; it does not infer emotions from faces or voice. Consent, retention and an explicit transcription provider are still needed for capture. Member private-agent bindings, owner/member management/recovery, external invitations, production auth/tenancy, billing, internet media deployment and shipping installers remain separate implementation work. Existing saved owner-authored prompts were not migrated or overwritten; newly assembled built-in prompts use Chief product identity. See `CHIEF_BRANDING_AUDIT.md` for intentional upstream references.
