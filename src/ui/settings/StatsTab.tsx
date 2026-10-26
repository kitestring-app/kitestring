import { useEffect, useId, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import { useStore } from "../../lib/store";
import {
  addDays, dayKey, focusCalendar, focusLevel, focusTrend, formatStatsDuration,
  startOfDay, stats, statsOverview,
} from "../../state/stats";
import type { CalendarDay, DayTotals, Range, TrendBucket } from "../../state/stats";
import { Icon } from "../icons";
import "./StatsTab.css";
import { SessionLog } from "../stats/SessionLog";

const RANGES: { id: Range; label: string }[] = [
  { id: "today", label: "Today" }, { id: "week", label: "Week" },
  { id: "month", label: "Month" }, { id: "3m", label: "3 Months" },
  { id: "6m", label: "6 Months" }, { id: "1y", label: "1 Year" },
  { id: "all", label: "All Time" },
];
const dateLabel = (at: number, year = false) => new Date(at).toLocaleDateString("en-GB", {
  day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}),
});
const dayLabel = (at: number) => new Date(at).toLocaleDateString("en-GB", {
  weekday: "short", day: "numeric", month: "short",
}).replace(",", "");
const sessionLabel = (n: number) => `${n} ${n === 1 ? "session" : "sessions"}`;
const calendarLabel = (day: CalendarDay) => `${dayLabel(day.at)} · ${formatStatsDuration(day.focusMs)} · ${sessionLabel(day.sessions)}`;

