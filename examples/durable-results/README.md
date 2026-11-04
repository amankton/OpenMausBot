# Synthetic onboarding through the task-result API

From the repository root with its existing dependencies installed:

```sh
node node_modules/vitest/vitest.mjs run server/task-results.e2e.test.ts --cache=false
```

This runnable example uses `transcript.md` and `sop.md`. The fixture deterministically creates a sourced packet, keeping owner and deadline unresolved and recording that customer contact has no authorization. This is synthetic extraction, not an evaluated model reasoning result.

The repository's fake provider calls the real `register_task_result` and `task_results` tools against a disposable server and database. It demonstrates failed attempt A, delivered B, a stopped requester, a later failure, restart reconciliation, an unrelated caller denied access, and peer access revocation. The registered packet is copied into ordinary private attachment storage and posted in its own task; the requester receives a reference card without a model wake.

The fixture removes its temporary data after the test. No owner conversations, real providers, customer data, paid resources, or live services are used. To inspect evidence, read `server/task-results.e2e.test.ts` and `docs/verification/durable-task-results.md`.
