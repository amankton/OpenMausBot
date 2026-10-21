# SOP: Chief remote access on Mac and iPhone

Version 1.0 · October 11, 2026 · Operator: Codex, Claude, or a human installer.

## Outcome and scope

The existing Chief installation remains branded and retains its agents, history and pairing. Its iPhone connects through the customer's Tailscale network over cellular and another Wi-Fi network. Chief runs independently of the agent's terminal while the Mac is awake and its user remains signed in.

This procedure was reviewed against the current Chief source and official documentation. It has not been executed on a Mac. The earlier successful connection report was for Windows + iPhone; it is not Mac acceptance evidence. Use [the installation record](INSTALLATION-RECORD.md) for each target and [the Mac handoff](MAC-AGENT-HANDOFF.md) when delegating implementation.

## 1. Inventory and preserve

1. Identify the actual Mac, owner, macOS version, CPU architecture (`uname -m`), Chief version and installation variant: packaged Agent, source server, or shared office/Platform.
2. Record the installed app path, running account, startup mechanism, backend, companion listener and owner-control ports. A browser URL is not evidence of the phone listener port.
3. Resolve the actual data paths from the runtime. Source defaults are `~/.chief-executive-suite`, `~/.chief-executive-suite-companion` and, for Electron's profile, `~/Library/Application Support/chief-executive-suite`. `OMB_DATA_DIR`, `CHIEF_PROFILE_DIR` and other configured overrides take precedence. Do not relocate data to match these examples.
4. Make a private, restorable backup before modifying the installation or pairing. Preserve the app, brand assets, device registry, settings and data; do not publish credentials or pairing codes. Follow the consistent-backup procedure in [Mac updates](MAC-WHITE-LABEL-UPDATES-SOP.md).
5. Use the customer's own approved tailnet. Do not copy this owner's personal tailnet membership, Hindsight connection, provider credentials, agents or device tokens into another customer's setup.

## 2. Install and connect Tailscale

