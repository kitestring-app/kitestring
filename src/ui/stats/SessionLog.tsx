import { useMemo, useState } from "react";
import { useStore } from "../../lib/store";
import * as parking from "../../state/parked";
import { dayKey, requestDeleteSession, sessionLog, stats } from "../../state/stats";
import type { LogInterruption } from "../../state/stats";
import { tasks } from "../../state/tasks";
import { downloadFile, sessionLogCsv } from "./csv";
import { Icon } from "../icons";
import { showDeleteUndo } from "./DeleteUndo";
import "./SessionLog.css";
import { StopLabels } from './StopLabels';

// Job 24 may land independently: do not require an export it hasn't added yet.
const interruptionSource = parking as typeof parking & {
  getInterruptions?: (range: { start: number; end: number }) => readonly LogInterruption[];
};
const duration = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 3600) ? `${Math.floor(seconds / 3600)}h ` : ""}${Math.floor(seconds / 60) % 60}m ${seconds % 60}s`;
};
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const stamp = (at: number) => new Date(at).toLocaleString();

export function SessionLog() {
  const data = useStore(stats);
  const taskList = useStore(tasks);
  const parked = useStore(parking.parked);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [taskId, setTaskId] = useState("all");
  const [message, setMessage] = useState("");
  const invalidRange = Boolean(from && to && from > to);
  const days = useMemo(() => sessionLog(data, taskList,
    { from, to, taskId: taskId === "all" ? undefined : taskId === "none" ? "" : taskId.slice(5) },
    interruptionSource.getInterruptions?.({ start: 0, end: Date.UTC(2100, 0, 1) }) ?? []), [data, taskList, from, to, taskId, parked]);
  const options = useMemo(() => {
    const names = new Map(taskList.map(task => [task.id, task.title || "Untitled task"]));
    for (const chunk of data.chunks) if (chunk.taskId && !names.has(chunk.taskId)) names.set(chunk.taskId, "Deleted task");
    return [...names].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data, taskList]);
  const exportCsv = () => {
    try {
      downloadFile(new Blob(["\uFEFF", sessionLogCsv(days)], { type: "text/csv;charset=utf-8" }), `focus-log-${dayKey(Date.now())}.csv`);
      setMessage("CSV exported.");
    } catch { setMessage("Could not export the CSV. Please try again."); }
  };
  return <div className="session-log">
    <StopLabels />
    <p className="help">Saved focus and break sessions, newest first. Paused entries are combined. Days use the session's local start date; start and end times are approximate for older entries. Length counts recorded timer time.</p>
    <div className="session-log-filters">
      <label>From<input className="input" type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} /></label>
      <label>Through<input className="input" type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} /></label>
      <label>Task<select className="input" value={taskId} onChange={e => setTaskId(e.target.value)}>
        <option value="all">All tasks</option><option value="none">No task</option>
        {options.map(([id, title]) => <option value={`task:${id}`} key={id}>{title}</option>)}
      </select></label>
    </div>
    <div className="row">
      <button className="btn primary" type="button" disabled={invalidRange || !days.length} onClick={exportCsv}>Export CSV</button>
      <button className="btn" type="button" onClick={() => { setFrom(""); setTo(""); setTaskId("all"); setMessage(""); }}>Clear filters</button>
    </div>
    {message && <p className="help" role="status">{message}</p>}
    {invalidRange ? <p role="alert">Choose an end date on or after the start date.</p> : !days.length ? <p className="help" role="status">No saved sessions match these filters.</p> : days.map(day => <section className="card session-log-day" key={day.day} aria-label={`Sessions for ${day.day}`}>
      <h2>{new Date(`${day.day}T12:00:00`).toLocaleDateString([], { weekday: "long", year: "numeric", month: "short", day: "numeric" })}</h2>
      <p className="help">{duration(day.focusMs)} focus · {duration(day.breakMs)} breaks · {day.sessions.length} {day.sessions.length === 1 ? "session" : "sessions"} · {day.interruptions} {day.interruptions === 1 ? "interruption" : "interruptions"}</p>
      <div className="session-log-scroll" role="region" aria-label={`Session details for ${day.day}`} tabIndex={0}>
        <table><caption className="faint small">{day.day} · totals reflect the current filters</caption><thead><tr>
          <th scope="col">Start–end</th><th scope="col">Length</th><th scope="col">Session</th><th scope="col">Task</th><th scope="col">Status</th><th scope="col">Interruptions</th><th scope="col">Actions</th>
        </tr></thead><tbody>{day.sessions.map(session => <tr key={session.id}>
          <td><time dateTime={new Date(session.start).toISOString()} title={stamp(session.start)}>{time(session.start)}</time>–<time dateTime={new Date(session.end).toISOString()} title={stamp(session.end)}>{dayKey(session.start) !== dayKey(session.end) ? `${dayKey(session.end)} ` : ""}{time(session.end)}</time></td>
          <td>{duration(session.ms)}</td><td>{session.segment === "focus" ? "Focus" : session.segment === "short" ? "Short break" : "Long break"}</td>
          <td>{session.taskTitles.join("; ")}</td><td>{session.earlyEndReason ? <>Hard mode: ended early<br />{session.earlyEndReason}</> : session.completed ? "Completed" : "Cut short"}</td><td>{session.interruptions}</td>
          <td><button type="button" className="iconbtn" aria-label="Delete" title="Delete" onClick={async e => {
            const host = e.currentTarget.closest<HTMLElement>('[role="dialog"]') ?? document.body;
            try { showDeleteUndo("Session deleted.", await requestDeleteSession(session), host); }
            catch (error) { setMessage((error as Error).message); }
          }}><Icon.trash /></button></td>
        </tr>)}</tbody></table>
      </div>
    </section>)}
  </div>;
}
