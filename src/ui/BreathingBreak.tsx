import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { breathingFrame } from "../state/breathing";
import type { BreathingPace, BreathingPattern } from "../state/breathing";
import { FocusCard } from "./FocusCard";
import "./BreathingBreak.css";

export function BreathingBreak({ hiddenTime, children }: { hiddenTime: boolean; children: (guide: ReactNode) => ReactNode }) {
  const [entryHost, setEntryHost] = useState<Element | null>(null);
  useEffect(() => { setEntryHost(document.querySelector(".focus-center > .tallies")); }, []);
  const [open, setOpen] = useState(false);
  const [pattern, setPattern] = useState<BreathingPattern>("even");
  const [pace, setPace] = useState<BreathingPace>(1);
  const [run, setRun] = useState<{ minutes: 1 | 5; at: number; wallAt: number } | null>(null);
  const [ended, setEnded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const entry = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLDivElement>(null);
  const mountHeading = useCallback((node: HTMLDivElement | null) => { heading.current = node; node?.focus(); }, []);
  const restoreFocus = useRef(false);
  const frame = breathingFrame(elapsed, run?.minutes ?? 1, pattern, pace);
  useEffect(() => {
    if (!run || frame.done) return;
    const update = () => setElapsed(Math.max(0, performance.now() - run.at, Date.now() - run.wallAt));
    const interval = setInterval(update, 200);
    document.addEventListener("visibilitychange", update);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", update); };
  }, [run, frame.done]);
  useEffect(() => {
    if (open) heading.current?.focus();
    else if (restoreFocus.current) { entry.current?.focus(); restoreFocus.current = false; }
  }, [open, run]);
  const close = () => { restoreFocus.current = true; setOpen(false); setEnded(!!run); setRun(null); setElapsed(0); };
  const announcement = run ? frame.done ? "Breathing ended." : "Breathing started." : ended ? "Breathing ended." : "";
  const live = entryHost && createPortal(<span className="sr-only breathing-live" role="status">{announcement}</span>, entryHost, "breathing-status");
  if (!open) return children(<>{entryHost && createPortal(<button className="btn small breathing-entry" ref={entry} onClick={() => setOpen(true)}>Breathe</button>, entryHost, "breathing-entry")}{live}</>);
  const instruction = pattern === "sigh" ? "Two short inhales, then one long exhale. No hold." : "Breathe in, then breathe out. No hold.";
  const actions = run ? frame.done ? <button className="btn small" onClick={close}>Close</button> : undefined :
    <div className="recovery-buttons">{([1, 5] as const).map(minutes => <button className="btn small" key={minutes}
      onClick={() => { setElapsed(0); setRun({ minutes, at: performance.now(), wallAt: Date.now() }); }}>Breathe for {minutes} {minutes === 1 ? "minute" : "minutes"}</button>)}</div>;
  return children(<><div className="breathing-host" ref={mountHeading} tabIndex={-1} onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); close(); } }}>
    <FocusCard title="Breathing break" icon="wind" label="Breathing break" className="breathing-card"
      note="Use a comfortable pace. Stop if it feels uncomfortable." onClose={close} actions={actions}>
      {run ? <div className="breathing-active">
        <p className="sr-only">{instruction}</p>
        <p className="breathing-static" aria-hidden="true">{frame.done ? "Breathing ended." : instruction}</p>
        <p className="breathing-paced" aria-hidden="true">{frame.done ? "Finished" : frame.phase}</p>
        {!hiddenTime && <p className="faint small" aria-live="off">{Math.ceil(frame.remaining / 1000)} seconds left</p>}
      </div> : <>
        <div className="recovery-buttons" role="group" aria-label="Breathing pattern">
          <button className="btn small" aria-pressed={pattern === "even"} onClick={() => setPattern("even")}>In and out</button>
          <button className="btn small" aria-pressed={pattern === "sigh"} onClick={() => setPattern("sigh")}>Cyclic sigh</button>
        </div>
        <div className="recovery-buttons" role="group" aria-label="Breathing pace">
          <button className="btn small" aria-pressed={pace === 1} onClick={() => setPace(1)}>Gentle</button>
          <button className="btn small" aria-pressed={pace === 1.5} onClick={() => setPace(1.5)}>Slower</button>
        </div>
        <p className="muted small">{instruction}</p>
      </>}
    </FocusCard>
  </div>{live}</>);
}
