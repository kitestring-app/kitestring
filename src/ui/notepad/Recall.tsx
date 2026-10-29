import { useEffect, useRef, useState } from "react";
import { appendRecall } from "../../state/notes";
import { NOTES_LIMIT } from "../../state/notesModel";

export function Recall({ requested = 0 }: { requested?: number }) {
  const [open, setOpen] = useState(requested > 0);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const entry = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => { if (requested) { setOpen(true); setSaved(false); } }, [requested]);
  useEffect(() => {
    if (open) input.current?.focus();
    else if (returnFocus.current) { entry.current?.focus(); returnFocus.current = false; }
  }, [open]);
  const close = () => { if (working.current) return; returnFocus.current = true; setOpen(false); };
  return <section className="note-recall" aria-label="Explain from memory" onKeyDown={event => {
    if (open && event.key === "Escape" && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    {open ? <form onSubmit={async event => {
      event.preventDefault(); if (working.current) return;
      working.current = true; setBusy(true);
      try { await appendRecall(draft); setDraft(""); setError(""); setSaved(true); returnFocus.current = true; setOpen(false); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save. Your explanation is kept here. Retry when ready."); }
      finally { working.current = false; setBusy(false); }
    }} aria-busy={busy}>
      <h3>Explain from memory</h3>
      <p className="small">At a study boundary you choose, put your material aside. How would you explain the idea and how it connects to what you know? Then return to your source to check and correct it. Nothing is graded.</p>
      <p className="small muted">Saved text is appended to Notes. It follows your existing Notes sync choice when signed in and travels in exports that include Focus data.</p>
      <label>Your explanation (optional)<textarea ref={input} className="input note-source" value={draft} maxLength={NOTES_LIMIT} disabled={busy} onChange={event => setDraft(event.target.value)} /></label>
      <div className="row"><button className="btn small" disabled={busy || !draft.trim()} type="submit">Save to Notes</button><button className="btn small" type="button" disabled={busy} onClick={close}>Close practice</button></div>
      {error && <p className="small" role="alert">{error}</p>}
    </form> : <button className="btn small" ref={entry} onClick={() => { setSaved(false); setOpen(true); }}>Explain from memory</button>}
    {saved && <p className="small" role="status">Saved in Notes. Return to your material to check your explanation.</p>}
  </section>;
}
