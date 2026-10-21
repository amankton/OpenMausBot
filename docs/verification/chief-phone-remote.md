# Chief phone access over cellular

October 11, 2026. The existing development phone connector advertised only LAN
and Bonjour endpoints. `scripts/chief-phone.ts` explicitly cleared hosted HTTPS
and its private origin. The packaged Electron Remote access settings therefore
did not configure this connector.

The supervisor now reuses the existing MausBot account service, managed
Cloudflare connector and guardian. Each companion generation receives a unique
private pipe/socket. The guardian forwards only to that companion, never to the
reusable LAN port or the backend. It fails closed if the companion exits.
Only a verified hosted address is advertised to paired phones; connector loss
withdraws it. Account recovery uses the upstream credential rotation/watchdog.

## Owner setup

- Open <http://127.0.0.1:18912> on this computer. Request an email code and enter
  it there. The code is not logged or included in diagnostics.
- Wait for **HTTPS is ready**. While still on home Wi-Fi, open the existing
  phone connection to allow its authenticated endpoint refresh to learn HTTPS.
- Turn phone Wi-Fi off. Send a message over cellular and receive a reply.
- If the app has not learned HTTPS, enter the displayed HTTPS origin and use a
  fresh pairing code from <http://127.0.0.1:18911>.
- Keep this computer awake and Chief running. This change does not alter Windows
  power settings or move the workspace into the cloud.

The setup page binds only 127.0.0.1 and checks exact Host, Origin, forwarding
headers, a page-specific CSRF token, bounded validated JSON and an email-request
cooldown. Its status contains only public account/connection fields. Saved
account credentials and ephemeral connector files live under
`.chief-local/phone/remote-private`, with the existing owner/SYSTEM ACL helper
applied before use. This is the headless server credential model: private
filesystem storage, not an Electron keychain. Same-user code shares the owner's
OS trust boundary.

## Verification and deployment

`node --experimental-strip-types scripts/verify-chief-phone-remote.mjs` launches
an isolated fake-engine backend and real companion plus origin gateway. It checks
setup Host/Origin/CSRF/rate limits; use of a LAN-paired credential through the
private pipe; unauthenticated denial; inaccessible owner controls; authenticated
endpoint refresh and withdrawal; and 503 after companion exit. Receipt:
`docs/verification/evidence/chief-phone-remote.json`.

The two existing `electron/companion-provisioning.node-test.mjs` integration
tests passed, covering endpoint recovery, retry and persistence. Syntax and
focused lint checks passed. The initial verification run had a cleanup-method
typo; it was corrected to the gateway's `close()` API and the full check reran.

Restarted only **Chief Mobile Connector (Dev)**. Its existing scheduled task
starts the enhanced supervisor. Live readback verified one paired phone, an
available account service awaiting sign-in, and a healthy unchanged Chief main
server. SHA-256 checks confirmed `devices.json`, `bots.json` and `config.json`
unchanged across activation. Original supervisor and paired-device recovery copy
are private in `.chief-local/phone/repair-backup-20261011`.

Email verification, actual public HTTPS readiness and a real cellular message
exchange remain owner acceptance steps. No claim of end-to-end cellular success
is made by the isolated tests or the local deployment checks.

## October 11 — hosted provider rate limit

The owner completed email verification. Saved account and installation
credentials are present, but no usable hosted endpoint/connector token has been
returned. The authenticated endpoint read reports `status: error` with
`lastErrorCode: cf_rate_limited`. The live provisioning response is HTTP 503
`endpoint_rate_limited` (reference `39578c33-095a-4628-8138-248afc417bfc`).
The earlier generic failure reference was
`40877628-562d-4e2d-ad00-fc43eecea878`.

Added both provider rate-limit codes to the existing bounded background recovery
policy and friendly messages in `electron/companion-account-service.mjs`.
Connected the service's existing secret-free diagnostic logger to the phone
supervisor. This preserves sign-in and installation identity, uses exponential
backoff/jitter and the service's Retry-After delay, and avoids repeated email
verification. Forty-five account-service tests, the isolated phone/gateway
verification and focused lint passed. After restarting only the phone connector,
live state shows the specific message and the log confirms an automatic retry
scheduled in 547 seconds. Paired-device storage remained byte-for-byte unchanged.

