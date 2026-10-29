import { playStartChime, shouldStartChime } from "../audio/startChime";
import { timerAnnouncement, timerDisplay } from "./timerDisplay";
import { intent, updateIntent } from "./intent";
import { longerOfferAvailable, recordTinyFinish, settleLongerOffer, tinyStarts } from "./tinyStarts";
import { answerParkingReview, chooseReviewBoundary, closeParkingReview, deferParkingReview, openParkingReview, parkingReview, queueParkingReview, registerReviewOwner, type ReviewBoundary } from "./parkingReview";
import { acknowledgeGap, checkReturnActivity, purposefulAction, registerActivityOwner, returnActivity } from "./returnActivity";
import { continueDuration, isRecoveryBoundary, isSessionContext, selectRecovery } from "./recoveryPolicy";
import type { SessionContext } from "./recoveryPolicy";
import { cleanThought } from "../lib/parked";
import { useEffect, useState } from "react";
import { canWriteClockStore, clearStoredProfile, registerClockAction, requestClockAction, CLOCK_OWNED_KEYS, executeClockAction, registerClockOwner, registerClockForwarder, refreshClockStores, createStore, flushReadyStores, registerPersistenceGroup, registerPersistenceOwner, uid, storeReady, storeSource, useStore } from "../lib/store";
import { playTimerTick, cancelAllChimes, cancelChime, cancelEnd, releaseChime, scheduleChime, scheduleEnd } from "../audio/core";
import { ALERT_TEXT, type AlertKind } from "../audio/alertSynth";
import { armCompanionWithSpeech, companionAvailable, companionKnownUp, disarmCompanion } from "../audio/companion";
import { calmFoundationReady, localPreferences, quietTimer, settings } from "./settings";
import { boundaryAlert, repeatBoundarySound } from "../audio/boundaryAlert";
import { createTickScheduler } from "../audio/ticking";
import { recordHardInterruption, requestInterruption } from "./parked";
import { logChunk, logHardEnd, stats, type StatsData } from "./stats";
import { currentTask, etaOf, focusPick, tasks } from "./tasks";
import * as E from "./timerEngine";
import { transitionStore } from "../ui/timer/TransitionStore";
import { alertTypingGuard } from "../lib/alertTypingGuard";
import { captureStoppedAttempt, registerStopClock, stopAttempt, stopOutcomes } from './stopOutcomes';

registerPersistenceGroup(["timer", "stats"]);
registerPersistenceGroup(["timer", "stats", "tinyStarts", "parkingReview", "clockPresence"]);
registerPersistenceGroup(["timer", "stats", "stopAttempt"]);

interface ClockPresence { segId: string; lastAliveAt: number; departedAt?: number; ownerId: string }
export const clockPresence = createStore<ClockPresence | null>("clockPresence", null, value => {
  const p = value as ClockPresence | null;
  return p && typeof p.segId === "string" && Number.isFinite(p.lastAliveAt) && typeof p.ownerId === "string" &&
    (p.departedAt === undefined || Number.isFinite(p.departedAt)) ? p : null;
});
const ownerId = uid();
let witnessedOwner: { segId: string; ownerId: string } | null = null;
let departing = false;
let settlingSnapshot = false;

let reminderMessage = "";
const reminderListeners = new Set<() => void>();
export const reminderStatus = {
  get: () => reminderMessage,
  subscribe(fn: () => void) { reminderListeners.add(fn); return () => { reminderListeners.delete(fn); }; },
  set(message: string) { if (message === reminderMessage) return; reminderMessage = message; reminderListeners.forEach(fn => fn()); },
};

export const timer = createStore<E.TimerState>("timer", { ...E.INITIAL_TIMER, segId: E.newSegId() }, (stored) => ({
  ...E.INITIAL_TIMER,
  ...(stored as Partial<E.TimerState>),
  segId: (stored as Partial<E.TimerState>)?.segId ?? E.newSegId(),
  context: isSessionContext((stored as E.TimerState)?.context) ? (stored as E.TimerState).context : undefined,
  boundary: isRecoveryBoundary((stored as E.TimerState)?.boundary) ? (stored as E.TimerState).boundary : undefined,
  reentry: typeof (stored as E.TimerState)?.reentry === "string" ? (stored as E.TimerState).reentry : undefined,
  tinyStart: (stored as E.TimerState)?.tinyStart === true ? true : undefined,
}));
registerStopClock(timer);

const T = () => settings.get().timer;
export const HARD_MODE_MESSAGE = "Hard mode: this block runs to the end";
export type TimerRefusal = { ok: false; reason: "hard-mode" | "hold-required" | "reason-required" | "stale-segment" | "typing-guard"; message: string };
export type TimerCommandResult = { ok: true } | TimerRefusal;
export const hardModeLocked = (s = timer.get()) => s.hardLocked === true || (s.startedAt !== null && T().hardMode);
export const timerBusyForImport = () => hardModeLocked() || timer.get().startedAt !== null || timer.get().elapsedBefore > 0 || timer.get().frozen === true;
/** The clock owner preserves its current block's credit while preparing an import. */
export function prepareTimerRestore(entries: [string, unknown][], keptTimer = timerBusyForImport(), segments: ReadonlySet<string> = new Set([timer.get().segId])) {
  const restored = entries.filter(([key]) => !keptTimer || key !== "timer").map(([key, value]): [string, unknown] => {
    if (!keptTimer && key === "timer") {
      const portable = value as E.TimerState;
      if (portable.startedAt !== null && portable.startedAt !== undefined) return [key, { ...portable, startedAt: null,
        elapsedBefore: Math.max(portable.elapsedBefore ?? 0, portable.creditedUpTo ?? 0), reentry: E.newSegId() }];
    }
    if (!keptTimer || key !== "stats") return [key, value];
    const imported = value as StatsData;
    const local = stats.get().chunks.filter(chunk => chunk.segId !== undefined && segments.has(chunk.segId));
    const ids = new Set(local.map(chunk => chunk.id));
    return [key, { ...imported, chunks: [...imported.chunks.filter(chunk => !ids.has(chunk.id) && (chunk.segId === undefined || !segments.has(chunk.segId))), ...local] }];
  });
  // Persist the credit cursor with its history, even if this run changed while waiting.
  // Publish it before tasks, whose subscribers may bank more time into both stores.
  if (keptTimer && entries.some(([key]) => key === "timer" || key === "stats")) restored.unshift(["timer", timer.get()]);
  return { keptTimer, entries: restored };
}
/** Capture the import boundary, but read credit only when the owner's restore is applied. */
export function captureTimerRestore() {
  const original = timer.get().segId, wasBusy = timerBusyForImport();
  const before = new Set(stats.get().chunks.map(chunk => chunk.id));
  return (entries: [string, unknown][]) => {
    const segments = new Set([original, timer.get().segId]);
    const added = stats.get().chunks.filter(chunk => !before.has(chunk.id));
    added.forEach(chunk => { if (chunk.segId !== undefined) segments.add(chunk.segId); });
    return prepareTimerRestore(entries, wasBusy || timerBusyForImport() || added.length > 0, segments);
  };
}
const hardRefusal = (): TimerRefusal => ({ ok: false, reason: "hard-mode", message: HARD_MODE_MESSAGE });
// Persist the latch on enable, including changes received from another tab or sync.
function latchHardMode() {
  const s = timer.get();
  if (canWriteClockStore("timer") && s.startedAt !== null && T().hardMode && !s.hardLocked) timer.set({ ...s, hardLocked: true });
}
settings.subscribe(latchHardMode);
timer.subscribe(latchHardMode);

// Hold authorization is transient, scoped to this segment and this renderer.
let endHold: { segId: string; at: number } | null = null;

const taskEta = () => {
  const all = tasks.get();
  const t = currentTask(all);
  return t ? etaOf(all, t) || null : null;
};
/** The configured length right now (used when a segment starts). */
const liveTotal = (s: E.TimerState) => E.durationMs(T(), s.segment, taskEta());
/** The length of the segment as it runs: frozen at start so editing settings or ticking a subtask can't move the end. */
export const totalMs = (s = timer.get()) => (s.frozen ? (s.frozenTotal ?? null) : liveTotal(s));

