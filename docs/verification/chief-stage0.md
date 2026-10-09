# Chief Stage 0 baseline

Scope and exact commands: [Stage 0 report](../plans/CHIEF_STAGE0_COMPLETION_2026-10-09.md).

`node --experimental-strip-types scripts/verify-chief-stage0.ts` starts two actual servers through `launchVerificationServer`. Each has a disposable home/data directory and the fake engine. It creates distinct synthetic members and bots, executes a fake specialist turn through `control-omb`, uploads synthetic text and image files, checks isolation in both directions, and closes only its own servers. Receipt: `work/chief-stage0-two-workspace.json`; an optional first argument selects another receipt path. The receipt records launcher log paths and synthetic transcripts, not member credentials.

`node --test integrations/platform/stage0-isolation.test.mjs` loads tracked capture source and real Express, with synthetic Accounts/record ACL/RTC dependencies. It tests colliding record IDs across two workspace contexts, worker/member credential separation, denied cross-workspace reads/consent/deletion, current membership/ACL changes and persisted reload. The first pending capture blocks a second capture with 409 because the existing worker is globally single-slot. It uses the retained Love checkout's installed Express dependency; no package installation or live endpoint fallback is performed.

These fixtures establish a baseline for current boundaries. They do not implement or prove shared member pairing, real Agency execution, live media, or deployed Platform project/file/search tenancy. Those remain explicit M1 and later integration gates.
