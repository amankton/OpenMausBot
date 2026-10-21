# General file attachments

Chief accepts files independently of the document MIME catalog. The agent receives
the private stored path and display name; its tools determine how to read the
contents. Archives remain intact. Existing image, file, message, and storage size
limits still apply.

## Verification

Run from the repository root:

```sh
pnpm exec vitest run server/attachments.test.ts server/bot-attachment.test.ts server/message-file.test.ts src/lib/composer-attachments.test.ts src/lib/intake-files.test.ts server/composer-attachments.test.ts server/general-attachments.e2e.test.ts server/attachments-startup.test.ts
pnpm exec vitest run server/index.test.ts -t 'streams shared documents|lets a bot attach a file it made|downloads an exact user attachment'
pnpm typecheck
```

`general-attachments.e2e.test.ts` launches and closes its own disposable server
with the fake engine. It uses browser `File` objects and the real composer upload
helper to upload a ZIP, Python source, HTML, a binary dataset, a Dockerfile, and a
dotfile. It sends their attachment references through the normal conversation
boundary, verifies delivery to the fake engine, and downloads each file through
the owning message. Download bytes must match; unshared paths must return 403.
HTML is downloaded with attachment disposition and `nosniff`, never executed.

The fixture keeps its bounded transcript, wait result, file receipts, and server
log location in `<fixture log path>.attachments.json`. It does not retain the
engine's credential-bearing MCP configuration. Upload retry and quota tests cover
arbitrary suffixes, content collisions, traversal, oversize rejection, and partial
cleanup. Agent-output tests verify the same broad formats can be returned to chat.

Last exercised on Windows, 2026-10-12: 181 tests in the first command and three
selected HTTP tests in the second command passed. This proves the server and
composer intake flow with a fake engine, not parsing every format by every model.

Mobile policy, picker, and share-target changes need native validation. Android
tests could not start on this machine because no JDK was configured. Swift/Xcode
was unavailable; iOS tests were not run. No live workspace or deployment changed.
