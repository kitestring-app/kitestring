import type { SessionContext, RecoveryBoundary } from "./recoveryPolicy";
import type { Settings, TimerMode } from "./settings";

export type Segment = "focus" | "short" | "long";

export interface TimerState {
  recoveryRecord?: { focusMs: number; awayMs: number };
  tinyStart?: boolean;
  context?: SessionContext;
  boundary?: RecoveryBoundary;
  reentry?: string;
  segment: Segment;
  startedAt: number | null; // epoch ms of the current run, null when paused
  elapsedBefore: number; // ms banked from earlier runs of this segment
  round: number; // focus segments finished in the current round
  creditedUpTo: number; // ms of this segment already written to stats (partial credit)
  segId: string; // identifies one segment run; stats merge partial chunks by it
  frozen?: boolean; // true once the segment has started: frozenTotal is authoritative (null = open-ended stopwatch)
  frozenTotal?: number | null; // segment length captured at start, so mid-run edits don't move the goalposts
  hardLocked?: boolean; // latched until this segment ends
  taskId?: string; // task the time since the last credit belongs to
}

export interface Chunk {
  away?: boolean;
  kind: "focus" | "break";
  segment: Segment;
  start: number; // epoch ms the chunk began (approximate for multi-run segments)
  ms: number;
  completed: boolean; // the segment ran to its end
  segId?: string;
}

export const newSegId = () => Math.random().toString(36).slice(2, 10);
export const INITIAL_TIMER: TimerState = { segment: "focus", startedAt: null, elapsedBefore: 0, round: 0, creditedUpTo: 0, segId: "initial" };

const MIN = 60_000;

/** Segment length in ms, or null for an open-ended stopwatch. */
export function durationMs(t: Settings["timer"], segment: Segment, taskEtaMin?: number | null): number | null {
  const L = t.lengths;
  switch (t.mode) {
    case "stopwatch":
      return segment === "focus" ? null : (segment === "short" ? L.short : L.long) * MIN;
    case "countdown":
      return segment === "focus" ? L.countdown * MIN : (segment === "short" ? L.short : L.long) * MIN;
    case "5217":
      return (segment === "focus" ? 52 : 17) * MIN;
    case "animedoro":
    case "pomodoro": {
      if (segment === "focus") return (t.taskEta && taskEtaMin ? taskEtaMin : L.pomodoro) * MIN;
      return (segment === "short" ? L.short : L.long) * MIN;
    }
  }
}

export function elapsed(s: TimerState, now: number): number {
  return s.elapsedBefore + (s.startedAt !== null ? Math.max(0, now - s.startedAt) : 0);
}

export function remaining(s: TimerState, total: number | null, now: number): number {
  return total === null ? Infinity : Math.max(0, total - elapsed(s, now));
}

/** Which segment follows `segment`, given `round` = focus sessions finished so far this round (after counting the one that just ended). */
export function nextSegment(mode: TimerMode, segment: Segment, round: number, longEvery: number): Segment {
  if (segment !== "focus") return "focus";
  switch (mode) {
    case "animedoro":
      return "long"; // Flocus: Long Break doubles as "watch time"
    case "5217":
      return "short";
    case "countdown":
    case "stopwatch":
      return "focus"; // single-session modes don't cycle
    case "pomodoro":
      return round > 0 && round % Math.max(1, longEvery) === 0 ? "long" : "short";
  }
}

/** Does finishing this segment stop the timer regardless of auto-start? */
export function endsSession(mode: TimerMode, segment: Segment): boolean {
  return (mode === "countdown" || mode === "stopwatch") && segment === "focus";
}

/** The final break of a full cycle, before the next focus session. */
export function endsCycle(mode: TimerMode, segment: Segment): boolean {
  return ((mode === "pomodoro" || mode === "animedoro") && segment === "long") ||
    (mode === "5217" && segment !== "focus");
}

export function start(s: TimerState, now: number): TimerState {
  return s.startedAt !== null ? s : { ...s, recoveryRecord: undefined, startedAt: now };
}

export function pause(s: TimerState, now: number): TimerState {
  if (s.startedAt === null) return s;
  return { ...s, elapsedBefore: elapsed(s, now), startedAt: null };
}

/** Time worked in this segment that hasn't been credited yet. Call before discarding a segment. */
export function pendingCredit(s: TimerState, now: number, completed: boolean): Chunk | null {
  const ms = Math.round(elapsed(s, now) - s.creditedUpTo);
  if (ms <= 0 && !completed) return null;
  return {
    kind: s.segment === "focus" ? "focus" : "break",
    segment: s.segment,
    start: now - ms,
    ms: Math.max(0, ms),
    completed,
    segId: s.segId,
  };
}

/** Bank partial credit without changing the segment (used when the tab closes). Never past the segment's end. */
export function markCredited(s: TimerState, now: number, total: number | null = null): TimerState {
  const e = elapsed(s, now);
  return { ...s, creditedUpTo: total === null ? e : Math.min(e, total) };
}

/** Move to another segment. `finished` = the current one ran to completion. */
export function advance(
  s: TimerState,
  t: Settings["timer"],
  now: number,
  finished: boolean,
  to?: Segment,
): TimerState {
  const round = s.segment === "focus" && finished ? s.round + 1 : s.segment === "long" ? 0 : s.round;
  const segment = to ?? nextSegment(t.mode, s.segment, round, t.longEvery);
  const keepRunning = finished && shouldAutoRun(t, s.segment);
  return {
    segment,
    context: carryContext(s, now),
    round: segment === "focus" && s.segment === "long" ? 0 : round,
    startedAt: keepRunning ? now : null,
    elapsedBefore: 0,
    creditedUpTo: 0,
    segId: newSegId(),
    frozen: false,
    frozenTotal: null,
    hardLocked: keepRunning && t.hardMode,
  };
}

/** Carry recorded focus time when leaving a segment, including partial stops and skips. */
export function carryContext(s: TimerState, now: number): SessionContext | undefined {
  if (!s.context || s.segment !== "focus") return s.context;
  const worked = Math.min(elapsed(s, now), s.frozenTotal ?? Infinity);
  return { ...s.context, spentMs: s.context.spentMs + worked };
}

/** Restart the current segment only (Flocus "reset segment"). */
export function resetSegment(s: TimerState, now = s.startedAt ?? 0): TimerState {
  return { ...s, recoveryRecord: undefined, context: carryContext(s, now), reentry: undefined, boundary: undefined, startedAt: null, elapsedBefore: 0, creditedUpTo: 0, segId: newSegId(), frozen: false, frozenTotal: null, hardLocked: false };
}

/** Countdowns round up (never show 00:00 early); count-ups round down (00:00 for the first second). */
export function fmt(ms: number, withHours = false, countUp = false): string {
  if (!isFinite(ms)) ms = 0;
  const total = countUp ? Math.floor(ms / 1000) : Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 || withHours ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export const SEGMENT_LABEL: Record<Segment, string> = { focus: "Focus", short: "Short break", long: "Long break" };

/** Countdown repeat is independent of the focus/break auto-run policy. */
export function shouldAutoRun(t: Settings["timer"], ended: Segment): boolean {
  if (t.mode === "countdown") return t.countdownRepeat && ended === "focus";
  return t.mode !== "stopwatch" &&
    (t.autoRun === "always" || (t.autoRun === "cycle" && !endsCycle(t.mode, ended)));
}
