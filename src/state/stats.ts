import { canWriteClockStore, createStore, registerClockAction, requestClockAction, uid } from "../lib/store";
import type { Chunk } from "./timerEngine";

export interface LoggedChunk extends Chunk {
  id: string;
  taskId?: string;
  earlyEndReason?: string;
}
export interface TaskDone {
  at: number;
  taskId: string;
}
export interface StatsData {
  chunks: LoggedChunk[];
  tasksDone: TaskDone[];
}

export const stats = createStore<StatsData>("stats", { chunks: [], tasksDone: [] });

/** Delete a whole segment run, or just the selected legacy chunk. */
export function deleteSession(session: Pick<SessionLogEntry, "id" | "segId">): (() => void) | undefined {
  if (!canWriteClockStore("stats", true)) return;
  const original = stats.get().chunks;
  const removed = original.filter(chunk => session.segId ? chunk.segId === session.segId :
    !chunk.segId && session.id === JSON.stringify(["entry", chunk.id, chunk.kind, chunk.segment]));
  if (!removed.length) return;
  const originalIds = new Set(original.map(item => item.id));
  const ids = new Set(removed.map(chunk => chunk.id));
  stats.set(data => ({ ...data, chunks: data.chunks.filter(chunk => !ids.has(chunk.id)) }));
  let undone = false;
  return () => {
    if (undone) return;
    undone = true;
    stats.set(data => {
      const chunks = [...data.chunks];
      for (const chunk of removed) {
        if (chunks.some(current => current.id === chunk.id)) continue;
        const following = new Set(original.slice(original.indexOf(chunk) + 1).map(next => next.id));
        const index = chunks.findIndex(current => following.has(current.id));
        const firstNew = chunks.findIndex(current => !originalIds.has(current.id));
        chunks.splice(index < 0 ? (firstNew < 0 ? chunks.length : firstNew) : index, 0, chunk);
      }
      return { ...data, chunks };
    });
  };
}

export function logChunk(c: Chunk, taskId?: string) {
  if (c.ms <= 0 && !c.completed) return;
  stats.set((s) => ({ ...s, chunks: [...s.chunks, { ...c, id: uid(), taskId }] }));
}
export function logTaskDone(taskId: string, at = Date.now()) {
  if (!canWriteClockStore("stats")) { void requestClockAction("task-stat", { taskId, at, done: true }).catch(() => {}); return; }
  stats.set((s) => ({ ...s, tasksDone: [...s.tasksDone, { at, taskId }] }));
}
export function unlogTaskDone(taskId: string) {
  if (!canWriteClockStore("stats")) { void requestClockAction("task-stat", { taskId, done: false }).catch(() => {}); return; }
  stats.set((s) => {
    const i = s.tasksDone.map((t) => t.taskId).lastIndexOf(taskId);
    return i < 0 ? s : { ...s, tasksDone: s.tasksDone.filter((_, j) => j !== i) };
  });
}

// ---------- dates ----------
export const dayKey = (t: number | Date) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
export const addDays = (t: number, n: number) => {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
};

export type Range = "today" | "week" | "month" | "3m" | "6m" | "1y" | "all";
export function rangeStart(r: Range, now: number, data: StatsData): number {
  const today = startOfDay(now);
  switch (r) {
    case "today": return today;
    case "week": return addDays(today, -6);
    case "month": return addDays(today, -29);
    case "3m": return addDays(today, -89);
    case "6m": return addDays(today, -181);
    case "1y": return addDays(today, -364);
    case "all": return data.chunks.length ? startOfDay(Math.min(...data.chunks.map((c) => c.start))) : today;
  }
}

// ---------- per-day aggregation ----------
export interface DayTotals {
  focusMs: number;
  breakMs: number;
  sessions: number; // completed focus segments
  tasks: number;
  longestFocusMs: number;
}
const empty = (): DayTotals => ({ focusMs: 0, breakMs: 0, sessions: 0, tasks: 0, longestFocusMs: 0 });