function captureContext(previous = timer.get().context): SessionContext {
  const pin = intent.get(), task = currentTask(tasks.get());
  return { actionId: `intent:${pin.updatedAt}`, actionRevision: pin.rev, action: pin.action, why: pin.why, cue: pin.cue, sufficientFinish: pin.sufficientFinish, portion: pin.portion,
    taskId: task?.id, taskTitle: task?.title.replace(/[\r\n]+/g, " ").slice(0, 500) ?? "",
    spentMs: previous?.actionId === `intent:${pin.updatedAt}` && previous.actionRevision === pin.rev ? previous.spentMs : 0 };
}
function credit(s: E.TimerState, now: number, completed: boolean) {
  const duration = totalMs(s);
  const creditAt = s.segment === "focus" && duration !== null && s.startedAt !== null ? Math.min(now, s.startedAt + duration - s.elapsedBefore) : now;
  noteAlive(now);
  const c = E.pendingCredit(s, creditAt, completed);
  if (!c) return;
  // Focus has a planned-length cap; recorded breaks retain their real length.
  const total = totalMs(s);
  if (s.segment === "focus" && total !== null) c.ms = Math.max(0, Math.min(c.ms, total - s.creditedUpTo));
  logChunk(c, s.segment === "focus" ? (s.taskId ?? currentTask(tasks.get())?.id) : undefined);
}

/** Presence is local accounting state, never a synced timer or portable setting. */
function noteAlive(at = Date.now(), force = true) {
  const s = timer.get(), p = clockPresence.get();
  if (!recoveryHydrated || !canWriteClockStore("clockPresence") || s.startedAt === null || departing) return;
  if (!force && p?.segId === s.segId && at >= p.lastAliveAt && at - p.lastAliveAt < 15_000) return;
  if (p?.segId !== s.segId) {
    heartbeat = { wall: at, mono: performance.now() }; interruptedClock = undefined;
  }
  clockPresence.set({ segId: s.segId, lastAliveAt: at, ownerId });
  commands?.postMessage({ type: "clock-alive", segId: s.segId, ownerId });
}
function quietRecovery() {
  armedKey = "";
  cancelAllChimes(); cancelEnd(); cancelSpeech(); ticks.stop();
  void disarmCompanion(); void boundaryAlert.stop();
  transitionStore.dismiss(); window.desktop?.release?.();
}
function settleAway(at: number, now = Date.now()) {
  const s = timer.get();
  if (!canWriteClockStore("timer") || !recoveryHydrated || s.startedAt === null) return false;
  const total = totalMs(s), cutoff = Math.max(s.startedAt, Math.min(at, now));
  const worked = Math.max(s.creditedUpTo, E.elapsed(s, cutoff));
  const expired = total !== null && E.elapsed(s, now) >= total;
  const finished = total !== null && E.elapsed(s, cutoff) >= total;
  // The cursor may already prove more work if the clock moved backwards.
  const paused = { ...s, startedAt: null, elapsedBefore: worked };
  credit(paused, cutoff, finished);
  const awayMs = Math.max(0, now - Math.max(at, s.startedAt));
  if (awayMs > 0) logChunk({ kind: "break", segment: s.segment === "focus" ? "short" : s.segment,
    start: Math.max(at, s.startedAt), ms: awayMs, completed: false, away: true, segId: s.segId });
  const context = s.context ?? captureContext();
  const focusMs = context.spentMs + (s.segment === "focus" ? Math.min(worked, total ?? Infinity) : 0);
  let next: E.TimerState;
  if (expired) {
    next = E.advance(paused, { ...T(), autoRun: "off", countdownRepeat: false }, cutoff, finished);
    next.context = { ...context, spentMs: focusMs };
    next.boundary = { id: s.segId, ended: s.segment, at: now, missed: true };
    if (finished) {
      if (s.segment === "focus") {
        if (s.tinyStart) recordTinyFinish(s.segId);
        queueParkingReview("block", s.segId);
      }
      if (E.endsSession(T().mode, s.segment) || E.endsCycle(T().mode, s.segment)) queueParkingReview("session", s.segId);
    }
  } else {
    next = { ...E.markCredited(paused, cutoff, s.segment === "focus" ? total : null), context,
      hardLocked: s.hardLocked || T().hardMode, reentry: E.newSegId() };
  }
  next.recoveryRecord = { focusMs, awayMs };
  interruptedClock = undefined;
  heartbeat = { wall: now, mono: performance.now() };
  clockPresence.set(null);
  departing = false;
  timer.set(next);
  quietRecovery();
  return true;
}
/** Bank a known native suspend or clean departure before its grouped save. */
async function bankDeparture(at: number) {
  const s = timer.get();
  if (!canWriteClockStore("timer") || !recoveryHydrated || s.startedAt === null) return;
  credit(s, at, false);
  departing = true;
  clockPresence.set({ segId: s.segId, lastAliveAt: at, departedAt: at, ownerId });
  timer.set({ ...E.markCredited(s, at, s.segment === "focus" ? totalMs(s) : null), reentry: E.newSegId() });
  quietRecovery();
  await flushReadyStores();
}
function suspensionRecovery() {
  if (typeof window === "undefined" || !canWriteClockStore("timer") || !recoveryHydrated) return false;
  const latch = window.desktop?.consumeSuspensionAt?.();
  if (!latch) return false;
  witnessedOwner = null;
  if (latch.suspended) {
    if (clockPresence.get()?.departedAt !== latch.at) void bankDeparture(latch.at).catch(reportRequestError);
    return true;
  }
  return settleAway(latch.at);
}
/** Every accounting mutation checks absence before it can advance the cutoff. */
function recoverBeforeMutation() {
  if (typeof window === "undefined" || !recoveryHydrated || !canWriteClockStore("timer")) return false;
  if (suspensionRecovery()) return true;
  const s = timer.get(), p = clockPresence.get();
  if (s.startedAt === null) return false;
  if (departing && p?.segId === s.segId) return true;
  missedEnding();
  if (interruptedClock?.segId !== s.segId) return false;
  return settleAway(interruptedClock.at);
}
/** Clean Quit waits for both departure bookkeeping and its durable commit. */
export async function prepareTimerDeparture(at = Date.now()) {
  if (recoverBeforeMutation()) { await flushReadyStores(); return; }
  await bankDeparture(at);
}

// ---------- one leader tab owns the clock, the chime and stats bookkeeping ----------
let leader = typeof window === "undefined" || typeof navigator === "undefined" || !("locks" in navigator);
const clockDependencies = [...CLOCK_OWNED_KEYS, "settings", "tasks", "focusPick", "intent", "parked"];
registerClockOwner(() => leader, clockDependencies);
registerPersistenceOwner([...CLOCK_OWNED_KEYS], () => canWriteClockStore("timer"));
const reportRequestError = (error: Error) => reminderStatus.set(error.message);
registerActivityOwner(() => canWriteClockStore("returnActivity"), at => { void sharedTimerRequest({ kind: "activity", at }).catch(reportRequestError); });
registerReviewOwner(() => canWriteClockStore("parkingReview"), choice => {
  void sharedTimerRequest({ kind: "review-control", expected: recoveryCommand(), reviewId: parkingReview.get().review?.id ?? null, choice }).catch(reportRequestError);
});
let armedKey = "";
let speechTimer: (() => void) | null = null;
let pageAnnouncement: SpeechSynthesisUtterance | null = null;
const ticks = createTickScheduler((style, volume, delay, duration) => playTimerTick(style, volume, delay, duration));
const selectedSound = (segment: E.Segment) => segment === "focus" ? T().focusDoneSound : T().breakOverSound;
function syncTicks() {
  if (!canWriteClockStore("timer")) return;
  let alert = boundaryAlert.get();
  if (alert.silenced && alert.nextSegId !== timer.get().segId) {
    boundaryAlert.resumeTicks();
    alert = boundaryAlert.get();
  }
  ticks.sync(timer.get(), totalMs(), T(), localPreferences.get().muted || alert.sounding || alert.silenced);
}
let wasQuiet = false;
let nativeAttentionSegment: string | null = null;
let snoozedBreak: { segId: string; count: number } | null = null;

