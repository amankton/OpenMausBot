# Retained model loading and backup evidence

The two invitation fields require a compatible bundled transactor model, **not a persisted data migration**. At pinned source `03b7aad7dc562f4f9769c51a4df08191a0393997`:

- `pods/server/src/server.ts` reads `model.json` from the transactor image.
- `server/server-pipeline/src/pipeline.ts` installs `ModelMiddleware.create(model)`.
- `foundations/server/packages/middleware/src/model.ts` initializes the hierarchy from `systemTx.concat(userTx)`. Workspace `model_tx` stores custom model transactions; absence of the new system fields there is expected.

`scripts/verify-chief-platform-model.mjs` runs this actual middleware with the exact built model and read-only workspace custom transactions. It verifies the hidden string `admission` and boolean `joined` attributes, compares baseline/candidate warning counts, checks workspace records before/after, and writes the private `meeting-model-validation.json` receipt consumed by the guarded launcher. The receipt binds source, patch, tool/transactor/workspace image IDs, model hash, private backups and per-workspace evidence. It does not claim a running service was replaced or browser/media acceptance passed.

`scripts/backup-chief-platform-acceptance.mjs` uses the supported upstream backup operation and the exact reviewed tool image. Default target is the fixed synthetic workspace; `--owner-read-only` targets the separately verified fixed owner workspace. Arbitrary workspace arguments are rejected. Backup manifests, all referenced files and hashes are checked, logs/configuration stay private, and only the exact completed one-shot container is removed.

## Correction: synthetic historical migration attempt

An initial recommendation to run `upgrade-workspace` was incorrect for this change. The supported command was attempted **only** against `chiefacceptance` after a verified backup. It also ran historical upgrade-mode migrations not marked during fresh workspace creation. Two legacy Chunter migrations reported a missing `comment` relation; upstream catches those errors and continues. The run reached `core/indexes-v5` and ended without its completion marker. No successful migration receipt was produced and it was not retried.

The original synthetic backup and failed command/log are retained under `.chief-local/platform/backups/chiefacceptance-before-admission`. Record IDs/counts remained unchanged across the seven compared domains. Four contacts gained/changed their `avatarType` default and three auto-generated UserProfile cards gained/changed `content`; the acceptance document card remained unchanged. Calendar, attachment, collaborator, Love room and meeting-minute domain data compared exactly. These historical effects are distinct from preservation checks around the later read-only model validation. The owner workspace never ran that migration command.

Do not use a generic forced workspace upgrade for this optional-field patch. No arbitrary tables, migration markers, account resets or volume changes were introduced to bypass the legacy errors. The one-shot upgrade script is archived privately with its failed evidence and removed from runnable project scripts.

## Rollback boundary

Restore the recorded frontend/transactor/workspace images and baseline nginx configuration together, and gracefully stop only the new Love/LiveKit services. Keep all five existing data volumes and both workspaces. Disable media routes rather than exposing stock Love's former unrestricted token path. Optional invitation fields may remain in any subsequently written records. A backup restore is a separately reviewed recovery action, not the default application rollback.
