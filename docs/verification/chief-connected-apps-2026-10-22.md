# Chief connected-app acceptance — October 22, 2026

Bacca - Chief and Solo - Chief executed bounded provider reads through Crewframe's
existing Chief server and the Hermes `chief_tools` → Composio bridge. Each agent
successfully read Gmail profile, Google Calendar calendars (maximum one), GitHub
authenticated profile, Google Super profile, Google Drive About, Google Docs
metadata search (maximum one), and a Tavily public documentation search (maximum one).

Solo's seven-read batch passed. Bacca's initial batch passed six reads; Docs
returned Google Drive `RATE_LIMIT_EXCEEDED`. One Docs-only retry after backoff
succeeded. No credential reset or reconnection was needed.

Provider execution receipts were independently checked in the local Hermes
transcript for success flags and expected payload shapes. This verifies these
reads, not provider writes, every workflow, or sustained response times.

All eight existing connected account IDs and statuses were preserved. Chief's
configuration hash and both agents' model, approval and integration-access
settings were unchanged. Only the owner-authorized reads were allowed once.
Separate verification threads retain the results; existing conversations remain.
The standalone desktop app stayed closed.

The 0.1.98 Windows installer refresh packages the existing committed Chief
runtime, including member-scoped Huly tools and startup fixes. Crewframe's
separately committed connector and document-worker changes belong to Crewframe;
they are not embedded in the Chief desktop installer. No owner connections,
credentials or workspace data are included in the distributable.
