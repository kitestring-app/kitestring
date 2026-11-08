import { canWriteClockStore } from "../lib/store";
import { boundaryAlert } from "../audio/boundaryAlert";
import { idleNudge, nudgeDue, nudgeText } from "./idleNudge";
import { hardModeLocked, timer } from "./timer";

/** Mac app: a native notification through the bridge. Web: a silent page notification, only if already allowed. */
export async function deliverNudge(text: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (window.desktop?.nudge) {
    try { return (await window.desktop.nudge(text)) === true; } catch { return false; }
  }
  if (!("Notification" in window) || Notification.permission !== "granted") return false;
  try {
    const n = new Notification("Kitestring", { body: text, tag: "kitestring-idle-nudge", silent: true });
    n.onclick = () => { window.focus(); n.close(); };
    return true;
  } catch {
    return false; // Some browsers only allow notifications from a service worker.
  }
}

/** The last reminder time is shared by this device's tabs, so a newly promoted clock owner doesn't repeat it. */
export const LAST_NUDGE_KEY = "kitestring-idle-nudge-last";
function sharedLastNudge(): number {
  try { const v = Number(globalThis.localStorage?.getItem(LAST_NUDGE_KEY)); return Number.isFinite(v) ? v : 0; } catch { return 0; }
}
function shareLastNudge(at: number) {
  try { globalThis.localStorage?.setItem(LAST_NUDGE_KEY, String(at)); } catch { /* Private mode: this tab still remembers it. */ }
}

const running = () => timer.get().startedAt !== null;
/** Never during a block, a Hard mode lock or a ringing end alarm. */
const busy = () => running() || hardModeLocked() || boundaryAlert.get().sounding || boundaryAlert.get().ringing;

/** Checks every 30 seconds on the main renderer. Only the clock owner (one tab, or the Mac main window) reminds. */
export function startIdleNudge({ now = Date.now, interval = 30_000, deliver = deliverNudge } = {}) {
  let idleSince = now();
  let lastNudgeAt: number | null = null;
  let wasRunning = running();
  let wasEnabled = idleNudge.get().enabled;
  const offTimer = timer.subscribe(() => {
    const isRunning = running();
    if (isRunning !== wasRunning) idleSince = now();
    wasRunning = isRunning;
  });
  // Switching it on, or changing the schedule, starts a fresh interval rather than reminding at once.
  const offSettings = idleNudge.subscribe(() => {
    const enabled = idleNudge.get().enabled;
    if (enabled && !wasEnabled) lastNudgeAt = now();
    wasEnabled = enabled;
  });
  const check = () => {
    const t = now();
    if (busy()) { idleSince = t; return; }
    if (!canWriteClockStore("timer")) return;
    const last = Math.max(lastNudgeAt ?? 0, sharedLastNudge()) || null;
    if (!nudgeDue(idleNudge.get(), { now: t, busy: false, idleSince, lastNudgeAt: last })) return;
    lastNudgeAt = t;
    shareLastNudge(t);
    void deliver(nudgeText(idleNudge.get()));
  };
  const id = setInterval(check, interval);
  return { check, stop() { clearInterval(id); offTimer(); offSettings(); } };
}
