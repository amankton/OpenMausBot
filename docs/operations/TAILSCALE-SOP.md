# SOP: Chief / MausBot remote phone access through Tailscale

Version 1.0 · October 11, 2026 · Windows host and iPhone reference procedure.

## Result and boundaries

The existing phone reaches the correct Chief workspace over cellular and another Wi-Fi network through Tailscale. Agents, conversations, brand, account settings and device pairing remain intact. A message and reply over cellular are the acceptance test; a ping or local health check alone is insufficient.

Tailscale provides the encrypted network path. Chief's companion still authenticates the phone. Publish only the intended companion service to authorized tailnet devices; keep backend and owner controls on loopback. Do not enable Funnel, router forwarding, an exit node, subnet routing, or unauthenticated API access as part of this procedure.

Use the customer's approved tailnet and device identities. Never enroll unrelated customers in the owner's personal tailnet or copy the owner's tokens, phone registry, agent memory connection, provider credentials or data into another installation. A shared organization tailnet needs explicit access rules separating customer devices and allowing only the intended companion port.

## 1. Identify the installation before changing it

Complete [the installation record](INSTALLATION-RECORD.md). Identify OS, installed version/source commit, packaged versus source runtime, account that runs it, data directory, companion directory, listener/control ports, and startup mechanism. Read applicable AGENTS.md and the target's current phone documentation.

Do not infer service ports from a browser tab. The browser UI, backend, phone listener and owner controls are different services. Find the listener in Remote access settings or the actual process configuration. Map it to the intended workspace before pairing.

| Reference only | UI | Phone listener | Owner controls |
| --- | --- | --- | --- |
| This owner's custom source setup | 5299 | 18910 | 18911; hosted setup 18912 |
| Chief packaged defaults in the audited source | separate desktop UI | 8910 | 8911 |

Environment overrides take precedence. Neither row is a universal setting. This owner's source backend uses a dynamic port recorded in `.chief-local/preview.json`; its live data happens to be under a temporary directory and must never be deleted as a disposable test fixture.

Take a private recovery backup before changing pairing, runtime or installation files. Preserve existing device credentials; do not print them. Install official Tailscale if absent, using its official installer and the owner's interactive sign-in. Do not solicit passwords or authentication keys in chat.

## 2. Inspect Tailscale and other VPNs

Example PowerShell, after verifying the installed CLI path:

```powershell
$ts = 'C:\Program Files\Tailscale\tailscale.exe'
& $ts version
$status = (& $ts status --json | ConvertFrom-Json)
[pscustomobject]@{
  State = $status.BackendState
  Online = $status.Self.Online
  Name = $status.Self.DNSName
  Health = $status.Health
} | ConvertTo-Json
```

Expected: Running, Online true, an assigned MagicDNS name and no blocking health warning. Both phone and host must join the intended tailnet, with MagicDNS enabled. If signed out, use `tailscale up --timeout=30s` and let the owner complete the official browser sign-in. Avoid `--reset` and forced reauthentication; preserve existing routes and preferences. Do not copy login URLs into shared logs.

Inspect active VPNs. In our incident, Cloudflare WARP caused Windows socket-permission errors reaching Tailscale's coordination service. HTTPS from a normal browser/CLI still worked, so that alone did not prove daemon connectivity.

For a suspected conflict, record current VPN settings, coordinate a brief disconnect test, and restore the prior connection afterward. Compare Tailscale online state and a bounded peer ping in both conditions. Ask the owner before leaving their general-purpose VPN disabled. Do not disable the Windows firewall or security software globally.

