import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { hardModeLocked, runTimerCommand, timer, timerActions, useTimerView } from "../../state/timer";
import { transitionStore } from "./TransitionStore";
import { createEndHold, END_HOLD_MS } from "./endHold";
import "./EndSession.css";
import { Glyph } from "../Glyph";

let requested = false;
const listeners = new Set<() => void>();
function setRequested(value: boolean) { requested = value; listeners.forEach(fn => fn()); }
export function requestEndSession() {
  if (!hardModeLocked()) return;
  transitionStore.dismiss(); setRequested(true);
}
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

/** Main-window host also answers requests from the native Timer and tray menus. */
export function EndSessionHost({ native = false }: { native?: boolean } = {}) {
  const open = useSyncExternalStore(subscribe, () => requested);
  const v = useTimerView();
  useEffect(() => timer.subscribe(() => { if (!hardModeLocked()) setRequested(false); }), []);
  useEffect(() => { if (!v.hardLocked) setRequested(false); }, [v.hardLocked]);
  return open && v.hardLocked ? <EndSessionDialog native={native} key={v.state.segId} close={() => setRequested(false)} /> : null;
}

export function EndSessionControl({ native = false }: { native?: boolean }) {
  const v = useTimerView();
  if (!v.hardLocked) return v.running || v.state.elapsedBefore > 0 ? <button type="button" className="btn small" aria-label="Stop session"
    onClick={() => native ? window.desktop?.timerControl?.('stop') : runTimerCommand('stop')}>Stop</button> : null;
  if (v.total === null) return <button className="btn small" onClick={() => native ? window.desktop?.timerControl?.("skip") : timerActions.skip()}>Finish session</button>;
  return <>
    <button className="btn small" onClick={requestEndSession}>End session</button>
    {native && <EndSessionHost native />}
  </>;
}

export function EndSessionDialog({ close, native = false }: { close: () => void; native?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const holding = useRef(false);
  const attempt = useRef(0);
  const readyRef = useRef(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const hold = useRef<ReturnType<typeof createEndHold> | null>(null);
  if (!hold.current) hold.current = createEndHold(setProgress, () => { readyRef.current = true; setReady(true); });
  const command = async (value: DesktopTimerCommand): Promise<DesktopTimerResult> => native
    ? await window.desktop?.timerControl?.(value) ?? { ok: false, reason: "unavailable" }
    : runTimerCommand(value);
  const cancelHold = () => {
    if (!readyRef.current) { attempt.current++; holding.current = false; hold.current!.cancel(); void command("cancelEndHold"); }
  };
  const start = async () => {
    if (readyRef.current || holding.current) return;
    holding.current = true;
    const currentAttempt = ++attempt.current;
    const result = await command("beginEndHold");
    if (!holding.current || currentAttempt !== attempt.current) return;
    if (!result.ok) { holding.current = false; setError("Could not start the hold. Try again."); return; }
    hold.current!.start();
  };
  useEffect(() => {
    const el = dialog.current!;
    el.showModal(); button.current?.focus();
    const cancel = () => cancelHold();
    el.ownerDocument.defaultView?.addEventListener("blur", cancel);
    const visibility = () => { if (el.ownerDocument.visibilityState === "hidden") cancel(); };
    el.ownerDocument.addEventListener("visibilitychange", visibility);
    return () => {
      attempt.current++; holding.current = false;
      hold.current!.cancel(); void command("cancelEndHold");
      el.ownerDocument.defaultView?.removeEventListener("blur", cancel);
      el.ownerDocument.removeEventListener("visibilitychange", visibility);
      el.close();
    };
  }, []);
  const seconds = Math.ceil((END_HOLD_MS - progress) / 1000);
  const valid = reason.trim().length >= 3;
  return <dialog ref={dialog} className="end-session panel" role="dialog" aria-modal="true" aria-labelledby="end-session-title" onCancel={event => { event.preventDefault(); close(); }}>
    <h2 id="end-session-title">End session</h2>
    {ready ? <form onSubmit={async event => {
      event.preventDefault();
      const result = await command({ action: "endHardSession", reason });
      if (result.ok) close(); else {
        setError("message" in result ? result.message : "Could not end the block. Try again.");
        if (result.reason !== "reason-required") {
          readyRef.current = false; setReady(false); holding.current = false;
          hold.current!.cancel(); void command("cancelEndHold");
        }
      }
    }}>
      <label>Reason for ending early<input autoFocus className="input" required minLength={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
      <p className="help">Your time so far will count. This reason will be saved in your session log.</p>
      {error && <p role="alert">{error}</p>}
      <div className="row"><button type="submit" className="btn primary" disabled={!valid}>End session</button><button type="button" className="btn" onClick={close}>Cancel</button></div>
    </form> : <>
      <p>Hold for 10 seconds, then give a reason. Your block keeps running.</p>
      {error && <p role="alert">{error}</p>}
      <button ref={button} className="btn end-session-hold" aria-label="Hold for 10 seconds to end session" onContextMenu={event => event.preventDefault()}
        onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); void start(); }}
        onPointerUp={cancelHold} onPointerCancel={cancelHold} onLostPointerCapture={cancelHold} onBlur={cancelHold}
        onKeyDown={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); event.stopPropagation(); if (!event.repeat) void start(); } }}
        onKeyUp={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); event.stopPropagation(); cancelHold(); } }}>
        <svg className="end-session-ring" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - progress / END_HOLD_MS * 100} /></svg>
        <span>{progress ? `${seconds} seconds remaining` : "Hold to continue"}</span>
      </button>
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">{progress ? `${seconds} seconds remaining` : "Hold for 10 seconds"}</span>
      <button type="button" className="btn" onClick={close}>Cancel</button>
    </>}
  </dialog>;
}

export function HardModeBadge({ pendingOff = false }: { pendingOff?: boolean }) {
  return <span className="hard-mode-badge" title="Hard mode: this block runs to the end"><Glyph name="lock" size={14} /> {pendingOff ? "Hard mode turns off after this block" : "Hard mode"}</span>;
}
