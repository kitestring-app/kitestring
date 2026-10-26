import { chooseReviewBoundary, parkingReview, type ReviewBoundary } from "../../state/parkingReview";
import { useTimerView } from "../../state/timer";
import { useStore } from "../../lib/store";
import { applySupportPreset, presetState, quietTimer, supportPresetLabel, settings, settingsUpdate, type Settings, type TimerMode, type TimerStyle, type TallyId } from "../../state/settings";
import { previewChime, type AlertSound } from "../../audio/core";
import { FlipPalettePicker } from "../timer/FlipPalettePicker";
import { FACES } from "../timer/faces";
import { Choices, Toggle } from "./SettingsDrawer";
import { useEffect, useState } from "react";
import { companionAvailable, testCompanion } from "../../audio/companion";
import { matchPreset, PRESETS } from "../../state/presets";
import { TallyPreview } from "../FocusView";

/** Shows whether the macOS companion is running (alerts even with Chrome closed) and lets you test it. */
function CompanionStatus({ volume, alertSound }: { volume: number; alertSound: AlertSound }) {
  const t = useStore(settings, s => s.timer);
  const [up, setUp] = useState<boolean | null>(null);
  const [msg, setMsg] = useState("");
  const [notifications, setNotifications] = useState<{ supported: boolean; failed: boolean } | null>(null);
  useEffect(() => void companionAvailable().then(setUp), []);
  useEffect(() => { void window.desktop?.notificationStatus?.().then(setNotifications); }, []);
  if (quietTimer(t)) return <p className="help">Timer reminders are off. You can change individual choices below.</p>;
  if (typeof window !== "undefined" && window.desktop?.armAlarm) return <p className="help" style={{ marginTop: 6 }}>
    Mac app alarms: on (rings even when the window is closed)
    {notifications && <span>{notifications.supported && !notifications.failed ? ". Native notifications available; delivery follows macOS notification settings." : ". Native notifications are unavailable; check macOS notification settings."}</span>}
  </p>;
  if (up === null) return null;
  return (
    <p className="help" style={{ marginTop: 6 }}>
      {up ? (
        <>
          macOS alerts are on: notifications and sound fire even if Chrome is closed.{" "}
          <button className="btn small" onClick={() => void testCompanion("break-over", volume, alertSound).then((ok) => setMsg(ok ? "Sent a test alert." : "Test failed."))}>Test macOS alert</button>{" "}
          {msg}
        </>
      ) : (
        "macOS alerts are off here (the companion only runs at localhost:4747). This tab will still chime and notify while it's open."
      )}
    </p>
  );
}

const MODES: { id: TimerMode; label: string; help: string }[] = [
  { id: "pomodoro", label: "Pomodoro", help: "Focus, short break, and a long break every few sessions." },
  { id: "countdown", label: "Countdown", help: "One session, no built-in breaks." },
  { id: "stopwatch", label: "Stopwatch (count-up)", help: "Counts up until you finish. Good for open-ended flow." },
  { id: "animedoro", label: "Animedoro", help: "Longer focus, then watch an episode. Uses the Pomodoro length and Long Break as watch time." },
  { id: "5217", label: "52/17", help: "52 minutes of focus, 17 minutes of rest." },
];

