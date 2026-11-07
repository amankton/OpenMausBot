import { useEffect, useId, useRef, useState } from "react";
import { CONNECTOR_TRUST_CATALOG_FINGERPRINT, type ConnectorTrustGrant, type ConnectorTrustOperation, type ConnectorTrustOverview, type ConnectorTrustPolicy } from "../../shared/connector-trust";
import { readConnectorTrust, revokeConnectorTrust, saveConnectorTrust } from "@/lib/connector-trust";

const button = "rounded-md border border-hairline px-3 py-2 text-sm hover:bg-control disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent";
const canonical = (grants: ConnectorTrustGrant[]) => JSON.stringify(grants.map(grant => ({ accountId: grant.accountId, identity: grant.identity.toLowerCase(), operations: [...grant.operations].sort() })).sort((a, b) => a.accountId.localeCompare(b.accountId)));
const draftFor = (policy: ConnectorTrustPolicy | null): ConnectorTrustGrant[] => policy?.state === "active" ? policy.grants.map(grant => ({ accountId: grant.accountId, identity: grant.identity, operations: [...grant.operations] })) : [];
const errorText = (error: unknown) => error instanceof Error ? error.message : "Could not update bounded trust.";
const time = (at: number) => new Date(at).toLocaleString();
type StoredGrant = ConnectorTrustPolicy["grants"][number];
type Review = { kind: "save"; botId: string; botName: string; expectedRevision: number; catalogFingerprint: typeof CONNECTOR_TRUST_CATALOG_FINGERPRINT; grants: ConnectorTrustGrant[]; previous: StoredGrant[] } | { kind: "revoke"; botId: string; botName: string; expectedRevision: number; catalogFingerprint: string; grants: StoredGrant[] };

/** Account-scoped protocol trust is separate from the existing model, app,
 * exact-tool and approval settings. Changes use their own revisioned API. */
