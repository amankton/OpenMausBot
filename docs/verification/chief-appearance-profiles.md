# Chief appearance profiles

Decision (owner request, 2026-10-13, Crewframe conversation): retain one Chief codebase with separate Chief Original, Chief (Crewframe), and Custom appearance profiles. Apply Crewframe styling throughout embedded Chief and its company workspace. Preserve the existing Bacca/Solo drawer behavior.

Settings > Appearance selects the profile. Standalone and embedded preferences have separate local storage keys; existing native skin preferences remain intact. Embedded Chief defaults to Crewframe and follows host light/dark mode. Custom offers an accent with automatic black/white button text contrast. Neutral surfaces and semantic status colors remain distinct.

The profile overrides deployment accent variables only while active. Company workspace receives validated mode/color messages from its Chief parent. Its CSS adapter covers both legacy theme variables and newer primary-button/global-accent variables. No agent data or native platform bundles are modified.

Verification: TypeScript build, 59 targeted Vitest tests (appearance, skins, settings, shared workspace), and company theme trusted-parent test passed. Browser checked Original and Crewframe selection, standalone isolation, and embedded dark palette. This is local per-browser appearance, not account-synced branding.
