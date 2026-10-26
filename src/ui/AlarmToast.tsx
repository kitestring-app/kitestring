import { useSyncExternalStore } from "react";
import { boundaryAlert } from "../audio/boundaryAlert";
import { HardModeBadge } from "./timer/EndSession";
import { timerActions, useTimerView } from "../state/timer";
import "./AlarmToast.css";

export function AlarmToast() {
  const v = useTimerView();
  const sound = useSyncExternalStore(boundaryAlert.subscribe, boundaryAlert.get);
  if (!sound.ringing) return null;
  return <aside className="alarm-toast panel" role="status" aria-label="Timer alert">
    <span>Timer alert</span>{v.hardLocked && <HardModeBadge />}
    <button className="btn small" onClick={() => void timerActions.stopSound()}>Stop sound</button>
    <button className="btn small" disabled={v.hardLocked} title={v.hardLocked ? "Hard mode: this block runs to the end" : undefined} aria-label="Stop sound and pause" onClick={() => void timerActions.stopAndPause()}>Pause</button>
  </aside>;
}
