import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import page from "../../public/research.html?raw";
import "./EvidenceLink.css";

export function EvidenceLink() {
  const link = useRef<HTMLAnchorElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return <>
    <a ref={link} href="./research.html" onClick={event => { event.preventDefault(); setOpen(true); }}>Why it works this way</a>
    {open && createPortal(<EvidenceReader close={close} opener={link.current} />, document.body)}
  </>;
}

function EvidenceReader({ close, opener }: { close: () => void; opener: HTMLElement | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    // Settings has a document-level keyboard trap. This top-layer reader owns its keys.
    const onKey = (event: KeyboardEvent) => {
      if (!el.contains(event.target as Node)) return;
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); close(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      el.close();
      opener?.focus();
    };
  }, [close, opener]);
  return <dialog ref={dialog} className="evidence-reader" aria-label="Why it works this way" onCancel={event => { event.preventDefault(); close(); }}>
    <header><button className="btn" autoFocus onClick={close}>Close evidence</button></header>
    <iframe title="Evidence and sources" srcDoc={page} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" onLoad={event => {
      const doc = event.currentTarget.contentDocument;
      // srcDoc otherwise resolves fragment links against the dashboard URL.
      doc?.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach(link => {
        link.href = `about:srcdoc${link.getAttribute("href")}`;
      });
      doc?.querySelectorAll('a[href="./"]').forEach(link => link.addEventListener("click", event => { event.preventDefault(); close(); }));
      doc?.addEventListener("keydown", event => {
        if (event.key === "Escape") { event.preventDefault(); close(); }
      });
    }} />
  </dialog>;
}