Use [Tailscale's official Mac download](https://tailscale.com/download/mac). Prefer its standalone application; avoid installing multiple Tailscale variants together. Approve the expected VPN/system extension locally and complete sign-in on the Mac and phone to the intended tailnet. See [Mac variants](https://tailscale.com/docs/concepts/macos-variants).

For the standalone application installed in `/Applications`, these are read-only diagnostics:

```sh
ts='/Applications/Tailscale.app/Contents/MacOS/Tailscale'
test -x "$ts" || { printf '%s\n' 'Locate the installed Tailscale CLI first.'; exit 1; }
TAILSCALE_BE_CLI=1 "$ts" version
TAILSCALE_BE_CLI=1 "$ts" status
TAILSCALE_BE_CLI=1 "$ts" status --json
```

Inspect `BackendState`, `Self.Online`, `Self.DNSName` and health warnings. Expect Running, online and a full MagicDNS name. Keep diagnostics private; record only the necessary nonsecret fields. A Homebrew or user-local installation can have a different CLI path. Chief's companion probes common Mac paths and sets `TAILSCALE_BE_CLI=1`; Finder does not necessarily inherit Terminal's PATH ([source](../../companion/src/listener.ts)).

Check existing VPNs if connectivity fails. Our Windows incident required leaving WARP disconnected, with the owner's explicit approval. That finding is not proof of a Mac conflict. Record prior settings, compare connectivity with a controlled disconnect, and get the target owner's choice before leaving their other VPN off. Never disable the system firewall as a general fix.

## 3. Connect the correct Chief companion

In the installed Chief app, use Settings → Remote access and its Tailscale pairing controls if present. Confirm the companion is attached to the intended workspace. Keep existing pairings when changing only the address.

For the direct companion route used by the reference fix, construct:

```text
http://<Self.DNSName-without-trailing-dot>:<actual-companion-port>
```

Copy the full hostname; do not retype it or borrow another installation's name. The reference source setup used port 18910; audited packaged defaults use 8910. Neither is a universal setting. Confirm the installed version's listener, transport and iOS compatibility before using either.

On an already paired iPhone, open MausBot → Settings → Connection & Security, edit the address, save and reconnect. A new phone requires a fresh pairing flow on the correct host. Do not paste codes into chat or clear the existing device registry to repair DNS.

Some server deployments use Tailscale Serve with a genuine `https://…ts.net` endpoint. Keep that verified route if already configured. Direct companion HTTP over Tailscale and HTTPS through Serve are different topologies: adding `https://` to an HTTP listener does not enable TLS. Do not enable public Funnel, router forwarding, an exit node or subnet routing for this standard install.

Expose only the intended authenticated service to authorized tailnet devices. Backend and owner-control interfaces stay on loopback. Verify authentication and access rules independently of Tailscale ping success.

## 4. Keep it available

Enable Tailscale VPN On Demand on the phone and Mac where available. Set Wi-Fi and Cellular on the phone, and the relevant Mac interfaces, to Always. Another VPN can disable Tailscale's On Demand behavior; recheck after VPN changes. The Tailscale app need not stay onscreen. See [VPN On Demand](https://tailscale.com/docs/features/client/ios-vpn-on-demand).

Do not copy Windows' `--unattended=true` setting onto a Mac. The current [unattended-mode documentation](https://tailscale.com/docs/how-to/run-unattended) limits that feature to Windows and describes the Mac client as belonging to a login session. This SOP promises operation while signed in, not before login or after sign-out.

For a packaged Chief app, configure it to open at login and verify that it and the companion actually start after login. Keep the app running; test what closing its window does in that exact release. Quitting the app is not a background-service configuration. Closing Codex or Terminal must not stop Chief.

Keep the Mac on power. In Battery → Options on a laptop, or Energy settings on a desktop, enable the applicable option preventing automatic sleep when the display is off. Display sleep and screen lock may remain enabled. Settings vary by model/macOS. See [Apple's sleep settings](https://support.apple.com/en-gb/guide/mac-help/mchle41a6ccd/mac). Treat lid closure, restart and sign-out as separate acceptance cases; do not assume wake-for-network-access guarantees availability.

### Optional: an existing source-server deployment

Use this branch only when the installation already uses Chief's server CLI. Do not substitute it for a packaged app or the custom shared-office supervisor.

The current [service generator](../../server/service-cli.ts) writes a LaunchAgent named `com.chiefexecutivesuite.serve`; [its implementation](../../server/service-unit.ts) uses `RunAtLoad` and `KeepAlive`. It is a user login service. It does not automatically supervise a separate custom companion, Vite preview, Platform containers or other office services.

1. Locate the stable Chief checkout, absolute Node executable, existing data directory and free intended server port. Match the installed release's help. Do not use an upstream `npx` install as the Chief executable.
2. Generate the plan using that Chief CLI's `service install --data-dir <directory> --port <port>` and only the already-validated access options. Inspect its ProgramArguments, HOME, OMB_DATA_DIR and PATH. Confirm all paths are stable and all required environment configuration is retained.
3. Create the configured log directory. Validate the generated plist with `plutil -lint`. Copy it into the running user's `~/Library/LaunchAgents` and bootstrap it under `gui/$(id -u)`. Quote every path: the current generator prints unquoted activation commands, which are unsafe to paste when paths contain spaces.
4. Before replacing an existing agent, save its plist and gracefully stop that exact label after draining active work. Never run two processes against the same mutable data.
5. Check `launchctl print "gui/$(id -u)/com.chiefexecutivesuite.serve"`, logs, backend health and the companion separately. Verify restart recovery and closing the launching terminal. Configure every additional dependency through its own supported supervisor.

A service that must operate without a logged-in user requires a separately designed and tested deployment. Do not run the desktop application as root or disable login security to approximate it.

## 5. Acceptance and recovery

| Check | Required evidence |
| --- | --- |
| Network | Mac and phone in the intended tailnet; exact DNS; successful bounded peer connection |
| Listener | Correct companion healthy; anonymous protected API request denied; owner controls unreachable remotely |
| Identity | Paired app shows the intended team/history and Chief desktop retains its branding |
| Cellular | Turn phone Wi-Fi off; send a harmless message in an approved test conversation and receive a reply |
| Reconnection | Another Wi-Fi, phone background/foreground, Mac screen lock and display-off all tested |
| Detached operation | Close the initiating terminal/Codex; app and companion remain available |
| Restart | Restart, log in, verify automatic start and repeat phone connection; record pre-login availability as unproven |
| Recovery | Prior app/configuration and consistent data backup available; existing device identity retained |

Automated mutation tests use the isolated fixtures in [verification instructions](../verification/README.md), never the owner's live conversations. Distinguish user-reported phone tests from directly observed checks. A successful ping or health response alone is not acceptance.

For offline status, check in order: Tailscale/VPN rules, exact hostname, Mac sleep/sign-in, actual listener, workspace mapping, then pairing/authentication. Preserve the old address and startup configuration so each change can be reversed. Stop a failed candidate before restoring the previous runtime; use the matching pre-migration data backup if schemas changed.