function cancelSpeech() {
  try { if (typeof window !== "undefined") window.desktop?.cancelSpeech?.(); } catch { /* Still cancel page speech. */ }
  speechTimer?.();
  speechTimer = null;
  pageAnnouncement = null;
  try { if (typeof window !== "undefined") window.speechSynthesis?.cancel(); } catch { /* Already stopped. */ }
}

const autoRunEnabled = () => T().mode === "countdown" ? T().countdownRepeat : T().autoRun !== "off" && T().mode !== "stopwatch";

function announce(kind: AlertKind, announcement?: DesktopAnnouncement) {
  if (window.desktop?.armAlarm) return; // The native alarm owns chime, speech and their ordering.
  cancelSpeech();
  const line = timerAnnouncement(T().display, announcement).line;
  if (!T().speak || (!line && companionKnownUp()) || typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const delay = (kind === "focus-done" ? T().focusDoneSound : T().breakOverSound) === "none" ? 0 : kind === "focus-done" ? 6500 : 5500;
  speechTimer = boundaryAlert.defer(() => {
    speechTimer = null;
    const line = timerAnnouncement(T().display, announcement).line;
    // This queued boundary belongs to the page, even if its timed line becomes generic.
    if (!T().speak) return;
    const task = currentTask(tasks.get())?.title.trim();
    const reminder = kind === "focus-done" ? "Focus session done. Time for a break." : "Break is over. Time to focus.";
    const utterance = new SpeechSynthesisUtterance(line ?? reminder + (task ? ` Next up: ${task}` : ""));
    if (line) {
      pageAnnouncement = utterance;
      utterance.onend = utterance.onerror = () => { if (pageAnnouncement === utterance) pageAnnouncement = null; };
    }
    window.speechSynthesis.speak(utterance);
  }, delay);
}

/** Arm or disarm the end chime + end watch to match the timer. Idempotent; only the leader tab plays audio. */
function syncAudio() {
  if (!canWriteClockStore("timer") || !recoveryHydrated || departing || settlingSnapshot) return;
  if (suspensionRecovery()) return;
  if (pageAnnouncement && timerAnnouncement(T().display).genericSpeech) cancelSpeech();
  syncTicks();
  const s = timer.get();
  const total = totalMs(s);
  // A Web Lock may be granted after hydration tried to settle. Do not arm an
  // expired saved run as a live boundary when this renderer finally becomes leader.
  if (recoveryHydrated && s.segId === loadedExpiredSeg && s.startedAt !== null && total !== null && E.elapsed(s, Date.now()) >= total) {
    settleOwnedSnapshot();
    return;
  }
  if (quietTimer(T()) || s.boundary?.missed) {
    reminderStatus.set("");
    if (!wasQuiet) {
      wasQuiet = true;
      cancelAllChimes(); cancelEnd(); cancelSpeech();
      void disarmCompanion(); // A stopped boundary may still have a future auto-run alarm.
      void boundaryAlert.stop(); // Includes pending native alarms and in-flight companion requests.
      transitionStore.dismiss();
      window.desktop?.release?.();
    }
    armedKey = "";
    return; // The ordinary ticker settles silent expiry, without arming any reminder channel.
  }
  wasQuiet = false;
  if (s.startedAt === null || total === null) {
    if (armedKey) {
      cancelChime();
      cancelEnd();
      if (window.desktop?.disarmAlarm) window.desktop.disarmAlarm();
      else void disarmCompanion();
      armedKey = "";
    }
    return;
  }
  const { alertVolume, speak } = T();
  const alertSound = selectedSound(s.segment);
  // The page owns timed auto-run speech; Hidden uses the companion's generic reminder.
  const companionSpeak = speak && (!autoRunEnabled() || T().display === "hidden");
  reminderStatus.set("");
  const key = `${s.segId}:${s.startedAt}:${total}:${T().display}:${alertSound}:${alertVolume}:${speak}:${T().autoRun}:${T().countdownRepeat}:${T().notify}:${T().bringToFront}:${T().longEvery}:${JSON.stringify(T().lengths)}`;
  if (key === armedKey) return;
  armedKey = key;
  const leftMs = E.remaining(s, total, Date.now());
  const kind: AlertKind = s.segment === "focus" ? "focus-done" : "break-over";
  const seg = s.segId;
  if (window.desktop?.armAlarm) {
    cancelChime();
    cancelEnd(); // Main owns the deadline; a silent Web Audio clock would waste an audio process.
    const next = E.advance(s, T(), s.startedAt + total - s.elapsedBefore, true);
    const cycleComplete = T().autoRun === "cycle" && E.endsCycle(T().mode, s.segment);
    const speech = timerAnnouncement(T().display, cycleComplete ? { phase: "cycle" } :
      next.startedAt !== null ? { phase: next.segment === "focus" ? "focus" : "break", minutes: liveTotal(next)! / 60_000 } : undefined);
    void window.desktop.armAlarm({ at: s.startedAt + total - s.elapsedBefore, kind, alertSound,
      volume: alertSound === "none" ? 0 : alertVolume, speak, notify: T().notify, attention: T().bringToFront,
      genericSpeech: speech.genericSpeech, ...(speech.native ? { announcement: speech.native } : {}) }).then(ok => {
        if (armedKey !== key) return;
        if (!ok) throw new Error("Native reminder unavailable");
      }).catch(() => {
        if (armedKey !== key) return;
        armedKey = "";
        reminderStatus.set("Native reminder unavailable. The timer will still finish here.");
      });
    return;
  }
  scheduleEnd(leftMs / 1000, () => timerActions.complete(seg, missedEnding()));
  // the macOS companion rings even if Chrome is closed; when it's up, the page stays quiet to avoid a double alert
  void armCompanionWithSpeech(Date.now() + leftMs, kind, alertSound === "none" ? 0 : alertVolume, companionSpeak, alertSound).then((ok) => {
    if (armedKey !== key) return;
    if (ok) cancelChime();
    else scheduleChime(alertSound, alertVolume, E.remaining(timer.get(), totalMs(), Date.now()) / 1000, kind);
  });
  if (!companionKnownUp()) scheduleChime(alertSound, alertVolume, leftMs / 1000, kind);
}

const currentTaskId = () => currentTask(tasks.get())?.id;

/** Switching tasks mid-session: bank the time so far to the old task, then attribute the rest to the new one. */
function onTaskChange(explicit = false) {
  const recovering = recoverBeforeMutation();
  const s = timer.get();
  if (recovering && s.startedAt !== null) return;
  if (!canWriteClockStore("timer") || s.segment !== "focus" || !s.context) return;
  const id = currentTaskId();
  if (id === s.taskId || (!explicit && s.taskId && !tasks.get().some(task => task.id === s.taskId))) return;
  const now = Date.now();
  if (s.startedAt !== null) credit(s, now, false);
  timer.set({ ...E.markCredited(s, now, totalMs(s)), taskId: id,
    context: { ...s.context, taskId: id, taskTitle: currentTask(tasks.get())?.title.replace(/[\r\n]+/g, " ").slice(0, 500) ?? "" } });
}

const localTimerActions = {
  beginEndHold() {
    const s = timer.get();
    if (!hardModeLocked(s)) return;
    if (endHold?.segId === s.segId) return;
    endHold = { segId: s.segId, at: performance.now() };
  },
  cancelEndHold() { endHold = null; },
  endHardSession(reason: string): TimerCommandResult {
    let s = timer.get();
    if (!hardModeLocked(s) || endHold?.segId !== s.segId) return { ok: false, reason: "stale-segment", message: "This block has changed." };
    if (performance.now() - endHold.at < 10_000) return { ok: false, reason: "hold-required", message: "Hold for 10 seconds first." };
    const clean = cleanThought(reason);
    if (clean.length < 3 || clean.length > 500 || /[\r\n]/.test(reason)) return { ok: false, reason: "reason-required", message: "Enter a single-line reason of at least 3 characters." };
    recoverBeforeMutation();
    const current = timer.get();
    if (current.segId !== s.segId || !hardModeLocked(current)) return { ok: false, reason: "stale-segment", message: "This block has changed." };
    s = current;
    const now = Date.now();
    endHold = null;
    credit(s, now, false);
    const taskId = s.segment === "focus" ? s.taskId ?? currentTaskId() : undefined;
    logHardEnd(s.segId, s.segment, now, clean, taskId);
    queueParkingReview("session", s.segId);
    recordHardInterruption({ segId: s.segId, taskId, at: now, segment: s.segment }, clean);
    const next = E.advance(s, { ...T(), autoRun: "off" }, now, false, "focus");
    timer.set(next);
    captureStoppedAttempt(s, next, now);
    void timerActions.stopSound();
    transitionStore.dismiss();
    window.desktop?.release?.();
    return { ok: true };
  },
  /** Silence this boundary, retaining the next segment and its future alarm. */
  stopSound() {
    const current = timer.get();
    const total = totalMs(current);
    if (current.startedAt !== null && total !== null && E.elapsed(current, Date.now()) >= total) timerActions.complete(current.segId);
    if (boundaryAlert.get().silenced) return boundaryAlert.stop();
    cancelSpeech();
    return boundaryAlert.stop().then(() => { armedKey = ""; syncAudio(); });
  },
  stopAndPause() {
    const stopped = timerActions.stopSound();
    if (hardModeLocked()) return hardRefusal();
    const notice = boundaryAlert.get();
    if (timer.get().segId === notice.nextSegId && timer.get().startedAt !== null) timerActions.pause();
    return stopped;
  },
  /** End the current segment and return to idle focus without starting it. */
  stop() {
    if (hardModeLocked()) return hardRefusal();
    void timerActions.stopSound();
    if (stopAttempt.get()?.nextSegId === timer.get().segId) return;
    const now = Date.now();
    const before = timer.get();
    credit(before, now, false);
    purposefulAction();
    queueParkingReview("session", timer.get().boundary?.id ?? timer.get().segId);
    const next = E.advance(timer.get(), { ...T(), autoRun: "off" }, now, false, "focus");
    timer.set(next);
    captureStoppedAttempt(before, next, now);
    transitionStore.dismiss();
    window.desktop?.release?.();
  },
  start() {
    const cur = timer.get();
    if (cur.boundary) return requestRecovery(recoveryCommand(), "continue");
    if (cur.startedAt !== null) return;
    transitionStore.dismiss();
    // freeze the length when the segment first starts; a resume after pause picks up edits made while paused
    purposefulAction();
    let context = cur.context && (cur.elapsedBefore > 0 || (cur.context.actionRevision === intent.get().rev && cur.context.actionId === `intent:${intent.get().updatedAt}`)) ? cur.context : captureContext();
    if (cur.segment === "focus" && cur.elapsedBefore === 0) {
      const selected = captureContext();
      context = { ...context, taskId: selected.taskId, taskTitle: selected.taskTitle };
    }
    const s = E.start({ ...cur, reentry: undefined, context, frozen: true,
      frozenTotal: cur.frozen ? (cur.frozenTotal ?? null) : liveTotal(cur),
      taskId: cur.elapsedBefore > 0 ? cur.taskId : context.taskId, hardLocked: cur.hardLocked || T().hardMode }, Date.now());
    departing = false;
    heartbeat = { wall: Date.now(), mono: performance.now() }; interruptedClock = undefined;
    boundaryAlert.resumeTicks();
    timer.set(s);
    noteAlive();
    if (shouldStartChime(cur, T(), localPreferences.get().muted)) playStartChime(T().startChimeSound, T().alertVolume);
    if (!window.desktop?.armAlarm && T().notify && "Notification" in window && Notification.permission === "default") void Notification.requestPermission();
  },
  pause() {
    if (hardModeLocked()) return hardRefusal();
    const now = Date.now();
    const before = timer.get();
    if (before.startedAt === null || before.boundary) return;
    const total = totalMs(before);
    if (total !== null && E.elapsed(before, now) >= total) return timerActions.complete(before.segId, missedEnding());
    purposefulAction();
    const s = { ...E.pause(before, now), reentry: E.newSegId() };
    credit(s, now, false);
    timer.set(E.markCredited(s, now, totalMs(s)));
    if (before.startedAt !== null && before.segment === "focus") {
      void requestInterruption({ segId: before.segId, taskId: before.taskId ?? currentTaskId(), at: now });
    }
  },
  toggle() {
    return timer.get().startedAt === null ? timerActions.start() : timerActions.pause();
  },
  /** Reset just the current segment; time already worked still counts. */
  reset() {
    if (hardModeLocked()) return hardRefusal();
    const now = Date.now();
    credit(timer.get(), now, false);
    timer.set({ ...E.resetSegment(timer.get(), now), tinyStart: undefined });
  },
  /** Skip to the next segment. A stopwatch "skip" counts as finishing the session. */
  skip() {
    const s = timer.get();
    if (hardModeLocked(s) && totalMs(s) !== null) return hardRefusal();
    const now = Date.now();
    purposefulAction();
    const finished = totalMs(s) === null;
    credit(s, now, finished);
    if (finished) queueParkingReview("session", s.segId);
    timer.set(E.advance(s, { ...T(), autoRun: "off" }, now, finished));
  },
  goTo(segment: E.Segment) {
    if (hardModeLocked()) return hardRefusal();
    if (timer.get().segment === segment) return; // clicking the active tab must not wipe it
    const now = Date.now();
    credit(timer.get(), now, false);
    timer.set(E.advance(timer.get(), { ...T(), autoRun: "off" }, now, false, segment));
  },
  /** End of segment. Called by the audio-clock watch or the ticker; `segId` makes repeat calls harmless. */
  complete(segId?: string, missed = false) {
    if (!canWriteClockStore("timer") || suspensionRecovery() || departing) return;
    const s = timer.get();
    if (missed && interruptedClock?.segId === s.segId) {
      const at = interruptedClock.at; interruptedClock = undefined; settleAway(at); return;
    }
    if (s.boundary || (segId && segId !== s.segId)) return;
    const total = totalMs(s);
    if (total === null || (s.startedAt === null && s.elapsedBefore < total)) return;
    const now = Date.now();
    if (total !== null && E.elapsed(s, now) < total - (window.desktop?.armAlarm ? 0 : 250)) return; // early wake-up
    credit(s, now, true);
    if (s.segment === "focus") {
      if (s.tinyStart) recordTinyFinish(s.segId);
      queueParkingReview("block", s.segId);
    }
    if (E.endsSession(T().mode, s.segment) || E.endsCycle(T().mode, s.segment)) queueParkingReview("session", s.segId);
    releaseChime(); // the end chime is sounding right now: let it finish
    armedKey = "";
    const next = E.advance(s, missed ? { ...T(), autoRun: "off", countdownRepeat: false } : T(), now, true);
    const context = s.context ?? captureContext();
    next.context = { ...context, spentMs: context.spentMs + (s.segment === "focus" ? total : 0) };
    // Stats and this boundary are batched in the same IndexedDB transaction.
    // A crash retains either the old run or the settled run, never a credit alone.
    if (missed) {
      next.boundary = { id: s.segId, ended: s.segment, at: now, missed };
      timer.set(next);
      cancelAllChimes(); cancelEnd(); cancelSpeech();
      void disarmCompanion(); void boundaryAlert.stop();
      transitionStore.dismiss(); window.desktop?.release?.();
      return;
    }
    if (s.segment === "focus" && next.startedAt === null && !T().takeover) {
      next.boundary = { id: s.segId, ended: s.segment, at: now, missed: false };
    }
    if (s.segment !== "focus" && next.startedAt === null && !T().takeover) next.reentry = E.newSegId();
    if (next.segment === "focus" && next.startedAt !== null) {
      const selected = captureContext();
      next.context = { ...next.context, taskId: selected.taskId, taskTitle: selected.taskTitle };
    }
    const cycleComplete = T().autoRun === "cycle" && E.endsCycle(T().mode, s.segment);
    const kind: AlertKind = s.segment === "focus" ? "focus-done" : "break-over";
    const audible = (selectedSound(s.segment) !== "none" && T().alertVolume > 0) || T().speak;
    if (audible) boundaryAlert.begin(s.segId, next.segId, T().takeover && selectedSound(s.segment) !== "none" && T().alertVolume > 0 ? () => {
      repeatBoundarySound(selectedSound(s.segment), T().alertVolume, kind);
    } : undefined);
    else boundaryAlert.endReminders();
    timer.set(next.startedAt !== null ? { ...next, frozen: true, frozenTotal: liveTotal(next), taskId: currentTaskId() } : next);
    if (s.segment === "focus" && focusPick.get() && !currentTask(tasks.get())) focusPick.set(null);
    notify(s.segment);
    if (T().takeover) transitionStore.show({
      segId: s.segId,
      ended: s.segment,
      at: now,
      nextSegId: next.segId,
      breakSegment: s.segment === "focus" ? (next.segment === "long" ? "long" : "short") : s.segment,
      breakRound: s.round,
      snoozes: snoozedBreak?.segId === s.segId ? snoozedBreak.count : 0,
      autoStarted: next.startedAt !== null,
      cycleComplete,
    });
    if (T().bringToFront && window.desktop?.attention) {
      alertTypingGuard.begin();
      nativeAttentionSegment = next.segId;
      window.desktop.attention(kind, next.segId);
    }
    announce(kind, cycleComplete ? { phase: "cycle" } : next.startedAt !== null ?
      { phase: next.segment === "focus" ? "focus" : "break", minutes: totalMs()! / 60_000 } : undefined);
  },
  /** Only the notice's buttons can answer it; a stale notice cannot change a newer segment. */
  answerTransition(action: "start" | "skip" | "snooze" | "dismiss" | "pause") {
    void timerActions.stopSound();
    if (hardModeLocked() && ["pause", "skip", "snooze"].includes(action)) return hardRefusal();
    const notice = transitionStore.get();
    if (!notice || (action === "snooze" && (notice.ended === "focus" || notice.snoozes >= 2))) return;
    transitionStore.dismiss();
    boundaryAlert.resumeTicks();
    window.desktop?.release?.();
    if (timer.get().segId !== notice.nextSegId) return;
    if (action === "dismiss" || (action === "start" && notice.autoStarted)) return;
    if (action === "pause") return timerActions.pause();
    if (action === "snooze") {
      const now = Date.now();
      credit(timer.get(), now, false);
      const next = E.advance(timer.get(), { ...T(), autoRun: "off" }, now, false, notice.breakSegment);
      snoozedBreak = { segId: next.segId, count: notice.snoozes + 1 };
      timer.set({ ...next, round: notice.breakRound, startedAt: now, frozen: true, frozenTotal: 5 * 60_000 });
    } else {
      if (action === "skip") timerActions.goTo("focus");
      else if (T().mode !== "countdown" && T().mode !== "stopwatch" && notice.ended === "focus" && timer.get().segment === "focus") timerActions.goTo(notice.breakSegment);
      timerActions.start();
    }
  },
};

/** Every public timer control uses the owner channel before doing any side effects. */
export const timerActions: typeof localTimerActions = new Proxy(localTimerActions, {
  get(target, key: keyof typeof localTimerActions) {
    const action = target[key];
    return (...args: unknown[]) => {
      if (canWriteClockStore("timer")) {
        if (!["complete", "beginEndHold", "cancelEndHold", "endHardSession"].includes(key) && recoverBeforeMutation()) return;
        return (action as (...values: unknown[]) => unknown)(...args);
      }
      if (key === "complete") return; // Only the owner's own clocks may complete a block.
      void sharedTimerRequest({ kind: "control", expected: recoveryCommand(), action: key, args,
        noticeId: transitionStore.get()?.segId ?? null }).catch(reportRequestError);
      return { ok: false, reason: "stale-segment", message: "The active timer is handling this change." };
    };
  },
});

function notify(ended: E.Segment) {
  if (window.desktop?.armAlarm) return;
  if (companionKnownUp()) return; // the companion already posted a native notification
  if (!T().notify || !("Notification" in window) || Notification.permission !== "granted") return;
  const anime = T().mode === "animedoro";
  const text = ALERT_TEXT[ended === "focus" ? "focus-done" : "break-over"];
  const body = ended === "focus" && anime ? "Focus done. Enjoy an episode." : text.body;
  try {
    new Notification(text.title, { body, silent: true, tag: "custom-pomodoro", requireInteraction: true });
  } catch {
    /* some browsers only allow notifications from a service worker */
  }
}

// ---------- ticking ----------
const tickSubs = new Set<() => void>();
let ticker: ReturnType<typeof setInterval> | null = null;
let tickNow = Date.now();
let heartbeat = { wall: Date.now(), mono: performance.now() };
let interruptedClock: { segId: string; at: number } | undefined;
// Throttled callbacks can be late while both clocks advance normally. Only a
// wall/monotonic mismatch indicates a clock jump; the native latch proves sleep
// even on systems where both clocks advance together.
function missedEnding(woke = false) {
  const current = { wall: Date.now(), mono: performance.now() };
  const suspended = window.desktop?.consumeSuspension?.() ?? false;
  const jumped = Math.abs((current.wall - heartbeat.wall) - (current.mono - heartbeat.mono)) > 5000;
  const missed = woke || suspended || jumped;
  const p = clockPresence.get();
  if ((jumped || woke) && p && !window.desktop?.consumeSuspension) interruptedClock = { segId: p.segId, at: p.lastAliveAt };
  heartbeat = current;
  return missed;
}
let recoveryHydrated = false;
let loadedExpiredSeg: string | undefined;
let savedCutoff: { segId: string; at: number } | undefined;
let promotionReady: Promise<void> | null = null;
// Only the clock owner renames legacy IDs, with their existing credit in the same save group.
function migrateInitialSegment() {
  const s = timer.get();
  if (!canWriteClockStore("timer") || s.segId !== "initial") return;
  const segId = E.newSegId(), migrated = { ...s, segId };
  // Migration marks the store edited, so retain the normal disk-reload recovery offer.
  if (storeSource("timer") === "disk" && (s.startedAt !== null || s.elapsedBefore > 0) && !s.boundary && !s.reentry) {
    migrated.context = s.context ?? captureContext();
    migrated.reentry = E.newSegId();
  }
  stats.set(data => ({ ...data, chunks: data.chunks.map(chunk => chunk.segId === "initial" ? { ...chunk, segId } : chunk) }));
  timer.set(migrated);
}
export const timerHydrationReady = Promise.all([
  timer.ready, settings.ready, tasks.ready, focusPick.ready, storeReady("stats"), intent.ready,
  returnActivity.ready, tinyStarts.ready, parkingReview.ready, clockPresence.ready, stopAttempt.ready, stopOutcomes.ready, storeReady("parked"), calmFoundationReady,
]).then(() => {
  const saved = timer.get(), p = clockPresence.get();
  if (saved.startedAt !== null && ["disk", "received"].includes(storeSource("timer") ?? "")) {
    savedCutoff = { segId: saved.segId, at: p?.segId === saved.segId ? p.departedAt ?? p.lastAliveAt : saved.startedAt + Math.max(0, saved.creditedUpTo - saved.elapsedBefore) };
  }
  migrateInitialSegment();
  const s = timer.get(), total = totalMs(s);
  if (savedCutoff) savedCutoff.segId = s.segId;
  // Remember only a run that was already over when loaded. A saved run with
  // time left can later finish live even if nothing has written the store yet.
  if (s.startedAt !== null && total !== null && E.elapsed(s, Date.now()) >= total) loadedExpiredSeg = s.segId;
  recoveryHydrated = true;
});

function settleOwnedSnapshot() {
  if (!canWriteClockStore("timer") || !recoveryHydrated) return;
  const before = timer.get(), presence = clockPresence.get();
  const saved = ["disk", "received"].includes(storeSource("timer") ?? "") || savedCutoff?.segId === before.segId;
  const cutoff = presence?.segId === before.segId ? presence.departedAt ?? presence.lastAliveAt :
    savedCutoff?.segId === before.segId ? savedCutoff.at : (before.startedAt ?? Date.now()) + Math.max(0, before.creditedUpTo - before.elapsedBefore);
  // Renaming a legacy ID must not publish it as a new live run before recovery.
  settlingSnapshot = true;
  try { migrateInitialSegment(); } finally { settlingSnapshot = false; }
  const s = timer.get(), total = totalMs(s), p = clockPresence.get();
  if (s.startedAt !== null) {
    const liveHandoff = p?.segId === s.segId && witnessedOwner?.segId === s.segId && witnessedOwner.ownerId === p.ownerId;
    if (liveHandoff && (total === null || E.elapsed(s, Date.now()) < total)) {
      departing = false; savedCutoff = undefined;
      timer.set({ ...s, reentry: undefined }); noteAlive();
    } else if (saved || p?.departedAt !== undefined) {
      savedCutoff = undefined;
      settleAway(cutoff);
    } else if (total !== null && E.elapsed(s, Date.now()) >= total) timerActions.complete(s.segId, true);
  } else if (storeSource("timer") === "disk" && s.elapsedBefore > 0 && !s.boundary && !s.reentry) {
    timer.set({ ...s, context: s.context ?? captureContext(), reentry: E.newSegId() });
  }
  checkReturnActivity();
  latchHardMode();
  syncAudio();
}
/** Promotion stays closed until every dependency and the latest durable accounting snapshot is loaded. */
export async function acquireTimerOwnership() {
  leader = false;
  await timerHydrationReady;
  await refreshClockStores();
  leader = true;
  settleOwnedSnapshot();
  // BroadcastChannel does not echo to its sender. A command sent before the
  // lock arrived must now run here, through the same guards as follower input.
  for (const [id, waiting] of commandWaiters) {
    clearTimeout(waiting.timeout);
    commandWaiters.delete(id);
    try {
      const result = await executeSharedTimerRequest(waiting.request);
      await flushReadyStores();
      waiting.resolve(result);
    } catch {
      waiting.reject(new Error("Could not save the timer change. Try again."));
    }
  }
}
/** Useful for renderer teardown: a handoff cannot overtake the owner's queued accounting commit. */
export async function releaseTimerOwnership() {
  await flushReadyStores();
  leader = false;
  armedKey = "";
  ticks.stop();
  cancelAllChimes(); cancelEnd(); cancelSpeech();
  void disarmCompanion(); void boundaryAlert.stop();
}


/** Native wake and web lifecycle paths share the same settlement and gap checks. */
export function checkRecoveryLifecycle(woke = false) {
  if (!recoveryHydrated) return;
  checkReturnActivity(woke);
  if (suspensionRecovery()) return;
  const p = clockPresence.get();
  if (departing && p && settleAway(p.departedAt ?? p.lastAliveAt)) return;
  const missed = missedEnding(woke);
  if (missed) {
    witnessedOwner = null;
    if (p && !window.desktop?.consumeSuspension && settleAway(p.lastAliveAt)) return;
  }
  const s = timer.get(), total = totalMs(s);
  if (canWriteClockStore("timer") && s.startedAt !== null && total !== null && E.elapsed(s, Date.now()) >= total) timerActions.complete(s.segId, missed || s.segId === loadedExpiredSeg);
}


export function startTicker({ follower = false }: { follower?: boolean } = {}) {
  if (ticker) return;
  heartbeat = { wall: Date.now(), mono: performance.now() };
  if (follower) {
    leader = false; // Native mini windows never request the leader lock or run side effects.
    ticker = setInterval(() => { tickNow = Date.now(); tickSubs.forEach((fn) => fn()); }, 250);
    return;
  }
  void companionAvailable();
  // claim leadership; other tabs become followers that render state but don't run the clock
  if (!leader) {
    void navigator.locks.request("custom-pomodoro-leader", () => {
      promotionReady = acquireTimerOwnership();
      return promotionReady.then(() => new Promise<void>(() => {})); // hold for the life of the tab
    }).catch(reportRequestError);
  }
  timer.subscribe(() => {
    if (recoveryHydrated && canWriteClockStore("timer") && !departing && !settlingSnapshot && timer.get().startedAt !== null && clockPresence.get()?.segId !== timer.get().segId) noteAlive();
    syncAudio();
  });
  settings.subscribe(syncAudio);
  localPreferences.subscribe(syncTicks);
  boundaryAlert.subscribe(syncTicks);
  tasks.subscribe(() => onTaskChange());
  focusPick.subscribe(() => onTaskChange(true));
  ticker = setInterval(() => {
    const now = Date.now();
    if (suspensionRecovery() || departing) return;
    const missed = missedEnding();
    if (missed) {
      witnessedOwner = null;
      const p = clockPresence.get();
      if (p && !window.desktop?.consumeSuspension && settleAway(p.lastAliveAt)) return;
    }
    tickNow = now;
    const s = timer.get();
    if (s.startedAt === null || !recoveryHydrated) return;
    const total = totalMs(s);
    if (canWriteClockStore("timer") && total !== null && E.elapsed(s, tickNow) >= total) timerActions.complete(s.segId, missed || s.segId === loadedExpiredSeg);
    noteAlive(now, false);
    tickSubs.forEach((fn) => fn());
  }, 250);

  setInterval(() => { if (recoveryHydrated) checkReturnActivity(); }, 30_000);
  window.addEventListener("focus", () => checkRecoveryLifecycle());
  window.addEventListener("pageshow", () => checkRecoveryLifecycle());
  window.desktop?.onLifecycle?.(event => {
    if (event === "suspend") suspensionRecovery();
    else checkRecoveryLifecycle(event === "resume");
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkRecoveryLifecycle(); });

  window.addEventListener("pagehide", () => { void prepareTimerDeparture().catch(reportRequestError); });
  commands?.postMessage({ type: "clock-hello" });

  // after a reload while running: finish if time ran out, otherwise re-arm
  void timerHydrationReady.then(settleOwnedSnapshot);

}

/** Shared 250 ms clock for every timer view (dashboard, PiP, tab title). */
function useTick(active: boolean) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!active) return;
    const fn = () => force((n) => n + 1);
    tickSubs.add(fn);
    return () => void tickSubs.delete(fn);
  }, [active]);
  return active ? tickNow : Date.now();
}

