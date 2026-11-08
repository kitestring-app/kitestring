import { useEffect, useSyncExternalStore } from "react";
import { useTimerView } from "../state/timer";
import { useStore } from "../lib/store";
import { settings } from "../state/settings";
import { boundaryAlert } from "../audio/boundaryAlert";
import { SEGMENT_LABEL } from "../state/timerEngine";
import { menuBarText, trayStatus } from "../state/menuBar";
import { intent } from "../state/intent";
import { currentTask, focusPick, tasks } from "../state/tasks";

/** Shows the countdown in the browser tab (pinned tabs show it too). Renders nothing. */
export function TitleSync() {
  const v = useTimerView();
  const showNumbers = useStore(settings, s => s.timer.showNumbers);
  const sound = useSyncExternalStore(boundaryAlert.subscribe, boundaryAlert.get);
  const label = v.hiddenTime ? SEGMENT_LABEL[v.state.segment] : v.mode === "animedoro" && v.state.segment === "long" ? "Watch time" : SEGMENT_LABEL[v.state.segment];
  const status = `${label} · ${v.running ? "Running" : "Paused"}`;
  const text = v.hiddenTime ? status : v.running || v.elapsed > 0 ? `${v.display} · ${label}${v.running ? "" : " (paused)"}` : "Kitestring";
  const countUp = useStore(settings, s => s.timer.display === "elapsed") || v.total === null;
  const prefs = useStore(menuBarText);
  // The pinned next action wins; otherwise the task the timer is working on.
  const action = useStore(intent, i => i.action.trim());
  const pick = useStore(focusPick);
  const taskTitle = useStore(tasks, all => currentTask(all, pick)?.title ?? "");
  const trayText = trayStatus({ segment: v.state.segment, running: v.running, elapsed: v.elapsed, remaining: v.remaining, countUp,
    display: v.display, hiddenTime: v.hiddenTime, hiddenStatus: status, showNumbers, name: action || taskTitle, prefs });
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
