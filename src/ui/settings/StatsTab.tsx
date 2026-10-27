import { useEffect, useMemo, useState } from "react";
import { useStore } from "../../lib/store";
import { focusRecordDays, focusRecords, formatStatsDuration, stats, statsOverview } from "../../state/stats";
import type { Range } from "../../state/stats";
import { SessionLog } from "../stats/SessionLog";
import "./StatsTab.css";

const RANGES: { id: Range; label: string }[] = [
  { id: "today", label: "Today" }, { id: "week", label: "Week" },
  { id: "month", label: "Month" }, { id: "3m", label: "3 Months" },
  { id: "6m", label: "6 Months" }, { id: "1y", label: "1 Year" },
  { id: "all", label: "All Time" },
];
const dateLabel = (at: number) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function StatsTab() {
  const data = useStore(stats);
  const [page, setPage] = useState<"overview" | "log">("overview");
  const [range, setRange] = useState<Range>("today");
  const [weekly, setWeekly] = useState(false);
  const [clock, setClock] = useState(Date.now);
  // Refresh local date boundaries after midnight or a backgrounded tab wakes.
  useEffect(() => {
    const refresh = () => setClock(Date.now());
    const timer = window.setInterval(refresh, 60_000);
    const unsubscribe = stats.subscribe(refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); unsubscribe(); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  const view = useMemo(() => statsOverview(data, range, clock), [data, range, clock]);
  const days = useMemo(() => focusRecordDays(data, clock), [data, clock]);
  const records = useMemo(() => focusRecords(days, view.from, clock, weekly).reverse(), [days, view.from, clock, weekly]);
  const hasData = records.some(record => record.focusMs > 0 || record.tasks > 0);
  return (
    <section className="focus-stats" aria-labelledby="focus-stats-title" onKeyDown={e => {
      if (e.key === " " && (e.target as HTMLElement).closest("button, summary")) e.stopPropagation();
    }}>
      <h1 id="focus-stats-title">Focus records</h1>
      <p className="stats-lede">Time focused includes partial sessions. Actions finished counts recorded task and subtask completions.</p>
      <div className="stats-pills" role="group" aria-label="Stats view">
        <button type="button" aria-pressed={page === "overview"} onClick={() => setPage("overview")}>Overview</button>
        <button type="button" aria-pressed={page === "log"} onClick={() => setPage("log")}>Log</button>
      </div>
      {page === "log" ? <SessionLog /> : <>
        <div className="stats-pills stats-ranges" role="group" aria-label="Stats range">
          {RANGES.map(r => <button type="button" key={r.id} aria-pressed={range === r.id} onClick={() => setRange(r.id)}>{r.label}</button>)}
        </div>
        <div className="stats-pills" role="group" aria-label="Record grouping">
          <button type="button" aria-pressed={!weekly} onClick={() => setWeekly(false)}>Daily</button>
          <button type="button" aria-pressed={weekly} onClick={() => setWeekly(true)}>Weekly</button>
        </div>
        {!hasData && <p className="stats-empty" role="status">No records in this period.</p>}
        <table className="stats-records">
          <caption>{weekly ? "Weekly records (Monday to Sunday, within the selected period)" : "Daily records"}</caption>
          <thead><tr><th scope="col">{weekly ? "Week" : "Day"}</th><th scope="col">Time focused</th><th scope="col">Actions finished</th></tr></thead>
          <tbody>{records.map(record => <tr key={record.start}>
            <th scope="row">{dateLabel(record.start)}{record.end !== record.start && <> to {dateLabel(record.end)}</>}</th>
            <td>{formatStatsDuration(record.focusMs)}</td><td>{record.tasks.toLocaleString()}</td>
          </tr>)}</tbody>
        </table>
      </>}
    </section>
  );
}
