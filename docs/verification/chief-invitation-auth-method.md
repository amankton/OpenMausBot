# Workspace invitation authorization correction

October 10, 2026: the owner reported an authorization error when creating a Chief
invitation. Read-only browser network inspection showed an ordinary workspace
token with `extra.authMethod`. The retained Accounts source emits `password` or
`otp` for normal login, but the lifecycle verifier rejected all extra fields.
The owner membership, membership epoch and nine-agent eligibility grant were
valid and unexpired.

The verifier now permits only those two authentication-method labels. It still
rejects admin/service fields, unknown fields or method values, and system
accounts. Accounts signature verification, current membership, membership epoch,
active Employee lookup and the separate entitlement policy remain required.

Validation and rollout:
- Regression test reproduced the failure before the change; all 13 lifecycle
  tests pass after it, including mixed metadata/privilege rejection.
- The isolated Accounts/lifecycle/proxy release fixture now uses signed password
  and OTP member tokens. Pairing, isolation, revocation, restart and recovery pass.
- Only the lifecycle container was replaced. All existing mounts, credentials,
  policy bytes and other container IDs were preserved. Nginx was gracefully
  reloaded and service health passed. See `evidence/chief-auth-method-rollout.json`.
- The deployed synthetic browser suite passes invitation, approval, reload,
  account isolation/switch, logout and partitioned iframe-cookie checks. Its
  receipt now records actual running image IDs instead of copying a prior rollout.
- No owner invitation, connection approval or permission grant was created.

The personal Vite host had separately stopped with an EBUSY watcher error while
the preview helper file was moved. Its existing Windows startup task restored
the same saved runtime, pairing origin and provider home; health then passed.

The owner can retry Create invitation on the existing page. No frontend rebuild
or sign-out is needed. Full M1 specialist execution remains outside this fix.
