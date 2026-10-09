# Chief embedded session persistence — October 9, 2026

Deployed following the owner's authorization to fix repeated sign-ins. A fresh
synthetic member reproduced the issue with the actual password form: sign-in
worked, but refreshing the embedding page returned to login. The browser had
rejected the account cookies in the cross-site iframe. The account service's
one-year expiration was not the cause.

## Change

`integrations/platform/nginx-meetings.conf` now adapts responses only on the exact
`/_accounts/cookie` lifecycle endpoint. Account and signature cookies retain
their existing values, root path, domain, HttpOnly protection and expiry, while
gaining Secure, SameSite=None and Partitioned. The pinned nginx 1.21.3 supports
cookie flags but has no native Partitioned flag, so the exact root cookie path
replacement appends that attribute. The adapter handles both PUT and DELETE.

Responses also expire the two legacy unpartitioned account cookies, preventing
an old direct-page cookie from restoring a session after logout. This is scoped
to the existing localhost loopback deployment; it is not a general production
domain or browser compatibility configuration.

Browser partitioning keeps the embedded session separate from a direct workspace
page or another top-level site. Separate browser profiles also have separate
sessions. This change does not implement single sign-on between those surfaces,
forward host credentials, change roles, or extend token lifetimes. Users whose
old embedded cookie was rejected may need one final sign-in to establish the
correct cookie.

## Verification

`scripts/verify-chief-session-persistence.mjs` provisions one dedicated synthetic
member in Chief Acceptance, with a one-use invite and a generated password kept
only in the ignored local fixture directory. It refuses outgoing mail, owner
state, and blind retries of uncertain account creation. Fresh persistent Chrome
profiles drive the real password form without authentication or local-storage
injection. No owner browser tab or credentials are used.

Before rollout, `baseline` reproduced loss of authentication on refresh. The
`candidate` mode ran a separate nginx container using the exact candidate file;
only the cookie endpoint's destination port changed through browser network
interception. Browser cookie handling remained native. API response mocking is
unsuitable here because it can change cookie partition handling.

The candidate and deployed modes passed:

- Fresh embedded password sign-in and page refresh.
- Leaving and returning to the workspace.
- Closing and restarting Chrome with the same persistent test profile.
- Secure, HttpOnly, SameSite=None cookie with the expected top-level partition
  and persistent expiry.
- No embedded session inherited under another top-level site or direct page.
- Independent standalone sign-in and refresh.
- Standalone logout with a deliberately seeded legacy synthetic cookie.
- Embedded logout via the real endpoint, followed by a reload requiring login.

The separate deployed embedded recording/playback regression also passed,
including file-cookie isolation and anonymous access denial. New scripts pass
Node syntax checks. Tests cover Chrome, not every browser or the owner's exact
Codex browser profile. A frontend rebuild/replacement was unnecessary and was
not performed for this change.

## Rollout and evidence

`scripts/rollout-chief-session-persistence.mjs --check` validates matching
before/after evidence, the precise cookie-only configuration diff, the mounted
source path, the pinned frontend image, and all 17 healthy services. `--apply`
validates nginx, performs a graceful reload, runs the deployed session tests,
and compares every container ID, image, health state and mount. Failure restores
the saved configuration and reloads it, unless a concurrent source edit prevents
safe automatic rollback.

The rollout passed. All 17 container identities, images and mounts remained
unchanged. The original configuration is preserved at
`.chief-local/session-persistence/nginx.before.conf`. Runtime data, the current
white-icon/title frontend and the separate installer baseline were preserved.
No commit or push was made.

Evidence:

- `docs/verification/evidence/chief-session-baseline.json`
- `docs/verification/evidence/chief-session-candidate.json`
- `docs/verification/evidence/chief-session-deployed.json`
- `docs/verification/evidence/chief-session-rollout.json`
- `docs/verification/evidence/chief-embedded-playback-deployed.json`

The `baseline` command is a pre-rollout negative check against the old running
configuration; do not expect it to reproduce the failure after deployment.
Candidate/deployed checks can reuse the dedicated fixture without creating
another account. Synthetic browser profiles and credentials stay in the ignored
local fixture directory.

References: [nginx cookie flags and path rewriting](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_cookie_flags)
and [browser cookie attributes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie).