export function byDay(data: StatsData): Map<string, DayTotals> {
  const m = new Map<string, DayTotals>();
  const get = (k: string) => m.get(k) ?? (m.set(k, empty()), m.get(k)!);
  for (const c of data.chunks) {
    const d = get(dayKey(c.start));
    if (c.kind === "focus") {
      d.focusMs += c.ms;
      d.longestFocusMs = Math.max(d.longestFocusMs, c.ms);
      if (c.completed) d.sessions += 1;
    } else d.breakMs += c.ms;
  }
  for (const t of data.tasksDone) get(dayKey(t.at)).tasks += 1;
  return m;
}

export function summarize(data: StatsData, from: number, to = Date.now()): DayTotals {
  const out = empty();
  for (const c of data.chunks) {
    if (c.start < from || c.start > to) continue;
    if (c.kind === "focus") {
      out.focusMs += c.ms;
      out.longestFocusMs = Math.max(out.longestFocusMs, c.ms);
      if (c.completed) out.sessions += 1;
    } else out.breakMs += c.ms;
  }
  out.tasks = data.tasksDone.filter((t) => t.at >= from && t.at <= to).length;
  return out;
}

/** Consecutive days with ≥ 1 minute of focus, ending today (or yesterday if today is still empty). */
export function streak(days: Map<string, DayTotals>, now = Date.now()): number {
  const active = (t: number) => (days.get(dayKey(t))?.focusMs ?? 0) >= 60_000;
  let t = startOfDay(now);
  if (!active(t)) t = addDays(t, -1);
  let n = 0;
  while (active(t)) {
    n++;
    t = addDays(t, -1);
  }
  return n;
}

// ---------- Focus Score ----------
export interface ScoreInputs {
  qualifyingSessions: number; // completed focus sessions ≥ MIN_SESSION_MS
  focusMin: number;
  tasks: number;
  breakMin: number;
  streakDays: number;
}
export const MIN_SESSION_MS = 10 * 60_000;

/**
 * A paused or backgrounded session is logged as several chunks of one segment run (same segId).
 * A session qualifies when that run finished and its pieces add up to MIN_SESSION_MS.
 * Chunks without a segId (older data) count on their own.
 */
export function qualifyingSessions(chunks: LoggedChunk[]): number {
  const runs = new Map<string, { ms: number; completed: boolean }>();
  for (const c of chunks) {
    if (c.kind !== "focus") continue;
    const key = c.segId ?? `solo:${c.id}`;
    const r = runs.get(key) ?? { ms: 0, completed: false };
    r.ms += c.ms;
    r.completed ||= c.completed;
    runs.set(key, r);
  }
  return [...runs.values()].filter((r) => r.completed && r.ms >= MIN_SESSION_MS).length;
}

export function scoreInputs(data: StatsData, day: number, streakDays: number): ScoreInputs {
  const from = startOfDay(day), to = addDays(from, 1) - 1;
  const chunks = data.chunks.filter((c) => c.start >= from && c.start <= to);
  return {
    qualifyingSessions: qualifyingSessions(chunks),
    focusMin: chunks.filter((c) => c.kind === "focus").reduce((a, c) => a + c.ms, 0) / 60_000,
    tasks: data.tasksDone.filter((t) => t.at >= from && t.at <= to).length,
    breakMin: chunks.filter((c) => c.kind === "break" && !c.away).reduce((a, c) => a + c.ms, 0) / 60_000,
    streakDays,
  };
}

/** Flocus-published streak boosts: +5 % at 7 days, +10 % at 30, +15 % at 90, +20 % at 180. */
export function streakMultiplier(days: number): number {
  return days >= 180 ? 1.2 : days >= 90 ? 1.15 : days >= 30 ? 1.1 : days >= 7 ? 1.05 : 1;
}

/**
 * Daily Focus Score, 0..100. ADHD-friendly weighting: time spent focusing counts even when sessions were
 * messy (paused, reset, stopwatch), short finished sessions count, and skipping breaks earns nothing
 * rather than costing points.
 *   focus time      up to 45  (2 h of focus = full)
 *   finished        up to 25  (4 sessions of 10+ min = full)
 *   tasks           up to 15  (3 tasks = full)
 *   break balance   up to 15  (breaks 10-35 % of focus = full, a bit off = 8; only after 25+ min of focus)
 * then the Flocus streak boost, capped at 100.
 */
