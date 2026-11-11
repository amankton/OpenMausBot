# Chief workflow setup — Windows and Mac test

Version `0.2.0-test`, November 4, 2026. Includes both local spaces, automatic member profiles, 183 selectable roles and enforced background budgets. Internet is required. This is a test package, not a signed customer release.

## Install on the Mac

1. Transfer the ZIP through TeamViewer. Extract into a permanent folder and keep it there. Run `shasum -a 256 -c SHA256SUMS.txt` inside that folder to verify the transfer.
2. Open `Start-Chief-Mac.command`. Use normal macOS controls if explicit opening is required, or review it and run it with Bash in Terminal. Complete the verified official Node installer if needed.
3. Select individual agents and distinct coordinator/operator profiles (Bacca/Solo are defaults). Save the selection.
4. Click **Install / resume selected setup**. Complete Docker's native installation/license and restart prompts, then resume with the same button. The lifecycle step installs fresh databases, migrations and member policy.
5. Click **Connect AI** and finish your own sign-in. Then click **Apply AI connection** to reload this installation's idle AI runtime.
6. Open both spaces. Create/sign into your shared-workspace account. In its Integrations page, open a member session and create an invitation. This authenticated step creates your member assistant automatically.
7. Paste the invitation into personal Chief's connection panel. It selects the assigned member profile. Compare the verification code and confirm in the workspace. Default Tracker access is read only; select the optional write grant only if wanted. Consequential action cards still apply.
8. Run **Verify installation**. Its connectivity report lists the remaining workflow tests; it never treats an untested model task as ready.

On Windows x64, open `Start-Chief-Windows.cmd`, respect the PowerShell policy, and finish any WSL/reboot prompts. The same wizard applies.

Private state: `%LOCALAPPDATA%/ChiefSetup/LocalPilot` on Windows; `~/Library/Application Support/ChiefSetup/LocalPilot` on Mac. For a pilot independent of an earlier extracted build, set an absolute `CHIEF_SETUP_HOME` before launching. Existing installations remain bound to their original extracted folder. Never copy the developer's live profiles, secrets, databases or memory connection.

## Test the complete workflow

1. Ask the operator to create a synthetic draft in its own working folder, read it back, attach it and register the task result. Confirm the artifact opens.
2. Give the coordinator a small internal draft task requiring a selected specialist. Verify the returned result. Configure model/tool/team access explicitly in Chief where required.
3. In Chief's Routines UI, create a 15-minute synthetic draft/check routine and use **Run now** once. Keep external writes out of the first test. All background descendants share one root, 20 provider requests and 10 minutes of active work; these are not a currency cap.
4. Decline a meaningful approval and confirm nothing executes. The active timer pauses only when all live descendants are waiting on real cards. Expired cards cannot execute. If another root owns the active slot, retry the still-valid card after that workflow finishes.
5. Test Stop during delegated work: descendants must stop without restarting the root. After interruption/restart, review possible effects before explicitly re-enabling the routine. Never blindly replay an uncertain external effect.
6. Sign in as another synthetic member. Its profile/folder must differ. Repeated import/sign-in must add no duplicates or reset edits. Removing a member must revoke paired access; its unattended work stops within the last verified lease's 60 seconds.
7. Test restart/login, sleep/wake and Docker outage. Firings over 30 minutes late are skipped. Docker Desktop must also start at login; a sleeping or signed-out machine cannot work.
8. Keep `verification.json`, `state.json`, personal `background-work.json` and relevant logs as evidence. Redact credentials and customer content before sharing. Never transfer pairing credentials or private keys.

Retained workspace binaries are Linux amd64; Apple Silicon uses Docker emulation. Native desktop packaging is a separate step on its own OS; Mac builds need Apple's Command Line Tools. Signing keys are not included. Meeting/capture services are outside this base test. See `app/installer/BUILD-REPORT.md` and `app/installer/VERIFICATION.json` for implementation and evidence.
