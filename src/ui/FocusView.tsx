import { useDashboardFit } from "./useDashboardFit";
import { NextAction } from "./NextAction";
import { FocusCardSlot } from "./FocusCardSlot";
import { openParkingReview } from "../state/parkingReview";
import { StartSupport } from "./StartSupport";
import { EndSessionControl, HardModeBadge } from "./timer/EndSession";
import { useState, useSyncExternalStore } from "react";
import { useStore } from "../lib/store";
import { settings, settingsUpdate, type TallyId } from "../state/settings";
import { currentTask, tasks } from "../state/tasks";
import { reminderStatus, timerActions, useTimerView } from "../state/timer";
import { SEGMENT_LABEL, type Segment } from "../state/timerEngine";
import { Icon } from "./icons";
import { FACES } from "./timer/faces";
import { openPip } from "./pip";
import "./FocusView.css";
import { QuoteLine } from "./QuoteLine";

import { parked } from "../state/parked";
import { ParkCapture } from "./ParkCapture";
import { Glyph, glyphFor, type GlyphName } from "./Glyph";

// Static and story-style tallies: the icon changes as the round progresses. Line icons, no emoji.
const STORY: Record<Exclude<TallyId, "dots">, GlyphName[]> = {
  tomato: ["apple"],
  check: ["circle-check"],
  star: ["star"],
  tree: ["sprout", "leaf", "trees", "tree-pine", "mountain", "sun"],
  tokyo: ["plane", "tower-control", "utensils", "castle", "coffee", "mountain-snow"],
  stem: ["flask-conical", "telescope", "dna", "cog", "calculator", "rocket"],
};
/** Four markers, two filled: the preview used in Settings > Timer. */
export function TallyPreview({ id }: { id: TallyId }) {
  return (
    <span className="tallies preview" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => {
        const g = tallyGlyph(id, i);
        const on = i < 2;
        return g ? <span key={i} className={`tally ${on ? "on" : ""}`}><Glyph name={g} size={16} filled={on && (g === "star" || g === "apple")} /></span> : <span key={i} className={`dot ${on ? "on" : ""}`} />;
      })}
    </span>
  );
}

function tallyGlyph(id: TallyId, i: number): GlyphName | null {
  if (id === "dots") return null;
  const seq = STORY[id];
  return seq[i % seq.length];
}