HTTPS remains unavailable until the upstream service provisions the route.
The next action is to leave the connector running and let its scheduled retry
run; do not repeat sign-in or repeatedly press Retry. A real cellular exchange
is still unverified. The wait is a connector recovery timer, not a scheduled
Codex follow-up task.

Later October 11 (14:45 PDT): read-only `/healthz` confirms provider capacity
`full`, tunnels `used: 1000, limit: 1000`, DNS records `used: 1024, limit: 1000`,
and no pending reclamation. Endpoint still reports `cf_rate_limited`. Latest
owner-visible reference `5ad57d27-6587-4bfb-ad96-19a81f1d295a`; supervisor scheduled
attempt five after 7984 seconds. This is not a known restoration time. Do not
keep promising that the next local retry will restore HTTPS. Tailscale is
installed and its service is running, but CLI state is `NoState`, with no DNS
name, IPs or peers. Owner has been asked whether to prepare that alternative
(computer and phone sign-in required) or continue waiting. No alternate route
has been enabled and no provider support message has been sent.

## October 11, 14:52 PDT — Tailscale prepared

Owner chose “Prepare Tailscale”, then explicitly approved “Use Tailscale;
leave WARP disconnected”. Tailscale 1.104.1 was already installed with an
existing account. Cloudflare WARP prevented the daemon from reaching its
coordination service (Windows socket permission error). With WARP paused,
Tailscale entered Running and reached the existing iPhone. Restoring WARP
reproduced failed peer pings and offline self status. Trial exclusions for
controlplane.tailscale.com, login.tailscale.com, *.tailscale.com and
log.tailscale.io did not resolve it; all four were removed.

Final configuration: WARP disconnected by owner choice; Tailscale Running,
self Online true, no health warnings. Enabled unattended mode with
`tailscale set --unattended=true`; readback confirms ForceDaemon true.
No exit node, subnet advertisement, public Funnel or firewall change was added.
Do not reconnect WARP without resolving this demonstrated conflict.

Refreshed the existing companion through POST 127.0.0.1:18911/tailscale/refresh.
It now advertises `http://the-box.tail0d3f36.ts.net:18910` as its tailnet route.
One existing phone remains paired. The computer reached
aj-iphone-13-pro-max over Tailscale in 102 ms. Local HTTP through the MagicDNS
address returned 401 without credentials, confirming the listener responds
and requires authentication. No app messages were sent and no pairing was
replaced during preparation.

Owner acceptance still needed: keep Tailscale enabled on the iPhone, open
MausBot Settings → Connection & Security → Edit address, save
`http://the-box.tail0d3f36.ts.net:18910` (existing pairing is retained), then
disable phone Wi-Fi and exchange a message over cellular. The successful
Tailscale ping alone does not prove that app-level cellular exchange.
Keep the computer awake and Chief running. Hosted HTTPS remains a separate
provider-capacity issue; no migration or provider support message was made.

## October 20, 2026 — connector restored; cellular acceptance confirmed

Tailscale was healthy, but the existing `Chief Mobile Connector (Dev)` task
had exited after its private-storage ACL guard failed. Rechecking the guard
succeeded without weakening permissions. Restarting the same task restored
the authenticated listener at `http://the-box.tail0d3f36.ts.net:18910` while
retaining the existing pairing. Health returned the correct application;
anonymous `/api/bots` returned 401; owner controls remained loopback-only.

Asked to reconnect with Tailscale enabled, turn Wi-Fi off, and send a message,
the owner explicitly answered **"Connected and received a reply"**. Cellular
message/reply acceptance is now confirmed. The older pending status above is
historical. See `../operations/MOBILE-AND-TERMINAL-REPAIR-2026-10-20.md` for
the related native terminal repair and live verification evidence.
