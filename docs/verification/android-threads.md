# Android thread navigation

Use the test suites below, which create synthetic fleets and disposable
loopback servers. Never pair a verification build to the user's live desktop
or send test messages to their bots.

## Build and regression checks

From `android/`, with JDK 17 and the Android SDK configured:

```sh
./gradlew :core:test :app:testDebugUnitTest :app:assemblePreview
```

Core tests cover saved folder order, title/folder search, legacy computers,
orphaned folders, closed/routine filtering, unread counts, per-thread runtime,
history loading after an SSE tail, and exact notification/search targeting.

`BotThreadTreeTest` and `AndroidThreadNavigationTest` drive real Compose
controls in Robolectric. Their data and HTTP responses are synthetic. They
check expanding folders, opening the exact thread without changing the
desktop selection, switching drafts from the header, status updates, and
failed create/rename/delete actions. Deletion requires confirmation; errors
keep the form and its entered text available for retry.

The roster reopening regression selects a sibling thread through the real
header picker, returns home, and taps the bot row again. It must reopen the
chosen thread without a server task-switch request. `ChatPreferencesTest`
checks that a fresh store restores the choice, isolates it by computer and bot,
falls back after deletion, and leaves rooms on their shared selection.

The reconnect regression keeps a nonactive thread open while a second,
non-resumable `Hello` hydrates the desktop-active thread. Its history must be
fetched again and rendered without navigation or changing the desktop's active
thread. This uses real Compose, Session, and HTTP history reads against a
loopback server; the SSE frames are scripted, not a real-device network test.

```sh
./gradlew :app:testDebugUnitTest --tests '*AndroidThreadNavigationTest*'
```

`ChatDraftHolderTest` covers separate text/attachment state, late upload
completion after switching away and back, and clearing an owner's drafts
when leaving the chat. Dictated text and attachments remain memory-only.

From the repository root, exercise the existing server contract:

```sh
pnpm exec vitest run server/paired-thread-targets-api.test.ts server/independent-threads-api.test.ts server/bot-projects-api.test.ts server/thread-capacity-api.test.ts
```

These launch isolated fake-provider fixtures. No server routes or pairing
protocol changes are needed for the Android UI.

## Compact home list

The home list has two densities, chosen per device in **Settings → Threads
list → List density**. Compact is the default: one line per bot and group, a
crown after a Chief of Staff, a hand while a bot waits on you and a spinner in
place of the time while it works. Only a bot with two or more threads shows
**› N**, which lists them under the bot's name and ends with **New thread**;
a long press on any bot offers **New thread** and **Manage threads**.
Comfortable is the earlier layout and keeps its own logic. The compact rules
mirror the iPhone companion's compact list and are tested in `:core`:

```sh
./gradlew :core:test --tests '*RosterDensityTest' \
  :app:testDebugUnitTest --tests '*RosterScreenTest' --tests '*ChatPreferencesTest'
```

