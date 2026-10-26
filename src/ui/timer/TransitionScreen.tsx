import { useEffect, useRef, useSyncExternalStore } from "react";
import { boundaryAlert } from "../../audio/boundaryAlert";
import { useStore } from "../../lib/store";
import { settings } from "../../state/settings";
import { currentTask, focusPick, tasks } from "../../state/tasks";
import { timerActions, useTimerView } from "../../state/timer";
import { durationMs, fmt } from "../../state/timerEngine";
import { transitionStore, type TransitionNotice } from "./TransitionStore";
import "./TransitionScreen.css";
import { Glyph } from "../Glyph";
import { alertTypingGuard } from "../../lib/alertTypingGuard";

export function TransitionScreen() {
  const notice = useSyncExternalStore(transitionStore.subscribe, transitionStore.get);
  return notice ? <TransitionPrompt key={notice.segId} notice={notice} /> : null;
}

function TransitionPrompt({ notice }: { notice: TransitionNotice }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const openedAt = useRef(0);
  const glassStyle = useStore(settings, (st) => st.appearance.reminderGlass);
  const v = useTimerView();
  const t = useStore(settings, (s) => s.timer);
  const sound = useSyncExternalStore(boundaryAlert.subscribe, boundaryAlert.get);
  const all = useStore(tasks);
  useStore(focusPick);
  const task = currentTask(all)?.title.trim();
  const singleSession = t.mode === "countdown" || t.mode === "stopwatch";
  const breakTime = notice.ended === "focus" && !singleSession;
  const nextIsRunning = v.state.segId === notice.nextSegId && v.running && v.state.segment === (breakTime ? notice.breakSegment : "focus");
  const autoStarted = notice.autoStarted || nextIsRunning;
  const cycleComplete = notice.cycleComplete;
  const breakTotal = v.state.segment === notice.breakSegment ? v.total : durationMs(t, notice.breakSegment);

  useEffect(() => {
    const el = dialog.current!;
    el.showModal(); // The browser makes everything outside the dialog inert, including other open panels.
    // The reminder can appear while the person is typing in another app. Focus the heading, not a button,
    // and wait for a quiet keyboard so a keystroke in flight never answers it.
    const opened = performance.now();
    openedAt.current = opened;
    el.querySelector?.<HTMLElement>("#transition-title")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (alertTypingGuard.keydown(e)) return;
      // Window capture also blocks the dashboard shortcuts and the settings drawer's focus trap.
      if ((e.target as HTMLElement)?.closest?.(".end-session")) return;
      // After keyboard quiet, let the deliberately focused button receive native activation.
      if ((e.key === "Enter" || e.key === " ") && (e.target as HTMLElement)?.closest?.("button") && el.contains(e.target as Node)) return;
      e.stopImmediatePropagation();
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault(); proceed(); return;
      }
      if (e.key === "Escape") { e.preventDefault(); later(); return; }
      if (e.metaKey && e.key === ".") { e.preventDefault(); void timerActions.stopSound(); return; }
      if (e.key !== "Tab") return;
      e.preventDefault();
      const buttons = [...el.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(index + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      el.close();
    };
  }, [breakTime, notice.segId]);

  const nextSegment = breakTime ? notice.breakSegment : "focus";
  const segment = (autoStarted ? v.state.segment : nextSegment) as "focus" | "short" | "long";
  const stateLabel = segment === "focus" ? "Focus" : segment === "long" ? "Long break" : "Short break";
  const stateGlyph = segment === "focus" ? "target" : segment === "long" ? "moon" : "coffee";
  const locked = v.hardLocked;
  const title = singleSession ? (autoStarted ? "Countdown restarted" : "Session complete")
    : cycleComplete ? "Cycle complete"
    : autoStarted ? (breakTime ? "Your break has started" : "Focus has started")
    : breakTime ? "Time for a break" : "Ready to focus";
  const instruction = singleSession ? (autoStarted ? "Your next countdown is running." : "Start another session when you’re ready.")
    : cycleComplete ? "Nice work. Start another cycle when you’re ready."
    : breakTime ? "Stand up, look far away, drink some water."
    : autoStarted ? "Your next block is running." : "Take a breath. Your next block is ready.";
  // No buttons: one click anywhere continues, Escape means later. Any answer also silences the alarm.
  const proceed = () => timerActions.answerTransition(autoStarted ? "dismiss" : "start");
  const later = () => timerActions.answerTransition("dismiss");
  const hint = autoStarted ? "Click anywhere to close" : singleSession ? "Click to start again · Esc for later"
    : cycleComplete ? "Click to start the next cycle · Esc for later"
    : breakTime ? "Click to start your break · Esc for later" : "Click to start focusing · Esc for later";

  return (
    <dialog ref={dialog} className={`transition-screen is-${segment} glass-${glassStyle}`} role="alertdialog" aria-modal="true" aria-labelledby="transition-title" aria-describedby="transition-instruction transition-hint"
      onCancel={(e) => { e.preventDefault(); if (!alertTypingGuard.pending()) later(); }}
      onClick={() => { if (performance.now() - openedAt.current >= 400) proceed(); }}>
      <div className="transition-content">
        <span className="transition-state"><span className="transition-state-icon"><Glyph name={stateGlyph} size={15} /></span>{stateLabel}{locked && <Glyph name="lock" size={12} title="Hard mode" />}{sound.ringing && !sound.silenced && <span className="transition-ringing" aria-label="Alarm sounding"><Glyph name="bell" size={13} /></span>}</span>
        <h1 id="transition-title" tabIndex={-1}>{title}</h1>
        {!breakTime && task && <p className="transition-task">{task}</p>}
        {breakTime && !cycleComplete && <p className="transition-length">{autoStarted ? v.display : `${Math.round((breakTotal ?? 0) / 60_000)} min`}</p>}
        {!breakTime && autoStarted && !cycleComplete && <p className="transition-length">{v.total === null ? fmt(v.elapsed) : v.display}</p>}
        <p id="transition-instruction">{instruction}</p>
        <p className="transition-hint" id="transition-hint">{hint}</p>
        {/* Invisible on screen (the reminder stays buttonless), reachable by Tab and screen readers. */}
        <div className="sr-only">
          <button type="button" onClick={(e) => { e.stopPropagation(); proceed(); }}>{autoStarted ? "Close" : breakTime ? "Start break" : "Start focus"}</button>
          {!autoStarted && <button type="button" onClick={(e) => { e.stopPropagation(); later(); }}>Later</button>}
        </div>
      </div>
    </dialog>
  );
}
