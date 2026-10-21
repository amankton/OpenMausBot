# Chief installation / update acceptance record

Copy this template for each installation into its approved private operational records. Do not enter passwords, tokens, pairing codes or transcript content.

| Field | Value |
| --- | --- |
| Customer/owner and operator | |
| Date, timezone, host and OS | |
| Install variant: Agent desktop / source office / Platform / mobile | |
| Current version, source SHA, artifact hash | |
| Target official tag/SHA and included/deferred commits | |
| Chief build identity and per-customer brand manifest | |
| App/package ID, install/profile/data/companion paths | |
| Backend / companion / owner-control ports and bindings | |
| Tailnet owner, device identity and exact MagicDNS phone URL | |
| Startup task/service, run account and sign-out behavior | |
| VPN conflicts and approved final settings | |
| Sleep/lid/reboot policy; key-expiry/re-authentication owner | |
| Backup location, restore validation, prior artifact | |
| Maintenance window and authorized targets | |
| Mac: architecture, bundle/helper IDs, signing TeamIdentifier | |
| Mac: notarization/stapling and final DMG-contained app verification | |
| Mac: Login Item / LaunchAgent label; tested login dependency | |
| Branding audit findings closed / pending; screenshots and build manifest | |

| Acceptance check | Pass / fail / pending; evidence and time |
| --- | --- |
| Correct host/workspace and authorized tailnet | |
| Tailscale Running/Online, MagicDNS, peer reachability | |
| Companion health; anonymous protected API denied | |
| Owner controls remain loopback-only | |
| Brand/app identity/update policy preserved | |
| Agents, history, settings and provider access retained | |
| Existing pairing retained and app connects | |
| Cellular message sent and reply received (Wi-Fi off) | |
| Other Wi-Fi, app background/foreground, host lock | |
| Restart/sign-out requirement actually tested | |
| Candidate unit/integration/fixture/build/package checks | |
| Rollback readiness / pilot result / remaining limitations | |

Final status must distinguish documented, staged, tested, deployed and owner-accepted. Record user-reported evidence separately from directly observed tests.
