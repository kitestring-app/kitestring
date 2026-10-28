import { useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { alertTypingGuard } from "../lib/alertTypingGuard";
import { useStore } from "../lib/store";
import { intent, updateIntent } from "../state/intent";
import { settings } from "../state/settings";
import { recoveryRecordText } from "../state/recoveryPolicy";
import { stats } from "../state/stats";
import { tasks } from "../state/tasks";
import { returnActivity } from "../state/returnActivity";
import { parkingReview } from "../state/parkingReview";
import { interruptionPrompt, parked } from "../state/parked";
import { ParkingReviewCard } from "./ParkingReviewCard";
import { requestRecovery, recoveryCommand, recoveryOffer, timer, useTimerView } from "../state/timer";
import type { RecoveryAnswer } from "../state/timer";
import { transitionStore } from "./timer/TransitionStore";
import { FocusCard } from "./FocusCard";
import "./RecoveryCard.css";

// Transient device-local Undo outlives the Focus tree, but never a reload or its deadline.
interface GapUndo { previous: ReturnType<typeof intent.get>; revision: number; at: number }
let gapUndo: GapUndo | null = null;
let undoExpiry: ReturnType<typeof setTimeout> | undefined;
const undoListeners = new Set<() => void>();
const readUndo = () => gapUndo;
const subscribeUndo = (fn: () => void) => { undoListeners.add(fn); return () => { undoListeners.delete(fn); }; };
function setUndo(next: GapUndo | null) {
  clearTimeout(undoExpiry);
  gapUndo = next;
  if (next) undoExpiry = setTimeout(() => setUndo(null), 5000);
  undoListeners.forEach(fn => fn());
}

export function useRecoveryOffer() {
  useStore(timer); useStore(intent); useStore(returnActivity);
  useStore(stats); useStore(settings); useStore(tasks);
  useStore(parkingReview); useStore(parked);
  return recoveryOffer();
}
export function RecoveryCard({ onChooseTask, fallback }: { onChooseTask: () => void; fallback?: ReactNode }) {
  const selectedOffer = useRecoveryOffer();
  const undo = useSyncExternalStore(subscribeUndo, readUndo);
  const offer = undo && selectedOffer === "parking-review" ? null : selectedOffer;
  const transition = useSyncExternalStore(transitionStore.subscribe, transitionStore.get);
  const interruption = useSyncExternalStore(interruptionPrompt.subscribe, interruptionPrompt.get);
  const view = useTimerView();
  const pin = useStore(intent);
  const [message, setMessage] = useState("");
  const s = view.state, context = s.context;
  const command = recoveryCommand();
  const visibleOffer = !interruption ? offer : null;
  useLayoutEffect(() => {
    if (visibleOffer) alertTypingGuard.begin();
  }, [visibleOffer, s.segId]);
  const [busy, setBusy] = useState(false);
  const answer = async (action: RecoveryAnswer) => {
    setBusy(true);
    try {
      if (!await requestRecovery(command, action)) { setMessage("This session or action has changed. Use the current card."); return; }
      setMessage("");
      if (action === "move") onChooseTask();
      if (action === "drop") setUndo({ previous: pin, revision: intent.get().rev, at: intent.get().updatedAt });
    } catch (cause) { setMessage((cause as Error).message); }
    finally { setBusy(false); }
  };
  // The optional pause prompt gets the first turn, including outside Focus.
  if (interruption || transition) return null;
  if (!offer && !undo) return fallback ?? null;
  if (offer === "parking-review") return <ParkingReviewCard />;
  const spent = (context?.spentMs ?? 0) + (s.segment === "focus" ? view.elapsed : 0);
  const title = offer === "missed-end" ? "Your block is finished" : offer === "re-entry" ? "Ready when you are" : "Welcome back";
  const buttons = <div className="recovery-buttons">
    {offer === "gap-return" ? <>
      <button className="btn primary" disabled={busy} onClick={() => void answer("keep")}>Keep</button>
      <button className="btn" disabled={busy} onClick={() => void answer("move")}>Move</button>
      <button className="btn" disabled={busy} onClick={() => void answer("drop")}>Drop</button>
      <button className="btn small" disabled={busy || view.hardLocked} onClick={() => void answer("short-block")}>Start a 5-minute block (optional)</button>
    </> : offer === "missed-end" ? <>
      <button className="btn primary" disabled={busy} onClick={() => void answer("continue")}>Continue</button>
      <button className="btn" disabled={busy} onClick={() => void answer("break")}>Take a break</button>
      <button className="btn" disabled={busy} onClick={() => void answer("stop")}>Stop</button>
    </> : offer === "re-entry" ?
      <button className="btn primary" disabled={busy} onClick={() => void answer("resume")}>Resume</button> :
      undo && <button className="btn primary" onClick={() => {
        const current = intent.get();
        if (current.rev === undo.revision && current.updatedAt === undo.at) {
          updateIntent({ action: undo.previous.action, why: undo.previous.why, cue: undo.previous.cue, reward: undo.previous.reward }); setMessage(""); setUndo(null);
        } else setMessage("Your next action has changed. The newer action is kept.");
      }}>Undo</button>}
  </div>;
  // The pinned action, why and cue already sit just above the controls; the card only names what is not on screen.
  const showContext = !!context?.action && context.action !== pin.action;
  const record = offer !== "gap-return" ? recoveryRecordText(s.recoveryRecord?.focusMs ?? spent, s.recoveryRecord?.awayMs, view.hiddenTime) : "";
  const showSpent = !!record;
  const body = offer === "gap-return" || (offer && (showContext || showSpent)) || message ? <>
    {offer === "gap-return" && <p className="recovery-action">{pin.action || "Choose a next action whenever you’re ready."}</p>}
    {offer && offer !== "gap-return" && showContext && <>
      {context?.taskTitle && <p className="muted small">Task: {context.taskTitle}</p>}
      <p className="recovery-action">{context?.action}</p>
      {context?.why && <p className="muted small">{context.why}</p>}
      {context?.cue && <p className="muted small recovery-cue">{context.cue}</p>}
    </>}
    {showSpent && <p className="faint small">{record}</p>}
    {message && <p className="muted small" role="status">{message}</p>}
  </> : null;
  return <FocusCard title={offer ? title : "Next action cleared"} icon={offer === "gap-return" ? "sun" : "clock"}
    label={offer === "gap-return" ? "Return to your next action" : offer === "re-entry" ? "Session context" : offer === "missed-end" ? "Finished block" : "Next action cleared"}
    note={offer === "gap-return" ? "Choose what you want to pick up." : offer === "missed-end" ? "Choose your next block or take a break." : offer === "re-entry" ? "Your place is saved." : "You can undo this change."}
    onClose={() => { if (offer) void answer("dismiss"); else setUndo(null); }} actions={buttons}>
    {body}
  </FocusCard>;
}