const STOPWATCH_LAP = 60 * 60_000; // visual faces loop once an hour in stopwatch mode

export function useTimerView() {
  const s = useStore(timer);
  const t = useStore(settings, (x) => x.timer);
  // only re-render for the current task's estimate, not every keystroke in the task list
  useStore(tasks, (all) => (t.taskEta ? `${currentTask(all)?.id}:${taskEta()}` : ""));
  useStore(focusPick);
  const now = Math.max(useTick(s.startedAt !== null), s.startedAt ?? 0);
  const total = totalMs(s);
  const el = E.elapsed(s, now);
  const left = E.remaining(s, total, now);
  return {
    state: s,
    running: s.startedAt !== null,
    total,
    elapsed: el,
    remaining: left,
    progress: total ? Math.min(1, el / total) : (el % STOPWATCH_LAP) / STOPWATCH_LAP,
    ...timerDisplay(t.display, el, left, total),
    mode: t.mode,
    longEvery: t.longEvery,
    hardLocked: hardModeLocked(s),
    hardModePendingOff: hardModeLocked(s) && !t.hardMode,
  };
}

/** Native menu/tray/floating requests use the same guards as every renderer control. */
export async function runTimerCommand(command: DesktopTimerCommand, origin?: DesktopTimerOrigin): Promise<TimerCommandResult> {
  if (origin === "accelerator" && alertTypingGuard.accelerator(command === "stopSound")) {
    return { ok: false, reason: "typing-guard", message: "Wait until typing has stopped." };
  }
  if (typeof command === "object" && command.action === "answerAttention") return answerNativeAttention(command);
  if (!canWriteClockStore("timer")) {
    if (hardModeLocked() && !(command === "toggle" && timer.get().startedAt === null) && typeof command === "string" && ["pause", "toggle", "reset", "skip", "stop", "stopAndPause"].includes(command) && !(command === "skip" && totalMs() === null)) return hardRefusal();
    const action = typeof command === "object" ? "endHardSession" : command;
    const result = await sharedTimerRequest({ kind: "control", expected: recoveryCommand(), action,
      args: typeof command === "object" ? [command.reason] : [], noticeId: transitionStore.get()?.segId ?? null });
    return result.ok ? { ok: true } : result.refusal ?? { ok: false, reason: "stale-segment", message: "The active block changed. Try again." };
  }
  if (typeof command === "object") return timerActions.endHardSession(command.reason);
  if (command === "skip") {
    const s = timer.get();
    if (s.segment === "focus" && s.startedAt === null && s.elapsedBefore === 0) return { ok: true };
  }
  const result = await timerActions[command]();
  return result && typeof result === "object" && "ok" in result && result.ok === false ? result as TimerRefusal : { ok: true };
}