export function ConnectorTrustPanel({ botId, botName }: { botId: string; botName: string }) {
  const [snapshot, setSnapshot] = useState<ConnectorTrustOverview | null>(null);
  const [grants, setGrants] = useState<ConnectorTrustGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [mustRefresh, setMustRefresh] = useState(false);
  const sequence = useRef(0);
  const requestPending = useRef(false);
  const reviewCancel = useRef<HTMLButtonElement>(null);
  const prefix = useId();
  useEffect(() => {
    const controller = new AbortController();
    const current = ++sequence.current;
    setSnapshot(null); setGrants([]); setReview(null); setLoading(true); setError(""); setMessage(""); setMustRefresh(false); setPending(false); requestPending.current = false;
    void readConnectorTrust(botId, controller.signal).then(value => {
      if (current !== sequence.current || controller.signal.aborted) return;
      setSnapshot(value); setGrants(draftFor(value.policy));
    }).catch(cause => { if (!controller.signal.aborted && current === sequence.current) setError(errorText(cause)); })
      .finally(() => { if (current === sequence.current && !controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); sequence.current++; };
  }, [botId]);
  useEffect(() => { if (review) reviewCancel.current?.focus(); }, [review]);

  const refresh = async () => {
    if (requestPending.current) return;
    const current = sequence.current;
    requestPending.current = true; setPending(true); setError(""); setMessage(""); setReview(null);
    try {
      const value = await readConnectorTrust(botId);
      if (current !== sequence.current) return;
      setSnapshot(value); setGrants(draftFor(value.policy)); setMustRefresh(false);
      setMessage("Read back the current trust policy and mailbox identity facts.");
    } catch (cause) { if (current === sequence.current) setError(errorText(cause)); }
    finally { if (current === sequence.current) { requestPending.current = false; setPending(false); } }
  };
  const confirm = async () => {
    if (!review || requestPending.current || review.botId !== botId) return;
    const current = sequence.current;
    requestPending.current = true; setPending(true); setError(""); setMessage("");
    try {
      const result = review.kind === "save"
        ? await saveConnectorTrust(botId, { expectedRevision: review.expectedRevision, grants: review.grants, catalogFingerprint: review.catalogFingerprint, reviewed: true })
        : await revokeConnectorTrust(botId, review.expectedRevision);
      if (current !== sequence.current) return;
      // A successful mutation is followed by a separate authoritative read.
      const saved = await readConnectorTrust(botId);
      if (current !== sequence.current) return;
      const expectedState = review.kind === "save" ? "active" : "revoked";
      if (!saved.policy || saved.policy.botId !== botId || saved.policy.revision !== result.policy.revision || saved.policy.state !== expectedState || (review.kind === "save" && saved.policy.catalogFingerprint !== review.catalogFingerprint) || canonical(saved.policy.grants) !== canonical(review.kind === "save" ? review.grants : [])) {
        throw new Error("The saved policy changed before readback. Refresh and review the current policy; do not repeat the grant automatically.");
      }
      setSnapshot(saved); setGrants(draftFor(saved.policy)); setReview(null); setMustRefresh(false);
      setMessage(`${review.kind === "save" ? "Bounded access saved" : "Bounded access revoked"} and verified at revision ${saved.policy.revision}.`);
    } catch (cause) {
      if (current === sequence.current) { setError(errorText(cause)); setReview(null); setMustRefresh(true); }
    } finally { if (current === sequence.current) { requestPending.current = false; setPending(false); } }
  };
  const policy = snapshot?.policy;
  const previous = policy?.state === "active" ? policy.grants : [];
  const catalogCompatible = snapshot?.catalogFingerprint === CONNECTOR_TRUST_CATALOG_FINGERPRINT;
  const catalogChanged = Boolean(policy?.state === "active" && policy.catalogFingerprint !== snapshot?.catalogFingerprint);
  const dirty = canonical(grants) !== canonical(previous) || catalogChanged;
  const facts = snapshot?.accounts ?? [];
  const accountIds = [...new Set([...facts.map(account => account.accountId), ...previous.map(grant => grant.accountId)])];
  const selectedFactsValid = grants.every(grant => facts.some(fact => fact.accountId === grant.accountId && fact.status === "active" && fact.verifiedAt > 0 && fact.identity?.toLowerCase() === grant.identity.toLowerCase()) && grant.operations.length > 0 && grant.operations.every(operation => snapshot?.operations.some(metadata => metadata.id === operation)));
  const changeOperation = (accountId: string, operation: ConnectorTrustOperation, checked: boolean) => setGrants(current => current.map(grant => grant.accountId === accountId ? { ...grant, operations: checked ? [...grant.operations, operation] : grant.operations.filter(value => value !== operation) } : grant));
  const reviewReady = Boolean(snapshot && catalogCompatible && dirty && selectedFactsValid && !mustRefresh && !pending);
  return <section aria-labelledby={`${prefix}-title`} aria-busy={loading || pending} className="space-y-3 rounded-lg border border-hairline p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 id={`${prefix}-title`} className="font-semibold">Bounded email trust</h3><p className="mt-1 text-xs text-ink-secondary">Agent: <strong>{botName}</strong> · Provider: <strong>Composio Gmail</strong></p></div><button type="button" className={button} disabled={pending || loading || Boolean(review)} onClick={() => void refresh()}>Refresh trust and identities</button></div>
    <p className="text-xs text-ink-secondary">Choose exact operations for verified mailboxes. Existing model, app, exact-tool and approval restrictions still apply. This review changes no schedule or model.</p>
    {loading && <p role="status">Reading bounded trust and current mailbox identities…</p>}
    {error && <div role="alert" className="space-y-1 rounded-md border border-danger p-3 text-sm text-danger"><p>{error}</p>{mustRefresh && <p className="text-xs">The outcome may have changed. Refresh trust and identities, then review again. This request will not be replayed automatically.</p>}</div>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {snapshot && <>
      {snapshot.gap && <p role="status" className="text-xs text-ink-secondary">{snapshot.gap}</p>}
      <p className="text-xs">{!policy ? "Not configured. Existing connector permissions are unchanged." : policy.state === "revoked" ? `Revoked · revision ${policy.revision}. Bounded operations remain blocked; this does not restore legacy access.` : `Configured · revision ${policy.revision}. Only the reviewed account and operation pairs below are in this policy.`}</p>
      {policy && <p className="text-xs text-ink-secondary">Last reviewed {time(policy.reviewedAt)} · {policy.reviewedBy}</p>}
      {snapshot.actions?.some(action => action.state === "outcome-unknown" || action.state === "pending") && <div role="status" className="space-y-1 rounded-md border border-hairline p-3 text-xs"><p className="font-medium">Mailbox actions await an outcome check.</p><p>Inspect provider evidence before considering another attempt. Pending or unknown actions are not replayed by this review.</p><ul className="space-y-1">{snapshot.actions.filter(action => action.state === "outcome-unknown" || action.state === "pending").slice(0, 5).map(action => <li key={action.id} className="break-all">{action.state} · {time(action.startedAt)} · source thread <code>{action.threadId}</code> · action <code>{action.actionDigest.slice(0, 16)}</code></li>)}</ul></div>}
      {!catalogCompatible && <p role="status" className="text-xs text-danger">This client cannot review the current tool catalog. Open a compatible updated client before granting access. Existing trust can still be revoked.</p>}
      {catalogChanged && <p role="status" className="text-xs text-ink-secondary">The tool catalog changed since this policy was reviewed. Review its exact tools again; new tools are not added automatically.</p>}
      {!review && <>
        <fieldset disabled={pending || mustRefresh} className="space-y-3"><legend className="mb-2 text-sm font-medium">Mailboxes and exact operations</legend>
          {!accountIds.length && <p className="text-xs text-ink-secondary">No verified mailbox is available. Reconnect the provider in Apps and refresh identities before reviewing new access.</p>}
          {accountIds.map(accountId => {
            const fact = facts.find(account => account.accountId === accountId);
            const selected = grants.find(grant => grant.accountId === accountId);
            const old = previous.find(grant => grant.accountId === accountId);
            const verified = Boolean(fact?.status === "active" && fact.identity && fact.verifiedAt > 0);
            const identityChanged = Boolean(selected && fact?.identity && selected.identity.toLowerCase() !== fact.identity.toLowerCase());
            return <article key={accountId} className="space-y-2 rounded-md border border-hairline p-3">
              <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" aria-label={`Select mailbox ${fact?.identity ?? old?.identity ?? accountId}`} checked={Boolean(selected)} disabled={!verified && !selected} onChange={event => {
                if (event.target.checked && fact?.identity && verified) setGrants(current => [...current, { accountId, identity: fact.identity!, operations: [] }]);
                else setGrants(current => current.filter(grant => grant.accountId !== accountId));
              }} /><span className="min-w-0"><span className="block break-all font-medium">{fact?.identity ?? old?.identity ?? "Identity unavailable"}</span><code className="block break-all text-xs text-ink-secondary">Connection {accountId}</code></span></label>
              <p className="text-xs text-ink-secondary">{verified ? `Identity verified ${time(fact!.verifiedAt)}; checked again when saving.` : "Current provider identity is unavailable or inactive. A cached connection status cannot authorize new access."}</p>
              {old && <p className="text-xs text-ink-secondary">Stored exact tools: <code className="break-all">{old.tools.join(", ") || "None"}</code></p>}
              {identityChanged && <p role="status" className="text-xs text-danger">The selected policy references {selected!.identity}. Remove this selection and explicitly select the current mailbox before reviewing access.</p>}
              {selected && <div className="space-y-2 border-t border-hairline pt-2">{snapshot.operations.map(operation => <label key={operation.id} className="flex items-start gap-2 rounded-md bg-inset p-2"><input type="checkbox" className="mt-1" checked={selected.operations.includes(operation.id)} disabled={!verified || identityChanged} aria-label={`${operation.label} for ${selected.identity}`} onChange={event => changeOperation(accountId, operation.id, event.target.checked)} /><span className="min-w-0"><span className="block text-sm">{operation.label}</span><span className="block text-xs font-medium">{operation.effect === "read" ? "Bounded read" : "Ask each time"} · effect: {operation.effect}</span><span className="mt-1 block break-all font-mono text-xs text-ink-secondary">{operation.tools.join(", ")}</span></span></label>)}
                {!selected.operations.length && <p className="text-xs text-ink-secondary">Choose at least one exact operation, or remove the mailbox selection.</p>}
                {selected.operations.some(operation => !snapshot.operations.some(metadata => metadata.id === operation)) && <p className="text-xs text-danger">This policy includes an unrecognized operation. Remove the mailbox selection or refresh a compatible client before saving.</p>}
              </div>}
            </article>;
          })}
        </fieldset>
        <p className="text-xs text-ink-secondary">Drafts, sends, label changes and deletion always ask for approval of the exact action. This grant does not approve credentials, software installation or arbitrary tools.</p>
        <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!reviewReady} onClick={() => setReview({ kind: "save", botId, botName, expectedRevision: policy?.revision ?? 0, catalogFingerprint: CONNECTOR_TRUST_CATALOG_FINGERPRINT, grants: structuredClone(grants), previous: structuredClone(previous) })}>Review bounded access</button>{policy?.state === "active" && <button type="button" className={`${button} text-danger`} disabled={pending || mustRefresh} onClick={() => setReview({ kind: "revoke", botId, botName, expectedRevision: policy.revision, catalogFingerprint: policy.catalogFingerprint, grants: structuredClone(policy.grants) })}>Review revocation</button>}</div>
      </>}
      {review && <section aria-labelledby={`${prefix}-review-title`} className="space-y-3 rounded-lg border border-accent p-3" onKeyDown={event => { if (event.key === "Escape" && !pending) { event.stopPropagation(); setReview(null); } }}>
        <h4 id={`${prefix}-review-title`} className="font-semibold">{review.kind === "save" ? "Review exact bounded access" : "Review bounded access revocation"}</h4>
        <dl className="space-y-1 text-sm"><div><dt className="inline font-medium">Agent: </dt><dd className="inline">{review.botName} <code className="break-all text-xs">({review.botId})</code></dd></div><div><dt className="inline font-medium">Provider: </dt><dd className="inline">Composio Gmail</dd></div><div><dt className="inline font-medium">Policy revision reviewed: </dt><dd className="inline">{review.expectedRevision}{review.expectedRevision === 0 ? " · never configured" : ""}</dd></div></dl>
        <p className="break-all text-xs text-ink-secondary">Exact tool catalog: <code>{review.catalogFingerprint}</code></p>
        {review.kind === "save" ? <>
          <GrantList grants={review.grants} snapshot={snapshot} empty="No account or operation will remain allowed by this bounded policy." />
          {removedGrants(review.previous, review.grants, snapshot).length > 0 && <section className="space-y-2"><h5 className="text-sm font-medium">Previously allowed pairs being removed</h5><GrantList grants={removedGrants(review.previous, review.grants, snapshot)} snapshot={snapshot} empty="No pairs removed." /></section>}
          <p className="text-xs">Only these exact account and operation pairs will be saved. Unselected pairs are excluded. Read operations may run within this scope; every write, draft, send, label change or deletion still asks for exact-action approval.</p>
        </> : <><GrantList grants={review.grants} snapshot={snapshot} empty="No allowed account pairs remain." /><p className="text-sm">Revoke every pair listed above for this agent. Revocation remains in force and does not restore broader legacy permissions.</p></>}
        <p className="text-xs text-ink-secondary">No model, profile, account connection, existing generic grant, routine or mailbox content changes in this review. The server checks the current revision and identity facts before accepting a grant.</p>
        <div className="flex flex-wrap gap-2"><button ref={reviewCancel} type="button" className={button} disabled={pending} onClick={() => setReview(null)}>Cancel trust review</button><button type="button" className={`${button} ${review.kind === "revoke" ? "text-danger" : "bg-accent text-white"}`} disabled={pending} onClick={() => void confirm()}>{pending ? "Saving and checking…" : review.kind === "save" ? "Save reviewed bounded access" : "Revoke reviewed bounded access"}</button></div>
      </section>}
    </>}
  </section>;
}

