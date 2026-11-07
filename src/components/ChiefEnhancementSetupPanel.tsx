import { useEffect, useId, useRef, useState } from "react";
import type { ChiefEnhancementPreview, ChiefSetupReceipt } from "../../shared/chief-enhancement-setup";
import { applyChiefEnhancements, previewChiefEnhancements, readChiefEnhancementCatalog, verifyChiefEnhancementReadback, type ChiefEnhancementCatalog } from "@/lib/chief-enhancement-setup";

const button = "rounded-md border border-hairline px-3 py-2 text-sm hover:bg-control disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent";
const select = "mt-1 min-h-9 w-full rounded-md border border-hairline bg-inset px-2 py-1 text-ink focus-visible:outline-2 focus-visible:outline-accent";
const text = "mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-inset p-3 text-xs text-ink";
const messageFor = (cause: unknown) => cause instanceof Error ? cause.message : "Enhancement setup could not verify the current state.";
const statusFor = (cause: unknown) => cause && typeof cause === "object" && "status" in cause ? Number(cause.status) : undefined;
const roleName = (role: string) => role === "chief" ? "Chief" : "Mail reviewer";
type ReceiptSummary = Pick<ChiefSetupReceipt, "state" | "targetIds" | "previewHash" | "gaps">;
function receiptFromError(cause: unknown): ReceiptSummary | null {
  const body = cause && typeof cause === "object" && "body" in cause ? cause.body : null;
  const value = body && typeof body === "object" && "receipt" in body ? body.receipt : null;
  if (!value || typeof value !== "object" || !("state" in value) || !("targetIds" in value) || !("previewHash" in value) || !("gaps" in value) || !["working", "applied", "failed", "partial"].includes(String(value.state)) || !Array.isArray(value.targetIds) || !value.targetIds.every(id => typeof id === "string") || typeof value.previewHash !== "string" || !Array.isArray(value.gaps) || !value.gaps.every(gap => typeof gap === "string")) return null;
  return value as ReceiptSummary;
}

