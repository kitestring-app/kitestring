import type { ReactNode } from "react";
import { Glyph } from "./Glyph";
import type { GlyphName } from "./Glyph";
import { Icon } from "./icons";
import "./RecoveryCard.css";

export function FocusCard({ title, icon, label, note, onClose, children, actions, className = "" }: {
  title: string; icon: GlyphName; label: string; note: string; onClose: () => void; children?: ReactNode; actions?: ReactNode; className?: string;
}) {
  return <aside className={`recovery-card chrome ${className}`} aria-label={label}>
    <div className="recovery-heading"><Glyph name={icon} size={20} /><h2>{title}</h2>
      <button className="iconbtn" aria-label="Close" onClick={onClose}><Icon.close /></button>
    </div>
    <p className="muted small">{note}</p>
    {children && <div className="focus-card-body">{children}</div>}
    {actions}
  </aside>;
}
