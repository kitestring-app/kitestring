import { createStore } from "../lib/store";

/** Opt-in reminder to start a block while the timer sits idle. Device-local: never synced, travels only in the backup's device section. */
export interface IdleNudge {
  enabled: boolean;
  every: number; // minutes of idle time between reminders
  from: string; // "HH:MM", start of the active window
  to: string; // "HH:MM", end of the active window; earlier than `from` means it runs past midnight
  days: boolean[]; // Sunday..Saturday, the day the window opens
  message: string; // empty uses DEFAULT_NUDGE_MESSAGE
}

export const NUDGE_EVERY = { min: 10, max: 120 } as const; // matches the choices offered in Settings
export const NUDGE_MESSAGE_MAX = 120;
/** Choices offered in Settings. Stored values outside the list still show. */
export const NUDGE_INTERVALS = [10, 15, 20, 30, 45, 60, 90, 120] as const;
export const DEFAULT_NUDGE_MESSAGE = "Ready when you are. Pick one small thing and start a block.";
export const DEFAULT_IDLE_NUDGE: IdleNudge = {
  enabled: false,
  every: 30,
  from: "09:00",
  to: "18:00",
  days: [false, true, true, true, true, true, false],
  message: "",
};

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const validTime = (v: unknown): v is string => typeof v === "string" && TIME.test(v);
export const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Shape and ranges. Runs on every load and on imported backups. */
export function sanitizeIdleNudge(stored: unknown): IdleNudge {
  const raw = (stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {}) as Partial<Record<keyof IdleNudge, unknown>>;
  const d = DEFAULT_IDLE_NUDGE;
  const every = typeof raw.every === "number" ? raw.every : Number.NaN;
  const days = Array.isArray(raw.days) && raw.days.length === 7 && raw.days.every(v => typeof v === "boolean") ? [...raw.days] as boolean[] : [...d.days];
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : d.enabled,
    every: Number.isFinite(every) ? Math.min(NUDGE_EVERY.max, Math.max(NUDGE_EVERY.min, Math.round(every))) : d.every,
    from: validTime(raw.from) ? raw.from : d.from,
    to: validTime(raw.to) ? raw.to : d.to,
    days,
    message: typeof raw.message === "string" ? raw.message.replace(/[\r\n]+/g, " ").slice(0, NUDGE_MESSAGE_MAX) : d.message,
  };
}

/** Strict check for backup import: the file must already be in range. */
export function isIdleNudge(v: unknown): v is IdleNudge {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const clean = sanitizeIdleNudge(v);
  const raw = v as Record<string, unknown>;
  return (Object.keys(clean) as (keyof IdleNudge)[]).every(key => JSON.stringify(raw[key]) === JSON.stringify(clean[key]));
}

export const idleNudge = createStore<IdleNudge>("idleNudge", DEFAULT_IDLE_NUDGE, sanitizeIdleNudge);
export function idleNudgeUpdate(patch: Partial<IdleNudge>) {
  idleNudge.set(current => sanitizeIdleNudge({ ...current, ...patch }));
}

export const nudgeText = (cfg: Pick<IdleNudge, "message">) => cfg.message.trim() || DEFAULT_NUDGE_MESSAGE;

/**
 * When the active window that contains `now` opened, or null when `now` is outside every window.
 * A window that runs past midnight belongs to the weekday it opened on. Equal times mean all day.
 */
export function windowStart(cfg: Pick<IdleNudge, "from" | "to" | "days">, now: Date): number | null {
  const from = minutesOf(cfg.from), to = minutesOf(cfg.to);
  const mins = now.getHours() * 60 + now.getMinutes();
  const at = (dayOffset: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(Math.floor(from / 60), from % 60, 0, 0);
    return d;
  };
  if (from === to) return cfg.days[now.getDay()] ? at(0).setHours(0, 0, 0, 0) : null;
  if (from < to) return mins >= from && mins < to && cfg.days[now.getDay()] ? at(0).getTime() : null;
  // Overnight window: the evening part opened today, the early-morning part opened yesterday.
  if (mins >= from) return cfg.days[now.getDay()] ? at(0).getTime() : null;
  if (mins < to) { const opened = at(-1); return cfg.days[opened.getDay()] ? opened.getTime() : null; }
  return null;
}

/**
 * Pure decision. Idle time counts from the latest of: the timer going idle, the last reminder,
 * the window opening and the reminder being switched on, so the first reminder of a day comes
 * one full interval after the window opens.
 */
export function nudgeDue(cfg: IdleNudge, input: { now: number; busy: boolean; idleSince: number; lastNudgeAt: number | null }): boolean {
  if (!cfg.enabled || input.busy) return false;
  const opened = windowStart(cfg, new Date(input.now));
  if (opened === null) return false;
  const since = Math.max(input.idleSince, input.lastNudgeAt ?? 0, opened);
  return input.now - since >= cfg.every * 60_000;
}
