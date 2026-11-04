# Chief GitHub synchronization — November 3, 2026

The owner requested that GitHub be brought up to date with the local workspace.
The current Chief source is maintained on `codex/chief-unified-platform` in
`amankton/OpenMausBot`. Its prior tip was
`22d5d4cf827159433bbb55587450f359b899b7ba`.

This synchronization records the existing phone/companion resilience changes,
native and source phone permission settings, Hermes routine and command review,
shared-workspace menu repair, and durable task results implementation, tests,
examples and documentation. The only new runtime edit made during synchronization
replaces an intentional iframe `src` self-assignment with a captured source value
to satisfy the full lint check; the existing blank-frame behavior test passes.

## Verification of the combined source

All checks ran against the primary Chief checkout:

- Changed and related regression tests: **28 files, 653 passed, 2 skipped**.
- Existing blank-frame recovery regression: **1 passed** after the lint repair.
- Hermes plugin: **8 Python unit tests passed**.
- Application `tsc -b` and server `tsc -p tsconfig.server.json --noEmit`: passed.
- Full repository `oxlint --deny-warnings .`: passed.
- Locale catalogs: valid, 10 languages and 3,508 English strings.
- Credential-pattern scan of changed files across the registered worktrees:
  no private-key blocks, recognized provider/GitHub tokens or JWTs found.

The credential-pattern scan is a bounded check, not a general security audit.
No full monorepo test, fresh installer, production build, live provider test or
deployment was performed for this Git synchronization. Earlier feature-specific
evidence retains the limits stated in its own verification documents.

Exact commands, file inventory, pre-synchronization hashes and logs are retained
locally under the ignored `.chief-local/github-sync-20261103/` directory.

## Other working copies

Distinct source/doc versions are preserved as review checkpoints under
`codex/github-sync-20261103-` branches with suffixes `desktop`, `selective`,
`upstream-compat`, `durable-delivery`, `durable-integration` and
`durable-owner-control`. These are historical/in-progress variants, not additional
validated releases. Their original working files, staging areas and branch tips
are preserved. Raw fixture logs, scratch files, recovery data and live application
state are excluded from these source checkpoints.

The detached October 17 release worktree has only local validation/scratch output
beyond its existing commit; there is no additional source to synchronize there.
The outer workspace has no Git remote, `chief-playbook` has no independent Git
repository, and `funnel-playbook-site` has no configured remote. No remote was
invented for those unrelated directories.

## Branch and upstream boundaries

The repository's default `main` points to a separate upstream history. At audit,
it had 1,192 commits absent from the Chief baseline and the Chief baseline had
15 commits absent from `main`; the source branch already matched its own remote
before these previously uncommitted changes were recorded. This is not a
fast-forward relationship. Synchronization publishes the Chief branch without
rewriting `main`, changing the default branch, merging unrelated upstream work,
publishing release artifacts or triggering a deployment.

Both Git remotes were fetched. Fetching the official upstream does not incorporate
its latest release into Chief. Selective backport and installed-app records remain
the authority for which upstream changes were actually adapted and deployed.
