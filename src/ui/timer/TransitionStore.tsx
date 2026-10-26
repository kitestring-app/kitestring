import type { Segment } from "../../state/timerEngine";
import { alertTypingGuard } from "../../lib/alertTypingGuard";

export interface TransitionNotice {
  segId: string;
  ended: Segment;
  at: number;
  nextSegId: string;
  breakSegment: "short" | "long";
  breakRound: number;
  snoozes: number;
  autoStarted?: boolean;
  cycleComplete?: boolean;
}

/** Deliberately local and transient: only the clock's leader opens reminders. */
export function createTransitionStore() {
  let notice: TransitionNotice | null = null;
  const seen = new Set<string>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((fn) => fn());
  return {
    get: () => notice,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    show(next: TransitionNotice) {
      if (seen.has(next.segId)) return false;
      seen.add(next.segId);
      alertTypingGuard.begin();
      notice = next;
      emit();
      return true;
    },
    dismiss() {
      notice = null;
      emit();
    },
  };
}

export const transitionStore = createTransitionStore();
