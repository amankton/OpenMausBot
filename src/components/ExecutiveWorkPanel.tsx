import { useEffect, useId, useRef, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { workStatuses, type ExecutiveSettings, type WorkItem, type WorkItemPatch, type WorkStatus } from "../../shared/executive-work";
import { readExecutiveWork, saveExecutiveSettings, scanExecutiveMail, updateExecutiveItem, type ExecutiveWorkSnapshot } from "@/lib/executive-work";
import { BoundedEmailTrust } from "./ConnectorTrustPanel";
import { ChiefEnhancementSetupPanel } from "./ChiefEnhancementSetupPanel";

const button = "rounded-md border border-hairline px-3 py-2 text-sm hover:bg-control disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent";
const input = "mt-1 min-h-9 w-full rounded-md border border-hairline bg-inset px-2 py-1 text-ink focus-visible:outline-2 focus-visible:outline-accent";
const box = "space-y-3 rounded-lg border border-hairline p-4";
const labelForStatus = (value: string) => value.replaceAll("-", " ");
const cloneSettings = (settings: ExecutiveSettings) => structuredClone(settings);
const describeError = (cause: unknown) => cause instanceof Error ? cause.message : "The request could not be completed.";
const date = (value: number) => new Date(value).toLocaleString();
const eventId = () => crypto.randomUUID();

export interface ExecutiveWorkPanelProps {
  onClose?: () => void;
  onOpenRoutines?: () => void;
  onOpenTask?: (target: { botId: string; threadId: string }) => void;
}

export function ExecutiveWorkPanel({ onClose, onOpenRoutines, onOpenTask }: ExecutiveWorkPanelProps) {
  const [snapshot, setSnapshot] = useState<ExecutiveWorkSnapshot | null>(null);
  const [draft, setDraft] = useState<ExecutiveSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"saving" | "scanning" | "refreshing" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [statusFilter, setStatusFilter] = useState<"open" | "all">("open");
  const mounted = useRef(true);
  const prefix = useId();
  const initialRequest = useRef(0);
  const pending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    const request = ++initialRequest.current;
    void readExecutiveWork(controller.signal).then(value => {
      if (mounted.current && request === initialRequest.current) { setSnapshot(value); setDraft(cloneSettings(value.settings)); }
    }).catch(cause => {
      if (!controller.signal.aborted && mounted.current) setError(describeError(cause));
    }).finally(() => { if (mounted.current && request === initialRequest.current) setLoading(false); });
    return () => { mounted.current = false; controller.abort(); };
  }, []);

  const dirty = Boolean(snapshot && draft && JSON.stringify(draft) !== JSON.stringify(snapshot.settings));
  const reload = async (replaceDraft: boolean) => {
    const value = await readExecutiveWork();
    if (mounted.current) { setSnapshot(value); if (replaceDraft) setDraft(cloneSettings(value.settings)); }
  };
  const perform = async (kind: NonNullable<typeof busy>, action: () => Promise<void>, success: string, replaceDraft = false) => {
    if (pending.current) return;
    pending.current = true; setBusy(kind); setError(""); setMessage("");
    try {
      await action();
      await reload(replaceDraft);
      if (mounted.current) setMessage(success);
    } catch (cause) {
      if (mounted.current) setError(describeError(cause));
    } finally { pending.current = false; if (mounted.current) setBusy(null); }
  };

  const settings = snapshot?.settings;
  const configuredScopes = settings?.accounts.filter(account => account.enabled && snapshot?.mailboxes.some(mailbox => mailbox.accountScope === account.accountScope && mailbox.identity === account.identity && mailbox.available) && snapshot.bots.some(bot => bot.id === account.ownerBotId) && snapshot.bots.some(bot => bot.id === account.coordinatorBotId)).map(account => account.accountScope) ?? [];
  const canScan = Boolean(settings?.scansEnabled && snapshot?.capabilities.scan && configuredScopes.length);
  const needsVerification = snapshot?.mailboxes.some(mailbox => configuredScopes.includes(mailbox.accountScope) && !mailbox.verified);
  const items = snapshot?.items.filter(item => statusFilter === "all" || !["done", "dismissed"].includes(item.status)) ?? [];
  const recentRuns = snapshot?.runs.toSorted((a, b) => b.startedAt - a.startedAt).slice(0, 10) ?? [];
  const lastSuccess = snapshot?.runs.filter(run => run.status === "completed" && run.finishedAt !== undefined).toSorted((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))[0];
  const linkedRoutines = snapshot?.capabilities.routines?.filter(routine => settings?.routineBindings.some(binding => binding.routineId === routine.id)) ?? [];
  const botName = (id: string) => snapshot?.bots.find(bot => bot.id === id)?.name ?? "Unavailable agent";

  return <section aria-labelledby={`${prefix}-title`} className="min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto bg-app p-4 text-sm text-ink sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3 pl-9 md:pl-0">
      <div><h2 id={`${prefix}-title`} className="text-lg font-semibold">Chief work and email review</h2><p className="mt-1 max-w-2xl text-ink-secondary">Review open commitments, mailbox coverage and the settings used by your Chief.</p></div>
      <div className="flex gap-2">
        <button type="button" className={button} disabled={Boolean(busy) || loading || dirty} onClick={() => void perform("refreshing", async () => {}, "Refreshed current work and settings.", true)}><RefreshCw size={14} aria-hidden="true" className="mr-1 inline" />Refresh</button>
        {onClose && <button type="button" className={button} aria-label="Close Chief work" onClick={onClose}><X size={16} /></button>}
      </div>
    </header>
    <ChiefEnhancementSetupPanel />
    {loading && <p role="status">Loading work and settings…</p>}
    {error && <div role="alert" className="rounded-md border border-danger p-3 text-danger"><p>{error}</p><p className="mt-1 text-xs">Your unsaved edits remain here. Refresh current state before retrying a conflicting change.</p></div>}
    {message && <p role="status" className="rounded-md border border-hairline p-3">{message}</p>}
    {snapshot && draft && <>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className={box} aria-labelledby={`${prefix}-coverage`}>
          <h3 id={`${prefix}-coverage`} className="font-semibold">Coverage</h3>
          <p>Last successful run: <strong>{lastSuccess?.finishedAt ? date(lastSuccess.finishedAt) : "No successful run recorded"}</strong></p>
          <p>Review backlog: <strong>{snapshot.capabilities.backlog === undefined ? "Not yet available" : snapshot.capabilities.backlog}</strong></p>
          {!snapshot.capabilities.gaps.length ? <p className="text-ink-secondary">See each run’s receipt for its actual coverage.</p> : <ul aria-label="Coverage gaps" className="list-disc space-y-1 pl-5 text-ink-secondary">{snapshot.capabilities.gaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul>}
          <button type="button" className={button} disabled={Boolean(busy) || dirty || !canScan} onClick={() => void perform("scanning", async () => { await scanExecutiveMail(configuredScopes, eventId()); }, "Scan request finished. Review the run receipts for coverage and gaps.")}>{busy === "scanning" ? "Scanning…" : needsVerification ? "Verify and scan mail" : "Scan mail now"}</button>
          <p className="text-xs text-ink-secondary">Manual scans verify each configured mailbox identity before reading. They do not send replies, create provider drafts, label, archive or delete mail.</p>
          {dirty && <p className="text-xs">Save or reload your settings before scanning.</p>}
          {!canScan && !dirty && <p className="text-xs">Select available mailboxes, assign their agents and allow manual scans to begin.</p>}
        </section>
        <section className={box} aria-labelledby={`${prefix}-schedule`}>
          <h3 id={`${prefix}-schedule`} className="font-semibold">Routines</h3>
          <p className="text-ink-secondary">Saving these settings does not create a schedule. Configure a routine through the existing owner flow.</p>
          {linkedRoutines.length ? <ul className="space-y-2">{linkedRoutines.map(routine => <li key={routine.id}><span className="font-medium">{routine.name}</span><span className="block text-xs text-ink-secondary">{routine.enabled ? "Enabled" : "Paused"}{routine.cadence ? ` · ${routine.cadence}` : " · Cadence unavailable"} · {labelForStatus(settings!.routineBindings.find(binding => binding.routineId === routine.id)!.kind)}</span></li>)}</ul> : <p>No linked routines reported.</p>}
          {onOpenRoutines && <button type="button" className={button} onClick={onOpenRoutines}>Open routines</button>}
          <p className="text-xs text-ink-secondary">Notification delivery depends on the configured app and device. This view does not establish delivery to a terminated mobile app.</p>
        </section>
      </div>
      <form className={box} aria-labelledby={`${prefix}-setup`} onSubmit={event => {
        event.preventDefault();
        const { revision, ...patch } = draft;
        void perform("saving", async () => { await saveExecutiveSettings(revision, patch); }, "Settings saved. No new routine or mailbox action was started.", true);
      }}>
        <h3 id={`${prefix}-setup`} className="font-semibold">Sources and settings</h3>
        <fieldset disabled={Boolean(busy)} className="space-y-3"><legend className="mb-2 font-medium">Connected mailboxes</legend>
          <p className="text-xs text-ink-secondary">These protocols apply to selected Composio email connections within this Chief install. Choose an existing agent to review each connection.</p>
          <label className="block">Preferred mail reviewer<select className={input} value={draft.preferredMailReviewerBotId ?? ""} onChange={event => setDraft({ ...draft, preferredMailReviewerBotId: event.target.value || null })}><option value="">Choose an existing agent</option>{snapshot.bots.map(bot => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</select><span className="mt-1 block text-xs text-ink-secondary">Saved even when a mailbox is unavailable. New source selections use this reviewer; existing assignments stay as configured.</span></label>
          {!snapshot.mailboxes.length && <p className="text-ink-secondary">No supported mailbox connection is available. Connect an account through Apps, then refresh this view.</p>}
          {snapshot.mailboxes.map(mailbox => {
            const account = draft.accounts.find(candidate => candidate.accountScope === mailbox.accountScope);
            const selected = Boolean(account?.enabled);
            const updateAccount = (patch: Partial<ExecutiveSettings["accounts"][number]>) => setDraft(current => current && ({ ...current, accounts: current.accounts.map(candidate => candidate.accountScope === mailbox.accountScope ? { ...candidate, ...patch } : candidate) }));
            return <article key={mailbox.accountScope} className="space-y-3 rounded-md border border-hairline p-3">
              <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={selected} disabled={(!mailbox.available || !mailbox.identity) && !selected} onChange={event => {
                const enabled = event.target.checked;
                setDraft(current => {
                  if (!current) return current;
                  if (account) return { ...current, accounts: current.accounts.map(candidate => candidate.accountScope === mailbox.accountScope ? { ...candidate, enabled } : candidate) };
                  const reviewer = snapshot.bots.find(bot => bot.id === current.preferredMailReviewerBotId);
                  return { ...current, accounts: [...current.accounts, { accountScope: mailbox.accountScope, provider: mailbox.provider, identity: mailbox.identity, label: mailbox.label, context: "personal", ownerBotId: reviewer?.id ?? "", coordinatorBotId: "", sourceThreadId: reviewer?.threadId ?? "", enabled }] };
                });
              }} /><span className="min-w-0"><span className="block break-words font-medium">{mailbox.label}</span><span className="block break-all text-xs text-ink-secondary">{mailbox.identity || "Mailbox identity unavailable"}</span></span></label>
              <p className="text-xs text-ink-secondary">{!mailbox.available ? mailbox.reason ?? "Provider unavailable" : !mailbox.identity ? "Refresh after the provider can identify this mailbox. It cannot be selected without its account identity." : mailbox.verified ? "Identity verified; checked again on every scan" : "Identity will be verified before the first scan"}</p>
              {selected && <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs sm:col-span-2">Mailbox context<select aria-label={`Context for ${mailbox.identity}`} className={input} value={account?.context ?? "personal"} onChange={event => updateAccount({ context: event.target.value as ExecutiveSettings["accounts"][number]["context"] })}>{(["personal", "ministry", "work", "other"] as const).map(context => <option key={context} value={context}>{context.charAt(0).toUpperCase() + context.slice(1)}</option>)}</select></label>
                <label className="block text-xs">Mail reviewer<select required aria-label={`Mail reviewer for ${mailbox.identity}`} className={input} value={account?.ownerBotId ?? ""} onChange={event => {
                  const owner = snapshot.bots.find(bot => bot.id === event.target.value);
                  updateAccount({ ownerBotId: owner?.id ?? "", sourceThreadId: owner?.threadId ?? "" });
                }}><option value="">Choose an agent</option>{snapshot.bots.map(bot => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</select></label>
                <label className="block text-xs">Coordinating Chief<select required aria-label={`Coordinating Chief for ${mailbox.identity}`} className={input} value={account?.coordinatorBotId ?? ""} onChange={event => updateAccount({ coordinatorBotId: event.target.value })}><option value="">Choose an agent</option>{snapshot.bots.map(bot => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</select></label>
              </div>}
            </article>;
          })}
          {draft.accounts.filter(account => !snapshot.mailboxes.some(mailbox => mailbox.accountScope === account.accountScope)).map(account => <div key={account.accountScope} className="space-y-2 text-xs"><p role="status">Previously configured source {account.label} is unavailable. It cannot be scanned until its connection is restored.</p>{account.enabled ? <button type="button" className={button} onClick={() => setDraft({ ...draft, accounts: draft.accounts.map(candidate => candidate.accountScope === account.accountScope ? { ...candidate, enabled: false } : candidate) })}>Disable unavailable source</button> : <p className="text-ink-secondary">Disabled in this setup.</p>}</div>)}
        </fieldset>
        <fieldset disabled={Boolean(busy)} className="space-y-3 border-t border-hairline pt-3"><legend className="sr-only">Execution and review settings</legend>
          <label className="flex items-center gap-2"><input type="checkbox" checked={draft.scansEnabled} onChange={event => setDraft({ ...draft, scansEnabled: event.target.checked })} />Allow manual read-only mail scans</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={draft.checkInEnabled} onChange={event => setDraft({ ...draft, checkInEnabled: event.target.checked })} />Allow check-ins from explicitly configured routines</label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">Time zone<input className={input} required value={draft.timezone} onChange={event => setDraft({ ...draft, timezone: event.target.value })} placeholder="America/Los_Angeles" /></label>
            <label className="block">New-message review budget<input className={input} type="number" min={1} max={100} required value={draft.analysisBudget} onChange={event => setDraft({ ...draft, analysisBudget: Number(event.target.value) })} /><span className="mt-1 block text-xs text-ink-secondary">Shared fairly across selected accounts. Unreviewed messages stay in the backlog.</span></label>
          </div>
          <label className="block">Suggested cadence<input className={input} maxLength={200} value={draft.cadenceProposal ?? ""} onChange={event => setDraft({ ...draft, cadenceProposal: event.target.value || null })} placeholder="For review, for example weekday mornings" /><span className="mt-1 block text-xs text-ink-secondary">A suggestion only; this field never enables a job.</span></label>
        </fieldset>
        <fieldset disabled={Boolean(busy)} className="space-y-3 border-t border-hairline pt-3"><legend className="mb-2 font-medium">Use existing routines</legend>
          <p className="text-xs text-ink-secondary">Choose an existing compatible routine to run deterministic read-only discovery instead of its ordinary agent prompt. Its schedule and paused state stay under Routines.</p>
          {!snapshot.capabilities.routines?.length && <p className="text-ink-secondary">No compatible routines reported. Open Routines to prepare one through the normal owner flow.</p>}
          {snapshot.capabilities.routines?.map(routine => <label key={routine.id} className="block">{routine.name}<span className="ml-2 text-xs text-ink-secondary">{routine.enabled ? "Enabled" : "Paused"}{routine.cadence ? ` · ${routine.cadence}` : ""}</span><select aria-label={`Discovery mode for ${routine.name}`} className={input} value={draft.routineBindings.find(binding => binding.routineId === routine.id)?.kind ?? "none"} onChange={event => {
            const kind = event.target.value;
            const bindings = draft.routineBindings.filter(binding => binding.routineId !== routine.id);
            if (kind === "check-in" || kind === "mail-scan") bindings.push({ routineId: routine.id, kind });
            setDraft({ ...draft, routineBindings: bindings });
          }}><option value="none">Keep ordinary routine behavior</option><option value="check-in">Chief read-only check-in</option><option value="mail-scan">Email Triage read-only scan</option></select></label>)}
          {draft.routineBindings.filter(binding => !snapshot.capabilities.routines?.some(routine => routine.id === binding.routineId)).map(binding => <div key={binding.routineId} className="space-y-2 text-xs"><p role="status">A previously bound routine is unavailable or incompatible.</p><button type="button" className={button} onClick={() => setDraft({ ...draft, routineBindings: draft.routineBindings.filter(candidate => candidate.routineId !== binding.routineId) })}>Remove unavailable binding</button></div>)}
        </fieldset>
        <fieldset disabled={Boolean(busy)} className="space-y-3 border-t border-hairline pt-3"><legend className="mb-2 font-medium">Meaningful-change notifications</legend>
          <label className="flex items-center gap-2"><input type="checkbox" checked={draft.notifications.enabled} onChange={event => setDraft({ ...draft, notifications: { ...draft.notifications, enabled: event.target.checked } })} />Notify on meaningful changes</label>
          <label className="block">Priority threshold<select className={input} value={draft.notifications.priorityThreshold} onChange={event => setDraft({ ...draft, notifications: { ...draft.notifications, priorityThreshold: Number(event.target.value) } })}>{[1, 2, 3, 4, 5].map(priority => <option key={priority} value={priority}>Priority 1{priority > 1 ? ` through ${priority}` : " only"}</option>)}</select></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={draft.notifications.quietHours !== null} onChange={event => setDraft({ ...draft, notifications: { ...draft.notifications, quietHours: event.target.checked ? { start: "22:00", end: "08:00" } : null } })} />Use quiet hours in the selected time zone</label>
          {draft.notifications.quietHours && <div className="grid gap-3 sm:grid-cols-2">{(["start", "end"] as const).map(key => <label key={key} className="block">Quiet hours {key}<input className={input} type="time" required value={draft.notifications.quietHours![key]} onChange={event => setDraft({ ...draft, notifications: { ...draft.notifications, quietHours: { ...draft.notifications.quietHours!, [key]: event.target.value } } })} /></label>)}</div>}
          <label className="flex items-center gap-2"><input type="checkbox" checked={draft.notifications.urgentBypassesQuiet} onChange={event => setDraft({ ...draft, notifications: { ...draft.notifications, urgentBypassesQuiet: event.target.checked } })} />Allow highest-priority changes during quiet hours</label>
          <p className="text-xs text-ink-secondary">Unchanged scans stay quiet. Disabling notifications keeps run receipts and unresolved work.</p>
        </fieldset>
        <details className="border-t border-hairline pt-3"><summary className="cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-accent">Retention</summary><label className="mt-3 block">Keep run receipts for days<input className={input} type="number" min={7} max={3650} required disabled={Boolean(busy)} value={draft.retention.runDays} onChange={event => setDraft({ ...draft, retention: { ...draft.retention, runDays: Number(event.target.value) } })} /></label><p className="mt-2 text-xs text-ink-secondary">Minimal source identifiers are retained indefinitely to prevent duplicates. Confidential email bodies are not part of this shared work queue.</p></details>
        <div className="flex flex-wrap items-center gap-3"><button type="submit" className={`${button} bg-accent font-medium text-white hover:bg-accent/90`} disabled={Boolean(busy) || !dirty}>{busy === "saving" ? "Saving…" : "Save settings"}</button>{dirty && <button type="button" className={button} disabled={Boolean(busy)} onClick={() => { setDraft(cloneSettings(snapshot.settings)); setError(""); }}>Discard unsaved settings</button>}</div>
      </form>
      <BoundedEmailTrust bots={snapshot.bots} preferredBotId={snapshot.settings.preferredMailReviewerBotId} />
      <section className={box} aria-labelledby={`${prefix}-queue`}>
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 id={`${prefix}-queue`} className="font-semibold">Shared work queue</h3><label className="text-xs">Show<select className="ml-2 rounded-md border border-hairline bg-inset px-2 py-1" value={statusFilter} onChange={event => setStatusFilter(event.target.value as "open" | "all")}><option value="open">Open work</option><option value="all">All work</option></select></label></div>
        {!items.length && <p className="text-ink-secondary">{statusFilter === "open" ? "No open work recorded." : "No work recorded."}</p>}
        {items.map(item => <WorkItemReview key={`${item.id}:${item.revision}`} item={item} ownerName={botName(item.ownerBotId)} busy={Boolean(busy)} onOpenTask={onOpenTask} onSave={(patch, reason) => perform("saving", async () => { await updateExecutiveItem(item, patch, { eventId: eventId(), ...(reason ? { resolutionReason: reason } : {}) }); }, "Work item updated against its current revision.")} />)}
      </section>
      <section className={box} aria-labelledby={`${prefix}-runs`}><h3 id={`${prefix}-runs`} className="font-semibold">Recent run receipts</h3>{!recentRuns.length && <p className="text-ink-secondary">No runs recorded. A saved setting is not a completed scan.</p>}{recentRuns.map(run => <article key={run.id} className="space-y-2 border-t border-hairline pt-3"><p className="flex flex-wrap justify-between gap-2"><span className="font-medium">{labelForStatus(run.kind)} · {labelForStatus(run.status)}</span><span className="text-xs text-ink-secondary">{date(run.startedAt)}</span></p><p className="break-words text-xs text-ink-secondary">{snapshot.mailboxes.find(mailbox => mailbox.accountScope === run.accountScope)?.label ?? run.accountScope} · {botName(run.botId)}{run.finishedAt ? ` · Finished ${date(run.finishedAt)}` : " · No completion receipt"}</p>{run.gaps.length > 0 && <ul className="list-disc pl-5 text-xs">{run.gaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul>}{onOpenTask && <button type="button" className={button} onClick={() => onOpenTask({ botId: run.botId, threadId: run.threadId })}>Open source task</button>}</article>)}</section>
    </>}
  </section>;
}

function WorkItemReview({ item, ownerName, busy, onOpenTask, onSave }: {
  item: WorkItem; ownerName: string; busy: boolean; onOpenTask?: ExecutiveWorkPanelProps["onOpenTask"];
  onSave: (patch: WorkItemPatch, reason: string) => Promise<void>;
}) {
  const [status, setStatus] = useState<WorkStatus>(item.status);
  const [reason, setReason] = useState("");
  const [completionKind, setCompletionKind] = useState<"user-confirmed" | "evidence-verified">("user-confirmed");
  const [evidence, setEvidence] = useState("");
  const [nextAction, setNextAction] = useState(item.nextAction);
  const closed = item.status === "done" || item.status === "dismissed";
  const closing = status === "done" || status === "dismissed";
  const requiresReason = closing || closed;
  const evidenceLines = evidence.split("\n").map(value => value.trim()).filter(Boolean);
  const ready = (status !== item.status || nextAction !== item.nextAction) && (!requiresReason || Boolean(reason.trim())) && (status !== "done" || completionKind !== "evidence-verified" || evidenceLines.length > 0);
  return <article className="space-y-2 border-t border-hairline pt-3">
    <div className="flex flex-wrap items-start justify-between gap-2"><h4 className="min-w-0 break-words font-medium">{item.title}</h4><span className="rounded bg-control px-2 py-1 text-xs">Priority {item.priority} · {labelForStatus(item.status)}</span></div>
    <p className="text-xs text-ink-secondary">{ownerName} · Execution: {labelForStatus(item.executionStatus)} · Revision {item.revision}</p>
    <p className="break-words">{item.desiredOutcome}</p><p className="break-words text-ink-secondary">Next: {item.nextAction}</p>
    {item.deadline && <p className="text-xs">Source deadline: {item.deadline.value} · {item.deadline.timezone} · {item.deadline.precision} precision<span className="block text-ink-secondary">{item.deadline.provenance}</span></p>}
    {item.suggestedReviewAt !== undefined && <p className="text-xs">Suggested review: {date(item.suggestedReviewAt)} · not a source deadline</p>}
    <p className="break-all text-xs text-ink-secondary">Source: {item.source.kind} / {item.source.id} · version {item.source.version}</p>
    {onOpenTask && <button type="button" className={button} onClick={() => onOpenTask({ botId: item.source.botId ?? item.ownerBotId, threadId: item.sourceThreadId })}>Open source task</button>}
    <details><summary className="cursor-pointer py-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-accent">Review this item</summary>
      <form className="mt-2 space-y-3" onSubmit={event => {
        event.preventDefault();
        if (!ready || busy) return;
        const patch: WorkItemPatch = { status, nextAction };
        if (status === "done") patch.completion = { kind: completionKind, actor: "owner", reason: reason.trim(), sourceVersion: item.source.version, evidence: completionKind === "evidence-verified" ? evidenceLines : [] };
        void onSave(patch, reason.trim());
      }}><fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs">Work status<select className={input} value={status} onChange={event => setStatus(event.target.value as WorkStatus)}>{workStatuses.map(value => <option key={value} value={value}>{labelForStatus(value)}</option>)}</select></label>
        <label className="block text-xs">Next action<input className={input} required maxLength={800} value={nextAction} onChange={event => setNextAction(event.target.value)} /></label>
        <label className="block text-xs sm:col-span-2">{closed && !closing ? "Reason for reopening" : "Decision reason"}<textarea className={input} required={requiresReason} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
        {status === "done" && <><label className="block text-xs">Completion basis<select className={input} value={completionKind} onChange={event => setCompletionKind(event.target.value as typeof completionKind)}><option value="user-confirmed">I confirm this is resolved</option><option value="evidence-verified">Verified against evidence</option></select></label>{completionKind === "evidence-verified" && <label className="block text-xs sm:col-span-2">Evidence references, one per line<textarea className={input} required maxLength={20000} value={evidence} onChange={event => setEvidence(event.target.value)} /></label>}</>}
      </fieldset><p className="text-xs text-ink-secondary">The server checks this revision and source version before accepting the decision.</p><button type="submit" className={button} disabled={busy || !ready}>Record decision</button></form>
    </details>
  </article>;
}
