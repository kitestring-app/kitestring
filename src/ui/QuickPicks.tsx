import { useState } from "react";
import { useStore } from "../lib/store";
import { settings } from "../state/settings";
import { quickBreakSegment } from "../state/timerEngine";
import { recoveryCommand, requestQuickPick, useTimerView, type QuickPickKind } from "../state/timer";
import { useRecoveryOffer } from "./RecoveryCard";
import "./QuickPicks.css";

/** Opt-in one-tap lengths. Each pick runs one block at that length and leaves the saved lengths alone. */
export function QuickPicks() {
  const picks = useStore(settings, s => s.timer.quickPicks), mode = useStore(settings, s => s.timer.mode);
  const view = useTimerView(), recovery = useRecoveryOffer();
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const idle = !view.hardLocked && !view.running && view.elapsed === 0 && !recovery;
  // Countdown and Stopwatch have no breaks, so their break row stays hidden.
  const breaks = quickBreakSegment(mode, view.state.segment) ? picks.breaks : [];
  if (!picks.enabled || !idle || (picks.focus.length === 0 && breaks.length === 0)) return null;
  const pick = async (kind: QuickPickKind, minutes: number) => {
    setBusy(true);
    try { setError(await requestQuickPick(recoveryCommand(), kind, minutes) ? "" : "The timer changed. Try again from an idle block."); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  const row = (kind: QuickPickKind, label: string, list: number[]) => list.length > 0 &&
    <div className="quick-start-row" role="group" aria-label={`Start ${label.toLowerCase()} for`}>
      <span className="quick-start-label small">{label}</span>
      {list.map(minutes => <button key={minutes} type="button" className="btn small" disabled={busy}
        aria-label={`Start ${label.toLowerCase()} for ${minutes} minutes`} onClick={() => void pick(kind, minutes)}>{minutes} min</button>)}
    </div>;
  return <div className="quick-start chrome">
    {row("focus", "Focus", picks.focus)}
    {row("break", mode === "animedoro" ? "Watch time" : "Break", breaks)}
    {error && <p className="small" role="alert">{error}</p>}
  </div>;
}
