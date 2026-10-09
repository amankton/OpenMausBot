import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileInput } from "lucide-react";
import {
  MEETING_REVIEW_MAX_BYTES, meetingReviewDraft, parseMeetingReview,
  type MeetingReviewBundle, type MeetingReviewSelection,
} from "../../shared/meeting-review";

export function MeetingReviewImport({ targetName, disabled, onAppendDraft }: {
  targetName: string;
  disabled: boolean;
  onAppendDraft: (text: string) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);
  const titleId = useId();
  const [bundle, setBundle] = useState<MeetingReviewBundle | null>(null);
  const [choices, setChoices] = useState<MeetingReviewSelection[]>([]);
  const [includeTranscript, setIncludeTranscript] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => {
    if (!bundle) return;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); };
  }, [bundle]);

  async function readFile(file: File | undefined) {
    if (!file || disabled) return;
    const current = ++generation.current;
    setError(""); setNotice(""); setLoading(true);
    try {
      if (file.size > MEETING_REVIEW_MAX_BYTES) throw new Error("Meeting review files must be 512 KiB or smaller.");
      const parsed = parseMeetingReview(await file.text());
      if (current !== generation.current) return;
      setChoices(parsed.items.map(item => ({ id: item.id, text: item.text, selected: false })));
      setConfirmed(false); setIncludeTranscript(false); setBundle(parsed);
    } catch (failure) {
      if (current === generation.current) setError(failure instanceof Error ? failure.message : "Could not read the meeting review file.");
    } finally { if (current === generation.current) setLoading(false); }
  }
  function close() { generation.current++; setBundle(null); setChoices([]); setError(""); setConfirmed(false); }
  function change(index: number, fields: Partial<MeetingReviewSelection>) {
    setChoices(previous => previous.map((value, itemIndex) => itemIndex === index ? { ...value, ...fields } : value));
    setConfirmed(false);
  }
  function append() {
    if (!bundle || disabled) return;
    try {
      onAppendDraft(meetingReviewDraft(bundle, choices, includeTranscript, confirmed));
      close(); setNotice("Reviewed notes added to your draft. Nothing has been sent.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not prepare the draft."); }
  }
  const control = "rounded-xl border border-hairline bg-panel px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";
  return <>
    <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" onChange={event => {
      void readFile(event.target.files?.[0]); event.target.value = "";
    }} />
    <button type="button" disabled={disabled || loading} aria-label="Import reviewed meeting notes" title="Import reviewed meeting notes"
      className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-50"
      onClick={() => fileInput.current?.click()}><FileInput size={17} /></button>
    {!bundle && error && <span role="alert" className="max-w-64 text-xs text-danger">{error}</span>}
    <span role="status" className="sr-only">{loading ? "Reading meeting review…" : notice}</span>
    {bundle && createPortal(<dialog ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); close(); }}
      onKeyDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[min(42rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-hairline bg-panel p-5 text-ink shadow-2xl backdrop:bg-black/55">
      <h2 id={titleId} className="text-lg font-semibold">Review meeting notes for {targetName}</h2>
      <p className="mt-2 text-sm text-ink-secondary">Choose what to add to this private agent’s draft. Your existing text and attachments stay. Nothing is sent until you use Send.</p>
      <p className="mt-2 text-sm text-ink-secondary">This file’s origin is not independently verified. Review its content and confirm you may share it with this agent.</p>
      <details className="mt-3 text-sm"><summary>File provenance: {bundle.source.title}</summary>
        <dl className="mt-2 break-words">
          <dt>Workspace</dt><dd>{bundle.source.workspace}</dd><dt>Meeting</dt><dd>{bundle.source.meetingId}</dd>
          <dt>Session / revision</dt><dd>{bundle.source.sessionId} / {bundle.source.revision}</dd>
          <dt>Shared reviewer</dt><dd>{bundle.review.reviewerPersonId}</dd><dt>Exported</dt><dd>{bundle.exportedAt}</dd>
        </dl>
      </details>
      {choices.map((choice, index) => {
        const original = bundle.items[index];
        return <fieldset key={choice.id} className="mt-4 rounded-xl border border-hairline p-3">
          <legend className="px-1 text-sm">{original.kind === "decision" ? "Reviewed decision" : "Suggested action"}</legend>
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={choice.selected} onChange={event => change(index, { selected: event.target.checked })} /> Include this item</label>
          <label className="mt-2 block text-sm">Text for your draft<textarea className={`${control} mt-1 block w-full`} rows={3} maxLength={4000} value={choice.text} onChange={event => change(index, { text: event.target.value })} /></label>
          <blockquote className="mt-2 whitespace-pre-wrap break-words border-l-2 border-hairline pl-3 text-sm text-ink-secondary">{original.source.speaker} · {Math.floor(original.source.startMs / 1000)}s{"\n"}{original.source.text}</blockquote>
        </fieldset>;
      })}
      {bundle.transcript !== undefined && <>
        <details className="mt-4 text-sm"><summary>Read included transcript ({bundle.transcript.length} segments)</summary>
          {bundle.transcript.map(segment => <p key={segment.id} className="mt-2 whitespace-pre-wrap break-words"><strong>{segment.speaker}</strong> · {Math.floor(segment.startMs / 1000)}s{"\n"}{segment.text}</p>)}
        </details>
        <label className="mt-3 flex gap-2 text-sm"><input type="checkbox" checked={includeTranscript} onChange={event => { setIncludeTranscript(event.target.checked); setConfirmed(false); }} /> Include this transcript in the draft (off by default)</label>
      </>}
      <label className="mt-4 flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> I reviewed the selected material and want to add it to this agent’s draft.</label>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" autoFocus className={control} onClick={close}>Cancel</button>
        <button type="button" className={control} disabled={disabled || !confirmed || (!choices.some(choice => choice.selected) && !(includeTranscript && bundle.transcript?.length))} onClick={append}>Add reviewed notes to draft</button>
      </div>
    </dialog>, document.body)}
  </>;
}