/** Native panels can answer only their own settled boundary, never a newer block. */
export async function answerNativeAttention(command: DesktopAttentionCommand): Promise<TimerCommandResult> {
  const s = timer.get(), total = totalMs(s);
  const stale = (): TimerCommandResult => ({ ok: false, reason: "stale-segment", message: "The active block changed. Open Kitestring." });
  if (!canWriteClockStore("timer") || command.segId !== s.segId || nativeAttentionSegment !== s.segId ||
      s.startedAt !== null && total !== null && E.elapsed(s, Date.now()) >= total) return stale();
  let result;
  if (command.choice === "stop") result = timerActions.stop();
  else if (command.choice === "dismiss") {
    result = timerActions.stopSound();
    if (transitionStore.get()?.nextSegId === s.segId) timerActions.answerTransition("dismiss");
  } else if (transitionStore.get()?.nextSegId === s.segId) result = timerActions.answerTransition("start");
  else if (s.boundary) {
    if (!answerRecovery(recoveryCommand(), s.boundary.ended === "focus" ? "break" : "continue")) return stale();
  } else if (s.reentry) {
    if (!answerRecovery(recoveryCommand(), "resume")) return stale();
  } else if (s.startedAt !== null) result = timerActions.stopSound();
  else return stale();
  if (result && typeof result === "object" && "ok" in result && result.ok === false) return result as TimerRefusal;
  nativeAttentionSegment = null;
  await result;
  return { ok: true };
}


