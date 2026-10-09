import { useEffect, useState } from "react";
import { ArrowUpRight, RefreshCw, Users } from "lucide-react";
import { api } from "@/state/store";

export interface SharedWorkspaceStatus {
  enabled: boolean;
  available: boolean;
  url?: string;
  name: "Chief shared workspace";
  message?: string;
}

/** A separate local hostname keeps scripts and host-scoped cookies away from
 * the Chief host. Neither the caller's URL nor any token is forwarded. */
export function sharedWorkspaceUrl(value: unknown, chiefOrigin: string): string | null {
  if (typeof value !== "string" || !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?(?:\/[^?#\\]*)?$/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.hostname === new URL(chiefOrigin).hostname) return null;
    return url.href;
  } catch { return null; }
}

export function sharedWorkspacePermissions(url: string, chiefOrigin: string): string {
  const validated = sharedWorkspaceUrl(url, chiefOrigin);
  const allowed = validated ? new URL(validated).origin : "'none'";
  return [
    ...["camera", "microphone", "display-capture", "local-network", "loopback-network"].map(feature => `${feature} ${allowed}`),
    ...["clipboard-read", "clipboard-write", "geolocation"].map(feature => `${feature} 'none'`),
  ].join("; ");
}

const linkClass = "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-hairline/60 bg-panel px-3 py-2 text-[12px] font-medium text-ink hover:bg-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function SharedWorkspaceSurface({ status, error, loading, origin, onRetry }: {
  status: SharedWorkspaceStatus | null;
  error: string;
  loading: boolean;
  origin: string;
  onRetry: () => void;
}) {
  const url = status?.enabled === true && status.available === true ? sharedWorkspaceUrl(status.url, origin) : null;
  const invalidUrl = status?.enabled === true && status.available === true && !url;
  const explanation = error || (invalidUrl ? "The organization workspace needs a separate local hostname to keep your sign-in private." : status?.message) ||
    (status?.enabled ? "Your organization workspace is not responding. Try connecting again shortly." : "Your organization workspace has not been enabled yet.");

  return <main className="flex h-dvh min-h-0 flex-col bg-app text-ink">
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-hairline/50 bg-panel px-4 py-3 sm:px-6">
      <div className="flex items-center gap-3">
        <img src="/brand/chief-avatar-ink.svg" alt="C.H.I.E.F." className="size-10 rounded-lg" />
        <div><h1 className="text-[15px] font-semibold">Shared workspace</h1><p className="text-[11px] text-ink-secondary">C.H.I.E.F. Executive Suite</p></div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <a className={linkClass} href="/" target="chief-personal-workspace" rel="noopener noreferrer">Open personal workspace<ArrowUpRight size={14} /></a>
        {url && <a className={linkClass} href={url} target="chief-retained-workspace" rel="noopener noreferrer">Open shared workspace directly<ArrowUpRight size={14} /></a>}
        <button className={linkClass} type="button" disabled={loading} onClick={onRetry}><RefreshCw size={14} />Retry connection</button>
      </div>
    </header>
    {url ? <>
      <p className="shrink-0 border-b border-hairline/40 px-4 py-2 text-[11px] text-ink-secondary sm:px-6">Your organization workspace uses its own sign-in. Your personal agents remain in their own window. Camera and microphone stay off until you turn them on. Sharing your screen requires an explicit action and browser permission.</p>
      <iframe
        key={url}
        src={url}
        title="Chief organization workspace"
        className="min-h-0 w-full flex-1 border-0 bg-white"
        sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
        allow={sharedWorkspacePermissions(url, origin)}
        referrerPolicy="no-referrer"
      />
      <p className="shrink-0 border-t border-hairline/40 px-4 py-2 text-[11px] text-ink-secondary sm:px-6">If the embedded application cannot sign in or display, use Open shared workspace directly. No session is transferred from your personal workspace.</p>
    </> : <section className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-lg rounded-2xl border border-hairline/50 bg-panel p-7">
        <Users size={25} className="mb-4 text-accent" />
        <h2 className="text-balance text-xl font-semibold">{loading ? "Connecting to your shared workspace…" : "Shared workspace is not available yet"}</h2>
        <p role={error || invalidUrl ? "alert" : "status"} className="mt-3 text-pretty text-sm leading-relaxed text-ink-secondary">{loading ? "Checking your organization workspace." : explanation}</p>
        <p className="mt-3 text-pretty text-sm leading-relaxed text-ink-secondary">Your organization workspace will appear here when it is ready. Your personal agents remain available in their own window.</p>
        <div className="mt-5 flex flex-wrap gap-2"><button className={linkClass} type="button" onClick={onRetry} disabled={loading}><RefreshCw size={14} />Retry</button></div>
      </div>
    </section>}
  </main>;
}

export function SharedWorkspacePage() {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<SharedWorkspaceStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    void api<SharedWorkspaceStatus>("/api/shared-workspace", { signal: controller.signal, timeoutMs: 12_000 })
      .then(next => { if (!controller.signal.aborted) setStatus(next); })
      .catch(cause => { if (!controller.signal.aborted) { setStatus(null); setError(cause instanceof Error ? cause.message : "Could not check shared workspace availability."); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);
  return <SharedWorkspaceSurface status={status} error={error} loading={loading} origin={location.origin} onRetry={() => setAttempt(value => value + 1)} />;
}
