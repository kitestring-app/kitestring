import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "../../lib/store";
import { settings, settingsUpdate, type SettingsTab } from "../../state/settings";
import { Icon } from "../icons";
import { TimerTab } from "./TimerTab";
import { ClockTab } from "./ClockTab";
import { ExtrasTab } from "./ExtrasTab";
import { DataTab } from "./DataTab";
import { AboutTab } from "./AboutTab";
import { ThemesTab } from "./ThemesTab";
import { StatsTab } from "./StatsTab";
import { QuotesTab } from "./QuotesTab";
import "./SettingsDrawer.css";

const TABS: { id: SettingsTab; label: string; icon: keyof typeof Icon; view: () => ReactNode }[] = [
  { id: "themes", label: "Themes", icon: "palette", view: ThemesTab },
  { id: "clock", label: "Clock", icon: "clock", view: ClockTab },
  { id: "timer", label: "Focus Timer", icon: "timer", view: TimerTab },
  { id: "stats", label: "Stats", icon: "stats", view: StatsTab },
  { id: "quotes", label: "Quotes", icon: "quote", view: QuotesTab },
  { id: "extras", label: "Extras", icon: "sparkle", view: ExtrasTab },
  { id: "data", label: "Your data", icon: "data", view: DataTab },
  { id: "about", label: "About", icon: "info", view: AboutTab },
];

export function SettingsDrawer({ onClose, initialTab }: { onClose: () => void; initialTab?: SettingsTab }) {
  const s = useStore(settings);
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? (s.extras.defaultTab === "recent" ? s.lastTab : s.extras.defaultTab));
  const tabs = TABS.filter(t => !s.extras.hideStats || t.id !== "stats");
  const current = tabs.find(t => t.id === tab) ?? TABS.find(t => t.id === "timer")!;
  const View = current.view;
  const pick = (id: SettingsTab) => {
    setTab(id);
    settingsUpdate("lastTab", id);
  };
  const root = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    nav.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current.id]);
  const openerRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // modal behaviour: focus in on open, keep Tab inside, Escape from anywhere (fields too), focus back on close
  useEffect(() => {
    // Setting the background inert can blur the toolbar before this effect runs.
    openerRef.current ??= document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement : document.querySelector<HTMLElement>('[aria-label="Settings (S)"]');
    const opener = openerRef.current;
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); closeRef.current(); return; }
      if (e.key !== "Tab" || !root.current) return;
      const items = [...root.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute("disabled") && x.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      opener?.focus();
      // React removes the background's inert flag during the same unmount commit.
      queueMicrotask(() => { if (opener?.isConnected && !document.querySelector(".drawer")) opener.focus(); });
    };
  }, []);
  return (
    <div ref={root} className="drawer" role="dialog" aria-modal="true" aria-label="Settings" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <header className="settings-header">
        <h2>{current.label}</h2>
        <button ref={closeBtn} className="settings-close" onClick={onClose} aria-label="Close settings · Escape"><span className="iconbtn"><Icon.close /></span></button>
      </header>
      <nav ref={nav} aria-label="Settings sections">
        {tabs.map((t) => {
          const I = Icon[t.icon];
          return (
            <button key={t.id} className="tab" aria-current={current.id === t.id} onClick={() => pick(t.id)}>
              <I /> {t.label}
            </button>
          );
        })}
      </nav>
      <main>
        <View />
      </main>
    </div>
  );
}

/** Shared settings building blocks. */
export { Toggle } from "./SettingsControls";

export function Choices<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string; preview?: ReactNode }[]; onChange: (v: T) => void }) {
  // Plain text options read best as one compact segmented control; options with previews stay as cards.
  if (!options.some((o) => o.preview)) {
    return (
      <div className="segmented" role="group">
        {options.map((o) => (
          <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>{o.label}</button>
        ))}
      </div>
    );
  }
  return (
    <div className="grid3">
      {options.map((o) => (
        <button key={o.id} className="choice" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.preview}
          <span className="lbl">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