export function FocusView({ captureOpen, onPark, onCaptureClose, onChooseTask = () => {}, onRecall, closeOutVisible = true }: { closeOutVisible?: boolean; onRecall?: () => void; onChooseTask?: () => void; captureOpen: boolean; onPark: () => void; onCaptureClose: () => void }) {
  const fit = useDashboardFit();
  const reminder = useSyncExternalStore(reminderStatus.subscribe, reminderStatus.get);
  const count = useStore(parked, all => all.filter(item => item.status === "open").length);
  const v = useTimerView();
  const [pipMsg, setPipMsg] = useState("");
  const t = useStore(settings, (s) => s.timer);
  const size = useStore(settings, (s) => s.clock.size);
  const showQuote = useStore(settings, (s) => s.quotes.inFocus);
  const task = useStore(tasks, (all) => currentTask(all));
  const Face = FACES[t.style];

  const segs: Segment[] =
    t.mode === "5217" ? ["focus", "short"] : t.mode === "animedoro" ? ["focus", "long"] : t.mode === "pomodoro" ? ["focus", "short", "long"] : ["focus"];
  const label = (s: Segment) => (v.hiddenTime ? SEGMENT_LABEL[s] : t.mode === "animedoro" && s === "long" ? "Watch time" : t.mode === "stopwatch" && s === "focus" ? "Stopwatch" : t.mode === "countdown" && s === "focus" ? "Countdown" : SEGMENT_LABEL[s]);
  const n = t.mode === "pomodoro" ? t.longEvery : 0;
  const filled = v.state.segment === "focus" ? v.state.round : v.state.segment === "long" ? n : v.state.round;

  return (
    <section ref={fit} className={`center focus-center size-${size}`} aria-label="Focus timer">
      <h1 className={`headline ${task?.title ? "task" : ""}`}>
        {task?.title ? (
          <>
            {glyphFor(task.emoji) && <Glyph name={glyphFor(task.emoji)!} size={30} />}
            {task.title}
          </>
        ) : (
          "What do you want to focus on?"
        )}
      </h1>
      {segs.length > 1 && (
        <div className="tabs chrome" role="group" aria-label="Segment">
          {segs.map((s) => (
            <button key={s} disabled={v.hardLocked} title={v.hardLocked ? "Hard mode: this block runs to the end" : undefined} aria-pressed={v.state.segment === s} onClick={() => timerActions.goTo(s)}>
              {label(s)}
            </button>
          ))}
        </div>
      )}
      <div className="tallies" aria-label={`${filled} of ${n} focus sessions this round`}>
        {Array.from({ length: n }, (_, i) => {
          const glyph = tallyGlyph(t.tally, i);
          const on = i < filled;
          return glyph ? <span key={i} className={`tally ${on ? "on" : ""}`}><Glyph name={glyph} size={18} filled={on && (glyph === "star" || glyph === "apple")} /></span> : <span key={i} className={`dot ${on ? "on" : ""}`} />;
        })}
      </div>
      <div className="time-display">
        {v.hiddenTime ? <p className="timer-hidden">{label(v.state.segment)} · {v.running ? "Running" : "Paused"}</p> :
          <Face display={v.display} progress={v.progress} showNumbers={t.showNumbers} big />}
        <button type="button" className="time-display-toggle" aria-label={`Time display: ${{ remaining: "Remaining", elapsed: "Elapsed", hidden: "Hidden" }[t.display]}. Switch to ${{ remaining: "Elapsed", elapsed: "Hidden", hidden: "Remaining" }[t.display]}`}
          title="Tap the timer to switch Remaining, Elapsed or Hidden"
          onClick={() => settingsUpdate("timer", { display: t.display === "remaining" ? "elapsed" : t.display === "elapsed" ? "hidden" : "remaining" })} />
      </div>
      {/* screen readers: one calm update per minute instead of every second */}
      <span className="sr-only" role="timer" aria-live={v.hiddenTime ? "off" : "polite"}>
        {label(v.state.segment)}: {v.timeDescription}
        {v.running ? "" : ", paused"}
      </span>
      {!v.hiddenTime && t.progressBar && v.total !== null && (
        <div className="progress-line" aria-hidden="true">
          <i style={{ width: `${v.progress * 100}%` }} />
        </div>
      )}
      <NextAction closeOutVisible={closeOutVisible} />
      {reminder && <p className="muted small" role="status">{reminder}</p>}
      <div className="controls chrome">
        <button className="iconbtn primary" disabled={v.hardLocked && v.running} title={v.hardLocked && v.running ? "Hard mode: this block runs to the end" : undefined} onClick={() => timerActions.toggle()} aria-label={v.running ? "Pause · Space" : "Start · Space"}>
          {v.running ? <Icon.pause /> : <Icon.play />}
        </button>
        <button className="iconbtn" disabled={v.hardLocked} title={v.hardLocked ? "Hard mode: this block runs to the end" : undefined} onClick={() => timerActions.reset()} aria-label="Reset this session · R">
          <Icon.reset />
        </button>
        <button className="iconbtn" disabled={v.hardLocked} title={v.hardLocked ? "Hard mode: this block runs to the end" : undefined} onClick={() => timerActions.skip()} aria-label={t.mode === "stopwatch" ? "Finish session · N" : "Skip to next · N"}>
          {t.mode === "stopwatch" ? <Icon.stop /> : <Icon.skip />}
        </button>
        <button className={`iconbtn ${typeof window !== "undefined" && !window.desktop?.floatTimer && !window.documentPictureInPicture ? "pip-unavailable" : ""}`} onClick={() => void openPip().then((err) => err && setPipMsg(err))} aria-label="Floating timer">
          <Icon.pip />
        </button>
        <button className="iconbtn" onClick={onPark} aria-label="Park a thought · P" title="Park a thought · P"><Icon.note /></button>
        {!v.hardLocked && <EndSessionControl />}
      </div>
      <FocusCardSlot onChooseTask={onChooseTask} onRecall={onRecall} />
      <StartSupport />
      {v.hardLocked && <><HardModeBadge pendingOff={v.hardModePendingOff} /><EndSessionControl /></>}
      <ParkCapture open={captureOpen} onClose={onCaptureClose} />
      {count > 0 && (v.running && v.state.segment === "focus" ? <span className="park-chip muted small">{count} parked</span> :
        <button className="btn small park-chip" onClick={openParkingReview}>{count} parked</button>)}
      {pipMsg && <p className="muted small" role="status" style={{ marginTop: 10 }}>{pipMsg}</p>}
      {showQuote && <QuoteLine />}
    </section>
  );
}
