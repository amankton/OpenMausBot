import { useEffect, useRef, useState } from "react";
import { api, StoreProvider, useStore } from "@/state/store";
import { DesktopCapabilitiesProvider } from "./DesktopCapabilities";
import { ThreadRefsProvider } from "./ThreadRefs";
import { PluginsPanel } from "./PluginsPanel";
import { SettingsModal } from "./SettingsModal";
import { BotSettingsDialog } from "./BotSettingsDialog";

export function validChiefOwnerAdmission(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const status = value as Record<string, unknown>;
  return status.name === "Chief shared workspace" && typeof status.enabled === "boolean" && typeof status.available === "boolean";
}

/** Only the Chief host can admit this surface. The workspace iframe has no
 * account or command bridge. A failed recheck destroys the cached UI context. */
export function ChiefConnectionsHost({ onClose }: { onClose: () => void }) {
  const [admitted, setAdmitted] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    let pending: AbortController | undefined;
    const check = async () => {
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      try {
        const status = await api<unknown>("/api/shared-workspace", { signal: controller.signal, timeoutMs: 12_000 });
        if (!validChiefOwnerAdmission(status)) throw new Error("Chief owner access could not be verified.");
        if (alive && !controller.signal.aborted) { setError(""); setAdmitted(true); }
      } catch {
        if (alive && !controller.signal.aborted) { setAdmitted(false); setError("Chief owner access could not be verified. Close this window and try again."); }
      }
    };
    void check();
    const focus = () => { void check(); };
    window.addEventListener("focus", focus);
    const timer = setInterval(focus, 30_000);
    return () => { alive = false; pending?.abort(); clearInterval(timer); window.removeEventListener("focus", focus); };
  }, []);
  return admitted ? <ChiefConnectionsSession onClose={onClose} /> : <ConnectionWait error={error} onClose={onClose} />;
}

function ConnectionWait({ error = "", onClose }: { error?: string; onClose: () => void }) {
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-6" role="dialog" aria-modal="true" aria-label="Chief Apps / Connections">
    <div className="rounded-xl border border-hairline bg-panel p-6 text-ink">
      <p role={error ? "alert" : "status"}>{error || "Loading Chief connections…"}</p>
      <button type="button" className="mt-4 rounded-lg bg-control px-4 py-2" onClick={onClose}>Close</button>
    </div>
  </div>;
}

function ChiefConnectionsSession({ onClose }: { onClose: () => void }) {
  const [ready, setReady] = useState(false);
  return <DesktopCapabilitiesProvider><StoreProvider onSnapshotReady={() => setReady(true)}><ThreadRefsProvider>
    <ChiefConnectionModals ready={ready} onClose={onClose} />
  </ThreadRefsProvider></StoreProvider></DesktopCapabilitiesProvider>;
}

export function ChiefConnectionModals({ ready, onClose }: { ready: boolean; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const opened = useRef(false);
  const visibleOnce = useRef(false);
  const bot = state.bots.find(candidate => candidate.id === state.selectedId);
  useEffect(() => {
    if (!ready) return;
    if (!opened.current) {
      opened.current = true;
      dispatch({ type: "togglePlugins", open: true, surface: "apps" });
      return;
    }
    if (state.pluginsOpen || state.appSettingsOpen || (state.settingsOpen && bot)) visibleOnce.current = true;
    else if (visibleOnce.current) onClose();
  }, [ready, state.pluginsOpen, state.appSettingsOpen, state.settingsOpen, bot, dispatch, onClose]);
  if (!ready) return <ConnectionWait onClose={onClose} />;
  return <div className="fixed inset-0 z-[100] bg-black/30">
    {state.pluginsOpen && <PluginsPanel refreshOnOpen />}
    {state.appSettingsOpen && <SettingsModal />}
    {state.settingsOpen && bot && <BotSettingsDialog key={bot.id} bot={bot} overlay />}
  </div>;
}
