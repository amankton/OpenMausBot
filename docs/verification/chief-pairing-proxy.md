# Personal Chief pairing through the frontend proxy

The server's routing URL uses `localhost` and an internal backend port. The
browser opens `127.0.0.1:5299`; Vite preserves that browser-facing Host and
Origin. Comparing Origin with the routing URL incorrectly rejected the
dropdown's Request connection action with an owner-window error.

The pairing route now uses the existing request-origin check. It still
requires personal loopback admin authority, an explicit Origin for mutations,
and rejects cross-site requests and forwarded headers. It does not allow
arbitrary loopback origins or change membership and agent eligibility.

Verification:

- `npx vitest run server/routes/chief-pairing.test.ts server/chief-pairing.test.ts server/request-auth.test.ts src/components/ChiefPairingPanel.test.ts` — 70 passing checks.
- `node --experimental-strip-types scripts/verify-chief-pairing-proxy.ts` —
  actual isolated personal backend and actual Vite proxy, with a synthetic
  lifecycle authority that verifies the signed claim. Covers selected-agent
  pairing, pending connection reload, local removal, and rejection before any
  claim for foreign origins and spoofed forwarding headers.
- `npx tsc -p tsconfig.server.json --noEmit` and focused lint passed.

The proxy fixture does not prove workspace approval or real specialist
execution. Deployed workspace approval is covered separately by the CON-01
synthetic release checks. Owner invitations and connections are never used
for verification. Evidence: `evidence/chief-pairing-proxy.json`.
