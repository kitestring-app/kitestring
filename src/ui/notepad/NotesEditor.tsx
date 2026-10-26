import { useRef, useState } from "react";
import { NOTES_LIMIT } from "../../state/notesModel";
import { formatSelection, safeLink, toggleChecklist } from "./markdown";
import type { Format } from "./markdown";
import { MarkdownPreview } from "./MarkdownPreview";
const FORMATS: [Format, string, string][] = [["bold", "Bold", "B"], ["italic", "Italic", "I"], ["heading", "Heading", "H"], ["bullet", "Bullet list", "• List"], ["numbered", "Numbered list", "1. List"], ["checklist", "Checklist", "☑ List"], ["link", "Link", "Link"]];
export function NotesEditor({ text, onChange }: { text: string; onChange: (text: string) => void }) {
  const input = useRef<HTMLTextAreaElement>(null);
  const selection = useRef({ start: 0, end: 0 });
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const remember = () => { if (input.current) selection.current = { start: input.current.selectionStart, end: input.current.selectionEnd }; };
  const apply = (format: Format, href?: string) => {
    const edit = formatSelection(text, selection.current.start, selection.current.end, format, href);
    if (edit.text.length > NOTES_LIMIT) { setError("This note is full. Remove some text before adding formatting."); return; }
    onChange(edit.text); setError("");
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(edit.start, edit.end); remember(); });
  };
  return <div className="notes-editor">
    <div className="note-toolbar" role="group" aria-label="Note formatting">
      {FORMATS.map(([format, label, glyph]) => <button type="button" className="btn small" key={format} aria-label={label} title={label} onMouseDown={event => event.preventDefault()} onClick={() => {
        if (document.activeElement === input.current) remember();
        if (format === "link") { setLinkOpen(value => !value); setUrl(""); } else apply(format);
      }}>{glyph}</button>)}
    </div>
    {linkOpen && <form className="note-link row" onSubmit={event => { event.preventDefault(); const href = safeLink(url); if (!href) { setError("Enter a full https://, http:// or mailto: link."); return; } apply("link", href); setLinkOpen(false); }}>
      <label>Link address<input className="input" value={url} autoFocus onChange={event => setUrl(event.target.value)} placeholder="https://example.com" /></label>
      <button className="btn small" type="submit">Add link</button><button className="btn small" type="button" onClick={() => { setLinkOpen(false); input.current?.focus(); }}>Cancel</button>
    </form>}
    <p className="faint small">Write with Markdown or use the toolbar. Tick checklist items in the preview.</p>
    <textarea ref={input} className="input note-source" value={text} maxLength={NOTES_LIMIT} placeholder="Brain dump, ideas, next steps…" aria-label="Notes" autoFocus onSelect={remember} onBlur={remember} onChange={event => { onChange(event.target.value); remember(); }} onKeyDown={event => {
      if ((event.metaKey || event.ctrlKey) && ["b", "i"].includes(event.key.toLowerCase())) { event.preventDefault(); remember(); apply(event.key.toLowerCase() === "b" ? "bold" : "italic"); }
    }} />
    {error && <p role="alert" className="small">{error}</p>}
    {text && <MarkdownPreview text={text} onCheck={line => onChange(toggleChecklist(text, line))} />}
  </div>;
}
