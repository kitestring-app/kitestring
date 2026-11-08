import { useEffect, useState } from "react";
import { useStore } from "../../lib/store";
import { DEFAULT_NUDGE_MESSAGE, NUDGE_INTERVALS, NUDGE_MESSAGE_MAX, idleNudge, idleNudgeUpdate, nudgeText, validTime } from "../../state/idleNudge";
import { deliverNudge } from "../../state/idleNudgeRunner";
import { Toggle } from "./SettingsControls";
import "./IdleNudgeCard.css";

const DAYS = [["Sun", "Sunday"], ["Mon", "Monday"], ["Tue", "Tuesday"], ["Wed", "Wednesday"], ["Thu", "Thursday"], ["Fri", "Friday"], ["Sat", "Saturday"]] as const;

/** Settings > Focus Timer: the opt-in "remind me to start" schedule. Stays on this device. */
export function IdleNudgeCard() {
  const cfg = useStore(idleNudge);
  const native = typeof window !== "undefined" && !!window.desktop?.nudge;
  const webPermission = !native && typeof window !== "undefined" && "Notification" in window ? Notification.permission : null;
  const [nativeStatus, setNativeStatus] = useState<{ supported: boolean; failed: boolean } | null>(null);
  const [msg, setMsg] = useState("");
  // Permission is read on each render; a finished prompt re-renders so the card stops asking.
  const [, setAsked] = useState(0);
  const askPermission = () => void Notification.requestPermission().then(() => setAsked(n => n + 1), () => setAsked(n => n + 1));
  useEffect(() => { if (native) void window.desktop?.notificationStatus?.().then(setNativeStatus); }, [native]);
  const intervals: number[] = NUDGE_INTERVALS.includes(cfg.every as (typeof NUDGE_INTERVALS)[number]) ? [...NUDGE_INTERVALS] : [...NUDGE_INTERVALS, cfg.every].sort((a, b) => a - b);
  const enable = (enabled: boolean) => {
    idleNudgeUpdate({ enabled });
    if (enabled && webPermission === "default") askPermission();
  };
  const off = !cfg.enabled;
  return (
    <div className="card">
      <h3>Remind me to start</h3>
      <Toggle title="Idle reminder" help="A quiet notification when the timer has been idle for a while. Never during a block. Stays on this device." checked={cfg.enabled} onChange={enable} />
      <div className="field-grid" aria-disabled={off}>
        <label htmlFor="nudge-every">Remind every</label>
        <select id="nudge-every" className="input" style={{ maxWidth: 200 }} disabled={off} value={cfg.every} onChange={e => idleNudgeUpdate({ every: Number(e.target.value) })}>
          {intervals.map(n => <option key={n} value={n}>{n < 60 || n % 60 ? `${n} minutes` : n === 60 ? "1 hour" : `${n / 60} hours`}</option>)}
        </select>
        <label htmlFor="nudge-from">Between</label>
        <span className="row" style={{ flexWrap: "wrap" }}>
          <input id="nudge-from" className="input" type="time" style={{ maxWidth: 140 }} disabled={off} value={cfg.from} onChange={e => { if (validTime(e.target.value)) idleNudgeUpdate({ from: e.target.value }); }} />
          <span className="muted">and</span>
          <input id="nudge-to" aria-label="Until" className="input" type="time" style={{ maxWidth: 140 }} disabled={off} value={cfg.to} onChange={e => { if (validTime(e.target.value)) idleNudgeUpdate({ to: e.target.value }); }} />
        </span>
        <label id="nudge-days-label">On</label>
        <div className="segmented nudge-days" role="group" aria-labelledby="nudge-days-label">
          {DAYS.map(([short, long], i) => (
            <button key={short} type="button" aria-label={long} aria-pressed={cfg.days[i]} disabled={off}
              onClick={() => idleNudgeUpdate({ days: cfg.days.map((on, j) => j === i ? !on : on) })}>{short}</button>
          ))}
        </div>
        <label htmlFor="nudge-message">Message</label>
        <input id="nudge-message" className="input" type="text" maxLength={NUDGE_MESSAGE_MAX} disabled={off} placeholder={DEFAULT_NUDGE_MESSAGE} value={cfg.message} onChange={e => idleNudgeUpdate({ message: e.target.value })} />
      </div>
      {cfg.enabled && <p className="help" style={{ marginTop: 10 }}>
        {!cfg.days.some(Boolean) ? "No days are picked, so it won’t remind you. "
          : cfg.from === cfg.to ? "Runs all day on the picked days. " : cfg.to < cfg.from ? "Runs past midnight into the next morning. " : ""}
        The first reminder comes {cfg.every} minutes after the window opens or the timer stops.
      </p>}
      {cfg.enabled && webPermission === "denied" && <p className="help" role="status">This browser blocks notifications for Kitestring, so the reminder can’t appear. Allow them in the site settings.</p>}
      {cfg.enabled && webPermission === "default" && <p className="help" role="status">
        Needs notification permission. <button type="button" className="btn small" onClick={askPermission}>Allow notifications</button>
      </p>}
      {cfg.enabled && webPermission === null && !native && <p className="help" role="status">This browser can’t show notifications, so the reminder can’t appear here.</p>}
      {cfg.enabled && native && nativeStatus && (!nativeStatus.supported || nativeStatus.failed) && <p className="help" role="status">macOS reports notifications are unavailable. Allow them in System Settings &gt; Notifications &gt; Kitestring.</p>}
      {cfg.enabled && <div className="row" style={{ marginTop: 10 }}>
        <button type="button" className="btn small" onClick={() => void deliverNudge(nudgeText(cfg)).then(ok => setMsg(ok ? "Sent. Look for the notification." : "Couldn’t show a notification. Check notification permission."))}>Send a test reminder</button>
        {msg && <span className="help" role="status">{msg}</span>}
      </div>}
    </div>
  );
}
