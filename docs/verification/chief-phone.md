# Chief development phone connector

The development server remains bound to loopback. Its dedicated companion
exposes the authenticated phone protocol on port **18910**. The owner-only
pairing/revocation page is **http://127.0.0.1:18911**, bound to loopback.
Click **Start pairing** there for the six-digit desktop-compatible code. The
code expires after two minutes; do not use the browser server-pairing code.

`Chief Mobile Connector (Dev)` runs `scripts/start-chief-phone.ps1` at user
logon. The supervisor follows `.chief-local/preview.json` and reconnects to
the saved development backend after its dynamic port changes. It never
discovers or attaches to the separately installed desktop app on port 8899.
The developer restart shortcut also starts this task when installed.

Paired devices persist in `.chief-local/phone`, with the local directory ACL
restricted to the owner and SYSTEM. No device tokens or codes are printed in
verification receipts. Stopping the scheduled task stops the connector;
revocation is available on its local control page.

Verification: `node --experimental-strip-types scripts/verify-chief-phone.ts`
uses a disposable fake-engine backend and companion directory. It verifies
six-digit redemption, authenticated roster access, unauthenticated rejection,
and separation from owner-only pairing controls. Evidence:
`evidence/chief-phone.json`. Syntax and focused lint checks pass. The local
installation responds on its LAN address at port 18910, but a real iPhone
connection still requires the owner to enter a fresh code. Cross-device Wi-Fi
reachability is not proven by a same-computer LAN probe.

On October 10, the active LAN address was `192.168.1.210`; DHCP can change it.
The control page displays the current address. Existing Windows Node firewall
rules allow TCP on Private and Public profiles; no firewall rule or network
classification was changed. Do not expose the owner control port remotely.