export function recoveryOffer() {
  // Do not flash a lower-priority offer while another saved value is still loading.
  if (["timer", "stats", "settings", "tasks", "intent", "returnActivity", "parkingReview", "parked"].some(key => storeSource(key) === "loading")) return null;
  const s = timer.get(), total = totalMs(s);
  if (!s.boundary && s.startedAt !== null && total !== null && E.elapsed(s, Date.now()) >= total) return null;
  return selectRecovery({ boundary: !!s.boundary, reentry: !!s.reentry, gap: !!returnActivity.get().pendingGap,
    review: !!parkingReview.get().review && !parkingReview.get().deferred, runningFocus: s.segment === "focus" && s.startedAt !== null });
}
export interface RecoveryCommand {
  expectedSegId: string;
  offerId: string | null;
  actionId: string;
  actionRevision: number;
  intentRevision: number;
  intentUpdatedAt: number;
}
export function recoveryCommand(): RecoveryCommand {
  const s = timer.get(), pin = intent.get(), offer = recoveryOffer();
  return { expectedSegId: s.segId, offerId: offer === "missed-end" ? s.boundary!.id : offer === "re-entry" ? s.reentry! : offer === "gap-return" ? returnActivity.get().pendingGap : offer === "parking-review" ? parkingReview.get().review!.id : null,
    actionId: s.context?.actionId ?? "", actionRevision: s.context?.actionRevision ?? 0,
    intentRevision: pin.rev, intentUpdatedAt: pin.updatedAt };
}
export type RecoveryAnswer = "continue" | "break" | "stop" | "resume" | "dismiss" | "keep" | "move" | "drop" | "short-block";
export function answerRecovery(expected: RecoveryCommand, action: RecoveryAnswer, override?: number): boolean {
  if (!canWriteClockStore("timer")) return false;
  const actual = recoveryCommand();
  if (!expected.offerId || Object.keys(actual).some(key => actual[key as keyof RecoveryCommand] !== expected[key as keyof RecoveryCommand])) return false;
  const offer = recoveryOffer(), s = timer.get(), now = Date.now();
  if (offer === "missed-end") {
    if (!["continue", "break", "stop", "dismiss"].includes(action)) return false;
    if (action === "dismiss") { timer.set({ ...s, boundary: undefined }); return true; }
    const context = s.context;
    const segment = action === "break" ? (s.segment === "long" ? "long" : "short") : "focus";
    const task = tasks.get().find(t => t.id === context?.taskId);
    const eta = T().taskEta && task ? etaOf(tasks.get(), task) || null : null;
    const total = action === "continue" ? continueDuration(override, eta, E.durationMs(T(), "focus")) : E.durationMs(T(), segment);
    purposefulAction();
    if (action === "stop") queueParkingReview("session", s.boundary!.id);
    const next = { ...E.advance(s, { ...T(), autoRun: "off" }, now, false, segment), context,
      startedAt: action === "stop" ? null : now, frozen: action !== "stop", frozenTotal: total,
      hardLocked: action !== "stop" && T().hardMode, taskId: context?.taskId,
      reentry: undefined };
    timer.set(next);
    if (action === "stop") captureStoppedAttempt(s, next, now);
    void timerActions.stopSound();
    return true;
  }
  if (offer === "re-entry") {
    if (action !== "resume" && action !== "dismiss") return false;
    if (action === "dismiss") { timer.set({ ...s, reentry: undefined }); transitionStore.dismiss(); void timerActions.stopSound(); window.desktop?.release?.(); return true; }
    purposefulAction();
    transitionStore.dismiss(); void timerActions.stopSound(); window.desktop?.release?.();
    if (s.startedAt === null) timerActions.start();
    else timer.set({ ...s, reentry: undefined });
    return true;
  }
  if (offer !== "gap-return" || !["keep", "move", "drop", "dismiss", "short-block"].includes(action)) return false;
  if (action === "short-block" && hardModeLocked(s)) return false;
  if (!acknowledgeGap(expected.offerId)) return false;
  if (action === "keep") purposefulAction();
  if (action === "move" || action === "drop") updateIntent({ action: "", why: "", cue: undefined, reward: undefined });
  if (action === "short-block") {
    purposefulAction();
    credit(s, now, false);
    const next = E.advance(s, { ...T(), autoRun: "off" }, now, false, "focus");
    timer.set({ ...next, context: captureContext(next.context), startedAt: now, frozen: true, frozenTotal: 5 * 60_000, hardLocked: T().hardMode, taskId: currentTaskId() });
  }
  return true;
}

