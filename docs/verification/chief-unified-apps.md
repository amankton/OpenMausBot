# Chief Personal and Workspace unified Apps — 2026-10-15

Scope: Chief Personal and Chief Workspace share the native Apps panel and native connector backend. Crewframe remains separate. No credential migration or iframe credential/command bridge was added.

Workspace entry: Chief workspace menu → Apps / Connections. The host performs fresh owner admission before mounting native state and rechecks on focus and periodically. API operations retain their existing authorization. Workspace membership does not grant owner connection access.

Implementation: ChiefConnectionsHost hosts PluginsPanel, SettingsModal and BotSettingsDialog. Store hydration completes before opening the panel. Workspace opening refreshes inventory; the collaboration iframe stays mounted.

Verification:
- Implementation agent: 242 focused tests passed; latest modal fixes: 11 host tests passed.
- Independent reviewer: 122 focused tests and TypeScript build passed; no blocking findings.
- Connector authorization reviewer: 24 tests passed, including non-owner/member token rejection.
- Final root TypeScript build and git diff --check passed (line-ending warnings only).
- Browser: running Chief at 127.0.0.1:5299/workspace opens Apps, opens native settings, and closes settings successfully.
- Disposable fixture: synthetic account appears in Workspace; changing fixture inventory and reopening shows refreshed alias; Personal shows that same refreshed account.
- Disposable fixture: unsaved iframe draft survives Apps open/close; iframe postMessage cannot open Apps.
- Browser observed failed owner recheck replace Apps with access verification failure.

Limits: real preview reports connected apps not configured. No real OAuth, provider execution, credential edits, or workspace-member connection grants were performed. Fixture account inventory is synthetic. Bot access dialog reviewed and covered by component tests; no live permission mutations performed.

Reproduction: node --experimental-strip-types scripts/testing/unified-apps-fixture.ts; use printed UI origin and /workspace. All connector mutations return 405; POST /__fixture/rotate changes only synthetic inventory. Browser interaction is performed separately through CUA. Stop the launcher with Ctrl-C.
