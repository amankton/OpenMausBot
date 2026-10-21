# Mac handoff for Codex or Claude

Copy the prompt below and supply access to the intended Mac plus the reviewed Chief source/artifact. Do not include secrets. This is an implementation handoff, not evidence that the Mac is already configured.

---

Implement the standard Chief Executive Suite installation/update on this Mac. Preserve its existing white-label build, data, agents, conversations, provider access, integrations and phone pairing. Use Tailscale for private phone connectivity. Incorporate the latest compatible official OpenMausBot changes into Chief; do not replace Chief with the upstream application.

Read the applicable AGENTS.md and these documents first:

1. `docs/operations/MAC-TAILSCALE-SOP.md`
2. `docs/operations/MAC-WHITE-LABEL-UPDATES-SOP.md`
3. `docs/operations/CHIEF-BRANDING-AUDIT-2026-10-11.md`
4. `docs/operations/INSTALLATION-RECORD.md`
5. `docs/verification/README.md`

Inspect the actual installation before choosing commands. Determine packaged Agent versus source office/Platform; resolve its real data paths, ports, launch account, startup and brand manifest. Do not assume Windows port 18910, the owner's hostname, profile, VPN preference or credentials apply here. Use this customer's approved tailnet and identities only.

Make a private, consistent and restorable backup. Use a separate candidate checkout and isolated synthetic test profile. Never run mutation tests against the live user's conversations. Preserve unrelated edits. Keep an explicit included/deferred upstream change list and build identifier.

Configure Tailscale and the existing authenticated companion, preserving pairing where possible. Copy the exact MagicDNS URL from the target. Keep owner controls/backend private; do not enable public Funnel or router forwarding. Diagnose other VPN conflicts before proposing changes. The owner's decision to disable WARP on a different Windows host does not authorize disabling this customer's VPN.

Make Chief independent of your terminal using the correct native startup mechanism. Distinguish a login LaunchAgent from a system service; the standard Mac setup requires a signed-in, awake host. Configure On Demand and startup as appropriate and verify closing the terminal, screen lock and restart/login. Do not promise before-login availability or use Windows unattended flags.

Address the branding audit's open release items: the older Mac source ZIP lacks the latest backports; prior Mac signing repair is not a verified build fix; runtime brand.json does not rebrand all hardcoded/native surfaces. Preserve each customer's approved assets, identities, legal notices and update policy. Do not bypass entitlements or copy owner-only memory connections into customer installs.

Build/sign/notarize on the Mac using the reviewed Chief pipeline. Inspect the final DMG-contained and installed app, not only a build folder. Do not disable Gatekeeper as a release workaround. Test each claimed architecture on matching hardware.

Complete cellular acceptance: Wi-Fi off on the phone, open the correct team, send a harmless message in an approved test conversation and receive a reply. A ping, health check or local-Wi-Fi connection is insufficient. Record what you observed versus what the user reported; mark unavailable tests pending.

Deliver the completed installation record, exact changed files/patch, artifact hashes, brand audit result, actual test results, startup/sign-out behavior, rollback instructions and remaining blockers. Use the terms staged, built, tested and deployed accurately. Continue routine authorized work without repeated confirmation; involve the owner only for required interactive sign-in, missing access or a material choice not already authorized.
