# Member-scoped Chief Tracker tools

User-authorized scope: connect Chief agents to Huly, then have Crewframe Bacca create one test issue in the existing LEARNING CHIEF WORKSPACE project and verify its saved content.

Implementation checklist:

- [x] Extend explicit two-sided member pairing with optional Tracker read/write scopes; never upgrade existing connections silently.
- [x] Bind every operation and its arguments into the runtime signature; recheck member session, epoch, bot, scope, policy and record access.
- [x] Use the stored ordinary member credential against the existing Transactor/Collaborator endpoints. No service/admin credentials or browser-session copying.
- [x] Provide bounded project/issue reads, duplicate-safe issue creation and limited updates through a packaged Chief MCP tool entry.
- [x] Verify isolated member separation, read-only denial, revoked access, tampered proofs, duplicate delivery and uncertain-write handling before rollout.
- [x] Back up affected service state; deploy only the lifecycle and Chief changes needed for this workflow.
- [x] Pair the owner-selected Chief agents explicitly, run Bacca's task once with duplicate protection, and independently verify the issue in Huly. Created LEARN-1; exact description persisted after browser reload.

The authorization service, Tracker client and tool transport remain separate modules. First delivery covers Tracker only; it does not enable arbitrary Huly mutation endpoints or other members' agents. Existing application conventions and sanitized error handling take precedence over introducing an unrelated backend framework.