`RosterScreenTest` mounts the real roster and Settings over a real Session,
`RosterFixture` (a synthetic fleet with every state the list draws, the
counterpart of the iPhone companion's roster preview fleet) and a loopback
server, with native graphics so text is measured for real. It checks:

- compact is the default, one line per bot, with the crown and no Threads row
  for a single-thread bot, and the Chief of Staff row set apart from Needs
  attention;
- the hand and the spinner on bot and group rows;
- a single-thread bot's long press and TalkBack action create a thread, with
  a spinner on the row until it opens;
- **› 3** lists Pepper's threads in line with its name, without the routine
  run, with a pin on the pinned one and a "Threads" heading over the unfiled
  one, and ends with **New thread**; closing the folder or tapping **› 3** again
  closes what it should; a list whose count goes away stays closed when the
  threads come back;
- search, including a single-thread bot's match; groups and the **+** that
  makes one; "No bots yet" never drawn over group rows;
- the role gives way before the name; at twice the text size names wrap
  between whole words with automatic hyphenation off, including a two-word
  name on a narrow phone;
- the setting switches back to comfortable and is saved; comfortable keeps its
  Threads tree;
- in both densities at twice the text size, the first title starts under the
  header and the last row scrolls fully clear of the floating bottom bar.

Two things these checks cannot settle: this host has no hyphenation patterns,
so only a device shows that no hyphen is added to a wrapped name, and TalkBack
speech needs a real screen reader.

## Installable preview

The output is `android/app/build/outputs/apk/preview/app-preview.apk`. This is
a debug-signed **OpenMausBot Preview** with its own application ID, so it does
not overwrite the released app or inherit its saved connections. Pair from
inside Preview using the scanner or manual form. The preview intentionally
does not register system share or pairing-link entrypoints.

This preview is built from main, not the separate Android 1.2.0 release
branch. That branch's call-mode screens are not on main; this is a thread
feature preview, not a replacement production upgrade.

For manual testing, launch the disposable fixture from
[threads.md](threads.md), enable Phone only on that fixture, and pair only a
test emulator/device to it. Check:

1. Home → Pepper's **› 3** (compact) or its Threads row (comfortable) → Email →
   open each named conversation.
2. Search a folder or thread name, then clear it; disclosure state survives.
3. Type in one thread, switch through its header, type in another and return.
   Text and attachments must not move between conversations.
4. Start independent fake-provider turns; each row and Updates entry shows
   its own Working/Queued/Unread state. Stop only the selected conversation.
5. Create, rename and confirm deletion. Disconnect the fixture and retry an
   action: show an error instead of silently closing the sheet.
6. Switch a group thread; groups retain their shared desktop selection.

Folder creation/reordering remains desktop-only. These checks do not establish
real-device HTTPS/Tailscale pairing, reconnects, dictation or uploads. Do not
claim those flows tested from the build or Robolectric suite alone.

## Recorded local pass — 2026-09-13

- 526 core tests and 890 app tests passed, including ten Compose thread cases.
- 19 isolated server thread/folder/capacity tests passed.
- Preview APK assembled successfully; its v2 signature and separate preview
  application ID were verified with the Android SDK tools.
- No physical-device installation, real pairing or live-provider test was run.

## Last opened thread regression — 2026-09-20 UTC (2026-09-21 IST)

The new real Compose regression failed before the fix: returning from the
chosen second thread to the roster and tapping the bot reopened the first
thread. After persisting the phone-local choice, the same regression passed
without any task-switch POST or change to the server-selected thread.

- 549 core tests and 919 app tests passed, including fresh-store restoration,
  connection/bot isolation, deleted-thread fallback, and room selection.
- Preview APK assembled and its v2 signature verified.
- Fixtures remained synthetic and confined to disposable loopback HTTP;
  no real pairing, device installation, or live-provider test was performed.

## Compact home list — 2026-09-27

- The 24 `RosterDensityTest` cases did not compile before the rules existed.
  On the unfixed layout at twice the text size, the clearance check failed:
  the last row ended at 818 dp, under the bottom bar's top at 804 dp. It passes
  with the measured inset. Ten of the twelve `RosterScreenTest` checks failed
  on the roster before the compact list existed.
- 621 core tests and 971 app tests passed (`cleanTest :core:test
  :app:testDebugUnitTest`), with no failures or skips. `:app:assembleDebug` and
  `:app:assemblePreview` succeeded; the preview APK's v2 signature and its
  `com.openmausbot.companion.preview` application ID were verified.
- Fixtures were synthetic and confined to a loopback server. No emulator,
  device installation, pairing or live-provider test was performed.

## Compact home list review fixes — 2026-09-27

- The reworked `RosterDensityTest` did not compile before the compact-only
  rules existed. On the unfixed screen, 8 of the 20 `RosterScreenTest` checks
  failed: hyphenation, the unfiled label and the pin, the list that reopened by
  itself, progress while a thread is made, the Chief of Staff spacing, and
  "No bots yet" over group rows. The other 12 pin behaviour that already held.
- 627 core tests and 979 app tests passed (`cleanTest :core:test
  :app:testDebugUnitTest`), with no failures or skips. `:app:assembleDebug` and
  `:app:assemblePreview` succeeded; the preview APK's v2 signature and its
  application ID were verified.
- Fixtures were synthetic and confined to a loopback server. No emulator,
  device installation, pairing or live-provider test was performed.

## October 23, 2026 — collapsible Android teams

`RosterScreen` now renders each sidebar team's heading as a full-width button
with a down/right chevron, a 48dp minimum touch target, and a localized
expanded/collapsed accessibility state. Folding a team removes its chief,
channels and agents from the lazy list in both density modes. Choices are
saved across rotation/navigation and scoped to the connected computer.
Search continues through the complete roster, independent of team folds.

Two `RosterScreenTest` regressions use the existing synthetic fleet and
loopback fixture to cover folding, restoring and searching a folded team in
compact and comfortable modes. No live pairing or conversations were changed.

Verification completed: `:app:testDebugUnitTest --tests '*RosterScreenTest*'
--tests '*ChatPreferencesTest*' :app:assemblePreview` passed (35 tests, zero
failures). The first new test attempts were corrected to scroll lazy team
headings above the floating bar and distinguish search result text from the
search input. The UI checks also leave and return to the roster while folded;
a preferences test confirms persistence, reopening and computer isolation.

Portable Microsoft JDK 17 and Android command-line tools were prepared under
`C:/Users/amank/AppData/Local/ChiefBuildTools`. The owner explicitly approved
accepting Google's Android SDK license and finishing the build on October 23.
No global PATH or JAVA_HOME changes were made. SDK/Gradle packages are cached
locally; the Android SDK path is set through ANDROID_HOME for each build.

`apksigner verify --verbose` passed. Package identity is
`com.openmausbot.companion.preview`, launcher label `MausBot Preview`, min SDK
26 and target SDK 37. It installs beside the released app with separate pairing
and preferences. No replacement signing key for the existing release is present.

Artifact: `release/Chief-Android-Team-Collapse-Preview-2026-10-23.apk`.
SHA-256: `58c4675883e41b19d15c82c29c0af6b14b8948f95c6f5324caf418e3403d1fd4`.
`git diff --check` passed. Physical-phone installation and on-device acceptance
remain pending; automated checks used only synthetic fixtures.
Delivery: two Taildrop attempts to the owner's aj-s23-ultra were stopped after the receiver did not respond. Tailscale ping succeeded, but APK delivery is not confirmed. No USB Android device was attached. The APK remains available at the release path above.

October 23 delivery retry: phone online and Tailscale ping successful, but Taildrop still did not respond. Started an owner-only temporary APK HTTP download listener on this host's Tailscale address port 18913, restricted to the owner's S23 and self for verification, serving only the preview APK. HEAD returned 200 with the expected APK length/type. Server expires after 30 minutes. Phone download/install remains unverified.

October 23 delivery confirmed: after the owner selected a Taildrop receive folder on the S23, tailscale file cp completed successfully with a sent receipt for Chief-Android-Team-Collapse-Preview-2026-10-23.apk. Installation and physical-phone UI acceptance remain pending.

October 23 upstream proposal: at the owner's explicit request, posted https://github.com/milind-soni/OpenMausBot/issues/3401 (Contribution proposal: collapsible teams in Android and iOS companions) using the owner's authenticated GitHub CLI after the connector returned 403. Owner also confirmed the installed Android preview paired successfully and the chevron is present and working. No PR submitted; iOS implementation remains pending.
