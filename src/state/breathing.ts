export type BreathingPattern = "even" | "sigh";
export type BreathingPace = 1 | 1.5;

/** Elapsed time is supplied by the view's monotonic clock. No timer or stats writes. */
export function breathingFrame(elapsed: number, minutes: 1 | 5, pattern: BreathingPattern, pace: BreathingPace) {
  const remaining = Math.max(0, minutes * 60000 - Math.max(0, elapsed));
  const cycle = (Math.max(0, elapsed) / pace) % 10000;
  const phase = pattern === "sigh" ? cycle < 2000 ? "Breathe in" : cycle < 3000 ? "A little more in" : "Breathe out" :
    cycle < 4000 ? "Breathe in" : "Breathe out";
  return { remaining, done: remaining === 0, phase };
}
