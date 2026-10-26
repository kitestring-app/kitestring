import { useEffect, useSyncExternalStore } from "react";
import { useTimerView } from "../state/timer";
import { useStore } from "../lib/store";
import { settings } from "../state/settings";
import { boundaryAlert } from "../audio/boundaryAlert";
import { SEGMENT_LABEL } from "../state/timerEngine";

/** Shows the countdown in the browser tab (pinned tabs show it too). Renders nothing. */
export function TitleSync() {
  const v = useTimerView();
  const showNumbers = useStore(settings, s => s.timer.showNumbers);
  const sound = useSyncExternalStore(boundaryAlert.subscribe, boundaryAlert.get);
  const label = v.mode === "animedoro" && v.state.segment === "long" ? "Watch time" : SEGMENT_LABEL[v.state.segment];
  const text = v.running || v.elapsed > 0 ? `${v.display} · ${label}${v.running ? "" : " (paused)"}` : "Kitestring";
  const trayLabel = v.state.segment === "focus" ? "Focus" : "Break";
  const trayText = v.running || v.elapsed > 0 ? `${trayLabel}${showNumbers && (v.running || v.elapsed > 0) ? ` ${v.display}` : ""}${!v.running && v.elapsed > 0 ? " (paused)" : ""}` : "";
  const hasProgress = v.elapsed > 0;
  useEffect(() => {
    window.desktop?.publishTimerState?.({ segment: v.state.segment, running: v.running, hasProgress, ringing: sound.ringing, sounding: sound.sounding, hardLocked: v.hardLocked ?? false });
  }, [v.state.segment, v.running, hasProgress, sound.ringing, sound.sounding, v.hardLocked]);
  useEffect(() => {
    document.title = text;
    window.desktop?.setStatus?.(trayText);
  }, [text, trayText]);
  return null;
}