export const SCORE = { focusFullMin: 120, sessionsFull: 4, tasksFull: 3 } as const;

export function focusScore(i: ScoreInputs): number {
  const focus = 45 * Math.min(1, Math.max(0, i.focusMin) / SCORE.focusFullMin);
  const sessions = 25 * Math.min(1, i.qualifyingSessions / SCORE.sessionsFull);
  const tasks = 15 * Math.min(1, i.tasks / SCORE.tasksFull);
  let breaks = 0;
  if (i.focusMin >= 25 && i.breakMin > 0) {
    const ratio = i.breakMin / i.focusMin;
    breaks = ratio >= 0.1 && ratio <= 0.35 ? 15 : ratio <= 0.6 ? 8 : 0;
  }
  const base = focus + sessions + tasks + breaks;
  return Math.round(Math.min(100, base * streakMultiplier(i.streakDays)));
}

// ---------- stats dashboard ----------
export function formatStatsDuration(ms: number): string {
  const seconds = Math.floor(Math.max(0, Number.isFinite(ms) ? ms : 0) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

/** Average only focused days; each day's boost uses its historical streak. */
export function averageFocusScore(data: StatsData, from: number, to: number): number {
  const visible = {
    chunks: data.chunks.filter((c) => c.start <= to && !c.away),
    tasksDone: data.tasksDone.filter((t) => t.at <= to),
  };
  const days = byDay(visible);
  // same rule as the daily score: pieces of one segment run (segId) count together
  const perDay = new Map<string, LoggedChunk[]>();
  for (const c of visible.chunks) {
    const key = dayKey(c.start);
    (perDay.get(key) ?? perDay.set(key, []).get(key)!).push(c);
  }
  const qualifying = new Map([...perDay].map(([k, cs]) => [k, qualifyingSessions(cs)]));
  let previousActive: string | undefined;
  let run = 0;
  let sum = 0;
  let count = 0;
  for (const [key, d] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    const [year, month, date] = key.split("-").map(Number);
    const day = new Date(year, month - 1, date).getTime();
    const continues = previousActive === dayKey(addDays(day, -1));
    const streakDays = d.focusMs >= 60_000 ? (continues ? run + 1 : 1) : (continues ? run : 0);
    if (d.focusMs >= 60_000) {
      previousActive = key;
      run = streakDays;
    }
    if (day < startOfDay(from) || d.focusMs <= 0) continue;
    sum += focusScore({
      qualifyingSessions: qualifying.get(key) ?? 0,
      focusMin: d.focusMs / 60_000,
      tasks: d.tasks,
      breakMin: d.breakMs / 60_000,
      streakDays,
    });
    count++;
  }
  return count ? Math.round(sum / count) : 0;
}

export function statsOverview(data: StatsData, range: Range, now: number) {
  const visible: StatsData = {
    chunks: data.chunks.filter((c) => c.start <= now),
    tasksDone: data.tasksDone.filter((t) => t.at <= now),
  };
  let from = rangeStart(range, now, visible);
  // All Time includes task completions even before the first timer entry.
  if (range === "all") {
    from = visible.tasksDone.reduce((earliest, t) => Math.min(earliest, startOfDay(t.at)), from);
  }
  const days = byDay(visible);
  const currentStreak = streak(days, now);
  return {
    from,
    days,
    currentStreak,
    totals: summarize(visible, from, now),
    score: range === "today"
      ? focusScore(scoreInputs(visible, now, currentStreak))
      : averageFocusScore(visible, from, now),
  };
}

export interface TrendBucket {
  start: number;
  end: number;
  focusMs: number;
}

/** Calendar days/weeks, including empty days and partial boundary weeks. */
export function focusTrend(days: Map<string, DayTotals>, from: number, to: number, weekly: boolean): TrendBucket[] {
  const out: TrendBucket[] = [];
  let bucket: TrendBucket | undefined;
  for (let day = startOfDay(from); day <= to; day = addDays(day, 1)) {
    if (!bucket || !weekly || new Date(day).getDay() === 1) {
      bucket = { start: day, end: day, focusMs: 0 };
      out.push(bucket);
    }
    bucket.end = day;
    bucket.focusMs += days.get(dayKey(day))?.focusMs ?? 0;
  }
  return out;
}

/** Records split credited focus at local midnights; saved chunks and legacy totals stay intact. */
export function focusRecordDays(data: StatsData, now = Date.now()): Map<string, DayTotals> {
  const days = new Map<string, DayTotals>();
  const get = (key: string) => days.get(key) ?? (days.set(key, empty()), days.get(key)!);
  for (const chunk of data.chunks) {
    if (chunk.kind !== "focus") continue;
    const end = Math.min(chunk.start + chunk.ms, now);
    for (let at = chunk.start; at < end;) {
      const next = Math.min(addDays(startOfDay(at), 1), end);
      get(dayKey(at)).focusMs += next - at;
      at = next;
    }
  }
  for (const task of data.tasksDone) if (task.at <= now) get(dayKey(task.at)).tasks += 1;
  return days;
}

/** Plain records reuse the calendar buckets; task completions keep their recorded local day. */
export function focusRecords(days: Map<string, DayTotals>, from: number, to: number, weekly: boolean) {
  return focusTrend(days, from, to, weekly).map(bucket => {
    let tasks = 0;
    for (let day = bucket.start; day <= bucket.end; day = addDays(day, 1)) tasks += days.get(dayKey(day))?.tasks ?? 0;
    return { ...bucket, tasks };
  });
}

export interface CalendarDay {
  at: number;
  key: string;
  inRange: boolean;
  focusMs: number;
  sessions: number;
}

/** Exactly 182 or 365 local days, padded to Sunday–Saturday columns. */
export function focusCalendar(days: Map<string, DayTotals>, now: number, length: 182 | 365): CalendarDay[] {
  const today = startOfDay(now);
  const from = addDays(today, 1 - length);
  const first = addDays(from, -new Date(from).getDay());
  const last = addDays(today, 6 - new Date(today).getDay());
  const out: CalendarDay[] = [];
  for (let at = first; at <= last; at = addDays(at, 1)) {
    const key = dayKey(at);
    const totals = days.get(key);
    out.push({ at, key, inRange: at >= from && at <= today, focusMs: totals?.focusMs ?? 0, sessions: totals?.sessions ?? 0 });
  }
  return out;
}

/** Empty plus four increasing purple levels; fixed thresholds keep periods comparable. */
export function focusLevel(value: number, unit: "hours" | "sessions"): number {
  if (value <= 0) return 0;
  const step = unit === "hours" ? 3_600_000 : 1;
  return Math.min(4, Math.ceil(value / step));
}

// ---------- session log (read-only selectors; the timer's stored entries stay intact) ----------
export interface SessionLogEntry {
  id: string;
  segId?: string;
  kind: "focus" | "break";
  segment: Chunk["segment"];
  start: number;
  end: number;
  ms: number;
  completed: boolean;
  taskIds: (string | undefined)[];
  taskTitles: string[];
  interruptions: number;
  earlyEndReason?: string;
}
export interface SessionLogDay {
  day: string;
  sessions: SessionLogEntry[];
  focusMs: number;
  breakMs: number;
  interruptions: number;
}
export interface SessionLogFilter { from?: string; to?: string; taskId?: string }
export interface LogInterruption { segId?: string; at: number; taskId?: string; tag?: string; text?: string; segment?: Chunk["segment"] }

/** One row per segment run. Legacy entries without a segId remain separate. */
export function sessionLog(
  data: StatsData,
  taskList: readonly { id: string; title: string }[],
  filter: SessionLogFilter = {},
  interruptions: readonly LogInterruption[] = [],
): SessionLogDay[] {
  const titles = new Map(taskList.map(task => [task.id, task.title || "Untitled task"]));
  const runs = new Map<string, SessionLogEntry>();
  for (const chunk of data.chunks) {
    const key = JSON.stringify([chunk.segId ? "session" : "entry", chunk.segId ?? chunk.id, chunk.kind, chunk.segment]);
    let run = runs.get(key);
    if (!run) {
      run = { id: key, segId: chunk.segId, kind: chunk.kind, segment: chunk.segment, start: chunk.start,
        end: chunk.start + chunk.ms, ms: 0, completed: false, taskIds: [], taskTitles: [], interruptions: 0 };
      runs.set(key, run);
    }
    run.start = Math.min(run.start, chunk.start);
    run.end = Math.max(run.end, chunk.start + chunk.ms);
    run.ms += chunk.ms;
    run.completed ||= chunk.completed;
    if (chunk.earlyEndReason) run.earlyEndReason = chunk.earlyEndReason;
    if (!run.taskIds.includes(chunk.taskId)) run.taskIds.push(chunk.taskId);
  }
  const counts = new Map<string, number>();
  for (const item of interruptions) if (item.segId) counts.set(item.segId, (counts.get(item.segId) ?? 0) + 1);
  const days = new Map<string, SessionLogDay>();
  for (const run of runs.values()) {
    const day = dayKey(run.start);
    if ((filter.from && day < filter.from) || (filter.to && day > filter.to)) continue;
    if (filter.taskId !== undefined && !run.taskIds.includes(filter.taskId || undefined)) continue;
    run.taskTitles = run.taskIds.map(id => id ? titles.get(id) ?? "Deleted task" : "No task");
    run.interruptions = run.segId ? counts.get(run.segId) ?? 0 : 0;
    const group = days.get(day) ?? { day, sessions: [], focusMs: 0, breakMs: 0, interruptions: 0 };
    group.sessions.push(run);
    group[run.kind === "focus" ? "focusMs" : "breakMs"] += run.ms;
    group.interruptions += run.interruptions;
    days.set(day, group);
  }
  return [...days.values()].sort((a, b) => b.day.localeCompare(a.day)).map(day => ({
    ...day, sessions: day.sessions.sort((a, b) => b.start - a.start || a.id.localeCompare(b.id)),
  }));
}

/** A zero-credit marker keeps the exit reason with its session, including very short blocks. */
export function logHardEnd(segId: string, segment: Chunk["segment"], at: number, reason: string, taskId?: string) {
  stats.set(data => ({ ...data, chunks: [...data.chunks, { id: uid(), segId, segment, kind: segment === "focus" ? "focus" : "break", start: at, ms: 0, completed: false, taskId, earlyEndReason: reason }] }));
}

const statUndos = new Map<string, () => void>();
registerClockAction("task-stat", ({ taskId, at, done }) => {
  if (typeof taskId !== "string" || typeof done !== "boolean" || (done && !Number.isFinite(at))) return { ok: false };
  if (done && !stats.get().tasksDone.some(item => item.taskId === taskId)) logTaskDone(taskId, at);
  if (!done) unlogTaskDone(taskId);
  return { ok: true };
});
registerClockAction("delete-stat", ({ session, ids }) => {
  const current = stats.get().chunks.filter(chunk => session.segId ? chunk.segId === session.segId :
    !chunk.segId && session.id === JSON.stringify(["entry", chunk.id, chunk.kind, chunk.segment]));
  if (JSON.stringify(current.map(chunk => chunk.id)) !== JSON.stringify(ids)) return { ok: false };
  const undo = deleteSession(session);
  if (!undo) return { ok: false };
  const undoToken = uid(); statUndos.set(undoToken, undo);
  setTimeout(() => statUndos.delete(undoToken), 10_000);
  return { ok: true, undoToken };
});
registerClockAction("undo-stat", ({ token }) => {
  const undo = statUndos.get(token); statUndos.delete(token); undo?.(); return { ok: !!undo };
});
/** User edits to clock accounting are evaluated on the owner, including Undo. */
export async function requestDeleteSession(session: Pick<SessionLogEntry, "id" | "segId">) {
  const ids = stats.get().chunks.filter(chunk => session.segId ? chunk.segId === session.segId :
    !chunk.segId && session.id === JSON.stringify(["entry", chunk.id, chunk.kind, chunk.segment])).map(chunk => chunk.id);
  const result = await requestClockAction("delete-stat", { session, ids });
  if (!result.ok) throw new Error("This session changed. Try deleting it again.");
  return () => { void requestClockAction("undo-stat", { token: result.undoToken }); };
}