On this host, narrow hostname exclusions did not fix WARP coexistence; they were removed. The owner explicitly chose to leave WARP disconnected. That is evidence for this installation, not a universal instruction to disable WARP everywhere. Tailscale documents [possible VPN interoperability issues](https://tailscale.com/docs/reference/interoperability).

## 3. Enable the existing companion and derive the address

Prefer the packaged application's Settings → Remote access → Tailscale pairing → Turn on device access & check / Pair over Tailscale, when those controls exist in the installed version. Do not replace a working packaged companion with this machine's development scripts.

For this custom source supervisor only, the owner-only control API supports `POST /tailscale/refresh`. Verify its loopback port and process ownership before invoking it. Read only nonsecret fields such as `port`, `tailnetName`, and `endpoints`; `/state` can also contain a live pairing code.

Construct the phone URL from the actual `Self.DNSName` (remove only a trailing dot) and the actual companion port:

```text
http://<exact-computer-name>.<exact-tailnet-suffix>.ts.net:<companion-port>
```

Use the full MagicDNS name, not a bare `100.x` address: the audited iOS client permits HTTP for `.ts.net` domains while the transport is encrypted by Tailscale. Copy the complete URL to prevent transcription errors. Do not change it to HTTPS unless that listener actually serves HTTPS.

Already paired phone: MausBot → Settings → Connection & Security → Edit address → paste URL → Save → Try reconnecting. This keeps its pairing. For an unpaired phone, use the target's Tailscale QR or a fresh short-lived code shown on the host. Do not revoke/re-pair an existing phone merely because the address changed.

Reference incident: `the-box.tail0d3f36.ts.net:18910` worked; `the-box.tail03f36.ts.net:18910` was missing a `d` and remained offline. Never reuse this owner's address for another installation.

## 4. Make startup and availability explicit

Windows: enable Tailscale unattended mode with `tailscale set --unattended=true`. This changes only that preference. Verify the service starts automatically and the preference persisted. See [Tailscale unattended mode](https://tailscale.com/docs/how-to/run-unattended).

iPhone: Tailscale → profile picture → VPN On Demand; enable it and set Wi-Fi and Cellular to Always. The VPN can operate while its app is not onscreen. Another VPN can disable Tailscale On Demand; check again after VPN changes. See [official iOS instructions](https://tailscale.com/docs/features/client/ios-vpn-on-demand).

Keep the host powered and online. Review sleep, hibernation, lid-close behavior and battery policy for that device; agree on availability needs before changing them. Screen lock is different from sleep and sign-out.

Chief itself must also run continuously. Hidden background tasks detach it from Codex and terminals, but an Interactive Windows task still requires the user to stay signed in. Tailscale unattended mode does not make Chief unattended. If operation after sign-out or before login is required, configure and test a supported service/account deployment with the same approved data and provider access. Do not run it as SYSTEM as a shortcut or collect a Windows password in chat. Record the achieved availability level accurately.

## 5. Verify in layers

1. Host Tailscale: Running, Online true; correct tailnet and MagicDNS.
2. Network: `tailscale ping --timeout=5s --c=2 <phone-name>` returns. This proves only network reachability.
3. Listener: from an authorized remote device, `/api/health` responds with the expected app identity. A protected endpoint such as `/api/bots` rejects a request without credentials (401). Owner controls must not be remotely accessible. Check intended workspace identity using the paired app; generic health does not distinguish two workspaces.
4. Existing paired app opens the expected team and conversation history, then reconnects without replacing its identity.
5. On the phone, disable Wi-Fi, retain cellular and Tailscale, send one owner-approved test message and receive a reply. Record time and the owner's result without copying conversation content.
6. Repeat from another Wi-Fi network where feasible. Test phone background/foreground and host lock/unlock. Test reboot or sign-out only if required and coordinated; never interrupt active agent work just to test it.

Mark any unperformed step pending. Repository code changes require isolated fixtures under [the verification rules](../verification/README.md), not synthetic mutation tests in the owner's live conversations.

## Troubleshooting and rollback

| Symptom | Next check |
| --- | --- |
| Hosted HTTPS rate limit/capacity error | Preserve sign-in, inspect exact provider status, allow backoff; do not repeatedly reverify email. Tailscale works independently of that hosted provisioning path. |
| Tailscale NoState/offline, socket access error | Service health, active VPN conflict, DNS and daemon connectivity. A working browser is insufficient. |
| Tailscale works but app remains offline | Exact hostname including every character, port and HTTP scheme; saved app address; iOS/client version. |
| Health works, paired API fails | Correct workspace/registry and app credential; distinguish 401 from 403/503. Do not immediately delete pairing. |
| Network ping works, HTTP times out | Listener binding, tailnet access policy and narrowly scoped firewall rule; IPv4/IPv6 resolution. Ping does not prove TCP access. |
| Stops after locking/sleep/restart | Determine sleep versus sign-out; verify both Tailscale and Chief startup, service identity, task triggers and logs. |

Rollback restores recorded VPN settings, previous app address and exact startup changes. Do not delete conversations or device registrations. Restore protected backups only to their owning installation. Hand off the final address, availability level, changed settings, evidence and pending acceptance tests.

## Evidence from the reference incident

October 11, 2026: WARP off restored Tailscale Running/Online, peer ping succeeded, companion health responded, protected API denied anonymous access, and the original phone stayed paired. The user reported “connection successfull” after correcting the missing `d`. A cellular message/reply was requested but not explicitly confirmed in the conversation. Do not describe it as completed cellular acceptance. Detailed local evidence: [phone remote-access record](../verification/chief-phone-remote.md).