function removedGrants(previous: StoredGrant[], next: ConnectorTrustGrant[], snapshot: ConnectorTrustOverview): StoredGrant[] {
  return previous.map(grant => {
    const replacement = next.find(candidate => candidate.accountId === grant.accountId && candidate.identity.toLowerCase() === grant.identity.toLowerCase());
    const keptTools = new Set<string>(replacement?.operations.flatMap(id => snapshot.operations.find(operation => operation.id === id)?.tools ?? []) ?? []);
    return { ...grant, operations: grant.operations.filter(operation => !replacement?.operations.includes(operation)), tools: grant.tools.filter(tool => !keptTools.has(tool)) };
  }).filter(grant => grant.operations.length > 0 || grant.tools.length > 0);
}

function GrantList({ grants, snapshot, empty }: { grants: Array<ConnectorTrustGrant & { tools?: string[] }>; snapshot: ConnectorTrustOverview; empty: string }) {
  return grants.length ? <ul className="space-y-3">{grants.map(grant => <li key={grant.accountId} className="space-y-1 rounded-md bg-inset p-3"><p className="break-all font-medium">{grant.identity}</p><p className="break-all text-xs text-ink-secondary">Connection {grant.accountId}</p><ul className="list-disc space-y-2 pl-5">{grant.operations.map(id => {
    const operation = snapshot.operations.find(metadata => metadata.id === id);
    return <li key={id} className="text-xs"><span className="font-medium">{operation?.label ?? id}</span><span className="block">{operation?.effect === "read" ? "Bounded read" : "Ask each time"} · {operation?.effect ?? "unknown effect"}</span>{!grant.tools && <code className="block break-all text-ink-secondary">{operation?.tools.join(", ") ?? "Tool details unavailable"}</code>}</li>;
  })}</ul>{grant.tools && <p className="break-all text-xs text-ink-secondary">Stored exact tools: <code>{grant.tools.join(", ") || "None"}</code></p>}</li>)}</ul> : <p className="text-sm">{empty}</p>;
}

export function BoundedEmailTrust({ bots, preferredBotId }: { bots: Array<{ id: string; name: string }>; preferredBotId?: string | null }) {
  const [selected, setSelected] = useState(preferredBotId && bots.some(bot => bot.id === preferredBotId) ? preferredBotId : "");
  const bot = bots.find(candidate => candidate.id === selected);
  return <div className="space-y-3"><label className="block text-sm font-medium">Agent for bounded email trust<select className="mt-1 min-h-9 w-full rounded-md border border-hairline bg-inset px-2 py-1 text-sm" value={selected} onChange={event => setSelected(event.target.value)}><option value="">Choose an existing agent</option>{bots.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>{bot ? <ConnectorTrustPanel key={bot.id} botId={bot.id} botName={bot.name} /> : <p className="text-xs text-ink-secondary">Choose an agent to inspect or review its account-scoped email trust. Selecting an agent grants nothing.</p>}</div>;
}