export function ChiefEnhancementSetupPanel() {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<ChiefEnhancementCatalog | null>(null);
  const [chief, setChief] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [preview, setPreview] = useState<ChiefEnhancementPreview | null>(null);
  const [receipt, setReceipt] = useState<ReceiptSummary | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState<"catalog" | "preview" | "apply" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [mustRefresh, setMustRefresh] = useState(false);
  const sequence = useRef(0);
  const pending = useRef(false);
  const cancelReview = useRef<HTMLButtonElement>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  const prefix = useId();
  useEffect(() => () => { sequence.current++; }, []);
  useEffect(() => { if (preview) cancelReview.current?.focus(); }, [preview]);

  const load = async () => {
    if (pending.current) return;
    const current = ++sequence.current;
    pending.current = true; setOpen(true); setBusy("catalog"); setError(""); setMessage(""); setPreview(null); setReceipt(null); setReviewed(false);
    try {
      const value = await readChiefEnhancementCatalog();
      if (sequence.current !== current) return;
      setCatalog(value); setUnavailable(false); setMustRefresh(false);
      setChief(id => value.roster.some(bot => bot.id === id) ? id : "");
      setReviewer(id => value.roster.some(bot => bot.id === id) ? id : "");
    } catch (cause) {
      if (sequence.current === current) { setCatalog(null); setUnavailable([404, 405, 501].includes(statusFor(cause) ?? 0)); setError([401, 403].includes(statusFor(cause) ?? 0) ? "Enhancement setup requires the authenticated desktop owner's session. Open this view in that session and refresh." : messageFor(cause)); }
    } finally { if (sequence.current === current) { pending.current = false; setBusy(null); } }
  };
  const prepare = async () => {
    if (!chief || !reviewer || pending.current || mustRefresh) return;
    const current = sequence.current;
    pending.current = true; setBusy("preview"); setError(""); setMessage(""); setReviewed(false); setReceipt(null); setPreview(null);
    try {
      const { preview: value } = await previewChiefEnhancements({ chiefBotId: chief, reviewerBotId: reviewer });
      if (sequence.current !== current) return;
      if (value.selection.chiefBotId !== chief || value.selection.reviewerBotId !== reviewer || value.catalogFingerprint !== catalog?.catalogFingerprint) throw new Error("The selected roles or bundled content changed. Refresh setup and review again.");
      setPreview(value);
    } catch (cause) { if (sequence.current === current) { setError(messageFor(cause)); setMustRefresh(true); } }
    finally { if (sequence.current === current) { pending.current = false; setBusy(null); } }
  };
  const apply = async () => {
    if (!preview || !reviewed || pending.current || mustRefresh || preview.conflicts.length || preview.missingRoles.length || !preview.changesNeeded) return;
    const current = sequence.current;
    const reviewedPreview = preview;
    pending.current = true; setBusy("apply"); setError(""); setMessage("");
    try {
      const result = await applyChiefEnhancements({ chiefBotId: chief, reviewerBotId: reviewer, previewHash: reviewedPreview.previewHash, catalogFingerprint: reviewedPreview.catalogFingerprint, reviewed: true });
      if (sequence.current !== current) return;
      setReceipt(result.receipt);
      if (result.receipt.state !== "applied") throw new Error("Setup did not finish applying. Inspect the receipt and refresh the current profiles and skills.");
      const { preview: saved } = await previewChiefEnhancements({ chiefBotId: chief, reviewerBotId: reviewer });
      if (sequence.current !== current) return;
      verifyChiefEnhancementReadback(reviewedPreview, result.receipt, saved);
      setPreview(null); setReviewed(false); setMustRefresh(false);
      setMessage("Enhancements applied and independently read back for the selected existing agents. Mailbox setup, trust, schedules and notifications still require their separate choices.");
    } catch (cause) {
      if (sequence.current === current) { setError(messageFor(cause)); setMustRefresh(true); setReviewed(false); const savedReceipt = receiptFromError(cause); if (savedReceipt) setReceipt(savedReceipt); }
    } finally { if (sequence.current === current) { pending.current = false; setBusy(null); } }
  };
  const choose = (role: "chief" | "reviewer", value: string) => { if (role === "chief") setChief(value); else setReviewer(value); setPreview(null); setReviewed(false); setReceipt(null); setMessage(""); };
  const blockReasons = preview ? [...preview.conflicts, ...preview.missingRoles.map(role => `Select an available existing agent for ${roleName(role)}.`)] : [];
  return <section aria-labelledby={`${prefix}-title`} aria-busy={Boolean(busy)} className="min-w-0 space-y-3 rounded-lg border border-hairline p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 id={`${prefix}-title`} className="font-semibold">Agent enhancement setup</h3><p className="mt-1 max-w-3xl text-xs text-ink-secondary">Review the Chief and mail-review instructions and eight skills for agents you already have. One agent may serve both roles.</p></div>{!open ? <button type="button" className={button} onClick={() => void load()}>Review agent enhancement setup</button> : <button type="button" className={button} disabled={Boolean(busy)} onClick={() => { setOpen(false); setPreview(null); setReviewed(false); }}>Close enhancement setup</button>}</div>
    {open && <>
      <p className="text-xs text-ink-secondary">This setup appends reviewed instructions and installs, enables or assigns the listed skills. It creates no agent, changes no model or grants, and starts no scan, schedule or notification.</p>
      <button type="button" className={button} disabled={Boolean(busy)} onClick={() => void load()}>Refresh enhancement setup</button>
      {busy && <p role="status">{busy === "catalog" ? "Reading existing agents and bundled instructions…" : busy === "preview" ? "Preparing the exact profile and skill review…" : "Applying the reviewed setup and checking authoritative readback…"}</p>}
      {unavailable ? <p role="status" className="text-ink-secondary">This server does not provide reviewed enhancement setup. Update it through the supported install flow, then refresh. No agent was changed.</p> : error && <div role="alert" className="space-y-1 rounded-md border border-danger p-3 text-danger"><p>{error}</p>{mustRefresh && <p className="text-xs">The outcome or source state may have changed. Refresh setup and prepare a fresh review. This request will not be replayed automatically.</p>}</div>}
      {message && <p role="status" className="rounded-md border border-hairline p-3">{message}</p>}
      {catalog && <>
        <fieldset disabled={Boolean(busy)} className="grid gap-3 sm:grid-cols-2"><legend className="sr-only">Existing agents for enhancement roles</legend>
          <label className="block">Chief agent<select className={select} value={chief} onChange={event => choose("chief", event.target.value)}><option value="">Choose an existing Chief</option>{catalog.roster.map(bot => <option key={bot.id} value={bot.id}>{bot.name}{bot.title ? ` · ${bot.title}` : ""}</option>)}</select></label>
          <label className="block">Mail-review agent<select className={select} value={reviewer} onChange={event => choose("reviewer", event.target.value)}><option value="">Choose an existing mail reviewer</option>{catalog.roster.map(bot => <option key={bot.id} value={bot.id}>{bot.name}{bot.title ? ` · ${bot.title}` : ""}</option>)}</select></label>
        </fieldset>
        {!catalog.roster.length && <p>No existing agent is available. Use the existing reviewed Team Setup flow to prepare the roles, then refresh here.</p>}
        {catalog.guidance.map((guidance, index) => <p key={index} className="text-xs text-ink-secondary">{guidance}</p>)}
        <button ref={previewButton} type="button" className={button} disabled={Boolean(busy) || !chief || !reviewer || mustRefresh} onClick={() => void prepare()}>Preview selected agent changes</button>
        {preview && <section aria-labelledby={`${prefix}-review-title`} className="space-y-4 rounded-md border border-accent p-3">
          <h4 id={`${prefix}-review-title`} className="font-semibold">Review exact enhancement changes</h4>
          <p className="break-all text-xs text-ink-secondary">Release {preview.release} · Catalog {preview.catalogFingerprint}<br />Review {preview.previewHash}</p>
          {blockReasons.length > 0 && <div role="alert"><p className="font-medium">Setup is blocked until these issues are resolved.</p><ul className="list-disc space-y-1 pl-5">{blockReasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul></div>}
          {preview.targets.map(target => <article key={target.botId} className="min-w-0 space-y-3 border-t border-hairline pt-3">
            <h5 className="break-words font-medium">{target.name} · {target.roles.map(roleName).join(" and ")}</h5>
            <p className="break-all text-xs text-ink-secondary">Existing agent {target.botId}<br />Profile revision {target.before.profileRevision} · Skill revision {target.before.skillAssignmentRevision}</p>
            {target.addenda.map(addendum => <details key={addendum.role} open><summary className="cursor-pointer font-medium">Exact {roleName(addendum.role)} addendum</summary><pre className={text}>{addendum.content}</pre><p className="break-all text-xs text-ink-secondary">SHA-256 {addendum.sha256}</p></details>)}
            <details><summary className="cursor-pointer font-medium">Current full instructions for {target.name}</summary><pre className={text}>{target.before.soul || "(Empty instructions)"}</pre></details>
            <details><summary className="cursor-pointer font-medium">Proposed full instructions for {target.name}</summary><pre className={text}>{target.nextSoul || "(Empty instructions)"}</pre></details>
            <ul aria-label={`Skill changes for ${target.name}`} className="space-y-2">{target.skills.map(skill => <li key={skill.name} className="break-words text-xs"><strong>{skill.name}</strong> · {skill.action}<span className="block break-all text-ink-secondary">Proposed SHA-256 {skill.sha256}</span>{target.before.skills.filter(existing => existing.name === skill.name).map((existing, index) => <details key={index} className="mt-1"><summary className="cursor-pointer">Current {skill.name} · {existing.kind} · {existing.enabled ? "enabled" : "disabled"} · {existing.assigned ? "assigned" : "not assigned"}</summary><p className="break-all text-ink-secondary">Source {existing.source} · Revision {existing.revision}</p><pre className={text}>{existing.content ?? "Current skill content could not be read. Resolve the conflict through the existing skill controls."}</pre></details>)}</li>)}</ul>
          </article>)}
          <section aria-labelledby={`${prefix}-skills-title`} className="space-y-2 border-t border-hairline pt-3"><h5 id={`${prefix}-skills-title`} className="font-medium">All eight exact skill documents</h5>{preview.bundle.skills.map(skill => <details key={skill.name}><summary className="cursor-pointer break-words py-1 text-sm">{skill.name}</summary><pre className={text}>{skill.content}</pre>{skill.warnings?.length ? <ul className="list-disc pl-5 text-xs text-danger">{skill.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}</details>)}</section>
          {!preview.changesNeeded && !blockReasons.length && <p role="status">The selected roles already have these exact enhancements. No apply is needed.</p>}
          <label className="flex items-start gap-2"><input className="mt-1" type="checkbox" checked={reviewed} disabled={Boolean(busy) || Boolean(blockReasons.length) || !preview.changesNeeded || mustRefresh} onChange={event => setReviewed(event.target.checked)} /><span>I reviewed these exact agents, instructions, all eight skill documents and assignment changes.</span></label>
          <div className="flex flex-wrap gap-2"><button ref={cancelReview} type="button" className={button} disabled={Boolean(busy)} onClick={() => { setPreview(null); setReviewed(false); previewButton.current?.focus(); }}>Cancel enhancement review</button><button type="button" className={`${button} bg-accent text-white`} disabled={Boolean(busy) || !reviewed || Boolean(blockReasons.length) || !preview.changesNeeded || mustRefresh} onClick={() => void apply()}>Apply reviewed enhancements</button></div>
        </section>}
      </>}
      {receipt && <details open className="space-y-2 rounded-md border border-hairline p-3"><summary className="cursor-pointer font-medium">Setup receipt: {receipt.state}</summary><p className="break-all text-xs">Reviewed targets: {receipt.targetIds.join(", ")}</p><p className="break-all text-xs">Review {receipt.previewHash}</p>{receipt.gaps.length > 0 && <ul className="list-disc pl-5">{receipt.gaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul>}<p className="text-xs text-ink-secondary">An applied receipt is confirmed only after the separate current-state readback above succeeds.</p></details>}
    </>}
  </section>;
}
