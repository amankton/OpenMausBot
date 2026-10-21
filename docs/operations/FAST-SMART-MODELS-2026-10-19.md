# Fast, smart response defaults

The owner requested updates to Bacca, Bacca - Chief, Solo and Solo - Chief after reviewing the recommendation to use GPT-6.1 Sol with Low reasoning for everyday work.

| Entry | Previous default | Updated default |
| --- | --- | --- |
| Bacca / Hermes default profile | GPT-6.1 Sol, Medium | GPT-6.1 Sol, Low |
| Solo / Hermes solo profile | GPT-6 Astra, Low | GPT-6.1 Sol, Low |
| Bacca - Chief | Inherits Hermes default | Inherits GPT-6.1 Sol, Low |
| Solo - Chief | Inherits Hermes default | Inherits GPT-6.1 Sol, Low |

Updated `C:/Users/amank/AppData/Local/hermes/config.yaml` (`agent.reasoning_effort`) and `C:/Users/amank/AppData/Local/hermes/profiles/solo/config.yaml` (`model.default`, retaining `agent.reasoning_effort: low`). Provider remains `openai-codex`. The Hermes atomic config writer was used; decoded before/after checks verified no unrelated values changed. Both effective profile loaders resolve the exact desired model, provider and enabled Low reasoning, with no per-model reasoning override.

The two Chief entries and all 14 listed existing tasks already select `hermes-default`. No explicit native model pin was added: that path rebuilds the ACP agent on each configured turn and would introduce unnecessary work. After an isolated fixture verified the settings refresh route, Chief's idle Hermes instance was refreshed through its supported API with the same canonical CLI path. It returned HTTP 200; the two entries remained idle with their inherited selection. Conversation content and permissions were not edited. Gateway source reloads scoped config for each turn and updates cached-agent reasoning per message; its service was not restarted. These are profile defaults; a separately selected session-specific override retains its normal precedence.

Verification helper: `work/performance-20261019/set-fast-smart-profile.py`. Isolated refresh fixture: `verify-instance-refresh.ts` in the same directory. Actual browser verification uses the existing isolated Chief/Hermes fixture with persistence, retention, review and tool-execution barriers; it records outgoing model and reasoning rather than relying on labels.

Completed at 2026-10-20 00:31:47 UTC (October 19 local): three real browser replies passed with no page errors. Agent and all three outgoing requests confirmed `gpt-6.1-sol`, `openai-codex`, Low reasoning and 19 tool definitions. First painted text was 22.603 seconds cold, then 3.332 and 2.370 seconds pooled; completion was 25.101, 5.807 and 3.794 seconds. This verifies adoption, not a controlled quality/latency improvement over Medium. Cold setup remains a separate unresolved bottleneck. The fixture exited zero and its exact recorded Python/parent process IDs were no longer running. Evidence: `work/performance-20261019/hermes-real-acp-fast-smart-low.json` and `.png`.

Rollback defaults, if requested: Bacca `agent.reasoning_effort` back to `medium`; Solo `model.default` back to `gpt-6-astra` with Low unchanged. Chief follows Bacca/default and requires its idle Hermes instance refreshed to discard cached agent settings. No rollback was applied.