/** A one-off tiny block. Repeated or stale Start clicks cannot replace a run. */
export function startTinyBlock(expectedSegId: string, minutes: number): boolean {
  const s = timer.get();
  if (!canWriteClockStore("timer") || hardModeLocked(s) || s.segId !== expectedSegId || s.startedAt !== null || s.segment !== "focus" || s.elapsedBefore > 0 || s.boundary || s.reentry ||
    !Number.isFinite(minutes) || minutes < 1 || minutes > 1440) return false;
  timer.set({ ...s, tinyStart: true, frozen: true, frozenTotal: minutes * 60_000, context: captureContext() });
  timerActions.start();
  if (shouldStartChime(s, T(), localPreferences.get().muted)) playStartChime(T().startChimeSound, T().alertVolume);
  return true;
}

export type ParkingRecoveryAnswer = "keep" | "task" | "drop" | "defer" | "close";

/** Review buttons share the recovery identity guards, including a newly started session. */
export function answerParkingRecovery(expected: RecoveryCommand, itemId: string, choice: ParkingRecoveryAnswer) {
  const actual = recoveryCommand();
  if (!canWriteClockStore("timer") || recoveryOffer() !== "parking-review" || !expected.offerId ||
    Object.keys(actual).some(key => actual[key as keyof RecoveryCommand] !== expected[key as keyof RecoveryCommand])) return { ok: false };
  if (choice === "defer" || choice === "close") {
    if (choice === "defer") deferParkingReview(expected.offerId);
    else closeParkingReview(expected.offerId);
    return { ok: true, undo: undefined };
  }
  return answerParkingReview(expected.offerId, itemId, choice);
}

