# Chief Mac build over TeamViewer

This is a source transfer for building Chief on your Mac, not a Mac installer. It contains application source and legal notices, not your agents, chats, keys, or Exec Workspace data. The restricted enterprise directory is omitted.

1. Transfer `Chief-Mac-Source-0.1.96.zip` using TeamViewer file transfer. Extract it somewhere private, such as Downloads. Do not copy the live Chief data directory.
2. Open Terminal on the Mac. Type `cd ` (including the space), drag the extracted `chief-executive-suite` folder into Terminal, and press Return.
3. Run `bash scripts/build-chief-mac.sh`. It checks prerequisites before building. Node.js 24+, pnpm 10.33.0, and Apple's Command Line Tools are required. If missing, use the instructions it prints and rerun it.
4. The script uses the existing desktop build to produce arm64 (Apple Silicon) and x64 (Intel) DMG/ZIP artifacts in `release`. No shared-workspace server is required.

## Signing

The source does not contain signing keys. Electron-builder can use a Developer ID Application certificate already installed in the Mac's keychain, or securely configured `CSC_LINK` and `CSC_KEY_PASSWORD`. Never paste credentials into chat or put them in this source directory.

After signing, notarize the final DMG with a locally stored Apple notarytool keychain profile:

```sh
xcrun notarytool submit release/Chief-Executive-Suite-0.1.96-arm64.dmg --keychain-profile ChiefNotary --wait
xcrun stapler staple release/Chief-Executive-Suite-0.1.96-arm64.dmg
spctl --assess --type open --context context:primary-signature --verbose release/Chief-Executive-Suite-0.1.96-arm64.dmg
```

The `ChiefNotary` profile must first be configured locally with your Apple Developer account. Repeat for the Intel DMG. If there is no Developer ID certificate/account, report that limitation; do not disable Gatekeeper as a release procedure. Automatic updates remain disabled.

## Native acceptance

- Install into Applications, launch, save an isolated test profile, quit, and relaunch.
- Check Chief identity in the app, Dock, menus, installer, and About. Attribution is under Third-party notices.
- Connect a test provider and verify a task and approval prompt. Do not copy the Windows owner's credentials.
- Test microphone, Accessibility, and Screen Recording requests and denials using a test account; granting permissions is an explicit local action.
- Verify both architectures on matching hardware before claiming support for both.

Report the command output and any error without including credentials. A successful Windows build does not establish Mac acceptance.
