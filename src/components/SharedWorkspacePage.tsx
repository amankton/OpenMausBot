import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight, ChevronDown, RefreshCw, Users } from "lucide-react";
import { api } from "@/state/store";
import { ChiefPairingPanel } from "./ChiefPairingPanel";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { WORKSPACE_HELLO, WORKSPACE_READY, WORKSPACE_SLOT, workspaceSlot, type WorkspaceSlot } from "@/lib/workspace-shell";

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
const menuLinkClass = "flex min-h-9 w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs font-medium text-ink hover:bg-control focus-visible:outline-2 focus-visible:outline-accent";

export function SharedWorkspaceSurface({ status, error, loading, origin, onRetry }: {
  status: SharedWorkspaceStatus | null;
  error: string;
  loading: boolean;
  origin: string;
  onRetry: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [slot, setSlot] = useState<WorkspaceSlot | null>(null);
  usePopoverDismiss(open, menu, () => { setOpen(false); trigger.current?.focus(); });
  const url = status?.enabled === true && status.available === true ? sharedWorkspaceUrl(status.url, origin) : null;
  useEffect(() => {
    setSlot(null);
    if (!url) return;
    const targetOrigin = new URL(url).origin;
    const connect = () => frame.current?.contentWindow?.postMessage({ type: WORKSPACE_HELLO }, targetOrigin);
    const receive = (event: MessageEvent) => {
      if (event.origin !== targetOrigin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === WORKSPACE_READY) connect();
      if (event.data?.type === WORKSPACE_SLOT) {
        const next = workspaceSlot(event.data.rect, window.innerWidth);
        if (next) setSlot(next);
      }
    };
    window.addEventListener("message", receive);
    connect();
    return () => window.removeEventListener("message", receive);
  }, [url]);
  useEffect(() => {
    if (!open) return;
    const blur = () => { if (document.activeElement === frame.current) setOpen(false); };
    window.addEventListener("blur", blur);
    return () => window.removeEventListener("blur", blur);
  }, [open]);
  const invalidUrl = status?.enabled === true && status.available === true && !url;
  const explanation = error || (invalidUrl ? "The organization workspace needs a separate local hostname to keep your sign-in private." : status?.message) ||
    (status?.enabled ? "Your organization workspace is not responding. Try connecting again shortly." : "Your organization workspace has not been enabled yet.");

  return <main className="relative flex h-dvh min-h-0 flex-col overflow-hidden bg-app text-ink">
    <h1 className="sr-only">Chief shared workspace</h1>
    <header aria-label="Chief workspace controls" className={slot ? "absolute z-50" : "relative z-50 flex h-11 shrink-0 items-center border-b border-hairline/50 bg-panel px-4"}
      style={slot ? { left: slot.x, top: slot.y, width: slot.width, height: slot.height } : undefined}>
      <div ref={menu} className="relative h-full">
        <button ref={trigger} type="button" aria-label="Chief workspace menu" aria-expanded={open} aria-controls={menuId}
          onClick={() => setOpen(value => !value)} className="flex h-full min-h-8 w-full items-center gap-2 rounded-md bg-panel px-1 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-accent">
          <img src="/brand/chief-avatar-ink.svg" alt="" className="size-6" />Chief<ChevronDown size={13} aria-hidden="true" />
        </button>
        <nav id={menuId} aria-label="Workspace actions" hidden={!open} className="absolute left-0 top-full mt-1 max-h-[calc(100dvh-4rem)] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-hairline bg-panel p-2 shadow-lg">
          <div className="px-3 py-2"><p className="text-sm font-semibold">Chief Executive Suite</p><p className="text-xs text-ink-secondary">Shared workspace</p></div>
          <a className={menuLinkClass} href="/" onClick={() => setOpen(false)}>Open personal workspace<ArrowUpRight size={14} /></a>
          <button type="button" className={menuLinkClass} aria-expanded={pairingOpen} onClick={() => setPairingOpen(value => !value)}>Connect personal Chief<ChevronDown size={14} /></button>
          {pairingOpen && <ChiefPairingPanel />}
          {url && <a className={menuLinkClass} href={url} rel="noreferrer" onClick={() => setOpen(false)}>Open shared workspace directly<ArrowUpRight size={14} /></a>}
          <button className={`${linkClass} w-full justify-start border-0`} type="button" disabled={loading} onClick={onRetry}><RefreshCw size={14} />{loading ? "Checking connection…" : "Retry connection"}</button>
          <p className="mt-2 border-t border-hairline/50 px-3 py-3 text-xs leading-relaxed text-ink-secondary">Your shared workspace has its own sign-in. Camera and microphone stay off until you turn them on. Screen sharing requires your action and browser permission.</p>
        </nav>
      </div>
    </header>
    {url ? <iframe
        ref={frame}
        key={url}
        src={url}
        title="Chief organization workspace"
        className="min-h-0 w-full flex-1 border-0 bg-white"
        sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
        allow={sharedWorkspacePermissions(url, origin)}
        referrerPolicy="no-referrer"
        onLoad={() => { setSlot(null); frame.current?.contentWindow?.postMessage({ type: WORKSPACE_HELLO }, new URL(url).origin); }}
      />
    : <section className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
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
