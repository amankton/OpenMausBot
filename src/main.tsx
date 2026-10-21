import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { sharedWorkspaceAvailable } from "./lib/release-profile";
import {
  BROWSER_SIGN_IN_FAILED, previewBrowserSignIn, readSessionState, SERVICE_TRUST_REASON, takeBrowserSignInFromLocation, takePairingCodeFromLocation, takeInvitedEmailFromLocation,
} from "./lib/session";
import { bootstrapBrand } from "./lib/brand";
import { applySkin, readSkin } from "./lib/skins";
import { applyFont, readFont } from "./lib/fonts";
import { settleAdvancedModeDefault } from "./lib/interface-mode";
import "katex/dist/katex.min.css";
import "./styles.css";
import "./crewframe-theme.css";
import "./lib/crewframe-theme";

// Before the first paint, not inside a component: stamping the skin during
// render would show one frame of the default palette first. A neutral loading
// shell appears while brand/session checks run; the chosen page waits for the
// brand so a white-labelled deployment never flashes the default name.
// Simple vs Advanced is decided first: applySkin below writes omb-skin, which
// would otherwise make every fresh install look like an existing one.
settleAdvancedModeDefault();
applySkin(readSkin());
applyFont(readFont());

/** A pairing link lands on /pair. A remote browser without a session lands
 * there too, because every API call would otherwise fail with "pair this
 * device"; on the owner's own machine the server trusts loopback and this
 * check is a single fast request. */
async function chooseRoot(): Promise<React.ReactNode> {
  // Retire the separate office surface without forwarding its old session links.
  if (location.pathname === "/office" || location.pathname === "/office/") {
    history.replaceState(null, "", "/workspace");
  }
  if (location.pathname === "/pair") {
    const { PairPage } = await import("./pair/PairPage");
    // The OMB Cloud page's "Use in your browser": whose Cloud it is, then one Continue.
    const signIn = takeBrowserSignInFromLocation();
    if (signIn) {
      const { BrowserSignInPage } = await import("./pair/BrowserSignInPage");
      const preview = await previewBrowserSignIn(signIn);
      return preview ? <BrowserSignInPage credential={signIn} owner={preview.owner} /> : <PairPage initialCode={null} reason={BROWSER_SIGN_IN_FAILED} />;
    }
    return <PairPage initialCode={takePairingCodeFromLocation()} initialEmail={takeInvitedEmailFromLocation()} />;
  }
  const session = await readSessionState();
  if (session.kind === "unreachable") return <main className="flex min-h-dvh items-center justify-center bg-app p-6 text-ink">
    <section className="w-full max-w-lg rounded-2xl border border-hairline/50 bg-panel p-7">
      <h1 className="text-xl font-semibold">Could not connect to Chief</h1>
      <p role="alert" className="mt-3 text-sm text-ink-secondary">{session.error}</p>
      <button type="button" className="mt-5 rounded-lg border border-hairline px-3 py-2" onClick={() => location.reload()}>Retry connection</button>
    </section>
  </main>;
  if (session.kind === "unauthenticated") {
    const { PairPage } = await import("./pair/PairPage");
    return <PairPage initialCode={null} reason={session.error} />;
  }
  // A service-trust server answers this machine's requests without a session
  // but refuses to let it manage anything: sign in first, as a remote browser would.
  if (session.kind === "loopback" && session.trust === "service") {
    const { PairPage } = await import("./pair/PairPage");
    return <PairPage initialCode={null} reason={SERVICE_TRUST_REASON} />;
  }
  if (sharedWorkspaceAvailable && (location.pathname === "/workspace" || location.pathname === "/workspace/")) {
    const { SharedWorkspacePage } = await import("./components/SharedWorkspacePage");
    return <SharedWorkspacePage />;
  }
  if (location.pathname === "/desktop-viewer") {
    const { DesktopViewer } = await import("./components/DesktopViewer");
    return <DesktopViewer />;
  }
  const { default: App } = await import("./App");
  return <App />;
}

const root = createRoot(document.getElementById("root")!);
root.render(<main className="flex min-h-dvh items-center justify-center bg-app p-6 text-ink">
  <p role="status">Connecting to your workspace…</p>
</main>);
void Promise.all([bootstrapBrand(), chooseRoot()]).then(([, page]) => {
  root.render(<StrictMode>{page}</StrictMode>);
}).catch(() => {
  root.render(<main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-app p-6 text-ink">
    <p role="alert">Could not load your workspace. Try connecting again.</p>
    <button type="button" className="rounded-lg border border-hairline px-3 py-2" onClick={() => location.reload()}>Retry connection</button>
  </main>);
});