export function TimerTab() {
  const reminderGlass = useStore(settings, (st) => st.appearance.reminderGlass);
  const v = useTimerView();
  const nativeAlarms = typeof window !== "undefined" && !!window.desktop?.armAlarm;
  const t = useStore(settings, (s) => s.timer);
  const support = useStore(presetState);
  const review = useStore(parkingReview);
  const [presetMessage, setPresetMessage] = useState("");
  const [presetBusy, setPresetBusy] = useState(false);
  const chooseSupport = async (mode: "Calm" | "Strong" | "Restore") => {
    setPresetBusy(true); setPresetMessage("");
    try { await applySupportPreset(mode); }
    catch (error) { setPresetMessage((error as Error).message); }
    finally { setPresetBusy(false); }
  };
  const [custom, setCustom] = useState(false);
  const preset = custom ? "custom" : matchPreset(t.lengths);
  const set = (patch: Partial<Settings["timer"]>) => settingsUpdate("timer", {
    ...patch,
    ...(patch.focusDoneSound !== undefined || patch.breakOverSound !== undefined ? { alertSound: patch.focusDoneSound ?? t.focusDoneSound } : {}),
  });
  const len = (k: keyof Settings["timer"]["lengths"], v: string) => {
    setCustom(true);
    const n = Math.max(1, Math.min(600, Math.round(Number(v) || 1)));
    set({ lengths: { ...t.lengths, [k]: n } });
  };
  const mode = MODES.find((m) => m.id === t.mode)!;
  const field = (k: keyof Settings["timer"]["lengths"], label: string) => (
    <div className="length-field">
      <label className="length-label" htmlFor={`len-${k}`}>{label}</label>
      <span className="num-field">
        <input id={`len-${k}`} type="number" min={1} max={600} value={t.lengths[k]} onChange={(e) => len(k, e.target.value)} />
        <span aria-hidden="true">min</span>
      </span>
      {(k === "short" || k === "long") && (
        <div className="quick-picks" role="group" aria-label={`${label} quick lengths`}>
          {(k === "short" ? [5, 10] : [10, 15, 20, 30]).map((n) => (
            <button key={n} type="button" aria-pressed={t.lengths[k] === n} onClick={() => len(k, String(n))}>{n}</button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <>
      <h1>Focus Timer</h1>
      <p className="lede">Customize your timer to match your workflow.</p>
      <Toggle title="Hard mode" help="Running focus and break blocks cannot be paused, skipped or reset. Ending early requires a 10-second hold and a reason." checked={t.hardMode} onChange={hardMode => set({ hardMode })} />
      {v.hardModePendingOff && <p role="status" className="help">Hard mode turns off after this block</p>}

      <div className="card">
        <h3>{supportPresetLabel()}</h3>
        <p className="help">Calm turns off timer reminders, ticking and auto-run. Both keep your lengths, sound mix, appearance and Hard mode choice.</p>
        <div className="row" role="group" aria-label="Support preset">
          <button className="btn small" disabled={presetBusy} onClick={() => void chooseSupport("Calm")}>Try Calm</button>
          {supportPresetLabel() !== "Strong" && <button className="btn small" aria-describedby="strong-preset-help" disabled={presetBusy} onClick={() => void chooseSupport("Strong")}>Strong</button>}
          {support.snapshot && <button className="btn small" disabled={presetBusy} onClick={() => void chooseSupport("Restore")}>Restore</button>}
        </div>
        {supportPresetLabel() !== "Strong" && <p className="help" id="strong-preset-help">Resets reminders to defaults</p>}
        <p className="help">Changing presets saves your current reminder choices once on this device. Restore puts those choices back.</p>
        {presetMessage && <p className="help" role="status">{presetMessage}</p>}
      </div>
      <div className="card">
        <h3>Timer mode</h3>
        <select className="input" style={{ maxWidth: 320 }} value={t.mode} onChange={(e) => set({ mode: e.target.value as TimerMode })}>
          {MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <p className="help" style={{ marginTop: 10 }}>{mode.help}</p>
        {(t.mode === "pomodoro" || t.mode === "animedoro") && (
          <Toggle title="Use Task ETA mode" help="The focus length follows the estimate of your current task." checked={t.taskEta} onChange={(v) => set({ taskEta: v })} />
        )}
        <label className="opt">Review parked thoughts
          <select className="input" aria-label="Review parked thoughts" value={review.boundary} onChange={e => chooseReviewBoundary(e.target.value as ReviewBoundary)}>
            <option value="never">Never automatically</option><option value="block">End of block</option><option value="session">End of session</option>
          </select>
        </label>
        <h3 style={{ marginTop: 14 }}>Timer lengths</h3>
        {(t.mode === "pomodoro" || t.mode === "animedoro") && (
          <div className="row" role="group" aria-label="Pomodoro presets" style={{ flexWrap: "wrap" }}>
            {PRESETS.map((p) => (
              <button key={p.id} className={`btn small ${preset === p.id ? "primary" : ""}`} aria-pressed={preset === p.id} onClick={() => {
                setCustom(p.id === "custom");
                if (p.lengths) set({ lengths: { ...t.lengths, ...p.lengths }, longEvery: p.longEvery });
              }}>{p.label}</button>
            ))}
          </div>
        )}
        <div className="length-grid">
          {t.mode === "5217" ? (
            <span className="muted">Fixed at 52 minutes of focus and 17 of rest.</span>
          ) : (
            <>
              {t.mode === "countdown" ? field("countdown", "Countdown") : t.mode !== "stopwatch" && field("pomodoro", "Focus")}
              {field("short", "Short break")}
              {field("long", t.mode === "animedoro" ? "Watch time" : "Long break")}
              {t.mode === "pomodoro" && (
                <div className="length-field">
                  <label className="length-label" htmlFor="len-every">Long break every</label>
                  <span className="num-field">
                    <input id="len-every" type="number" min={1} max={12} value={t.longEvery} onChange={(e) => set({ longEvery: Math.max(1, Math.min(12, Number(e.target.value) || 1)) })} />
                    <span aria-hidden="true">sessions</span>
                  </span>
                </div>
              )}
            </>
          )}
        </div>
        {t.mode === "countdown" && <Toggle title="Repeat countdown" help="Start a fresh countdown automatically when this one finishes. No breaks." checked={t.countdownRepeat} onChange={(countdownRepeat) => set({ countdownRepeat })} />}
        <h3>Auto-run</h3>
        <Choices<Settings["timer"]["autoRun"]>
          value={t.autoRun}
          onChange={(autoRun) => set({ autoRun })}
          options={[
            { id: "off", label: "Off: wait for me" },
            { id: "cycle", label: "Run one full cycle" },
            { id: "always", label: "Keep going" },
          ]}
        />
        <p className="help choice-help">{{ off: "Waits for you to start each focus session and break.", cycle: "Continues through the long break, then waits before the next focus session.", always: "Starts every next focus session and break on its own." }[t.autoRun]}</p>
        {(t.mode === "countdown" || t.mode === "stopwatch") && <p className="help">Auto-run has no effect on Countdown or Stopwatch.</p>}
      </div>

      <div className="card">
        <h3>Timer style</h3>
        <p className="help">Choose how the time remaining is displayed.</p>
        <Choices<TimerStyle>
          value={t.style}
          onChange={(v) => set({ style: v })}
          options={(["default", "flip", "bar", "gauge", "dots", "pie"] as TimerStyle[]).map((id) => {
            const F = FACES[id];
            return { id, label: { default: "Default", flip: "Flip Clock", bar: "Progress Bar", gauge: "Gauge", dots: "Dot Matrix", pie: "Pie" }[id], preview: <div style={{ fontSize: 22, minHeight: 64, display: "grid", placeItems: "center" }}><F display="25:00" progress={0.4} showNumbers big={false} /></div> };
          })}
        />
        {t.style === "flip" && <FlipPalettePicker />}
        <Toggle title="Show numbers" help="Hide them for a calmer, visual-only timer." checked={t.showNumbers} onChange={(v) => set({ showNumbers: v })} />
        <Toggle title="Show timer progress bar" help="A thin bar under the timer." checked={t.progressBar} onChange={(v) => set({ progressBar: v })} />
      </div>

      <div className="card">
        <h3>Alerts</h3>
        <p className="help">Each pack has different focus and break sounds.</p>
        {([['focusDoneSound', 'Focus done', 'focus-done'], ['breakOverSound', 'Break over', 'break-over']] as const).map(([field, label, kind]) => (
          <div className="row" key={field} style={{ marginBottom: 10 }}>
            <label className="row"><span>{label}</span>
              <select className="input" aria-label={label} value={t[field]} onChange={e => set({ [field]: e.target.value as AlertSound })}>
                {(["signature", "bell", "chime", "digital", "wood", "none"] as const).map(sound => <option key={sound} value={sound}>{sound[0].toUpperCase() + sound.slice(1)}</option>)}
              </select>
            </label>
            <button className="btn small" aria-label={`Preview ${label.toLowerCase()}`} disabled={t[field] === "none"} onClick={() => previewChime(t[field], t.alertVolume, kind)}>Preview</button>
          </div>
        ))}
        {t.focusDoneSound === "none" && t.breakOverSound === "none" && <p className="help" role="status">
          No sound will play when a segment ends.
          {window.desktop && <> macOS notifications follow System Settings &gt; Notifications &gt; Kitestring.</>}
        </p>}
        <CompanionStatus volume={t.alertVolume} alertSound={t.breakOverSound} />
        <label className="row"><span className="muted" style={{ width: 70 }}>Volume</span>
          <input className="range" aria-label="Alert volume" type="range" min={0} max={1} step={0.05} value={t.alertVolume} onChange={(e) => set({ alertVolume: Number(e.target.value) })} onPointerUp={() => previewChime(t.focusDoneSound, t.alertVolume)} />
        </label>
        <Toggle title="Show notification" help={nativeAlarms ? "A native Mac notification when a segment ends." : "A browser notification when a segment ends."} checked={t.notify} onChange={(v) => { set({ notify: v }); if (v && !nativeAlarms && "Notification" in window) void Notification.requestPermission(); }} />
        {typeof window !== "undefined" && window.desktop?.testReminder && <ReminderTest />}
        <div className="field-grid">
          <label>Reminder glass</label>
          <Choices<Settings["appearance"]["reminderGlass"]> value={reminderGlass} onChange={(v) => settingsUpdate("appearance", { reminderGlass: v })} options={[{ id: "frosted", label: "Frosted" }, { id: "clear", label: "Clear glass" }]} />
        </div>
        <Toggle title="Full-screen break/focus reminder" help="Keep the next step on screen until you choose it." checked={t.takeover} onChange={(v) => set({ takeover: v })} />
        <Toggle title="Say it out loud" help="Speak a short reminder after the alert sound." checked={t.speak} onChange={(v) => set({ speak: v })} />
        <Toggle title="Bring the app to the front (Mac app)" help="Bring the reminder forward when a segment ends." checked={t.bringToFront} onChange={(v) => set({ bringToFront: v })} />
      </div>

      <div className="card">
        <h3>Ticking</h3>
        <Choices<Settings["timer"]["ticking"]> value={t.ticking} onChange={ticking => set({ ticking })} options={[
          { id: "off", label: "Off" }, { id: "breaks", label: "Breaks only" }, { id: "focus", label: "Focus only" }, { id: "both", label: "Both" },
        ]} />
        <div className="field-grid" aria-disabled={t.ticking === "off"}>
          <label htmlFor="tick-style">Style</label>
          <select id="tick-style" className="input" disabled={t.ticking === "off"} value={t.tickStyle} onChange={e => set({ tickStyle: e.target.value as Settings["timer"]["tickStyle"] })}>
            <option value="soft">Soft clock</option><option value="wood">Wood</option><option value="digital">Digital</option>
          </select>
          <label htmlFor="tick-volume">Volume</label>
          <input id="tick-volume" className="range" type="range" min="0" max="1" step="0.05" disabled={t.ticking === "off"} value={t.tickVolume} onChange={e => set({ tickVolume: Number(e.target.value) })} />
        </div>
        <p className="help">Ticks pause with the timer and stay quiet while an alarm is sounding.</p>
      </div>

      <div className="card">
        <h3>Session tallies</h3>
        <p className="help">The icons above the timer. Story sets change as your round progresses.</p>
        <Choices<TallyId>
          value={t.tally}
          onChange={(v) => set({ tally: v })}
          options={[
            { id: "dots", label: "Dots", preview: <TallyPreview id="dots" /> },
            { id: "tomato", label: "Tomato", preview: <TallyPreview id="tomato" /> },
            { id: "check", label: "Checks", preview: <TallyPreview id="check" /> },
            { id: "star", label: "Stars", preview: <TallyPreview id="star" /> },
            { id: "tree", label: "Growing tree", preview: <TallyPreview id="tree" /> },
            { id: "tokyo", label: "Trip to Tokyo", preview: <TallyPreview id="tokyo" /> },
            { id: "stem", label: "STEM", preview: <TallyPreview id="stem" /> },
          ]}
        />
      </div>
      <div className="card" role="group" aria-label="Time display">
        <h3>Time display</h3>
        <Choices<Settings["timer"]["display"]> value={t.display} onChange={(display) => set({ display })}
          options={[{ id: "remaining", label: "Remaining" }, { id: "elapsed", label: "Elapsed" }, { id: "hidden", label: "Hidden" }]} />
        <p className="help">Tap the timer face to switch these choices. Hidden keeps time and progress out of view everywhere. You can still ask a screen reader for the time.</p>
      </div>
    </>
  );
}

/** Fires the real Mac notification and the banners on other displays, so the owner can see they work. */
function ReminderTest() {
  const [msg, setMsg] = useState("");
  return (
    <div className="opt reminder-test">
      <span><b>Test reminders</b><span>{msg || "Shows the notification now and the banner on each other display for 6 seconds."}</span></span>
      <button type="button" className="btn small" onClick={async () => {
        const r = await window.desktop?.testReminder?.();
        if (!r) return setMsg("The test could not run.");
        if (!r.supported) return setMsg("macOS reports notifications are unavailable for this app. Allow them in System Settings > Notifications > Kitestring.");
        setMsg(r.displays > 1 ? `Sent. Look for the notification, and a banner on your other ${r.displays - 1 === 1 ? "display" : `${r.displays - 1} displays`}. Not seeing the notification? Allow it in System Settings > Notifications > Kitestring.` : "Sent. Look for the notification. Banners appear on other displays when one is connected.");
      }}>Send a test reminder</button>
    </div>
  );
}
