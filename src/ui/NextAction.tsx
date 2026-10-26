import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { finishIntent, intent, updateIntent } from "../state/intent";
import { tasks } from "../state/tasks";
import "./NextAction.css";

export function NextAction() {
  const value = useStore(intent);
  const all = useStore(tasks);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<Pick<typeof value, "action" | "why" | "cue" | "reward">>>({});
  const [error, setError] = useState("");
  const pending = useRef<typeof draft>({});
  const expected = useRef(value);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);
  const edit = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const save = () => {
    clearTimeout(debounce.current);
    if (!Object.keys(pending.current).length) return true;
    try {
      updateIntent(pending.current, expected.current);
      expected.current = intent.get();
      pending.current = {};
      setDraft({ ...intent.get() });
      setError("");
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your next action. Try again.");
      return false;
    }
  };
  const change = (patch: typeof draft) => {
    pending.current = { ...pending.current, ...patch };
    setDraft(previous => ({ ...previous, ...patch }));
    clearTimeout(debounce.current);
    debounce.current = setTimeout(save, 400);
  };
  useEffect(() => {
    if (editing) input.current?.focus();
    else if (returnFocus.current) { edit.current?.focus(); returnFocus.current = false; }
  }, [editing]);
  useEffect(() => () => { save(); }, []);
  return <div className="next-action chrome" role="group" aria-label="Pinned next action">
    {editing ? <>
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
      <button className="btn small" onClick={() => { if (save()) { returnFocus.current = true; setEditing(false); } }}>Done</button>
      {error && <button className="btn small" onClick={() => { clearTimeout(debounce.current); pending.current = {}; expected.current = intent.get(); setDraft({ ...intent.get() }); setError(""); }}>Use saved action</button>}
      <p className="faint small">Start whenever you’re ready. These fields are optional. When signed in, the latest saved action, note, cue and reward replace the whole document on other devices. Breaks are always available.</p>
    </> : <>
      <div className="next-action-copy">
      {value.action && <p className="next-action-text">{value.action}</p>}
      {value.why && <p className="small muted">{value.why}</p>}
      {value.cue && <p className="small muted next-action-cue">{value.cue}</p>}
      </div>
      <div className="next-action-buttons">
        <button className="btn small" ref={edit} onClick={() => { expected.current = intent.get(); setDraft({ ...intent.get() }); setEditing(true); }}>{value.action ? "Edit next action" : "Pin a next action"}</button>
        {value.action.trim() && <button className="btn small" onClick={() => {
          setError(finishIntent(value) ? "" : "Your next action changed. Finish the current action when you’re ready.");
        }}>Finish action</button>}
      </div>
    </>}
    {error && <p className="small" role="alert">{error}</p>}
  </div>;
}
