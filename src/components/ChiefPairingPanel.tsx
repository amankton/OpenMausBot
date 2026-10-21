import { useEffect, useId, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { api } from "@/state/store";

interface Connection { id: string; workspace: string; account: string; keyFingerprint: string; bots: string[]; scopes?: string[]; state: string; expiresAt: string }
interface PairingStatus { enabled: boolean; bots: Array<{ id: string; name: string }>; connections: Connection[]; error?: string }
const button = "rounded-md border border-hairline px-3 py-2 text-xs hover:bg-control disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent";

export function ChiefPairingPanel() {
  const [status, setStatus] = useState<PairingStatus | null>(null);
  const [invitation, setInvitation] = useState("");
  const [bots, setBots] = useState<string[]>([]);
  const [trackerWrite, setTrackerWrite] = useState(false);
  const [query, setQuery] = useState("");
  const searchId = useId();
  const searchInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const load = async () => setStatus(await api<PairingStatus>("/api/chief-pairing"));
  useEffect(() => { const controller = new AbortController();
    void api<PairingStatus>("/api/chief-pairing", { signal: controller.signal }).then(setStatus).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load connections.");
    }); return () => controller.abort();
  }, []);
  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setError(""); setMessage("");
    try { await action(); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Connection could not be updated."); }
    finally { setBusy(false); }
  };
  const matches = status?.bots.filter(bot => bot.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) ?? [];
  const selectedAgents = status?.bots.filter(bot => bots.includes(bot.id)) ?? [];
  const currentConnections = status?.connections.filter(connection => connection.state !== "revoked" && Date.parse(connection.expiresAt) > Date.now()) ?? [];
  const previousConnections = status?.connections.filter(connection => !currentConnections.includes(connection)) ?? [];
  return <section aria-label="Connect personal Chief" className="space-y-3 px-3 py-3 text-xs">
    <p className="text-ink-secondary">Create an invitation in the workspace’s Integrations page, then paste it here. Approve the matching verification code there to finish.</p>
    {status?.enabled === false && <p role="status">{status.error}</p>}
    {status?.enabled && <form className="space-y-3" onSubmit={event => { event.preventDefault(); void perform(async () => {
      let parsed: unknown;
      try { parsed = JSON.parse(invitation); } catch { throw new Error("Paste the complete invitation from the workspace."); }
      await api("/api/chief-pairing", { method: "POST", body: JSON.stringify({ invitation: parsed, bots, ...(trackerWrite ? { trackerWrite: true } : {}) }) });
      setInvitation(""); setMessage("Request sent. Compare the verification code and approve it in the workspace.");
    }); }}>
      <label className="block">Workspace invitation<textarea aria-label="Workspace invitation" value={invitation} onChange={event => setInvitation(event.target.value)} required maxLength={4096} disabled={busy} autoComplete="off" spellCheck={false}
        className="mt-1 min-h-24 w-full rounded-md border border-hairline bg-inset p-2" /></label>
      <fieldset disabled={busy}><legend className="mb-1 font-medium">Agents to connect</legend>
        <label htmlFor={searchId} className="sr-only">Search agents to connect by name</label>
        <div className="flex min-h-9 items-center gap-2 rounded-md border border-hairline bg-inset px-2 focus-within:outline-2 focus-within:outline-accent">
          <Search size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" />
          <input ref={searchInput} id={searchId} type="search" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} placeholder="Search agents by name…" autoComplete="off"
            className="min-w-0 flex-1 bg-transparent py-2 text-ink outline-none placeholder:text-ink-secondary [&::-webkit-search-cancel-button]:appearance-none" />
          {query && <button type="button" aria-label="Clear agent search" onClick={() => { setQuery(""); searchInput.current?.focus(); }} className="rounded p-1 text-ink-secondary hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"><X size={14} /></button>}
        </div>
        <p role="status" className="my-2 text-ink-secondary tabular-nums">{matches.length} {matches.length === 1 ? "agent" : "agents"} shown · {bots.length} selected</p>
        {selectedAgents.length > 0 && <div aria-label="Selected agents" className="mb-2 flex flex-wrap gap-1">
          {selectedAgents.map(bot => <button key={bot.id} type="button" aria-label={`Remove ${bot.name} from selection`} onClick={() => setBots(ids => ids.filter(id => id !== bot.id))}
            className="flex max-w-full items-center gap-1 rounded-md border border-hairline bg-control px-2 py-1 focus-visible:outline-2 focus-visible:outline-accent"><span className="truncate">{bot.name}</span><X size={12} aria-hidden="true" className="shrink-0" /></button>)}
        </div>}
        <div className="max-h-48 overflow-y-auto">
          {matches.map(bot => <label key={bot.id} className="flex items-center gap-2 py-1"><input type="checkbox" checked={bots.includes(bot.id)} onChange={event => setBots(ids => event.target.checked ? [...ids, bot.id] : ids.filter(id => id !== bot.id))} /><span className="break-words">{bot.name}</span></label>)}
        </div>
        {status.bots.length > 0 && !matches.length && <p>No matching agents. Try another name or clear your search.</p>}
        {!status.bots.length && <p>Create a personal agent before pairing.</p>}
      </fieldset>
      <label className="flex items-center gap-2"><input type="checkbox" checked={trackerWrite} onChange={event => setTrackerWrite(event.target.checked)} disabled={busy} />Allow selected agents to read Tracker projects/issues and create or update issues as this workspace member</label>
      <p className="text-ink-secondary">Access still requires matching workspace approval and current membership. Existing connections are not upgraded. This does not start work.</p>
      <button className={`${button} border-accent bg-accent font-medium text-white hover:bg-accent/90`} disabled={busy || bots.length === 0} type="submit">{busy ? "Connecting…" : "Request connection"}</button>
    </form>}
    {error && <p role="alert" className="text-danger">{error}</p>}
    {message && <p role="status">{message}</p>}
    {currentConnections.map(connection => <article key={connection.id} className="space-y-2 border-t border-hairline pt-3">
      <p className={`font-medium ${connection.state === "active" ? "text-success" : "text-ink"}`}>{connection.state === "pending" ? "Next: approve in the workspace" : "Connected · last verified"}</p>
      <p>{connection.scopes?.includes("tracker:write") ? "Tracker: read projects and issues, create issues, update titles/status." : connection.scopes?.includes("tracker:read") ? "Tracker: read only." : "Workspace connection only · no Tracker access."}</p>
      <p>Verification code <code className="block break-all select-all">{connection.keyFingerprint}</code></p>
      <p className="break-all text-ink-secondary">Workspace: {connection.workspace}</p>
      <p className="text-ink-secondary">Expires {new Date(connection.expiresAt).toLocaleString()}</p>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} className={button} onClick={() => void perform(async () => {
        await api(`/api/chief-pairing/${connection.id}/check`, { method: "POST" }); setMessage("The workspace verified this connection now.");
      })}>Check connection</button>
      </div><details><summary className="cursor-pointer py-2 text-ink-secondary focus-visible:outline-2 focus-visible:outline-accent">Manage local connection</summary><p className="mb-2 text-ink-secondary">Remove this connection from Chief. You can reconnect later.</p><button type="button" disabled={busy} className={`${button} border-danger text-danger`} onClick={() => void perform(async () => {
        await api(`/api/chief-pairing/${connection.id}`, { method: "DELETE" }); setMessage("Local connection credentials removed. You can also revoke its record in the workspace.");
      })}>Forget locally</button></details>
    </article>)}
    {previousConnections.length > 0 && <details><summary className="cursor-pointer py-2 text-ink-secondary focus-visible:outline-2 focus-visible:outline-accent">Previous connections ({previousConnections.length})</summary>
      {previousConnections.map(connection => <article key={connection.id} className="my-2 space-y-2 text-ink-secondary"><p>{connection.state === "revoked" ? "Revoked" : "Expired"} · no access · {new Date(connection.expiresAt).toLocaleString()}</p>
        <button type="button" disabled={busy} className={button} onClick={() => void perform(async () => {
          await api(`/api/chief-pairing/${connection.id}/check`, { method: "POST" }); setMessage("The workspace verified this connection now.");
        })}>Check connection</button>
        <button type="button" disabled={busy} className={`${button} border-danger text-danger`} onClick={() => void perform(async () => {
          await api(`/api/chief-pairing/${connection.id}`, { method: "DELETE" }); setMessage("Old local connection credentials removed.");
        })}>Forget locally</button>
      </article>)}
    </details>}
  </section>;
}