export function StatsTab() {
  const data = useStore(stats);
  const [page, setPage] = useState<"overview" | "log">("overview");
  const [range, setRange] = useState<Range>("today");
  const [clock, setClock] = useState(Date.now);
  // Refresh date boundaries while open, including after a backgrounded tab wakes.
  useEffect(() => {
    const refresh = () => setClock(Date.now());
    const timer = window.setInterval(refresh, 60_000);
    const unsubscribe = stats.subscribe(refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      unsubscribe();
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  const now = clock;
  const view = useMemo(() => statsOverview(data, range, now), [data, range, now]);
  const weekly = range === "6m" || range === "1y" || (range === "all" && view.from < addDays(startOfDay(now), -89));
  const trend = useMemo(() => focusTrend(view.days, view.from, now, weekly), [view.days, view.from, now, weekly]);
  const hasData = data.chunks.some((c) => c.start <= now) || data.tasksDone.some((t) => t.at <= now);
  const cards = [
    { label: "Focus Time", value: formatStatsDuration(view.totals.focusMs), note: "Includes partial sessions", color: "focus", icon: Icon.clock },
    { label: "Tasks Completed", value: view.totals.tasks.toLocaleString(), note: "Completed in this period", color: "tasks", icon: Icon.check },
    { label: "Sessions", value: view.totals.sessions.toLocaleString(), note: "Completed focus sessions", color: "sessions", icon: Icon.timer },
    { label: "Break Time", value: formatStatsDuration(view.totals.breakMs), note: "Time to recharge", color: "break", icon: Icon.heart },
  ];

  return (
    <section className="focus-stats" aria-labelledby="focus-stats-title" onKeyDown={(e) => {
      // Space activates dashboard controls without toggling the app's timer shortcut.
      if (e.key === " " && (e.target as HTMLElement).closest("button, summary")) e.stopPropagation();
    }}>
      <h1 id="focus-stats-title">Focus Stats</h1>
      <p className="stats-lede">A little focus, day by day.</p>
      <div className="stats-pills" role="group" aria-label="Stats view">
        <button type="button" aria-pressed={page === "overview"} onClick={() => setPage("overview")}>Overview</button>
        <button type="button" aria-pressed={page === "log"} onClick={() => setPage("log")}>Log</button>
      </div>
      {page === "log" ? <SessionLog /> : <>
      <div className="stats-pills stats-ranges" role="group" aria-label="Stats range">
        {RANGES.map((r) => <button type="button" key={r.id} aria-pressed={range === r.id} onClick={() => setRange(r.id)}>{r.label}</button>)}
      </div>
      {!hasData && <div className="stats-empty" role="status">
        <Icon.stats />
        <div><h2>Your focus story starts here</h2><p>Start a focus timer or complete a task. Your progress will appear here automatically.</p></div>
      </div>}
      <div className="stats-cards">
        {cards.map(({ label, value, note, color, icon: I }) => <div className={`stats-metric stats-metric-${color}`} key={label}>
          <I /><h2>{label}</h2><strong>{value}</strong><p>{note}</p>
        </div>)}
      </div>
      <FocusCalendar days={view.days} now={now} />
      <FocusTrend key={`${range}-${dayKey(now)}`} buckets={trend} weekly={weekly} />

      </>}
    </section>
  );
}

function FocusCalendar({ days, now }: { days: Map<string, DayTotals>; now: number }) {
  const [unit, setUnit] = useState<"hours" | "sessions">("hours");
  const [length, setLength] = useState<182 | 365>(182);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const helpId = useId();
  const cells = useMemo(() => focusCalendar(days, now, length), [days, now, length]);
  const active = cells.find((d) => d.key === (hovered ?? focused) && d.inRange);
  const focusKey = cells.some((d) => d.key === focused && d.inRange) ? focused : dayKey(now);
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
  // Label each month at its first visible column; avoid overlapping adjacent labels.
  let previousMonth = -1;
  let lastLabel = -3;
  const months = weeks.map((week, i) => {
    const first = week.find((d) => d.inRange);
    if (!first) return "";
    const month = new Date(first.at).getMonth();
    const changed = month !== previousMonth;
    previousMonth = month;
    // Skip a short leading month so the next month's label has room.
    if (i === 0 && weeks[1]?.some((d) => new Date(d.at).getMonth() !== month)) return "";
    if (!changed || i - lastLabel < 3 || i === weeks.length - 1) return "";
    lastLabel = i;
    return new Date(first.at).toLocaleDateString("en-GB", { month: "short" });
  });
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLButtonElement;
    if (!target.dataset.calendarDay) return;
    const index = cells.findIndex((d) => d.key === target.dataset.calendarDay);
    const moves: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
    let next = index + (moves[event.key] ?? 0);
    if (event.key === "Home") next = cells.findIndex((d) => d.inRange);
    else if (event.key === "End") next = cells.findLastIndex((d) => d.inRange);
    else if (!(event.key in moves)) return;
    event.preventDefault();
    event.stopPropagation();
    next = Math.max(cells.findIndex((d) => d.inRange), Math.min(cells.findLastIndex((d) => d.inRange), next));
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-calendar-day="${cells[next].key}"]`)?.focus();
  };

  return <section className="stats-section" aria-labelledby="stats-calendar-title">
    <div className="stats-section-head">
      <div><h2 id="stats-calendar-title">Focus Calendar</h2><p>Your daily rhythm, at a glance.</p></div>
      <div className="stats-calendar-controls">
        <div className="stats-pills" role="group" aria-label="Calendar measure">
          <button type="button" aria-pressed={unit === "hours"} onClick={() => setUnit("hours")}>Hours</button>
          <button type="button" aria-pressed={unit === "sessions"} onClick={() => setUnit("sessions")}>Sessions</button>
        </div>
        <div className="stats-pills" role="group" aria-label="Calendar period">
          <button type="button" aria-pressed={length === 182} onClick={() => setLength(182)}>6 months</button>
          <button type="button" aria-pressed={length === 365} onClick={() => setLength(365)}>1 year</button>
        </div>
      </div>
    </div>
    <div className="stats-calendar-scroll" onKeyDown={navigate}>
      <div className="stats-calendar" style={{ gridTemplateColumns: `28px repeat(${weeks.length}, minmax(10px, 1fr))`, minWidth: 28 + weeks.length * 14 }}>
        <span />{months.map((month, i) => <span className="stats-month" key={i}>{month}</span>)}
        <div className="stats-weekdays" aria-hidden="true">{["", "Mon", "", "Wed", "", "Fri", ""].map((d, i) => <span key={i}>{d}</span>)}</div>
        {weeks.map((week) => <div className="stats-week" key={week[0].key}>
          {week.map((day) => day.inRange ? <button
            type="button" className={`stats-day stats-level-${focusLevel(unit === "hours" ? day.focusMs : day.sessions, unit)}`}
            key={day.key} data-calendar-day={day.key} tabIndex={day.key === focusKey ? 0 : -1}
            aria-label={`${calendarLabel(day)} ${new Date(day.at).getFullYear()}`}
            aria-current={day.key === dayKey(now) ? "date" : undefined}
            aria-describedby={helpId} title={calendarLabel(day)}
            onMouseEnter={() => setHovered(day.key)} onMouseLeave={() => setHovered(null)}
            onFocus={() => setFocused(day.key)} onBlur={() => setFocused(null)}
            onClick={() => setFocused(day.key)}
          /> : <span className="stats-day stats-day-padding" key={day.key} />)}
        </div>)}
      </div>
    </div>
    <div className="stats-calendar-footer">
      <span>{dateLabel(addDays(now, 1 - length), true)} – {dateLabel(now, true)}</span>
      <div className="stats-legend" aria-label={unit === "hours" ? "Focus hours: none, up to 1, 2, 3, and over 3 hours" : "Sessions: none, 1, 2, 3, and 4 or more"}>
        <span>Less</span>{[0, 1, 2, 3, 4].map((n) => <i key={n} className={`stats-level-${n}`} />)}<span>More</span>
      </div>
    </div>
    <p className="stats-calendar-detail" aria-live="polite">{active ? calendarLabel(active) : "Hover or focus a day to see its activity."}</p>
    <p className="stats-key-help" id={helpId}>Use arrow keys to explore days; Home and End jump to the first and last day.</p>
  </section>;
}

function bucketLabel(bucket: TrendBucket) {
  return bucket.start === bucket.end ? dateLabel(bucket.start, true) : `${dateLabel(bucket.start, true)} – ${dateLabel(bucket.end, true)}`;
}

function FocusTrend({ buckets, weekly }: { buckets: TrendBucket[]; weekly: boolean }) {
  const gradientId = useId();
  const titleId = useId();
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [selected, setSelected] = useState(0);
  const active = hovered ?? focused;
  const width = 760, height = 240, left = 48, right = 26, top = 30, bottom = 38;
  const floor = height - bottom;
  const peak = Math.max(0, ...buckets.map((b) => b.focusMs));
  const maxHours = Math.max(1, Math.ceil(peak / 3_600_000));
  const points = buckets.map((bucket, i) => ({
    ...bucket,
    x: buckets.length === 1 ? (left + width - right) / 2 : left + i / (buckets.length - 1) * (width - left - right),
    y: floor - bucket.focusMs / (maxHours * 3_600_000) * (floor - top),
  }));
  const line = points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  const area = points.length ? `${line} L${points[points.length - 1].x},${floor} L${points[0].x},${floor} Z` : "";
  const peakIndex = points.findIndex((p) => p.focusMs === peak);
  const labels = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  const current = active === null ? null : points[active];
  const pointLabel = (i: number) => `${bucketLabel(buckets[i])} · ${formatStatsDuration(buckets[i].focusMs)}`;
  return <section className="stats-section" aria-labelledby={titleId}>
    <div className="stats-section-head">
      <div><h2 id={titleId}>Focus Trend</h2><p>{weekly ? "Weekly focus time" : "Daily focus time"}</p></div>
      <span className="stats-trend-total">{formatStatsDuration(buckets.reduce((sum, b) => sum + b.focusMs, 0))}<small>in this period</small></span>
    </div>
    {peak === 0 && <p className="stats-trend-empty">No focus time in this period. Start a timer to add your first point.</p>}
    <div className="stats-trend-scroll">
      <svg className="stats-trend" viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`${weekly ? "Weekly" : "Daily"} focus time chart. Use left and right arrows to explore.`}>
        <defs><linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" style={{ stopColor: "var(--accent)" }} stopOpacity="0.35" /><stop offset="100%" style={{ stopColor: "var(--accent)" }} stopOpacity="0.02" /></linearGradient></defs>
        {[0, 0.5, 1].map((ratio) => {
          const y = floor - ratio * (floor - top);
          return <g key={ratio} aria-hidden="true"><line className="stats-chart-grid" x1={left} x2={width - right} y1={y} y2={y} /><text className="stats-chart-label" x={left - 10} y={y + 4} textAnchor="end">{Number((maxHours * ratio).toFixed(1))}h</text></g>;
        })}
        <path d={area} fill={`url(#${gradientId})`} aria-hidden="true" />
        <path d={line} className="stats-trend-line" aria-hidden="true" />
        {current && <line x1={current.x} x2={current.x} y1={top} y2={floor} className="stats-chart-crosshair" aria-hidden="true" />}
        {points.map((point, i) => <g key={point.start}>
          {peak > 0 && i === peakIndex && <text className="stats-peak-label" x={point.x} y={point.y - 12} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} aria-hidden="true">{formatStatsDuration(peak)}</text>}
          <circle cx={point.x} cy={point.y} r={active === i || i === peakIndex ? 4 : 2} className="stats-trend-dot" aria-hidden="true" />
          <rect
            className="stats-trend-hit" x={point.x - (points.length === 1 ? 20 : (width - left - right) / Math.max(1, points.length - 1) / 2)} y={top - 8}
            width={points.length === 1 ? 40 : (width - left - right) / Math.max(1, points.length - 1)} height={floor - top + 16}
            tabIndex={i === selected ? 0 : -1} role="img" aria-label={pointLabel(i)}
            onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}
            onFocus={() => { setFocused(i); setSelected(i); }} onBlur={() => setFocused(null)}
            onKeyDown={(event) => {
              let next = i;
              if (event.key === "ArrowLeft") next = Math.max(0, i - 1);
              else if (event.key === "ArrowRight") next = Math.min(points.length - 1, i + 1);
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = points.length - 1;
              else return;
              event.preventDefault(); event.stopPropagation();
              event.currentTarget.ownerSVGElement?.querySelectorAll<SVGRectElement>(".stats-trend-hit")[next]?.focus();
            }}
          ><title>{pointLabel(i)}</title></rect>
        </g>)}
        {labels.map((i) => points[i] && <text key={i} className="stats-chart-label" x={points[i].x} y={height - 10} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} aria-hidden="true">{dateLabel(points[i].start, true)}</text>)}
      </svg>
    </div>
    <p className="stats-trend-detail" aria-live="polite">{current ? pointLabel(active!) : "Hover or focus the chart to see a total. Use left and right arrows to explore."}</p>
  </section>;
}
