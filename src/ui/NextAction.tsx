import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { FocusCard } from "./FocusCard";
import { Glyph } from "./Glyph";
import { useStore } from "../lib/store";
import { finishIntent, intent, saveIntent } from "../state/intent";
import { tasks } from "../state/tasks";
import "./NextAction.css";

export function NextAction({ closeOutVisible = true, children }: { closeOutVisible?: boolean; children?: (pin: ReactNode, closeOut: ReactNode) => ReactNode } = {}) {
  const value = useStore(intent);
  const all = useStore(tasks);
  const [editing, setEditing] = useState(false);
  const [closeOut, setCloseOut] = useState<"none" | "choose" | "replace">("none");
  const leaving = useRef(false);
  const returnToLeave = useRef(false);
  const leave = useRef<HTMLButtonElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState<Partial<Pick<typeof value, "action" | "why" | "cue" | "reward" | "sufficientFinish" | "portion">>>({});
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const pending = useRef<typeof draft>({});
  const expected = useRef(value);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);
  const edit = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const saving = useRef<Promise<boolean> | null>(null);
  const save = (): Promise<boolean> => {
    clearTimeout(debounce.current);
    if (saving.current) return saving.current.then(ok => ok ? save() : false);
    if (!Object.keys(pending.current).length) return Promise.resolve(true);
    const patch = { ...pending.current };
    setIsSaving(true);
    const work = (async () => {
      try {
        await saveIntent(patch, expected.current);
        expected.current = intent.get();
        const remaining = { ...pending.current };
        for (const key of Object.keys(patch) as (keyof typeof patch)[]) {
          if (remaining[key] === patch[key]) delete remaining[key];
        }
        pending.current = remaining;
        setDraft({ ...intent.get(), ...remaining });
        setError("");
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not save your next action. Try again.");
        return false;
      } finally { saving.current = null; setIsSaving(false); }
    })();
    saving.current = work;
    return work;
  };
  const close = async (): Promise<void> => {
    if (!await save()) return;
    if (Object.keys(pending.current).length) return close();
    leaving.current = false; returnFocus.current = true; setEditing(false); setCloseOut("none");
  };
  const change = (patch: typeof draft) => {
    pending.current = { ...pending.current, ...patch };
    setDraft(previous => ({ ...previous, ...patch }));
    clearTimeout(debounce.current);
    if (!leaving.current) debounce.current = setTimeout(() => void save(), 400);
  };
  useEffect(() => {
    if (editing) input.current?.focus();
    else if (closeOut === "choose") keep.current?.focus();
    else if (returnFocus.current) { (returnToLeave.current ? leave : edit).current?.focus(); returnToLeave.current = false; returnFocus.current = false; }
  }, [editing, closeOut]);
  useEffect(() => () => { if (!leaving.current) void save(); }, []);
  const keepCurrent = () => {
    if (saving.current) return;
    clearTimeout(debounce.current); pending.current = {}; setError("");
    leaving.current = false; returnFocus.current = true; setEditing(false); setCloseOut("none");
  };
  const content = <div className="next-action chrome" role="group" aria-label="Pinned next action" aria-busy={isSaving} onKeyDown={event => {
    if (event.nativeEvent.isComposing) return;
    if (closeOut !== "none" && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); keepCurrent(); return; }
    if (editing && (event.key === "Escape" || event.key === "Enter" && event.target instanceof HTMLInputElement)) {
      event.preventDefault(); event.stopPropagation(); void close();
    }
  }}>
    {editing ? <>
      {closeOut === "replace" && <p className="small muted">Changes wait for Save next step. Keep current action or Escape leaves your saved pin as it is.</p>}
      <label>Next action (optional)
        <input className="input" ref={input} maxLength={500} value={draft.action ?? value.action} placeholder="Choose one small action to start" onChange={e => change({ action: e.target.value })} />
      </label>
      <label>Pick a task or subtask
        <select className="input" value="" onChange={e => {
          const task = all.find(item => item.id === e.target.value);
          if (task) change({ action: task.title.replace(/[\r\n]+/g, " ").slice(0, 500) });
        }}>
          <option value="">Choose a task</option>
          {all.filter(task => !task.done).map(task => <option value={task.id} key={task.id}>{task.parentId ? "↳ " : ""}{task.title}</option>)}
        </select>
      </label>
      <label>Why this matters (optional)
        <input className="input" maxLength={500} value={draft.why ?? value.why} onChange={e => change({ why: e.target.value })} />
      </label>
      <label>If-then cue (optional)
        <input className="input" maxLength={500} value={draft.cue ?? value.cue ?? ""} placeholder="When I sit down after lunch, I will open the draft" onChange={e => change({ cue: e.target.value })} />
      </label>
      <label>Small reward for finishing this action (optional)
        <input className="input" maxLength={500} value={draft.reward ?? value.reward ?? ""} placeholder="Make a cup of tea" onChange={e => change({ reward: e.target.value })} />
      </label>
      <details>
        <summary>Optional details</summary>
        <label>Sufficient finish (optional)
          <input className="input" maxLength={500} value={draft.sufficientFinish ?? value.sufficientFinish ?? ""} onChange={event => change({ sufficientFinish: event.target.value })} />
        </label>
        <p className="faint small">What would be enough for this pass? You choose when to finish. This line is never graded.</p>
        <label>Bounded portion (optional)
          <input className="input" maxLength={500} value={draft.portion ?? value.portion ?? ""} onChange={event => change({ portion: event.target.value })} />
        </label>
        <p className="faint small">What piece do you want to try? Use the action above if it already says enough. Time ending never marks this piece or its task complete.</p>
      </details>
      <button className={`btn small ${closeOut === "replace" ? "primary" : ""}`} disabled={closeOut === "replace" && isSaving} onClick={close}>{closeOut === "replace" ? "Save next step" : "Done"}</button>
      {closeOut === "replace" && <button className="btn small" disabled={isSaving} onClick={keepCurrent}>Keep current action</button>}
      {error && <button className="btn small" disabled={isSaving} onClick={() => { if (saving.current) return; clearTimeout(debounce.current); pending.current = {}; expected.current = intent.get(); setDraft({ ...intent.get() }); setError(""); }}>Use saved action</button>}
      <p className="faint small">Start whenever you’re ready. These fields are optional. When signed in, the latest saved action, note, cue, reward, sufficient finish and portion replace the whole document on other devices. Breaks are always available.</p>
    </> : closeOut === "choose" ? <>
      <p className="next-action-text">Current next action: {value.action || "No pinned action"}</p>
      <p className="small muted">Keep this pin or edit it for next time. Your interrupted session keeps its saved place. The timer keeps its current state, and you can close the window whenever you choose.</p>
      <div className="next-action-buttons">
        <button className="btn small primary" ref={keep} onClick={keepCurrent}>Keep current action</button>
        <button className="btn small" onClick={() => { expected.current = intent.get(); setDraft({ ...intent.get() }); pending.current = {}; setCloseOut("replace"); setEditing(true); }}>Replace for next time</button>
      </div>
    </> : <>
      <div className="next-action-copy">
      {value.action && <p className="next-action-text">{value.action}</p>}
      {value.why && <p className="small muted">{value.why}</p>}
      {value.sufficientFinish?.trim() && <p className="small muted next-action-finish">Enough for this pass: {value.sufficientFinish}</p>}
      {value.portion?.trim() && <p className="small muted next-action-portion">Chosen portion: {value.portion}</p>}
      {value.cue && <p className="small muted next-action-cue">{value.cue}</p>}
      </div>
      <div className={`next-action-buttons${closeOutVisible ? " next-action-buttons-closeout" : ""}`}>
        <button className="btn small" ref={edit} onClick={() => { returnToLeave.current = false; expected.current = intent.get(); setDraft({ ...intent.get() }); setEditing(true); }}>{value.action ? "Edit next action" : "Pin a next action"}</button>
        {value.action.trim() && <button className="btn small" onClick={() => {
          setError(finishIntent(value) ? "" : "Your next action changed. Finish the current action when you’re ready.");
        }}>Finish action</button>}
        {closeOutVisible && <button className="btn small next-action-leave" aria-label="Leave a next step" title="Leave a next step" ref={leave} onClick={() => { leaving.current = true; returnToLeave.current = true; setError(""); setCloseOut("choose"); }}><Glyph name="notebook-pen" size={18} /><span>Leave a next step</span></button>}
      </div>
    </>}
    {error && <p className="small" role="alert">{error}</p>}
  </div>;
  const card = closeOut !== "none" ? (
    <FocusCard title="Leave a next step" icon="notebook-pen" label="Leave a next step" note="Keep your saved pin or choose a next step for later." onClose={keepCurrent}>
      {content}
    </FocusCard>
  ) : null;
  return children ? children(card ? null : content, card) : card ?? content;
}