// Follower renderers send guarded actions to the clock owner. Store writes and
// replies use the persistence channel so the resulting state arrives before a reply.
type SharedTimerRequest =
  | { kind: "owned"; expected: RecoveryCommand; action: string; payload: unknown }
  | { kind: "control"; expected: RecoveryCommand; action: keyof typeof localTimerActions; args: unknown[]; noticeId: string | null }
  | { kind: "longer"; expected: RecoveryCommand; choice: "accepted" | "dismissed"; finished: string[] }
  | { kind: "activity"; at: number }
  | { kind: "review-control"; expected: RecoveryCommand; reviewId: string | null; choice: "open" | ReviewBoundary }
  | { kind: "recovery"; expected: RecoveryCommand; action: RecoveryAnswer; override?: number }
  | { kind: "tiny"; expected: RecoveryCommand; minutes: number }
  | { kind: "parking"; expected: RecoveryCommand; itemId: string; choice: ParkingRecoveryAnswer }
  | { kind: "undo"; token: string };
interface SharedTimerResult { ok: boolean; undoToken?: string; refusal?: TimerRefusal; keptTimer?: boolean }
const commands = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("custom-pomodoro");
const commandWaiters = new Map<string, { request: SharedTimerRequest; resolve: (result: SharedTimerResult) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>();
const reviewUndos = new Map<string, () => void>();
async function executeSharedTimerRequest(request: SharedTimerRequest): Promise<SharedTimerResult> {
  if (recoverBeforeMutation()) return { ok: false };
  if (!canWriteClockStore("timer", true)) return { ok: false };
  if (request.kind === "control" || request.kind === "owned" || request.kind === "longer") {
    const actual = recoveryCommand();
    if ((request.kind !== "owned" || ["restore-stores", "remote-store"].includes(request.action)) &&
      Object.keys(actual).some(key => actual[key as keyof RecoveryCommand] !== request.expected[key as keyof RecoveryCommand])) return { ok: false };
    if (request.kind === "owned") {
      if (request.action === "task-stat") {
        const edit = request.payload as { taskId: string; done: boolean };
        if (tasks.get().find(task => task.id === edit.taskId)?.done !== edit.done) return { ok: false };
      }
      if (request.action === "restore-stores" && Array.isArray(request.payload)) {
        const { entries, keptTimer } = prepareTimerRestore(request.payload);
        return { ...await executeClockAction(request.action, entries), keptTimer };
      }
      return executeClockAction(request.action, request.payload);
    }
    if (request.kind === "longer") {
      const s = timer.get(), progression = tinyStarts.get();
      if (!longerOfferAvailable() || JSON.stringify(progression.finished) !== JSON.stringify(request.finished) ||
        s.startedAt !== null || s.segment !== "focus" || s.elapsedBefore > 0 || recoveryOffer()) return { ok: false };
      settleLongerOffer(request.choice);
      if (request.choice === "accepted") timerActions.start();
      return { ok: true };
    }
    if (request.action === "complete" || !Object.hasOwn(localTimerActions, request.action)) return { ok: false };
    if (request.action === "answerTransition" && (transitionStore.get()?.segId ?? null) !== request.noticeId) return { ok: false };
    const result = await (localTimerActions[request.action] as (...args: unknown[]) => unknown)(...request.args);
    return result && typeof result === "object" && "ok" in result && !result.ok ? { ok: false, refusal: result as TimerRefusal } : { ok: true };
  }
  if (request.kind === "activity") {
    if (!Number.isFinite(request.at) || request.at < 0) return { ok: false };
    purposefulAction(request.at);
    return { ok: true };
  }
  if (request.kind === "review-control") {
    const actual = recoveryCommand();
    if ((parkingReview.get().review?.id ?? null) !== request.reviewId ||
      Object.keys(actual).some(key => actual[key as keyof RecoveryCommand] !== request.expected[key as keyof RecoveryCommand])) return { ok: false };
    if (request.choice === "open") openParkingReview();
    else chooseReviewBoundary(request.choice);
    return { ok: true };
  }
  if (request.kind === "recovery") return { ok: answerRecovery(request.expected, request.action, request.override) };
  if (request.kind === "tiny") {
    const actual = recoveryCommand();
    if (Object.keys(actual).some(key => actual[key as keyof RecoveryCommand] !== request.expected[key as keyof RecoveryCommand])) return { ok: false };
    return { ok: startTinyBlock(request.expected.expectedSegId, request.minutes) };
  }
  if (request.kind === "undo") {
    const undo = reviewUndos.get(request.token);
    reviewUndos.delete(request.token);
    undo?.();
    return { ok: !!undo };
  }
  const result = answerParkingRecovery(request.expected, request.itemId, request.choice);
  if (!result.undo) return { ok: result.ok };
  const token = uid();
  reviewUndos.set(token, result.undo);
  setTimeout(() => reviewUndos.delete(token), 10_000);
  return { ok: result.ok, undoToken: token };
}
commands?.addEventListener("message", (event: MessageEvent) => {
  const message = event.data;
  if (message?.type === "clock-hello" && canWriteClockStore("timer") && timer.get().startedAt !== null && !departing) {
    commands?.postMessage({ type: "clock-alive", segId: timer.get().segId, ownerId });
  } else if (message?.type === "clock-alive" && !canWriteClockStore("timer") && typeof message.segId === "string" && typeof message.ownerId === "string") {
    witnessedOwner = { segId: message.segId, ownerId: message.ownerId };
  } else if (message?.type === "timer-result") {
    const waiting = commandWaiters.get(message.id);
    if (!waiting) return;
    clearTimeout(waiting.timeout); commandWaiters.delete(message.id);
    if (message.error) waiting.reject(new Error(message.error));
    else waiting.resolve(message.result);
  } else if (message?.type === "timer-request" && canWriteClockStore("timer")) {
    void (async () => {
      try {
        const result = await executeSharedTimerRequest(message.request);
        await flushReadyStores();
        commands.postMessage({ type: "timer-result", id: message.id, result });
      } catch {
        commands.postMessage({ type: "timer-result", id: message.id, error: "Could not save the timer change. Try again." });
      }
    })();
  }
});
async function sharedTimerRequest(request: SharedTimerRequest): Promise<SharedTimerResult> {
  await timerHydrationReady;
  if (canWriteClockStore("timer")) return executeSharedTimerRequest(request);
  if (promotionReady) await promotionReady;
  if (canWriteClockStore("timer")) return executeSharedTimerRequest(request);
  if (!commands) throw new Error("Could not reach the active timer. Try again.");
  await flushReadyStores();
  if (canWriteClockStore("timer")) return executeSharedTimerRequest(request);
  const id = uid();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { commandWaiters.delete(id); reject(new Error("Could not reach the active timer. Try again.")); }, 5000);
    commandWaiters.set(id, { request, resolve, reject, timeout });
    commands.postMessage({ type: "timer-request", id, request });
  });
}
export async function requestRecovery(expected: RecoveryCommand, action: RecoveryAnswer, override?: number) {
  return (await sharedTimerRequest({ kind: "recovery", expected, action, override })).ok;
}
export async function requestTinyBlock(expected: RecoveryCommand, minutes: number) {
  return (await sharedTimerRequest({ kind: "tiny", expected, minutes })).ok;
}
export async function requestParkingRecovery(expected: RecoveryCommand, itemId: string, choice: ParkingRecoveryAnswer) {
  const result = await sharedTimerRequest({ kind: "parking", expected, itemId, choice });
  const token = result.undoToken;
  return { ok: result.ok, undo: token ? () => { void sharedTimerRequest({ kind: "undo", token }); } : undefined };
}

registerClockForwarder((action, payload) => sharedTimerRequest({ kind: "owned", expected: recoveryCommand(), action, payload }));
registerClockAction("restore-backup", async ({ backup, selected }) => {
  // Lazy UI modules need not have loaded in the owning tab. Import preparation
  // and its sync queue belong here, regardless of which tab opened the picker.
  const [{ restoreBackup }, { metaAfterImport }] = await Promise.all([import("../lib/backup"), import("../lib/sync")]);
  return { ok: true, keptTimer: await restoreBackup(backup, metaAfterImport, selected) };
});
export async function requestLongerOffer(expected: RecoveryCommand, choice: "accepted" | "dismissed", finished: string[]) {
  return (await sharedTimerRequest({ kind: "longer", expected, choice, finished })).ok;
}

registerClockAction("reset-profile", async () => {
  if (hardModeLocked()) return { ok: false };
  await clearStoredProfile(); return { ok: true };
});
export async function requestProfileReset() {
  return (await requestClockAction("reset-profile", null)).ok;
}
