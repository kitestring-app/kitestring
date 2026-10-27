import { EndSessionControl, HardModeBadge } from "./timer/EndSession";
import { useStore } from "../lib/store";
import { settings } from "../state/settings";
import { timerActions, useTimerView } from "../state/timer";
import { SEGMENT_LABEL } from "../state/timerEngine";
import { Icon } from "./icons";
import "./AmbientTimer.css";

export function AmbientTimer() {
  const v = useTimerView();
  const mode = useStore(settings, s => s.timer.mode);
  const segment = v.state.segment;
  const label = v.hiddenTime ? SEGMENT_LABEL[segment] : segment === "focus" && mode === "countdown" ? "Countdown" :
    segment === "focus" && mode === "stopwatch" ? "Stopwatch" :
    segment === "long" && mode === "animedoro" ? "Watch time" : SEGMENT_LABEL[segment];
  return <div className="ambient-timer chrome" role="group" aria-label="Ambient timer">
    <div className="ambient-timer-reading">
      <span className="ambient-timer-segment">{label}</span>
      <span className="ambient-timer-time" role="timer" aria-label={v.hiddenTime ? `${label}: ${v.timeDescription}, ${v.running ? "running" : "paused"}` : `${label}: ${v.display}`} aria-live="off">{v.hiddenTime ? (v.running ? "Running" : "Paused") : v.display}</span>
    </div>
    <button className="iconbtn" disabled={v.hardLocked} title={v.hardLocked ? "Hard mode: this block runs to the end" : undefined} onClick={() => timerActions.toggle()} aria-label={v.running ? "Pause ambient timer" : "Start ambient timer"}>
      {v.running ? <Icon.pause /> : <Icon.play />}
    </button>
    <button className="iconbtn" disabled={v.hardLocked} title={v.hardLocked ? "Hard mode: this block runs to the end" : undefined} onClick={() => timerActions.skip()} aria-label={mode === "stopwatch" ? "Finish ambient session" : "Skip ambient segment"}>
      {mode === "stopwatch" ? <Icon.stop /> : <Icon.skip />}
    </button>
    {v.hardLocked && <><HardModeBadge pendingOff={v.hardModePendingOff} /><EndSessionControl /></>}
  </div>;
}
