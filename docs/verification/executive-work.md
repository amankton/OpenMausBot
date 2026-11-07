# Chief work and email review

Run the real App against a temporary fake-engine server and disposable headless browser:

```sh
node --experimental-strip-types scripts/verify-executive-work.ts
```

The recipe uses `control-omb ui` for navigation, edits, screenshots and viewport changes, and the shared `executive-work` control operation for synthetic queue creation and readback. It never discovers or addresses the owner's installed application. It reuses installed browser binaries on Windows when available, with a new temporary home and no saved login. Otherwise the existing browser fixture downloads its pinned tools.

The recipe verifies unavailable mailbox scans remain disabled, saving proposed cadence and an existing preferred reviewer increments the settings revision without creating a routine, synthetic canonical work can be owner-confirmed against its source version, a date-only deadline stays date-only, and settings survive reloading the App. It checks a 390-pixel viewport for horizontal overflow and confirms the work panel scrolls vertically. Screenshots and a JSON receipt with exact command types, fixture URL, saved revisions and persistent server log are written to `docs/verification/evidence/executive-work/`. The receipt records whether fixture data was removed after cleanup.

This disconnected-provider recipe does not prove real mailbox identity, mail accuracy, provider authentication, background execution, notifications to a terminated mobile app or installed-package compatibility. Those require separate synthetic adapter tests and the staged installed read-only acceptance described in the implementation plan.

For a retained isolated browser session, the shared control surface also supports:

```sh
node --experimental-strip-types scripts/control-omb.ts ui viewport --ui HANDLE --width 390 --height 844
```

Dimensions are constrained to 240–4096 pixels. Every viewport mutation requires the explicit live fixture handle, retaining the existing session checks.
