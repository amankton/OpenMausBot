# Handoff for Codex or Claude

Give the receiving agent this file and the other files in this directory. Do not send private runtime folders or credentials.

## Copy-ready task

> Configure private remote MausBot/Chief phone access on the target installation using Tailscale, following TAILSCALE-SOP.md. This is our standard installation route. Inspect the actual target before choosing ports, data paths, account or startup mode. Preserve its white-label identity, existing agents, history, provider sign-ins and phone pairing. Derive and copy its exact MagicDNS name; do not reuse the example host's address. Verify cellular message/reply with the owner. Diagnose other VPNs before changing them, and do not leave a general-purpose VPN disabled without the owner's choice.
>
> For updates, consult the latest stable release in milind-soni/OpenMausBot's official repository, pin its source SHA, and apply WHITE-LABEL-UPDATES-SOP.md. The owner's preference is the latest official updates that do not interfere with Chief customizations. Work in an isolated candidate, preserve current uncommitted changes, integrate compatible fixes with their regression tests, and explicitly list deferred changes. Never install an upstream binary over Chief or enable its upstream auto-update feed. Keep separate records for the source office, standalone desktop package, Platform services and mobile client. Test and back up before any production replacement. An updated source tree is not a deployed installer.
>
> Read applicable AGENTS.md, current release/build docs and the installation record. Use available owner-approved tools and memory context, but verify operational facts live. Do not fabricate access to another host. Ask only for missing target/access information or owner-only sign-in steps. Never request credentials in chat. Provide exact changed files/settings, included upstream commits, test evidence, rollout status, rollback path and pending owner checks.

## Inputs to resolve on the target

- Owner-authorized installation(s), operating system, connection method and maintenance window.
- Packaged desktop versus custom source host versus Platform service.
- Actual brand variant, current/target version, source tree and local modifications.
- Tailnet/account ownership, approved device access and required uptime: while signed in, after sign-out, or before login.

## Reference case, not a deployment template

The reference machine's custom source UI is 5299, phone listener 18910 and loopback controls 18911. Its address was `http://the-box.tail0d3f36.ts.net:18910`. WARP blocked Tailscale and was left disconnected with explicit owner approval. Tailscale unattended was enabled. Chief runs in hidden Interactive Windows scheduled tasks: detached from Codex, but still tied to the signed-in user. Do not claim sign-out independence.

The owner reported successful app connection after correcting a missing `d` in the hostname. Explicit cellular message/reply acceptance remains unconfirmed. Hosted HTTPS had a separate provider capacity limit. Tailscale needs no hosted provisioning patch to work; do not transplant the custom HTTPS supervisor just for Tailscale.

Current Chief fork source has independent branding and disabled upstream auto-update. Its standalone Agent packaging differs from the shared-office source runtime. Relevant baseline details are in ../CHIEF_BRANDING_AUDIT.md and ../verification/chief-phone-remote.md. Recheck all version and runtime facts before operating on another machine.
